/**
 * onthecountofthree: Zero-Backend Client-Side Video Synchronization
 * Main Application Orchestrator
 */

import './style.css';
import {
  generateRoomCredentials,
  parseCredentialsFromHash,
  setUrlHash,
  buildShareUrl,
  RoomCredentials
} from './crypto/keyManager';
import { createEphemeralIdentity } from './network/nostrIdentity';
import { NostrRelayPool, DEFAULT_RELAYS } from './network/relayPool';
import { PairingCodeService } from './network/pairingCode';
import { SyncEngine } from './sync/engine';
import { AriaAnnouncer } from './ui/ariaAnnouncer';
import { setupKeyboardShortcuts } from './ui/keyboardShortcuts';
import { renderTitleBar } from './ui/components/titleBar';
import { BadgesBar } from './ui/components/badges';
import { RoomBar } from './ui/components/roomBar';
import { VideoPlayerComponent } from './ui/components/videoPlayer';
import { OffsetSliderComponent } from './ui/components/offsetSlider';
import { DiagnosticsComponent } from './ui/components/diagnostics';
import { ToastNotificationManager } from './ui/components/toastNotification';
import { ChatWindowComponent } from './ui/components/chatWindow';
import { SecretHeartOverlay } from './ui/components/secretHeartOverlay';
import { openInfoModal } from './ui/components/shareModal';
import { openPairingModal } from './ui/components/pairingModal';
import { openHelpModal } from './ui/components/helpModal';
import { applyRoomTheme } from './ui/theme';
import { formatPlaybackTime } from './utils/format';
import { PeerState } from './types';

