/**
 * UI Component: Room Management Bar
 * Streamlined toolbar with Copy Link, 1-Min Word Code, Chat, Diag, and New Room.
 */

import { buildShareUrl } from '../../crypto/keyManager';

export interface RoomBarCallbacks {
  onNewRoom: () => void;
  onOpenInfoModal: () => void;
  onOpenPairingModal: () => void;
  onToggleChat: () => void;
  onToggleDiagnostics: () => void;
}

export class RoomBar {
  private element: HTMLElement;
  private roomIdEl: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private chatBtn: HTMLButtonElement;
  private diagBtn: HTMLButtonElement;
  private pairingBtn: HTMLButtonElement;
  private currentRoomId = '';
  private currentKey = '';
  private callbacks: RoomBarCallbacks;

  constructor(callbacks: RoomBarCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'room-bar';

    this.element.innerHTML = `
      <div class="room-bar-left">
        <label style="font-weight: bold;">ROOM:</label>
        <span class="room-id-display" id="room-id-text">INITIALIZING...</span>
        <button class="retro-btn primary" id="btn-copy-link" title="Copy encrypted invite link to clipboard">
          📋 Copy Link
        </button>
        <button class="retro-btn" id="btn-word-pairing" title="Pair using a simple 1-minute English word (Yellkey-style)">
          🔑 Word Code
        </button>
        <button class="retro-btn" id="btn-toggle-chat" title="Toggle encrypted side-chat">
          💬 Chat
        </button>
        <button class="retro-btn" id="btn-toggle-diag" title="Toggle system diagnostics and telemetry drawer">
          📊 Diag
        </button>
        <button class="retro-btn" id="btn-new-room" title="Generate fresh room credentials">
          ⚡ New Room
        </button>
      </div>

      <div class="room-bar-right">
        <button class="retro-btn small" id="btn-info" title="View architecture & cryptography info">ℹ Info</button>
      </div>
    `;

    this.roomIdEl = this.element.querySelector('#room-id-text')!;
    this.copyBtn = this.element.querySelector('#btn-copy-link')!;
    this.pairingBtn = this.element.querySelector('#btn-word-pairing')!;
    this.chatBtn = this.element.querySelector('#btn-toggle-chat')!;
    this.diagBtn = this.element.querySelector('#btn-toggle-diag')!;

    this.copyBtn.addEventListener('click', () => this.handleCopy());
    this.pairingBtn.addEventListener('click', () => this.callbacks.onOpenPairingModal());
    this.chatBtn.addEventListener('click', () => this.callbacks.onToggleChat());
    this.diagBtn.addEventListener('click', () => this.callbacks.onToggleDiagnostics());

    this.element.querySelector('#btn-new-room')!.addEventListener('click', () => {
      if (confirm('Create a new room? This will generate a new AES key, reset the current session, and disconnect existing peers.')) {
        this.callbacks.onNewRoom();
      }
    });

    this.element.querySelector('#btn-info')!.addEventListener('click', () => {
      this.callbacks.onOpenInfoModal();
    });
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public updateUnreadChat(unreadCount: number): void {
    if (unreadCount > 0) {
      this.chatBtn.innerHTML = `💬 Chat <span class="badge-unread">(${unreadCount})</span>`;
      this.chatBtn.classList.add('chat-has-unread');
    } else {
      this.chatBtn.innerHTML = `💬 Chat`;
      this.chatBtn.classList.remove('chat-has-unread');
    }
  }

  public updateCredentials(roomId: string, keyBase64: string): void {
    this.currentRoomId = roomId;
    this.currentKey = keyBase64;
    const shortId = `${roomId.slice(0, 6)}...${roomId.slice(-6)}`;
    this.roomIdEl.textContent = shortId;
    this.roomIdEl.title = `Full Room ID: ${roomId}`;
  }

  private async handleCopy(): Promise<void> {
    if (!this.currentRoomId || !this.currentKey) return;

    const url = buildShareUrl(this.currentRoomId, this.currentKey);
    try {
      await navigator.clipboard.writeText(url);
      const originalText = this.copyBtn.innerHTML;
      this.copyBtn.innerHTML = '✔ Copied Link!';
      setTimeout(() => {
        this.copyBtn.innerHTML = originalText;
      }, 2500);
    } catch {
      prompt('Copy this invite URL:', url);
    }
  }
}
