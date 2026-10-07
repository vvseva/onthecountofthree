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
import { SyncEngine } from './sync/engine';
import { AriaAnnouncer } from './ui/ariaAnnouncer';
import { setupKeyboardShortcuts } from './ui/keyboardShortcuts';
import { renderTitleBar } from './ui/components/titleBar';
import { BadgesBar } from './ui/components/badges';
import { RoomBar } from './ui/components/roomBar';
import { VideoPlayerComponent } from './ui/components/videoPlayer';
import { OffsetSliderComponent } from './ui/components/offsetSlider';
import { DiagnosticsComponent } from './ui/components/diagnostics';
import { openInfoModal } from './ui/components/shareModal';

async function bootstrapApp() {
  const root = document.getElementById('app');
  if (!root) throw new Error('Root #app container not found');

  // 1. Accessibility announcer
  const announcer = new AriaAnnouncer();

  // 2. Cryptographic credentials (from hash or freshly generated)
  let credentials: RoomCredentials = (await parseCredentialsFromHash()) || (await generateRoomCredentials());
  setUrlHash(credentials.roomId, credentials.keyBase64);

  // 3. Ephemeral Nostr Identity (in-memory throwaway keypair)
  const nostrIdentity = createEphemeralIdentity();

  // 4. Multi-Relay Nostr WebSocket Transport Pool
  const relayPool = new NostrRelayPool(DEFAULT_RELAYS);

  // 5. Initialize UI Components
  const badgesBar = new BadgesBar();

  const roomBar = new RoomBar({
    onNewRoom: async () => {
      credentials = await generateRoomCredentials();
      setUrlHash(credentials.roomId, credentials.keyBase64);
      roomBar.updateCredentials(credentials.roomId, credentials.keyBase64);
      syncEngine.setRoomCredentials(credentials.aesKey, credentials.hashedRoomTag);
      announcer.announce('Created new encrypted room.');
      diagnostics.appendLog(`[Room] Generated fresh Room ID ${credentials.roomId}`);
    },
    onOpenInfoModal: () => {
      const shareUrl = buildShareUrl(credentials.roomId, credentials.keyBase64);
      openInfoModal(shareUrl, () => {});
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

  const offsetSlider = new OffsetSliderComponent({
    onOffsetChange: (offset) => {
      syncEngine.setManualOffset(offset);
      announcer.announce(`Manual offset set to ${offset > 0 ? '+' : ''}${offset.toFixed(2)} seconds`);
    }
  });

  let currentPeerFingerprint: string | undefined = undefined;

  // 6. Synchronization & Drift Engine
  const syncEngine = new SyncEngine(nostrIdentity, relayPool, {
    onPeerUpdate: (peer) => {
      badgesBar.updatePeerState(peer);
      currentPeerFingerprint = peer?.fingerprint;
    },
    onFingerprintStatusChange: (status, peerFp) => {
      badgesBar.updateFingerprint(status, syncEngine.getLocalFingerprint() || undefined, peerFp);
      if (status === 'VERIFIED') {
        announcer.announce('Fingerprint verified: identical video file detected with peer.');
      } else if (status === 'MISMATCH') {
        announcer.announce('Warning: Fingerprint mismatch! Peer has a different file.');
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
    }
  });

  // Supply active room credentials to sync engine
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
      badgesBar.updateFingerprint(
        currentPeerFingerprint === fpResult.code ? 'VERIFIED' : (currentPeerFingerprint ? 'MISMATCH' : 'WAITING_FOR_PEER'),
        fpResult.code,
        currentPeerFingerprint
      );
    },
    onUserPlayPause: () => {
      videoPlayer.togglePlayPause();
    },
    onUserSeek: (targetTime) => {
      diagnostics.appendLog(`[Video] Scrubbed timeline to ${targetTime.toFixed(2)}s`);
    },
    onLog: (msg, level) => {
      diagnostics.appendLog(msg, level);
    },
    onAnnounce: (msg) => {
      announcer.announce(msg);
    }
  });

  // Attach video element to sync engine
  syncEngine.attachVideo(videoPlayer.getVideoElement());

  // 8. Keyboard Shortcuts
  setupKeyboardShortcuts({
    onTogglePlayPause: () => videoPlayer.togglePlayPause(),
    onSeekRelative: (sec) => videoPlayer.seekRelative(sec),
    onVolumeChange: (delta) => videoPlayer.adjustVolume(delta),
    onToggleFullscreen: () => videoPlayer.toggleFullscreen(),
    onToggleMute: () => videoPlayer.toggleMute()
  });

  // Listen for hash changes in case user pastes another link into address bar
  window.addEventListener('hashchange', async () => {
    const newCreds = await parseCredentialsFromHash();
    if (newCreds && newCreds.roomId !== credentials.roomId) {
      credentials = newCreds;
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
  windowBody.appendChild(videoPlayer.getElement());
  windowBody.appendChild(offsetSlider.getElement());
  windowBody.appendChild(diagnostics.getElement());

  windowFrame.appendChild(windowTitlebar);
  windowFrame.appendChild(windowBody);
  root.appendChild(windowFrame);

  // Footer status bar
  const footer = document.createElement('footer');
  footer.className = 'footer-statusbar';
  footer.innerHTML = `
    <span>Status: SYSTEM READY • ZERO-BACKEND STATIC CLIENT</span>
    <span>Hotkeys: [Space] Play/Pause • [← / →] ±5s Seek • [↑ / ↓] Volume • [F] Fullscreen • [M] Mute</span>
    <span>Nostr Transport: 3 Relays Active</span>
  `;
  root.appendChild(footer);

  diagnostics.appendLog(`[System] Initialized Room ${credentials.roomId.slice(0, 8)}...`);
  diagnostics.appendLog('[System] Ready for local video drag-and-drop or test pattern generation.');
}

// Start application
bootstrapApp().catch((err) => {
  console.error('Fatal initialization error:', err);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `<div style="padding: 20px; color: red; background: #fff; font-family: monospace;">Fatal Error: ${err}</div>`;
  }
});
