/**
 * UI Component: Room Management Bar
 * Displays current Room ID, invite sharing button, and privacy status.
 */

import { buildShareUrl } from '../../crypto/keyManager';

export interface RoomBarCallbacks {
  onNewRoom: () => void;
  onOpenInfoModal: () => void;
}

export class RoomBar {
  private element: HTMLElement;
  private roomIdEl: HTMLElement;
  private copyBtn: HTMLButtonElement;
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
          📋 Copy Invite Link
        </button>
        <button class="retro-btn" id="btn-new-room" title="Generate fresh room credentials">
          ⚡ New Room
        </button>
      </div>

      <div class="security-tag">
        <span title="Encrypted with Web Crypto AES-GCM-256 before leaving your browser">🔒 E2EE AES-256-GCM</span>
        <span>•</span>
        <span title="Transported over public Nostr relays with ephemeral throwaway keys">📡 Ephemeral Nostr</span>
        <span>•</span>
        <button class="retro-btn small" id="btn-info" title="View security and architecture info">ℹ Info</button>
      </div>
    `;

    this.roomIdEl = this.element.querySelector('#room-id-text')!;
    this.copyBtn = this.element.querySelector('#btn-copy-link')!;

    this.copyBtn.addEventListener('click', () => this.handleCopy());
    this.element.querySelector('#btn-new-room')!.addEventListener('click', () => {
      if (confirm('Create a new room? This will generate a new AES key and disconnect current session.')) {
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

  public updateCredentials(roomId: string, keyBase64: string): void {
    this.currentRoomId = roomId;
    this.currentKey = keyBase64;
    // Shorten display for aesthetics
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
      // Fallback
      prompt('Copy this invite URL:', url);
    }
  }
}
