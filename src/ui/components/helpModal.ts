/**
 * UI Component: Keyboard Shortcuts & Usability Guide Modal
 * Displays a tactile retro cheat sheet of all available shortcuts and accessibility tips.
 */

export function openHelpModal(onClose?: () => void): HTMLElement {
  const previousActiveElement = document.activeElement as HTMLElement | null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  backdrop.innerHTML = `
    <div class="window-frame modal-dialog" role="dialog" aria-labelledby="help-modal-title" aria-modal="true" style="max-width: 480px;">
      <div class="window-titlebar">
        <div class="window-title-left">
          <span>⌨</span>
          <span id="help-modal-title">Keyboard Shortcuts & Usability Guide</span>
        </div>
        <div class="window-controls-glyph">
          <button class="window-btn" id="btn-close-help-modal" title="Close (Esc)">×</button>
        </div>
      </div>

      <div class="modal-body" style="padding: 14px;">
        <p style="margin-bottom: 12px; line-height: 1.4; font-size: 12px;">
          Enjoy hands-free media playback and peer communication with tactile retro hotkeys:
        </p>

        <div class="inset-panel" style="margin-bottom: 14px; font-size: 11px; max-height: 280px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">Space</td>
                <td style="padding: 6px 8px;">Synchronized Play / Pause (initiates 3s countdown)</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">← / →</td>
                <td style="padding: 6px 8px;">Seek Backward / Forward 5 seconds</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">↑ / ↓</td>
                <td style="padding: 6px 8px;">Volume Up / Down (5% steps)</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">F</td>
                <td style="padding: 6px 8px;">Toggle Fullscreen Mode</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">M</td>
                <td style="padding: 6px 8px;">Mute / Unmute Audio</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">C</td>
                <td style="padding: 6px 8px;">Toggle Controls Bar Visibility</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">T</td>
                <td style="padding: 6px 8px;">Open & Focus Encrypted Chat Input</td>
              </tr>
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">? or H</td>
                <td style="padding: 6px 8px;">Show / Hide this Shortcuts Guide</td>
              </tr>
              <tr>
                <td style="padding: 6px 8px; font-weight: bold; font-family: var(--font-mono); color: #000080;">Escape</td>
                <td style="padding: 6px 8px;">Close active dialog modal or unfocus inputs</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="font-size: 11px; color: #555; margin-bottom: 12px; line-height: 1.4;">
          💡 <strong>Tip:</strong> You can drag and drop any local video file (MP4, MKV, WebM), external audio (.mp3), or subtitle (.srt, .vtt) directly onto the video player.
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button class="retro-btn primary" id="btn-help-close-action">OK (Esc)</button>
        </div>
      </div>
    </div>
  `;

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    }
    if (onClose) onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  document.addEventListener('keydown', onKeyDown);
  backdrop.querySelector('#btn-close-help-modal')!.addEventListener('click', close);
  backdrop.querySelector('#btn-help-close-action')!.addEventListener('click', close);

  // Click outside dialog to close
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      close();
    }
  });

  document.body.appendChild(backdrop);
  const okBtn = backdrop.querySelector('#btn-help-close-action') as HTMLButtonElement;
  if (okBtn) okBtn.focus();

  return backdrop;
}
