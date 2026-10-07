/**
 * Module D: Synchronization & Drift Compensation Engine
 * State machine handling PLAY, PAUSE, SEEK, PING, PONG, and dynamic drift correction.
 */

import { SyncPayload, SyncEventType, SyncRole, PeerState, FingerprintMatchStatus, ChatMessagePayload } from '../types';
import { NostrRelayPool } from '../network/relayPool';
import { NostrIdentity, signEphemeralSyncEvent } from '../network/nostrIdentity';
import { encryptPayload, decryptPayload } from '../crypto/e2ee';
import { VerifiedEvent } from 'nostr-tools';

export const PEER_TIMEOUT_MS = 60000;

export interface SyncEngineCallbacks {
  onPeerUpdate: (peer: PeerState | null) => void;
  onFingerprintStatusChange: (status: FingerprintMatchStatus, peerFingerprint?: string) => void;
  onAnnounceMessage: (message: string) => void;
  onDiagnosticsUpdate: (stats: {
    rttMs: number;
    driftMs: number;
    currentRate: number;
    manualOffsetSec: number;
    peerTimeSec: number;
    localTimeSec: number;
    role: SyncRole;
  }) => void;
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  onCountdownStart: (targetStartTime: number) => void;
  onCountdownAbort: () => void;
  onChatMessage: (msg: ChatMessagePayload, isSelf: boolean) => void;
  onPauseWithDetails: (pausedBy: string, timeSec: number) => void;
  onRoleChange?: (role: SyncRole, triggeredByPeer: boolean) => void;
  onPeerAudioDecoded?: (peerId: string, trackName: string) => void;
}

export class SyncEngine {
  private video: HTMLVideoElement | null = null;
  private identity: NostrIdentity;
  private relayPool: NostrRelayPool;
  private aesKey: CryptoKey | null = null;
  private hashedRoomTag: string | null = null;
  private senderId: string;
  private sequenceId = 0;
  private manualOffset = 0; // seconds (-2.0 to +2.0)
  private localFingerprint: string | null = null;
  private role: SyncRole = 'PRIMARY';
  private isHost = false;
  private lastPlayStartTime = 0;

  private isApplyingRemoteUpdate = false;
  private pingIntervalTimer: number | null = null;
  private driftCheckTimer: number | null = null;
  private activePeer: PeerState | null = null;
  private lastReportedFpStatus: FingerprintMatchStatus | null = null;
  private lastReportedPeerFp: string | null = null;

  // Track pending ping timestamps
  private pendingPings = new Map<string, number>();

  private callbacks: SyncEngineCallbacks;

  constructor(
    identity: NostrIdentity,
    relayPool: NostrRelayPool,
    callbacks: SyncEngineCallbacks
  ) {
    this.identity = identity;
    this.relayPool = relayPool;
    this.callbacks = callbacks;
    // 8-character unique session token for this browser tab
    this.senderId = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Bind relay pool incoming event handler
    this.relayPool.addEventListener((event) => this.handleIncomingNostrEvent(event));
    this.relayPool.addLogListener((msg, level) => this.callbacks.onLog(msg, level));

    // Start background ping & drift monitoring loops
    this.startHeartbeatLoops();
  }

  public attachVideo(video: HTMLVideoElement): void {
    this.detachVideo();
    this.video = video;

    // Attach listeners for local user interactions
    this.video.addEventListener('play', this.handleLocalPlay);
    this.video.addEventListener('pause', this.handleLocalPause);
    this.video.addEventListener('seeked', this.handleLocalSeeked);
    this.video.addEventListener('ratechange', this.handleLocalRateChange);
  }

  public detachVideo(): void {
    if (this.video) {
      this.video.removeEventListener('play', this.handleLocalPlay);
      this.video.removeEventListener('pause', this.handleLocalPause);
      this.video.removeEventListener('seeked', this.handleLocalSeeked);
      this.video.removeEventListener('ratechange', this.handleLocalRateChange);
      this.video = null;
    }
  }

