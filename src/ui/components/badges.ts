/**
 * UI Component: Status Badges Bar
 * Displays Connection Status, Peer Status, and Fuzzy Fingerprint Match.
 */

import { RelayStatus, PeerState, FingerprintMatchStatus } from '../../types';

export class BadgesBar {
  private element: HTMLElement;
  private connectionDot: HTMLElement;
  private connectionText: HTMLElement;
  private peerDot: HTMLElement;
  private peerText: HTMLElement;
  private fpDot: HTMLElement;
  private fpText: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'badge-bar';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', 'Network and Synchronization Status');

    this.element.innerHTML = `
      <div class="badge-item" id="badge-connection" title="Nostr Relays Connection Status">
        <span class="badge-dot yellow" id="dot-conn"></span>
        <span id="text-conn">CONNECTING (0/3 RELAYS)</span>
      </div>

      <div class="badge-item" id="badge-peer" title="Remote Peer Status">
        <span class="badge-dot gray" id="dot-peer"></span>
        <span id="text-peer">WAITING FOR PEER</span>
      </div>

      <div class="badge-item" id="badge-fp" title="Local vs Peer File Verification Fingerprint">
        <span class="badge-dot gray" id="dot-fp"></span>
        <span id="text-fp">NO LOCAL FILE</span>
      </div>
    `;

    this.connectionDot = this.element.querySelector('#dot-conn')!;
    this.connectionText = this.element.querySelector('#text-conn')!;
    this.peerDot = this.element.querySelector('#dot-peer')!;
    this.peerText = this.element.querySelector('#text-peer')!;
    this.fpDot = this.element.querySelector('#dot-fp')!;
    this.fpText = this.element.querySelector('#text-fp')!;
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public updateRelayStatuses(relays: RelayStatus[]): void {
    const total = relays.length;
    const connected = relays.filter(r => r.status === 'CONNECTED').length;

    if (connected === 0) {
      this.connectionDot.className = 'badge-dot red';
      this.connectionText.textContent = `RECONNECTING (0/${total} RELAYS)`;
    } else if (connected < total) {
      this.connectionDot.className = 'badge-dot yellow';
      this.connectionText.textContent = `PARTIAL (${connected}/${total} RELAYS)`;
    } else {
      this.connectionDot.className = 'badge-dot green';
      this.connectionText.textContent = `CONNECTED (${connected}/${total} RELAYS)`;
    }
  }

  public updatePeerState(peer: PeerState | null): void {
    if (!peer) {
      this.peerDot.className = 'badge-dot gray';
      this.peerText.textContent = 'WAITING FOR PEER';
    } else {
      this.peerDot.className = 'badge-dot green';
      const rttStr = peer.rttMs > 0 ? ` [RTT: ${peer.rttMs}ms]` : '';
      this.peerText.textContent = `1 PEER ONLINE (${peer.peerId})${rttStr}`;
    }
  }

  public updateFingerprint(status: FingerprintMatchStatus, localCode?: string, peerCode?: string): void {
    switch (status) {
      case 'NO_LOCAL_FILE':
        this.fpDot.className = 'badge-dot gray';
        this.fpText.textContent = 'FINGERPRINT: NO LOCAL FILE';
        break;

      case 'WAITING_FOR_PEER':
        this.fpDot.className = 'badge-dot yellow';
        this.fpText.textContent = `FINGERPRINT: ${localCode || '---'} (WAITING PEER)`;
        break;

      case 'VERIFIED':
        this.fpDot.className = 'badge-dot green';
        this.fpText.textContent = `FINGERPRINT: [VERIFIED] ${localCode}`;
        break;

      case 'MISMATCH':
        this.fpDot.className = 'badge-dot red';
        this.fpText.textContent = `FINGERPRINT: [MISMATCH] Local:${localCode || '?'} ≠ Peer:${peerCode || '?'}`;
        break;
    }
  }
}
