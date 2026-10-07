/**
 * UI Component: Diagnostics Console & Relay Monitor
 * Provides real-time metrics (RTT, Drift, Nudge rate) and Nostr relay status table.
 */

import { RelayStatus } from '../../types';

export interface DiagnosticsCallbacks {
  onAddRelay: (url: string) => void;
  onRemoveRelay: (url: string) => void;
}

export class DiagnosticsComponent {
  private element: HTMLElement;
  private isExpanded = false;
  private rttValEl: HTMLElement;
  private driftValEl: HTMLElement;
  private rateValEl: HTMLElement;
  private peerTimeValEl: HTMLElement;
  private fingerprintValEl: HTMLElement;
  private relayTableBody: HTMLElement;
  private logConsole: HTMLElement;
  private addRelayInput: HTMLInputElement;
  private toggleBtn: HTMLElement;
  private contentContainer: HTMLElement;
  private callbacks: DiagnosticsCallbacks;

  constructor(callbacks: DiagnosticsCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'diagnostics-accordion';

    this.element.innerHTML = `
      <div class="accordion-header" id="diag-toggle" role="button" tabindex="0" aria-expanded="false">
        <span>📊 SYSTEM DIAGNOSTICS & NOSTR RELAY MONITOR</span>
        <span id="accordion-icon">▼ Show</span>
      </div>

      <div class="accordion-content" id="diag-content" style="display: none;">
        <!-- Live Metrics Cards -->
        <div class="diagnostics-grid">
          <div class="diag-card">
            <div class="diag-card-title">Round-Trip Time (RTT)</div>
            <div class="diag-card-value" id="diag-rtt">-- ms</div>
          </div>

          <div class="diag-card">
            <div class="diag-card-title">Network Playback Drift</div>
            <div class="diag-card-value" id="diag-drift">0 ms (Synced)</div>
          </div>

          <div class="diag-card">
            <div class="diag-card-title">Drift Nudge Multiplier</div>
            <div class="diag-card-value" id="diag-rate">1.00x</div>
          </div>

          <div class="diag-card">
            <div class="diag-card-title">Estimated Peer Position</div>
            <div class="diag-card-value" id="diag-peer-time">--:--</div>
          </div>

          <div class="diag-card">
            <div class="diag-card-title">Fuzzy File Fingerprint</div>
            <div class="diag-card-value" id="diag-fingerprint" style="color: #555555;">No Local File</div>
          </div>

          <div class="diag-card">
            <div class="diag-card-title">E2EE Cryptographic Security</div>
            <div class="diag-card-value" style="font-size: 11px; color: #008000;">AES-GCM-256 • 12B IV • Ephemeral Nostr</div>
          </div>
        </div>

        <!-- Relay Table -->
        <div style="font-weight: bold; margin-bottom: 4px; font-size: 11px;">NOSTR RELAY TRANSPORT (WSS PORT 443):</div>
        <table class="relay-table">
          <thead>
            <tr>
              <th>Relay WebSocket URL</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Received</th>
              <th>Latency</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="relay-table-body">
            <!-- populated dynamically -->
          </tbody>
        </table>

        <!-- Add Custom Relay -->
        <div class="add-relay-bar">
          <input type="text" class="text-input" id="input-custom-relay" placeholder="wss://custom-nostr-relay.example.com" />
          <button class="retro-btn small" id="btn-add-relay">+ Add Relay</button>
        </div>

        <!-- Console Log Terminal -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; font-size: 11px;">PROTOCOL & SYNC ACTIVITY LOG:</span>
          <button class="retro-btn small" id="btn-clear-log">Clear Log</button>
        </div>
        <div class="terminal-window" id="log-terminal" role="log" aria-live="off">
          <div class="log-line info">[System] Bootstrapped onthecountofthree protocol engine.</div>
        </div>
      </div>
    `;

    this.rttValEl = this.element.querySelector('#diag-rtt')!;
    this.driftValEl = this.element.querySelector('#diag-drift')!;
    this.rateValEl = this.element.querySelector('#diag-rate')!;
    this.peerTimeValEl = this.element.querySelector('#diag-peer-time')!;
    this.fingerprintValEl = this.element.querySelector('#diag-fingerprint')!;
    this.relayTableBody = this.element.querySelector('#relay-table-body')!;
    this.logConsole = this.element.querySelector('#log-terminal')!;
    this.addRelayInput = this.element.querySelector('#input-custom-relay')!;
    this.toggleBtn = this.element.querySelector('#diag-toggle')!;
    this.contentContainer = this.element.querySelector('#diag-content')!;

    this.setupEvents();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public toggle(): void {
    this.isExpanded = !this.isExpanded;
    this.contentContainer.style.display = this.isExpanded ? 'block' : 'none';
    this.element.querySelector('#accordion-icon')!.textContent = this.isExpanded ? '▲ Hide' : '▼ Show';
    this.toggleBtn.setAttribute('aria-expanded', this.isExpanded.toString());
  }

  public updateFingerprint(status: 'NO_LOCAL_FILE' | 'WAITING_FOR_PEER' | 'VERIFIED' | 'MISMATCH', localCode?: string, peerCode?: string): void {
    switch (status) {
      case 'NO_LOCAL_FILE':
        this.fingerprintValEl.textContent = 'No Local File';
        this.fingerprintValEl.style.color = '#555555';
        break;
      case 'WAITING_FOR_PEER':
        this.fingerprintValEl.textContent = `${localCode || '---'} (Waiting Peer)`;
        this.fingerprintValEl.style.color = '#cc8800';
        break;
      case 'VERIFIED':
        this.fingerprintValEl.textContent = `[VERIFIED] ${localCode}`;
        this.fingerprintValEl.style.color = '#008000';
        break;
      case 'MISMATCH':
        this.fingerprintValEl.textContent = `[MISMATCH] ${localCode || '?'} ≠ ${peerCode || '?'}`;
        this.fingerprintValEl.style.color = '#cc0000';
        break;
    }
  }

  private setupEvents(): void {
    this.toggleBtn.addEventListener('click', () => {
      this.isExpanded = !this.isExpanded;
      this.contentContainer.style.display = this.isExpanded ? 'block' : 'none';
      this.element.querySelector('#accordion-icon')!.textContent = this.isExpanded ? '▲ Hide' : '▼ Show';
      this.toggleBtn.setAttribute('aria-expanded', this.isExpanded.toString());
    });

    const addBtn = this.element.querySelector('#btn-add-relay')!;
    addBtn.addEventListener('click', () => {
      const url = this.addRelayInput.value.trim();
      if (url && (url.startsWith('wss://') || url.startsWith('ws://'))) {
        this.callbacks.onAddRelay(url);
        this.addRelayInput.value = '';
      } else {
        alert('Please enter a valid WebSocket URL (e.g. wss://relay.damus.io)');
      }
    });

    this.element.querySelector('#btn-clear-log')!.addEventListener('click', () => {
      this.logConsole.innerHTML = '<div class="log-line info">[System] Log cleared.</div>';
    });
  }

  public updateStats(stats: {
    rttMs: number;
    driftMs: number;
    currentRate: number;
    manualOffsetSec: number;
    peerTimeSec: number;
    localTimeSec: number;
    role?: 'PRIMARY' | 'SECONDARY';
  }): void {
    this.rttValEl.textContent = stats.rttMs > 0 ? `${stats.rttMs} ms` : '-- ms';

    if (stats.role === 'PRIMARY') {
      this.driftValEl.textContent = '0 ms (Primary: Master Clock)';
      this.driftValEl.style.color = '#008000';
      this.rateValEl.textContent = '1.00x (Fixed)';
    } else {
      const absDrift = Math.abs(stats.driftMs);
      let driftLabel = `${stats.driftMs > 0 ? '+' : ''}${stats.driftMs} ms`;
      if (absDrift < 100) {
        driftLabel += ' (In Sync)';
        this.driftValEl.style.color = '#008000';
      } else if (absDrift <= 1200) {
        driftLabel += ' (Nudging)';
        this.driftValEl.style.color = '#ff8800';
      } else {
        driftLabel += ' (Hard Seeking)';
        this.driftValEl.style.color = '#ff0000';
      }
      this.driftValEl.textContent = driftLabel;
      this.rateValEl.textContent = `${stats.currentRate.toFixed(2)}x`;
    }

    this.peerTimeValEl.textContent = this.formatTime(stats.peerTimeSec);
  }

  public updateRelayTable(relays: RelayStatus[]): void {
    this.relayTableBody.innerHTML = '';
    relays.forEach(r => {
      const tr = document.createElement('tr');

      let statusColor = '#008000';
      if (r.status === 'CONNECTING') statusColor = '#ff8800';
      if (r.status === 'ERROR' || r.status === 'DISCONNECTED') statusColor = '#cc0000';

      tr.innerHTML = `
        <td style="font-weight: bold;">${r.url}</td>
        <td style="color: ${statusColor}; font-weight: bold;">${r.status}</td>
        <td>${r.eventsSent}</td>
        <td>${r.eventsReceived}</td>
        <td>${r.latencyMs !== undefined ? `${r.latencyMs}ms` : '--'}</td>
        <td>
          <button class="retro-btn small danger" data-url="${r.url}">✕ Remove</button>
        </td>
      `;

      const removeBtn = tr.querySelector('button')!;
      removeBtn.addEventListener('click', () => {
        this.callbacks.onRemoveRelay(r.url);
      });

      this.relayTableBody.appendChild(tr);
    });
  }

  public appendLog(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const d = new Date();
    const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;

    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.textContent = `[${timeStr}] ${msg}`;

    this.logConsole.appendChild(line);

    // Auto-scroll to bottom
    this.logConsole.scrollTop = this.logConsole.scrollHeight;

    // Cap at 300 lines
    while (this.logConsole.childElementCount > 300) {
      this.logConsole.removeChild(this.logConsole.firstElementChild!);
    }
  }

  private formatTime(sec: number): string {
    if (isNaN(sec) || sec < 0) return '00:00';
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