  public setRoomCredentials(aesKey: CryptoKey, hashedRoomTag: string): void {
    this.aesKey = aesKey;
    this.hashedRoomTag = hashedRoomTag;
    this.lastReportedFpStatus = null;
    this.lastReportedPeerFp = null;
    this.relayPool.setRoomTag(hashedRoomTag);
    // Announce presence immediately
    this.broadcastEvent('ANNOUNCE');
  }

  public setLocalFingerprint(fingerprint: string | null): void {
    this.localFingerprint = fingerprint;
    this.updateFingerprintStatus();
    if (this.aesKey && this.hashedRoomTag) {
      this.broadcastEvent('ANNOUNCE');
    }
  }

  public setManualOffset(seconds: number): void {
    this.manualOffset = seconds;
    this.callbacks.onLog(`[Sync] Manual offset adjusted to ${seconds > 0 ? '+' : ''}${seconds.toFixed(2)}s`);
    this.performDriftCorrection();
  }

  public getManualOffset(): number {
    return this.manualOffset;
  }

  public getLocalFingerprint(): string | null {
    return this.localFingerprint;
  }

  public getPeer(): PeerState | null {
    return this.activePeer;
  }

  // ================= Local Event Handlers =================

  private handleLocalPlay = (): void => {
    if (this.isApplyingRemoteUpdate) return;
    this.lastPlayStartTime = Date.now();
    this.callbacks.onLog('[Local] User pressed Play');
    this.broadcastEvent('PLAY');
    this.callbacks.onAnnounceMessage('Playback started');
  };

  private handleLocalPause = (): void => {
    if (this.isApplyingRemoteUpdate) return;
    this.callbacks.onLog('[Local] User pressed Pause');
    this.broadcastEvent('PAUSE');
    this.callbacks.onAnnounceMessage('Playback paused');
  };

  private handleLocalSeeked = (): void => {
    if (this.isApplyingRemoteUpdate) return;
    if (!this.video) return;
    this.callbacks.onLog(`[Local] User seeked to ${this.formatTime(this.video.currentTime)}`);
    this.broadcastEvent('SEEK');
    this.callbacks.onAnnounceMessage(`Seeked to ${this.formatTime(this.video.currentTime)}`);
  };

  private handleLocalRateChange = (): void => {
    // Only logged if manually modified outside drift controller
  };

  // ================= Network Broadcasting =================

  private async broadcastEvent(
    type: SyncEventType,
    pingNonce?: string,
    echoTimestamp?: number,
    extra?: {
      targetStartTime?: number;
      chatMessage?: ChatMessagePayload;
      pausedBy?: string;
      audioDecodedTrack?: string;
    }
  ): Promise<void> {
    if (!this.aesKey || !this.hashedRoomTag) return;

    this.sequenceId++;
    const currentTime = this.video ? this.video.currentTime : 0;
    const paused = this.video ? this.video.paused : true;
    const playbackRate = this.video ? this.video.playbackRate : 1.0;
    const duration = this.video && !isNaN(this.video.duration) ? this.video.duration : 0;

    const payload: SyncPayload = {
      version: 1,
      senderId: this.senderId,
      sequenceId: this.sequenceId,
      timestamp: Date.now(),
      type,
      playbackTime: currentTime,
      playbackRate,
      paused,
      fingerprint: this.localFingerprint || undefined,
      duration: duration || undefined,
      pingNonce,
      echoTimestamp,
      targetStartTime: extra?.targetStartTime,
      chatMessage: extra?.chatMessage,
      pausedBy: extra?.pausedBy,
      role: this.role,
      audioDecodedTrack: extra?.audioDecodedTrack
    };

    try {
      const encryptedBase64 = await encryptPayload(payload, this.aesKey);
      const nostrEvent = signEphemeralSyncEvent(this.identity, this.hashedRoomTag, encryptedBase64);
      this.relayPool.publish(nostrEvent);
    } catch (err) {
      this.callbacks.onLog(`[Sync] Failed to encrypt/broadcast event: ${err}`, 'error');
    }
  }

