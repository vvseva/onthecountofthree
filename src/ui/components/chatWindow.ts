/**
 * UI Component: Encrypted Retro Side-Chat Window
 * Features System 7 / 90s aesthetic, minimization/close, unread badges, and emoji reaction shortcuts.
 */

import { ChatMessagePayload } from '../../types';

export interface ChatWindowCallbacks {
  onSendMessage: (text: string) => void;
  onVisibilityChange: (isVisible: boolean) => void;
}

export class ChatWindowComponent {
  private element: HTMLElement;
  private messagesList: HTMLElement;
  private inputField: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private isVisible = true;
  private isMinimized = false;
  private unreadCount = 0;
  private callbacks: ChatWindowCallbacks;
  private unreadBadgeUpdateCb: ((count: number) => void) | null = null;

  constructor(callbacks: ChatWindowCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'window-frame chat-window';
    this.element.id = 'chat-window-pane';

    this.element.innerHTML = `
      <div class="window-titlebar chat-titlebar">
        <div class="window-title-left">
          <span>💬</span>
          <span style="font-size: 12px;">ENCRYPTED CHAT [E2EE]</span>
        </div>
        <div class="window-controls-glyph">
          <button class="window-btn" id="chat-btn-minimize" title="Minimize Chat">_</button>
          <button class="window-btn" id="chat-btn-close" title="Close Chat">×</button>
        </div>
      </div>

      <div class="chat-content" id="chat-content-body">
        <div class="chat-messages-container" id="chat-messages" role="log" aria-live="polite">
        </div>

        <!-- Quick Reaction Emoji Bar -->
        <div class="chat-reactions-bar">
          <button class="retro-btn small chat-emoji-btn" data-emoji="🍿">🍿</button>
          <button class="retro-btn small chat-emoji-btn" data-emoji="😂">😂</button>
          <button class="retro-btn small chat-emoji-btn" data-emoji="🔥">🔥</button>
          <button class="retro-btn small chat-emoji-btn" data-emoji="👏">👏</button>
          <button class="retro-btn small chat-emoji-btn" data-emoji="❤️">❤️</button>
          <button class="retro-btn small chat-emoji-btn" data-emoji="👀">👀</button>
        </div>

        <!-- Input Bar -->
        <div class="chat-input-bar">
          <input type="text" class="text-input chat-input" id="chat-input" placeholder="Type a message..." maxlength="500" />
          <button class="retro-btn primary small" id="chat-btn-send">Send</button>
        </div>
      </div>
    `;

    this.messagesList = this.element.querySelector('#chat-messages')!;
    this.inputField = this.element.querySelector('#chat-input')!;
    this.sendBtn = this.element.querySelector('#chat-btn-send')!;

    this.setupEvents();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public setUnreadBadgeCallback(cb: (count: number) => void): void {
    this.unreadBadgeUpdateCb = cb;
  }

  private setupEvents(): void {
    // Send button
    this.sendBtn.addEventListener('click', () => this.handleSend());

    // Enter key
    this.inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Emoji reaction buttons
    this.element.querySelectorAll('.chat-emoji-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        if (emoji) {
          this.callbacks.onSendMessage(emoji);
        }
      });
    });

    // Minimize button
    const minBtn = this.element.querySelector('#chat-btn-minimize')!;
    const contentBody = this.element.querySelector('#chat-content-body') as HTMLElement;
    minBtn.addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      contentBody.style.display = this.isMinimized ? 'none' : 'flex';
      minBtn.textContent = this.isMinimized ? '□' : '_';
    });

    // Close button
    const closeBtn = this.element.querySelector('#chat-btn-close')!;
    closeBtn.addEventListener('click', () => {
      this.hide();
    });
  }

  private handleSend(): void {
    const text = this.inputField.value.trim();
    if (!text) return;
    this.callbacks.onSendMessage(text);
    this.inputField.value = '';
    this.inputField.focus();
  }

  public addMessage(msg: ChatMessagePayload, isSelf: boolean): void {
    const d = new Date(msg.timestamp);
    const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${isSelf ? 'self' : 'peer'}`;

    const senderDisplay = isSelf ? 'You' : `Peer ${msg.senderId.slice(0, 4)}`;

    msgEl.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-sender ${isSelf ? 'self' : 'peer'}">${senderDisplay}</span>
        <span class="chat-time">${timeStr}</span>
      </div>
      <div class="chat-msg-text">${this.escapeHtml(msg.text)}</div>
    `;

    this.messagesList.appendChild(msgEl);
    this.messagesList.scrollTop = this.messagesList.scrollHeight;

    // Track unread if hidden or minimized
    if ((!this.isVisible || this.isMinimized) && !isSelf) {
      this.unreadCount++;
      if (this.unreadBadgeUpdateCb) {
        this.unreadBadgeUpdateCb(this.unreadCount);
      }
    }
  }

  public addSystemMessage(_text: string): void {
    // System messages are silenced to prevent crowding the chat
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  public show(): void {
    this.isVisible = true;
    this.isMinimized = false;
    this.element.style.display = 'flex';
    const contentBody = this.element.querySelector('#chat-content-body') as HTMLElement;
    contentBody.style.display = 'flex';
    this.unreadCount = 0;
    if (this.unreadBadgeUpdateCb) {
      this.unreadBadgeUpdateCb(0);
    }
    this.callbacks.onVisibilityChange(true);
    setTimeout(() => this.inputField.focus(), 50);
  }

  public hide(): void {
    this.isVisible = false;
    this.element.style.display = 'none';
    this.callbacks.onVisibilityChange(false);
  }

  public getIsOpen(): boolean {
    return this.isVisible;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
