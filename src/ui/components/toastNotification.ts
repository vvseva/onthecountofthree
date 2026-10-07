/**
 * UI Component: Transient Toast Notification Window
 * System 7 / 90s retro popup for peer events (connect, disconnect, fingerprint match).
 * Auto-dismisses after 4 seconds or when dismissed manually.
 */

export interface ToastOptions {
  title: string;
  message: string;
  icon?: string;
  type?: 'info' | 'success' | 'warn' | 'error';
  durationMs?: number;
}

export class ToastNotificationManager {
  private container: HTMLElement;

  constructor() {
    let el = document.getElementById('toast-notification-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-notification-container';
      el.className = 'toast-container';
      document.body.appendChild(el);
    }
    this.container = el;
  }

  public show(options: ToastOptions): HTMLElement {
    const {
      title,
      message,
      icon = '🔔',
      type = 'info',
      durationMs = 4000
    } = options;

    const toast = document.createElement('div');
    toast.className = `window-frame toast-window toast-${type}`;
    toast.setAttribute('role', 'alert');

    toast.innerHTML = `
      <div class="window-titlebar toast-titlebar">
        <div class="window-title-left">
          <span>${icon}</span>
          <span style="font-size: 11px;">${title}</span>
        </div>
        <div class="window-controls-glyph">
          <button class="window-btn toast-close-btn" title="Dismiss">×</button>
        </div>
      </div>
      <div class="toast-body">
        ${message}
      </div>
    `;

    const closeBtn = toast.querySelector('.toast-close-btn')!;
    let dismissTimer: number | null = null;

    const dismiss = () => {
      if (dismissTimer) clearTimeout(dismissTimer);
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        toast.remove();
      }, 300);
    };

    closeBtn.addEventListener('click', dismiss);

    if (durationMs > 0) {
      dismissTimer = window.setTimeout(dismiss, durationMs);
    }

    this.container.appendChild(toast);
    return toast;
  }
}