  // ================= Incoming Event Processing =================

  private async handleIncomingNostrEvent(event: VerifiedEvent): Promise<void> {
    if (!this.aesKey) return;

    const payload = await decryptPayload(event.content, this.aesKey);
    if (!payload) {
      // Packet failed decryption or schema validation
      return;
    }

    // Filter out our own messages
    if (payload.senderId === this.senderId) {
      return;
    }

    const now = Date.now();

    // Track or update peer state
    if (!this.activePeer || this.activePeer.peerId !== payload.senderId) {
      this.activePeer = {
        peerId: payload.senderId,
        lastSeen: now,
        fingerprint: payload.fingerprint,
        playbackTime: payload.playbackTime,
        paused: payload.paused,
        playbackRate: payload.playbackRate,
        rttMs: 0,
        estimatedClockSkewMs: 0,
        role: payload.role
      };
      this.callbacks.onLog(`[Sync] Peer connected: ${payload.senderId}`);
      this.callbacks.onAnnounceMessage(`Peer connected: ${payload.senderId}`);

      // Role Assignment: The second user that joins is Clock (PRIMARY), and the first user (host) becomes Follower (SECONDARY)
      if (this.isHost) {
        if (this.role !== 'SECONDARY') {
          this.setRole('SECONDARY', false);
          this.callbacks.onLog('[Sync] Second user joined room: Local (User 1) is SECONDARY (follower), Peer (User 2) is PRIMARY (clock).');
          this.callbacks.onRoleChange?.('SECONDARY', true);
        }
      } else {
        if (this.role !== 'PRIMARY') {
          this.setRole('PRIMARY', false);
          this.callbacks.onLog('[Sync] Joined room as second user: Local is PRIMARY (clock), Peer is SECONDARY (follower).');
          this.callbacks.onRoleChange?.('PRIMARY', true);
        }
      }
    } else {
      this.activePeer.lastSeen = now;
      if (payload.fingerprint) {
        this.activePeer.fingerprint = payload.fingerprint;
      }
      this.activePeer.playbackTime = payload.playbackTime;
      this.activePeer.paused = payload.paused;
      this.activePeer.playbackRate = payload.playbackRate;
      if (payload.role) {
        this.activePeer.role = payload.role;
      }
    }

    this.updateFingerprintStatus();
    this.callbacks.onPeerUpdate(this.activePeer);

    // Process specific event types
    switch (payload.type) {
      case 'ROLE_CHANGE':
        if (payload.role) {
          // Opposite role to peer to avoid two-way fighting
          const desiredRole: SyncRole = payload.role === 'PRIMARY' ? 'SECONDARY' : 'PRIMARY';
          this.setRole(desiredRole, false);
          this.callbacks.onLog(`[Sync] Peer switched role to ${payload.role}. Local role is now ${desiredRole}.`);
          this.callbacks.onRoleChange?.(desiredRole, true);
        }
        break;

      case 'AUDIO_DECODED':
        const trackName = payload.audioDecodedTrack || 'Dolby Audio';
        if (this.activePeer) {
          this.activePeer.isAudioDecoded = true;
        }
        this.callbacks.onLog(`[Audio] Peer finished audio decoding: ${trackName}`);
        this.callbacks.onPeerAudioDecoded?.(payload.senderId, trackName);
        break;

      case 'PING':
        this.handleRemotePing(payload);
        break;

      case 'PONG':
        this.handleRemotePong(payload);
        break;

      case 'PLAY':
        this.handleRemotePlay(payload);
        break;

      case 'PAUSE':
        this.handleRemotePause(payload);
        this.callbacks.onPauseWithDetails(payload.pausedBy || payload.senderId, payload.playbackTime);
        break;

      case 'SEEK':
        this.handleRemoteSeek(payload);
        break;

      case 'COUNTDOWN_START':
        if (payload.targetStartTime) {
          this.lastPlayStartTime = payload.targetStartTime;
          this.callbacks.onLog(`[Sync] Peer initiated 3s countdown start at ${this.formatTime(payload.playbackTime)}`);
          this.callbacks.onCountdownStart(payload.targetStartTime);
          if (this.video && Math.abs(this.video.currentTime - payload.playbackTime) > 0.3) {
            this.isApplyingRemoteUpdate = true;
            this.video.currentTime = Math.max(0, payload.playbackTime + this.manualOffset);
            setTimeout(() => { this.isApplyingRemoteUpdate = false; }, 80);
          }
        }
        break;

      case 'COUNTDOWN_ABORT':
        this.callbacks.onLog(`[Sync] Peer cancelled countdown`);
        this.callbacks.onCountdownAbort();
        if (this.video) {
          this.isApplyingRemoteUpdate = true;
          this.video.pause();
          setTimeout(() => { this.isApplyingRemoteUpdate = false; }, 80);
        }
        break;

      case 'CHAT_MESSAGE':
        if (payload.chatMessage) {
          this.callbacks.onChatMessage(payload.chatMessage, false);
        }
        break;

      case 'ANNOUNCE':
        this.callbacks.onLog(`[Sync] Peer announced state: ${this.formatTime(payload.playbackTime)} (${payload.paused ? 'paused' : 'playing'}, role: ${payload.role || 'default'})`);
        // Immediately reply with a ping to establish bidirectional handshake and compute RTT
        const nonce = Math.random().toString(36).substring(2, 8);
        this.pendingPings.set(nonce, Date.now());
        this.broadcastEvent('PING', nonce);
        break;
    }
  }