async function bootstrapApp() {
  const root = document.getElementById('app');
  if (!root) throw new Error('Root #app container not found');

  // 1. Accessibility announcer & Transient Toast Notification Manager
  const announcer = new AriaAnnouncer();
  const toastManager = new ToastNotificationManager();

  // 2. Cryptographic credentials (from hash or freshly generated)
  const hashCredentials = await parseCredentialsFromHash();
  const isHost = !hashCredentials;
  let credentials: RoomCredentials = hashCredentials || (await generateRoomCredentials());
  setUrlHash(credentials.roomId, credentials.keyBase64);
  applyRoomTheme(credentials.roomId);

  // 3. Ephemeral Nostr Identity (in-memory throwaway keypair)
  const nostrIdentity = createEphemeralIdentity();

  // 4. Multi-Relay Nostr WebSocket Transport Pool & Yellkey Pairing Service
  const relayPool = new NostrRelayPool(DEFAULT_RELAYS);
  const pairingService = new PairingCodeService(relayPool);

  // 5. Initialize UI Components
  const badgesBar = new BadgesBar({
    onToggleRole: () => {
      const newRole = syncEngine.toggleRole();
      badgesBar.updateRole(newRole);
      toastManager.show({
        title: 'Role Changed',
        message: `You are now <strong>${newRole === 'PRIMARY' ? 'Primary (Master Clock)' : 'Secondary (Follower)'}</strong>.<br><small>${newRole === 'PRIMARY' ? 'Your video plays at steady 1.00x speed without speed/seek stutter.' : 'Your video gently syncs with the Primary clock.'}</small>`,
        icon: newRole === 'PRIMARY' ? '👑' : '🎧',
        type: 'info',
        durationMs: 4000
      });
      announcer.announce(`Switched sync role to ${newRole === 'PRIMARY' ? 'Primary Master Clock' : 'Secondary Follower'}`);
    }
  });

  const diagnostics = new DiagnosticsComponent({
    onAddRelay: (url) => {
      relayPool.addRelay(url);
      diagnostics.appendLog(`[Relay] Added custom relay: ${url}`);
    },
    onRemoveRelay: (url) => {
      relayPool.removeRelay(url);
      diagnostics.appendLog(`[Relay] Removed relay: ${url}`, 'warn');
    }
  });

  let chatCol: HTMLElement;

  // Secret Hearts Overlay for /polina command
  const polinaOverlay = new SecretHeartOverlay();

  const chatWindow = new ChatWindowComponent({
    onSendMessage: (text) => {
      syncEngine.sendChatMessage(text);
    },
    onVisibilityChange: (isOpen) => {
      if (isOpen) {
        roomBar.updateUnreadChat(0);
        if (chatCol) chatCol.style.display = 'block';
      } else {
        if (chatCol) chatCol.style.display = 'none';
      }
    },
    onSecretCommand: (cmd) => {
      if (cmd === 'polina') {
        polinaOverlay.show();
      }
    }
  });

  const roomBar = new RoomBar({
    onNewRoom: async () => {
      credentials = await generateRoomCredentials();
      setUrlHash(credentials.roomId, credentials.keyBase64);
      applyRoomTheme(credentials.roomId);
      roomBar.updateCredentials(credentials.roomId, credentials.keyBase64);
      syncEngine.setIsHost(true);
      syncEngine.setRoomCredentials(credentials.aesKey, credentials.hashedRoomTag);
      badgesBar.updateRole(syncEngine.getRole());
      announcer.announce('Created new encrypted room. You are Follower; second user that joins will be Master Clock.');
      diagnostics.appendLog(`[Room] Generated fresh Room ID ${credentials.roomId}`);
    },
    onOpenInfoModal: () => {
      const shareUrl = buildShareUrl(credentials.roomId, credentials.keyBase64);
      openInfoModal(shareUrl, () => {});
    },
    onOpenPairingModal: () => {
      openPairingModal({
        pairingService,
        currentRoomId: credentials.roomId,
        currentKeyBase64: credentials.keyBase64,
        onJoinRoom: (newRoomId, newKeyBase64) => {
          setUrlHash(newRoomId, newKeyBase64);
          window.location.hash = `#room=${encodeURIComponent(newRoomId)}&key=${encodeURIComponent(newKeyBase64)}`;
          window.location.reload();
        },
        onClose: () => {}
      });
    },
    onToggleChat: () => {
      chatWindow.toggle();
    },
    onToggleDiagnostics: () => {
      diagnostics.toggle();
    }
  });

  chatWindow.setUnreadBadgeCallback((count) => {
    roomBar.updateUnreadChat(count);
  });

  const offsetSlider = new OffsetSliderComponent({
    onOffsetChange: (offset) => {
      syncEngine.setManualOffset(offset);
      announcer.announce(`Manual offset set to ${offset > 0 ? '+' : ''}${offset.toFixed(2)} seconds`);
    }
  });

  let currentPeerFingerprint: string | undefined = undefined;
  let previousPeer: PeerState | null = null;

  // 6. Synchronization & Drift Engine
  const syncEngine = new SyncEngine(nostrIdentity, relayPool, {
    onPeerUpdate: (peer) => {
      badgesBar.updatePeerState(peer);
      currentPeerFingerprint = peer?.fingerprint;

      // Toast when peer connects/disconnects (no chat crowding)
      if (peer && !previousPeer) {
        const roleMsg = syncEngine.getRole() === 'PRIMARY'
          ? 'You are Master Clock (zero rate changes). Peer is Follower.'
          : 'Second user joined as Master Clock. You are Follower.';
        toastManager.show({
          title: 'Peer Connected',
          message: `User <strong>${peer.peerId}</strong> joined the room.<br><small>${roleMsg}</small>`,
          icon: '👋',
          type: 'info',
          durationMs: 4500
        });
      } else if (!peer && previousPeer) {
        toastManager.show({
          title: 'Peer Disconnected',
          message: `Peer <strong>${previousPeer.peerId}</strong> disconnected or timed out.`,
          icon: '🔌',
          type: 'warn',
          durationMs: 4000
        });
      }
      previousPeer = peer;
    },
    onFingerprintStatusChange: (status, peerFp) => {
      diagnostics.updateFingerprint(status, syncEngine.getLocalFingerprint() || undefined, peerFp);
      if (status === 'VERIFIED') {
        // Silently updated in diagnostics card; no distracting popups
      } else if (status === 'MISMATCH') {
        announcer.announce('Warning: Fingerprint mismatch! Peer has a different file.');
        toastManager.show({
          title: 'Fingerprint Mismatch',
          message: `Warning: Local file code does not match peer's file!`,
          icon: '⚠',
          type: 'warn',
          durationMs: 6000
        });
      }
    },
    onAnnounceMessage: (msg) => {
      announcer.announce(msg);
    },
    onDiagnosticsUpdate: (stats) => {
      diagnostics.updateStats(stats);
    },
    onLog: (msg, level) => {
      diagnostics.appendLog(msg, level);
    },
    onCountdownStart: (targetStartTime) => {
      announcer.announce('Countdown started: playing on the count of three');
      videoPlayer.startSynchronizedCountdown(targetStartTime, () => {
        videoPlayer.getVideoElement().play().catch(() => {});
      });
    },
    onCountdownAbort: () => {
      announcer.announce('Countdown cancelled');
      videoPlayer.cancelCountdown();
    },
    onChatMessage: (msg, isSelf) => {
      chatWindow.addMessage(msg, isSelf);
      if (!isSelf) {
        announcer.announce(`New message from peer: ${msg.text}`);
        const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
        if (isFs || !chatWindow.getIsOpen()) {
          toastManager.show({
            title: `Chat from Peer ${msg.senderId.slice(0, 4)}`,
            message: msg.text.slice(0, 80),
            icon: '💬',
            type: 'info',
            durationMs: 3500
          });
        }
      }
      const textClean = msg.text.trim().toLowerCase();
      if (textClean === '/polina' || textClean.startsWith('/polina ') || textClean.startsWith('/polina!')) {
        polinaOverlay.show();
      }
    },
    onPauseWithDetails: (pausedBy, timeSec) => {
      const bannerMsg = `Paused by ${pausedBy === 'You' ? 'You' : `Peer ${pausedBy.slice(0, 4)}`} at ${formatPlaybackTime(timeSec)}`;
      videoPlayer.showPauseBanner(bannerMsg);
    },
    onRoleChange: (role, triggeredByPeer) => {
      badgesBar.updateRole(role);
      if (triggeredByPeer) {
        toastManager.show({
          title: 'Role Updated',
          message: `Peer updated sync roles. You are now <strong>${role === 'PRIMARY' ? 'Primary (Master Clock)' : 'Secondary (Follower)'}</strong>.`,
          icon: role === 'PRIMARY' ? '👑' : '🎧',
          type: 'info',
          durationMs: 4000
        });
        announcer.announce(`Role updated: You are ${role === 'PRIMARY' ? 'Primary Master Clock' : 'Secondary Follower'}`);
      }
    },
    onPeerAudioDecoded: (peerId, trackName) => {
      toastManager.show({
        title: 'Peer Audio Ready',
        message: `Peer <strong>${peerId.slice(0, 4)}</strong> finished decoding audio track: <em>${trackName}</em>.<br><small>Both sides are ready for synchronized playback!</small>`,
        icon: '🎧',
        type: 'info',
        durationMs: 5000
      });
      announcer.announce(`Peer finished decoding audio: ${trackName}`);
    }
  });

  // Supply active room credentials and initial role to sync engine
  syncEngine.setIsHost(isHost);
  badgesBar.updateRole(syncEngine.getRole());
  syncEngine.setRoomCredentials(credentials.aesKey, credentials.hashedRoomTag);
  roomBar.updateCredentials(credentials.roomId, credentials.keyBase64);

  // Monitor relay connection status
  relayPool.addStatusListener((relays) => {
    badgesBar.updateRelayStatuses(relays);
    diagnostics.updateRelayTable(relays);
  });

  relayPool.addLogListener((msg, level) => {
    diagnostics.appendLog(msg, level);
  });

  // 7. Video Player Component
  const videoPlayer = new VideoPlayerComponent({
    onFingerprintComputed: (fpResult) => {
      syncEngine.setLocalFingerprint(fpResult.code);
      diagnostics.updateFingerprint(
        currentPeerFingerprint === fpResult.code ? 'VERIFIED' : (currentPeerFingerprint ? 'MISMATCH' : 'WAITING_FOR_PEER'),
        fpResult.code,
        currentPeerFingerprint
      );
    },
    onUserPlayRequest: (instant) => {
      syncEngine.requestPlay(instant);
    },
    onUserPauseRequest: () => {
      syncEngine.requestPause();
    },
    onUserSeek: (targetTime) => {
      diagnostics.appendLog(`[Video] Scrubbed timeline to ${targetTime.toFixed(2)}s`);
    },
    onLog: (msg, level) => {
      diagnostics.appendLog(msg, level);
    },
    onAnnounce: (msg) => {
      announcer.announce(msg);
    },
    onAudioDecoded: (trackName) => {
      syncEngine.broadcastAudioDecoded(trackName);
    },
    onNoVideoWarning: () => {
      toastManager.show({
        title: 'No Video File Loaded',
        message: 'Please select or drag-and-drop a local video file (MP4, MKV, WebM) before pressing Play.',
        icon: '⚠',
        type: 'warn',
        durationMs: 4500
      });
      announcer.announce('Warning: No video file loaded. Please select a video file first.');
    }
  });

  // Attach video element to sync engine
  syncEngine.attachVideo(videoPlayer.getVideoElement());

  // 8. Keyboard Shortcuts
  setupKeyboardShortcuts({
    onTogglePlayPause: () => videoPlayer.triggerPlayPauseAction(),
    onSeekRelative: (sec) => videoPlayer.seekRelative(sec),
    onVolumeChange: (delta) => videoPlayer.adjustVolume(delta),
    onToggleFullscreen: () => videoPlayer.toggleFullscreen(),
    onToggleMute: () => videoPlayer.toggleMute(),
    onToggleControls: () => videoPlayer.toggleControlsVisibility(),
    onFocusChat: () => {
      chatWindow.show();
      announcer.announce('Focused chat input');
    },
    onToggleHelp: () => {
      const existing = document.querySelector('.modal-backdrop');
      if (existing) {
        existing.remove();
      } else {
        openHelpModal();
      }
    }
  });

  // Listen for hash changes in case user pastes another link into address bar
  window.addEventListener('hashchange', async () => {
    const newCreds = await parseCredentialsFromHash();
    if (newCreds && newCreds.roomId !== credentials.roomId) {
      credentials = newCreds;
      applyRoomTheme(credentials.roomId);
      roomBar.updateCredentials(credentials.roomId, credentials.keyBase64);
      syncEngine.setRoomCredentials(credentials.aesKey, credentials.hashedRoomTag);
      diagnostics.appendLog(`[Room] Switched to room from hash URL: ${credentials.roomId}`);
      announcer.announce('Joined room from URL');
    }
  });

  // 9. Assemble UI Layout inside System 7 / 90s Window
  const windowFrame = document.createElement('div');
  windowFrame.className = 'window-frame';

  const windowTitlebar = renderTitleBar();
  const windowBody = document.createElement('div');
  windowBody.className = 'window-body';

  windowBody.appendChild(roomBar.getElement());
  windowBody.appendChild(badgesBar.getElement());

  // Main Workspace: Media on left, Chat on right
  const workspaceRow = document.createElement('div');
  workspaceRow.className = 'workspace-row';

  const mediaCol = document.createElement('div');
  mediaCol.className = 'media-col';
  mediaCol.appendChild(videoPlayer.getElement());
  mediaCol.appendChild(offsetSlider.getElement());
  mediaCol.appendChild(diagnostics.getElement());

  chatCol = document.createElement('div');
  chatCol.className = 'chat-col';
  chatCol.appendChild(chatWindow.getElement());

  workspaceRow.appendChild(mediaCol);
  workspaceRow.appendChild(chatCol);
  windowBody.appendChild(workspaceRow);

  windowFrame.appendChild(windowTitlebar);
  windowFrame.appendChild(windowBody);
  root.appendChild(windowFrame);

  // Footer status bar
  const footer = document.createElement('footer');
  footer.className = 'footer-statusbar';
  footer.innerHTML = `
    <span>Status: SYSTEM READY • ZERO-BACKEND STATIC CLIENT</span>
    <span>Hotkeys: [Space] Play/Pause • [← / →] ±5s Seek • [↑ / ↓] Volume • [F] Fullscreen • [M] Mute</span>
    <span>Countdown: 3s SYNCHRONIZED PLAY</span>
  `;
  root.appendChild(footer);

  diagnostics.appendLog(`[System] Initialized Room ${credentials.roomId.slice(0, 8)}...`);
  diagnostics.appendLog('[System] Ready for local video file selection.');
}

// Start application
bootstrapApp().catch((err) => {
  console.error('Fatal initialization error:', err);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `<div style="padding: 20px; color: red; background: #fff; font-family: monospace;">Fatal Error: ${err}</div>`;
  }
});
