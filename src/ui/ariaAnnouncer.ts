/**
 * Accessible ARIA Live Announcer
 * Announces state changes to screen readers politely.
 */

export class AriaAnnouncer {
  private element: HTMLElement;

  constructor() {
    let el = document.getElementById('aria-live-announcer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aria-live-announcer';
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'true');
      el.className = 'sr-only';
      document.body.appendChild(el);
    }
    this.element = el;
  }

  public announce(message: string): void {
    // Clear and set to trigger assistive tech re-read
    this.element.textContent = '';
    setTimeout(() => {
      this.element.textContent = message;
    }, 50);
  }
}