  private handleRemotePing(payload: SyncPayload): void {
    if (!payload.pingNonce) return;
    // Instantly reply with PONG echoing token and timestamp
    this.broadcastEvent('PONG', payload.pingNonce, payload.timestamp);
  }

  private handleRemotePong(payload: SyncPayload): void {
    if (!payload.pingNonce || !payload.echoTimestamp) return;

    const sentAt = this.pendingPings.get(payload.pingNonce) || payload.echoTimestamp;
    this.pendingPings.delete(payload.pingNonce);

    const now = Date.now();
    const rtt = Math.max(1, now - sentAt);

    if (this.activePeer) {
      // Smooth RTT using moving average
      this.activePeer.rttMs = this.activePeer.rttMs === 0 ? rtt : Math.round(0.7 * this.activePeer.rttMs + 0.3 * rtt);
      this.callbacks.onPeerUpdate(this.activePeer);
    }

    // Trigger drift check
    this.performDriftCorrection();
  }

  private handleRemotePlay(payload: SyncPayload): void {
    if (!this.video) return;

    this.lastPlayStartTime = Date.now();
    const oneWayLatencySec = (this.activePeer?.rttMs || 100) / 2000;
    const targetTime = payload.playbackTime + (oneWayLatencySec * payload.playbackRate) + this.manualOffset;

    this.callbacks.onLog(`[Remote] Peer started playback at ${this.formatTime(targetTime)}`);
    this.callbacks.onAnnounceMessage(`Peer started playback at ${this.formatTime(targetTime)}`);

    this.isApplyingRemoteUpdate = true;
    try {
      if (Math.abs(this.video.currentTime - targetTime) > 0.3) {
        this.video.currentTime = Math.max(0, targetTime);
      }
      this.video.playbackRate = 1.0;
      const playPromise = this.video.play();
      if (playPromise) {
        playPromise.catch(() => {
          this.callbacks.onLog('[Sync] Browser blocked autoplay without user gesture. Click video to start.', 'warn');
          this.callbacks.onAnnounceMessage('Playback blocked: Click video player to enable audio/video playback');
        });
      }
    } finally {
      // Small timeout to allow browser video event queue to settle
      setTimeout(() => {
        this.isApplyingRemoteUpdate = false;
      }, 100);
    }
  }

