/**
 * UI Component: Yellkey-style 1-Minute Ephemeral Word Pairing Modal
 * Single-view interface: Enter a word code first, generate/share a code below.
 */

import { PairingCodeService } from '../../network/pairingCode';

export interface PairingModalOptions {
  pairingService: PairingCodeService;
  currentRoomId: string;
  currentKeyBase64: string;
  onJoinRoom: (roomId: string, keyBase64: string) => void;
  onClose: () => void;
}

export function openPairingModal(options: PairingModalOptions): HTMLElement {
  const { pairingService, currentRoomId, currentKeyBase64, onJoinRoom, onClose } = options;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  backdrop.innerHTML = `
    <div class="window-frame modal-dialog" role="dialog" aria-labelledby="pairing-modal-title" aria-modal="true" style="max-width: 440px;">
      <div class="window-titlebar">
        <span id="pairing-modal-title">🔑 Connect with a Word (1-Minute Code)</span>
        <div class="window-controls-glyph">
          <button class="window-btn" id="btn-close-pairing-modal" title="Close">×</button>
        </div>
      </div>

      <div class="modal-body" style="padding: 14px;">
        <!-- 1. Enter Word to Connect (FIRST) -->
        <div class="pairing-entry-section" style="margin-bottom: 14px;">
          <label for="input-join-word" style="display: block; font-size: 11px; font-weight: bold; margin-bottom: 6px; color: #000080;">
            1. Enter a Word to Connect:
          </label>
          <div style="display: flex; gap: 6px; margin-bottom: 6px;">
            <input
              type="text"
              class="text-input"
              id="input-join-word"
              placeholder="e.g. sun"
              style="font-size: 15px; font-weight: bold; text-align: center; letter-spacing: 2px; flex: 1;"
              maxlength="20"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="retro-btn primary" id="btn-submit-join-word" style="min-width: 80px;">Connect</button>
          </div>
          <div id="join-status-msg" style="font-family: var(--font-mono); font-size: 11px; min-height: 18px; color: #555555;"></div>
        </div>

        <!-- Groove Divider -->
        <div style="border-top: 2px groove #ffffff; margin: 10px 0 14px 0; text-align: center; position: relative;">
          <span style="position: relative; top: -9px; background: var(--bg-window); padding: 0 8px; font-size: 10px; color: #555555; font-weight: bold;">
            ── OR SHARE YOUR CODE ──
          </span>
        </div>

        <!-- 2. Generated Word Code (BELOW) -->
        <div class="pairing-share-section">
          <div style="font-size: 11px; font-weight: bold; margin-bottom: 6px; color: #000080;">
            2. Or Share This 1-Minute Word with Your Peer:
          </div>

          <div style="background: #ffffff; border: 2px inset #ffffff; padding: 12px; text-align: center; margin-bottom: 8px;">
            <div style="font-size: 10px; font-weight: bold; color: #666666; margin-bottom: 2px;">YOUR 60-SECOND PAIRING WORD:</div>
            <div id="pairing-word-display" style="font-family: var(--font-mono); font-size: 32px; font-weight: 900; color: #000080; letter-spacing: 4px;">...</div>
            <div id="pairing-timer-display" style="font-family: var(--font-mono); font-size: 11px; color: #cc6600; margin-top: 4px;">Expires in: 60s</div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <button class="retro-btn small" id="btn-regen-word">🔁 Generate New Word</button>
            <span style="font-size: 10px; color: #555555;">Zero-Knowledge Nostr Beacon</span>
          </div>
        </div>

        <!-- Modal Footer Controls -->
        <div style="display: flex; justify-content: flex-end; margin-top: 14px; border-top: 2px groove #ffffff; padding-top: 8px;">
          <button class="retro-btn" id="btn-pairing-close">Close</button>
        </div>
      </div>
    </div>
  `;

  const wordDisplay = backdrop.querySelector('#pairing-word-display') as HTMLElement;
  const timerDisplay = backdrop.querySelector('#pairing-timer-display') as HTMLElement;
  const joinInput = backdrop.querySelector('#input-join-word') as HTMLInputElement;
  const joinStatus = backdrop.querySelector('#join-status-msg') as HTMLElement;
  const submitJoinBtn = backdrop.querySelector('#btn-submit-join-word') as HTMLButtonElement;
  const regenBtn = backdrop.querySelector('#btn-regen-word') as HTMLButtonElement;

  const close = () => {
    pairingService.stopHosting();
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  backdrop.querySelector('#btn-close-pairing-modal')!.addEventListener('click', close);
  backdrop.querySelector('#btn-pairing-close')!.addEventListener('click', close);

  // Close when clicking outside dialog
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      close();
    }
  });

  const startHosting = () => {
    const word = pairingService.generateRandomWord();
    wordDisplay.textContent = word.toUpperCase();
    timerDisplay.textContent = 'Expires in: 60s';
    timerDisplay.style.color = '#cc6600';

    pairingService.startHostingPairingCode(
      word,
      currentRoomId,
      currentKeyBase64,
      (rem) => {
        timerDisplay.textContent = `Expires in: ${rem}s`;
        if (rem < 10) {
          timerDisplay.style.color = '#cc0000';
        }
      },
      () => {
        timerDisplay.textContent = 'Expired (Click "Generate New Word")';
        timerDisplay.style.color = '#cc0000';
      }
    );
  };

  regenBtn.addEventListener('click', () => {
    startHosting();
  });

  // Join logic
  const handleJoin = async () => {
    const word = joinInput.value.trim().toLowerCase();
    if (!word) {
      joinStatus.textContent = 'Please enter a word first.';
      joinStatus.style.color = '#cc0000';
      joinInput.focus();
      return;
    }

    submitJoinBtn.disabled = true;
    submitJoinBtn.textContent = 'Searching...';
    joinStatus.textContent = `Looking for room beacon for "${word}"...`;
    joinStatus.style.color = '#000080';

    try {
      const result = await pairingService.resolvePairingCode(word, 12000);
      if (result) {
        joinStatus.textContent = `✔ Found room! Connecting...`;
        joinStatus.style.color = '#008000';
        setTimeout(() => {
          onJoinRoom(result.roomId, result.keyBase64);
          close();
        }, 500);
      } else {
        joinStatus.textContent = `❌ No active beacon found for "${word}". (It may have expired)`;
        joinStatus.style.color = '#cc0000';
      }
    } catch (err) {
      joinStatus.textContent = `Error: ${err}`;
      joinStatus.style.color = '#cc0000';
    } finally {
      submitJoinBtn.disabled = false;
      submitJoinBtn.textContent = 'Connect';
    }
  };

  submitJoinBtn.addEventListener('click', handleJoin);
  joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleJoin();
    }
  });

  // Start hosting by default so code is generated & live immediately
  startHosting();

  document.body.appendChild(backdrop);
  setTimeout(() => joinInput.focus(), 50);

  return backdrop;
}
