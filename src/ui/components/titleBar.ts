/**
 * UI Component: Window Title Bar
 */

export function renderTitleBar(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'window-titlebar';

  container.innerHTML = `
    <div class="window-title-left">
      <span class="title-icon">3</span>
      <span class="title-text">onthecountofthree [Zero-Backend Encrypted Video Sync]</span>
    </div>
    <div class="window-controls-glyph" aria-hidden="true">
      <button class="window-btn" title="Minimize">_</button>
      <button class="window-btn" title="Maximize">□</button>
      <button class="window-btn" title="Close">×</button>
    </div>
  `;

  return container;
}