  private handleRemotePause(payload: SyncPayload): void {
    if (!this.video) return;

    const targetTime = payload.playbackTime + this.manualOffset;
    this.callbacks.onLog(`[Remote] Peer paused playback at ${this.formatTime(targetTime)}`);
    this.callbacks.onAnnounceMessage(`Peer paused at ${this.formatTime(targetTime)}`);

    this.isApplyingRemoteUpdate = true;
    try {
      this.video.pause();
      if (Math.abs(this.video.currentTime - targetTime) > 0.3) {
        this.video.currentTime = Math.max(0, targetTime);
      }
      this.video.playbackRate = 1.0;
    } finally {
      setTimeout(() => {
        this.isApplyingRemoteUpdate = false;
      }, 100);
    }
  }

  private handleRemoteSeek(payload: SyncPayload): void {
    if (!this.video) return;

    const targetTime = payload.playbackTime + this.manualOffset;
    this.callbacks.onLog(`[Remote] Peer seeked to ${this.formatTime(targetTime)}`);
    this.callbacks.onAnnounceMessage(`Peer seeked to ${this.formatTime(targetTime)}`);

    this.isApplyingRemoteUpdate = true;
    try {
      this.video.currentTime = Math.max(0, targetTime);
      if (payload.paused) {
        this.video.pause();
      } else {
        this.video.play().catch(() => {});
      }
      this.video.playbackRate = 1.0;
    } finally {
      setTimeout(() => {
        this.isApplyingRemoteUpdate = false;
      }, 100);
    }
  }

  // ================= Role Management =================

  public setIsHost(isHost: boolean): void {
    this.isHost = isHost;
    // The second user that joins is Clock (PRIMARY), and the first user (host) becomes Follower (SECONDARY)
    this.role = isHost ? 'SECONDARY' : 'PRIMARY';
  }

  public setRole(role: SyncRole, broadcast = true): void {
    const changed = this.role !== role;
    this.role = role;
    if (broadcast) {
      this.broadcastEvent('ROLE_CHANGE');
    }
    if (changed) {
      this.callbacks.onRoleChange?.(role, false);
    }
    // If local became PRIMARY, instantly reset playback rate to 1.00x
    if (role === 'PRIMARY' && this.video && this.video.playbackRate !== 1.0) {
      this.video.playbackRate = 1.0;
    }
  }

  public getRole(): SyncRole {
    return this.role;
  }

  public toggleRole(): SyncRole {
    const nextRole: SyncRole = this.role === 'PRIMARY' ? 'SECONDARY' : 'PRIMARY';
    this.setRole(nextRole, true);
    return nextRole;
  }

  public broadcastAudioDecoded(trackName: string): void {
    this.callbacks.onLog(`[Audio] Broadcasting audio decoded: ${trackName}`);
    this.broadcastEvent('AUDIO_DECODED', undefined, undefined, {
      audioDecodedTrack: trackName
    });
  }

  // ================= Drift Compensation Engine =================

