/**
 * UI Component: Info & Security Modal
 */

export function openInfoModal(roomUrl: string, onClose: () => void): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  backdrop.innerHTML = `
    <div class="window-frame modal-dialog" role="dialog" aria-labelledby="modal-title" aria-modal="true">
      <div class="window-titlebar">
        <span id="modal-title">onthecountofthree - Architecture & Privacy Security</span>
        <div class="window-controls-glyph">
          <button class="window-btn" id="btn-close-modal">×</button>
        </div>
      </div>

      <div class="modal-body">
        <h3 style="font-size: 14px; margin-bottom: 8px;">Zero-Backend Decentralized Video Sync</h3>
        <p style="margin-bottom: 10px; line-height: 1.4;">
          This application enables two users (e.g., across Sweden and Russia) to watch identical local video files in frame-accurate synchronization over censorship-resistant, decentralized channels.
        </p>

        <div class="inset-panel" style="margin-bottom: 12px; line-height: 1.5; font-size: 11px;">
          <div><strong>1. Zero Server Backend:</strong> Pure static client-side bundle. No accounts, cookies, databases, or central servers.</div>
          <div style="margin-top: 4px;"><strong>2. Data Minimization:</strong> File names, paths, and video bytes never touch any network. Relays never see the Room ID or the AES key.</div>
          <div style="margin-top: 4px;"><strong>3. Web Crypto E2EE:</strong> Every sync packet is encrypted client-side with 256-bit AES-GCM and a fresh 12-byte IV before transmission.</div>
          <div style="margin-top: 4px;"><strong>4. Censorship Resistance:</strong> Communicates via public Nostr relays over WSS (port 443) using ephemeral throwaway Nostr keys.</div>
          <div style="margin-top: 4px;"><strong>5. Fuzzy Fingerprint:</strong> Reads the first 4 MB, final 1 MB, and exact duration to verify identical media without hashing multi-gigabyte files.</div>
        </div>

        <label style="font-weight: bold; font-size: 12px;">Shareable Encrypted Invite Link:</label>
        <input type="text" class="modal-share-link" readonly value="${roomUrl}" id="modal-link-input" />

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
          <button class="retro-btn primary" id="btn-modal-copy">📋 Copy Link</button>
          <button class="retro-btn" id="btn-modal-close-action">Close</button>
        </div>
      </div>
    </div>
  `;

  const close = () => {
    backdrop.remove();
    onClose();
  };

  backdrop.querySelector('#btn-close-modal')!.addEventListener('click', close);
  backdrop.querySelector('#btn-modal-close-action')!.addEventListener('click', close);

  const copyBtn = backdrop.querySelector('#btn-modal-copy') as HTMLButtonElement;
  copyBtn.addEventListener('click', async () => {
    const input = backdrop.querySelector('#modal-link-input') as HTMLInputElement;
    input.select();
    try {
      await navigator.clipboard.writeText(roomUrl);
      copyBtn.textContent = '✔ Copied!';
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy Link';
      }, 2000);
    } catch {
      input.focus();
    }
  });

  document.body.appendChild(backdrop);
  return backdrop;
}