  /**
   * Evaluates drift between local video and peer video:
   * Drift = localCurrentTime - estimatedPeerCurrentTime.
   * Drift Rules:
   * - PRIMARY (Master Clock): Plays with zero rate modifications or auto-seeks.
   * - SECONDARY (Follower):
   *   * Warmup window (<4.0s after play): suppresses hard seeks, gentle settling.
   *   * |drift| < 100ms: Do nothing (perceptual threshold).
   *   * 100ms <= |drift| <= 1200ms: Soft rate nudge (0.97x - 1.03x).
   *   * |drift| > 1200ms: Hard seek.
   */
  public performDriftCorrection(): void {
    if (!this.video || !this.activePeer) return;

    // Check if peer has timed out (> 60 seconds without message)
    const timeSincePeerSeen = Date.now() - this.activePeer.lastSeen;
    if (timeSincePeerSeen > PEER_TIMEOUT_MS) {
      this.activePeer = null;
      this.callbacks.onPeerUpdate(null);
      this.updateFingerprintStatus();
      return;
    }

    const now = Date.now();
    const rttSec = (this.activePeer.rttMs || 100) / 1000;
    const elapsedSinceLastPeerReport = (now - this.activePeer.lastSeen) / 1000;

    // Estimate current peer playback position
    let estimatedPeerTime = this.activePeer.playbackTime;
    if (!this.activePeer.paused) {
      estimatedPeerTime += elapsedSinceLastPeerReport * this.activePeer.playbackRate + (rttSec / 2);
    }

    const targetLocalTime = estimatedPeerTime + this.manualOffset;
    const localTime = this.video.currentTime;
    const driftSec = localTime - targetLocalTime;
    const driftMs = Math.round(driftSec * 1000);

    // Notify diagnostics UI
    this.callbacks.onDiagnosticsUpdate({
      rttMs: this.activePeer.rttMs,
      driftMs,
      currentRate: this.video.playbackRate,
      manualOffsetSec: this.manualOffset,
      peerTimeSec: targetLocalTime,
      localTimeSec: localTime,
      role: this.role
    });

    // If local is PRIMARY (Master Clock):
    // PRIMARY NEVER changes rate or auto-seeks to match peer!
    // Plays completely smoothly at 1.00x constant speed.
    if (this.role === 'PRIMARY') {
      if (this.video.playbackRate !== 1.0) {
        this.video.playbackRate = 1.0;
      }
      return;
    }

    // From here on: Local client is SECONDARY (Follower).

    // If local and remote are both paused, match timestamp if discrepancy > 500ms
    if (this.video.paused && this.activePeer.paused) {
      if (Math.abs(driftSec) > 0.5) {
        this.isApplyingRemoteUpdate = true;
        this.video.currentTime = Math.max(0, targetLocalTime);
        setTimeout(() => {
          this.isApplyingRemoteUpdate = false;
        }, 80);
      }
      return;
    }

    // If one is paused and the other is playing, don't nudge rate; allow user or countdown to settle
    if (this.video.paused !== this.activePeer.paused) {
      return;
    }

    const absDriftMs = Math.abs(driftMs);

    // Warmup period: First 4.0 seconds after playback starts
    // In warmup, prevent hard-seeks unless drift is catastrophic (> 3500ms).
    // This allows decoder buffers to settle without stuttering!
    const timeSincePlay = now - this.lastPlayStartTime;
    const isWarmup = !this.video.paused && timeSincePlay < 4000;

    if (isWarmup) {
      if (absDriftMs < 100) {
        if (this.video.playbackRate !== 1.0) this.video.playbackRate = 1.0;
        return;
      }
      if (absDriftMs <= 3500) {
        // Very gentle rate nudge during warmup
        const nudgeRate = driftMs > 0 ? 0.98 : 1.02;
        if (this.video.playbackRate !== nudgeRate) {
          this.video.playbackRate = nudgeRate;
          this.callbacks.onLog(`[Sync Warmup] Soft settling: drift ${driftMs > 0 ? '+' : ''}${driftMs}ms, rate ${nudgeRate}x`);
        }
        return;
      }
    }

    // Rule 1: < 100ms: within perceptual threshold
    if (absDriftMs < 100) {
      if (this.video.playbackRate !== 1.0) {
        this.video.playbackRate = 1.0;
        this.callbacks.onLog('[Sync] In sync (<100ms drift). Playback rate reset to 1.00x.');
      }
      return;
    }

    // Rule 2: 100ms <= Drift <= 1200ms: Soft rate nudge (0.97x - 1.03x)
    if (absDriftMs <= 1200) {
      if (driftMs > 0) {
        // Local is ahead: slow down softly
        if (this.video.playbackRate !== 0.97) {
          this.video.playbackRate = 0.97;
          this.callbacks.onLog(`[Sync] Soft nudge: Ahead by +${driftMs}ms. Rate adjusted to 0.97x.`);
        }
      } else {
        // Local is behind: speed up softly
        if (this.video.playbackRate !== 1.03) {
          this.video.playbackRate = 1.03;
          this.callbacks.onLog(`[Sync] Soft nudge: Behind by ${driftMs}ms. Rate adjusted to 1.03x.`);
        }
      }
      return;
    }

    // Rule 3: Drift > 1200ms: Hard seek
    this.callbacks.onLog(`[Sync] Hard seek: Drift ${driftMs > 0 ? '+' : ''}${driftMs}ms exceeded threshold (>1200ms). Seeking to ${this.formatTime(targetLocalTime)}.`);
    this.isApplyingRemoteUpdate = true;
    try {
      this.video.currentTime = Math.max(0, targetLocalTime);
      this.video.playbackRate = 1.0;
    } finally {
      setTimeout(() => {
        this.isApplyingRemoteUpdate = false;
      }, 120);
    }
  }

  private updateFingerprintStatus(): void {
    let status: FingerprintMatchStatus = 'NO_LOCAL_FILE';
    let peerFp: string | undefined = undefined;

    if (!this.localFingerprint) {
      status = 'NO_LOCAL_FILE';
    } else if (!this.activePeer || !this.activePeer.fingerprint) {
      status = 'WAITING_FOR_PEER';
    } else if (this.localFingerprint === this.activePeer.fingerprint) {
      status = 'VERIFIED';
      peerFp = this.activePeer.fingerprint;
    } else {
      status = 'MISMATCH';
      peerFp = this.activePeer.fingerprint;
    }

    if (status !== this.lastReportedFpStatus || peerFp !== this.lastReportedPeerFp) {
      this.lastReportedFpStatus = status;
      this.lastReportedPeerFp = peerFp || null;
      this.callbacks.onFingerprintStatusChange(status, peerFp);
    }
  }

  private startHeartbeatLoops(): void {
    // Send periodic PING every 3.5 seconds
    this.pingIntervalTimer = window.setInterval(() => {
      if (this.aesKey && this.hashedRoomTag) {
        const nonce = Math.random().toString(36).substring(2, 8);
        this.pendingPings.set(nonce, Date.now());
        this.broadcastEvent('PING', nonce);
      }
    }, 3500);

    // Run drift check loop every 1 second
    this.driftCheckTimer = window.setInterval(() => {
      this.performDriftCorrection();
    }, 1000);
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
    return `${mins}:${secs}.${ms}`;
  }

  public requestPlay(instant = false): void {
    if (!this.video) return;

    if (instant) {
      this.callbacks.onLog('[Local] Starting instant playback');
      this.broadcastEvent('PLAY');
      this.video.play().catch(() => {});
      return;
    }

    const targetStartTime = Date.now() + 3000;
    this.callbacks.onLog('[Local] Initiating synchronized 3s countdown');
    this.broadcastEvent('COUNTDOWN_START', undefined, undefined, { targetStartTime });
    this.callbacks.onCountdownStart(targetStartTime);
  }

  public requestPause(): void {
    if (!this.video) return;
    this.callbacks.onLog('[Local] Pausing playback');
    this.broadcastEvent('PAUSE', undefined, undefined, { pausedBy: this.senderId });
    this.broadcastEvent('COUNTDOWN_ABORT');
    this.video.pause();
    this.callbacks.onCountdownAbort();
    this.callbacks.onPauseWithDetails('You', this.video.currentTime);
  }

  public sendChatMessage(text: string): void {
    const chatMessage: ChatMessagePayload = {
      id: Math.random().toString(36).substring(2, 10),
      senderId: this.senderId,
      timestamp: Date.now(),
      text
    };
    this.broadcastEvent('CHAT_MESSAGE', undefined, undefined, { chatMessage });
    this.callbacks.onChatMessage(chatMessage, true);
  }

  public destroy(): void {
    if (this.pingIntervalTimer) clearInterval(this.pingIntervalTimer);
    if (this.driftCheckTimer) clearInterval(this.driftCheckTimer);
    this.detachVideo();
    this.pendingPings.clear();
  }
}
