/**
 * Module C: Nostr Ephemeral Relay Pool
 * Manages concurrent WebSocket connections to multiple Nostr relays,
 * subscription filters for ephemeral events, and broadcast publishing.
 * Includes local BroadcastChannel transport for instant local multi-tab sync.
 */

import { RelayStatus } from '../types';
import { EventDeduplicator } from './deduplicator';
import { VerifiedEvent } from 'nostr-tools';

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net'
];

export type RelayEventCallback = (event: VerifiedEvent) => void;
export type RelayStatusCallback = (relays: RelayStatus[]) => void;
export type LogCallback = (msg: string, level?: 'info' | 'warn' | 'error') => void;

interface RelayClient {
  url: string;
  ws: WebSocket | null;
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  eventsSent: number;
  eventsReceived: number;
  latencyMs?: number;
  lastError?: string;
  reconnectTimer: number | null;
  reconnectAttempts: number;
  subId: string | null;
}

export class NostrRelayPool {
  private relays = new Map<string, RelayClient>();
  private deduplicator = new EventDeduplicator();
  private hashedRoomTag: string | null = null;
  private eventListeners: RelayEventCallback[] = [];
  private statusListeners: RelayStatusCallback[] = [];
  private logListeners: LogCallback[] = [];
  private broadcastChannel: BroadcastChannel | null = null;
  private isDestroyed = false;

  constructor(relayUrls: string[] = DEFAULT_RELAYS) {
    relayUrls.forEach(url => this.addRelay(url));
  }

  public addEventListener(listener: RelayEventCallback): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== listener);
    };
  }

  public addStatusListener(listener: RelayStatusCallback): () => void {
    this.statusListeners.push(listener);
    listener(this.getStatuses());
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  public addLogListener(listener: LogCallback): () => void {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter(l => l !== listener);
    };
  }

  /**
   * Backward compatibility helper: registers listeners without overwriting
   */
  public setCallbacks(
    onEvent?: RelayEventCallback,
    onStatus?: RelayStatusCallback,
    onLog?: LogCallback
  ): void {
    if (onEvent) this.addEventListener(onEvent);
    if (onStatus) this.addStatusListener(onStatus);
    if (onLog) this.addLogListener(onLog);
  }

  public addRelay(url: string): void {
    if (this.relays.has(url)) return;

    const client: RelayClient = {
      url,
      ws: null,
      status: 'DISCONNECTED',
      eventsSent: 0,
      eventsReceived: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
      subId: null
    };

    this.relays.set(url, client);
    this.connectRelay(client);
    this.emitStatus();
  }

  public removeRelay(url: string): void {
    const client = this.relays.get(url);
    if (!client) return;

    if (client.reconnectTimer) {
      window.clearTimeout(client.reconnectTimer);
    }
    if (client.ws) {
      try {
        client.ws.close();
      } catch {
        // ignore
      }
    }
    this.relays.delete(url);
    this.emitStatus();
  }

  public setRoomTag(hashedRoomTag: string): void {
    this.hashedRoomTag = hashedRoomTag;

    // Setup local BroadcastChannel for zero-latency local multi-tab companion
    if (typeof BroadcastChannel !== 'undefined') {
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.close();
        } catch {
          // ignore
        }
      }

      try {
        const channelName = `onthecountofthree_${hashedRoomTag.slice(0, 16)}`;
        this.broadcastChannel = new BroadcastChannel(channelName);
        this.broadcastChannel.onmessage = (event) => {
          if (this.isDestroyed || !event.data) return;
          const nostrEvent = event.data as VerifiedEvent;
          if (!nostrEvent || !nostrEvent.id) return;

          if (this.deduplicator.isDuplicateEventId(nostrEvent.id)) {
            return;
          }

          this.dispatchIncomingEvent(nostrEvent);
        };
      } catch (err) {
        this.log(`Could not initialize local BroadcastChannel: ${err}`, 'warn');
      }
    }

    // Re-subscribe on all active connections
    for (const client of this.relays.values()) {
      if (client.status === 'CONNECTED' && client.ws) {
        this.sendSubscription(client);
      }
    }
  }

  private connectRelay(client: RelayClient): void {
    if (this.isDestroyed) return;

    if (client.reconnectTimer) {
      window.clearTimeout(client.reconnectTimer);
      client.reconnectTimer = null;
    }

    client.status = 'CONNECTING';
    this.emitStatus();
    this.log(`Connecting to ${client.url}...`);

    try {
      const ws = new WebSocket(client.url);
      client.ws = ws;

      const connectStart = performance.now();

      ws.onopen = () => {
        if (this.isDestroyed || client.ws !== ws) return;
        client.status = 'CONNECTED';
        client.reconnectAttempts = 0;
        client.latencyMs = Math.round(performance.now() - connectStart);
        this.log(`Connected to ${client.url} (${client.latencyMs}ms)`, 'info');
        this.emitStatus();

        if (this.hashedRoomTag) {
          this.sendSubscription(client);
        }
      };

      ws.onmessage = (event) => {
        if (this.isDestroyed || client.ws !== ws) return;
        this.handleMessage(client, event.data);
      };

      ws.onerror = () => {
        if (this.isDestroyed || client.ws !== ws) return;
        client.status = 'ERROR';
        client.lastError = 'WebSocket network error';
        this.log(`Error on ${client.url}`, 'warn');
        this.emitStatus();
      };

      ws.onclose = () => {
        if (this.isDestroyed || client.ws !== ws) return;
        client.status = 'DISCONNECTED';
        client.ws = null;
        this.log(`Disconnected from ${client.url}`, 'warn');
        this.emitStatus();
        this.scheduleReconnect(client);
      };
    } catch (err) {
      client.status = 'ERROR';
      client.lastError = err instanceof Error ? err.message : 'Connection failed';
      this.emitStatus();
      this.scheduleReconnect(client);
    }
  }

  private scheduleReconnect(client: RelayClient): void {
    if (this.isDestroyed) return;
    client.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, client.reconnectAttempts - 1), 15000);
    this.log(`Will reconnect to ${client.url} in ${Math.round(delay / 1000)}s`);
    client.reconnectTimer = window.setTimeout(() => {
      this.connectRelay(client);
    }, delay);
  }

  private sendSubscription(client: RelayClient): void {
    if (!client.ws || client.ws.readyState !== WebSocket.OPEN || !this.hashedRoomTag) return;

    // Unique subscription ID for this relay
    const subId = `sub_${Math.random().toString(36).slice(2, 8)}`;
    client.subId = subId;

    // Nostr filter subscribing to kind 20033 ephemeral events with #d tag matching hashed room tag
    const filter = {
      kinds: [20033],
      '#d': [this.hashedRoomTag]
    };

    const reqMessage = JSON.stringify(['REQ', subId, filter]);
    try {
      client.ws.send(reqMessage);
      this.log(`Subscribed to room tag on ${client.url} (sub: ${subId})`);
    } catch (err) {
      this.log(`Failed to send subscription to ${client.url}: ${err}`, 'error');
    }
  }

  private handleMessage(client: RelayClient, rawData: unknown): void {
    if (typeof rawData !== 'string') return;

    try {
      const msg = JSON.parse(rawData);
      if (!Array.isArray(msg) || msg.length < 2) return;

      const type = msg[0];

      if (type === 'EVENT') {
        // Format: ["EVENT", <subId>, <eventObject>]
        const event = msg[2] as VerifiedEvent;
        if (!event || !event.id) return;

        client.eventsReceived++;
        this.emitStatus();

        // Relay deduplication
        if (this.deduplicator.isDuplicateEventId(event.id)) {
          return;
        }

        this.dispatchIncomingEvent(event);
      } else if (type === 'OK') {
        // Format: ["OK", <eventId>, <true/false>, <message>]
      } else if (type === 'NOTICE') {
        this.log(`[${client.url}] NOTICE: ${msg[1]}`);
      }
    } catch {
      // Ignore unparseable frames
    }
  }

  private dispatchIncomingEvent(event: VerifiedEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in event listener:', err);
      }
    }
  }

  /**
   * Publishes a signed event to all currently connected relays,
   * and to local BroadcastChannel for multi-tab instances.
   */
  public publish(event: VerifiedEvent): number {
    // 1. Dispatch to local broadcast channel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(event);
      } catch {
        // ignore
      }
    }

    // 2. Dispatch to Nostr relays
    const raw = JSON.stringify(['EVENT', event]);
    let sentCount = 0;

    for (const client of this.relays.values()) {
      if (client.status === 'CONNECTED' && client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(raw);
          client.eventsSent++;
          sentCount++;
        } catch {
          // ignore send error on individual socket
        }
      }
    }

    if (sentCount > 0) {
      this.emitStatus();
    }
    return sentCount;
  }

  public getConnectedCount(): number {
    let count = 0;
    for (const client of this.relays.values()) {
      if (client.status === 'CONNECTED') count++;
    }
    return count;
  }

  public getStatuses(): RelayStatus[] {
    return Array.from(this.relays.values()).map(c => ({
      url: c.url,
      status: c.status,
      eventsSent: c.eventsSent,
      eventsReceived: c.eventsReceived,
      latencyMs: c.latencyMs,
      lastError: c.lastError
    }));
  }

  private emitStatus(): void {
    const statuses = this.getStatuses();
    for (const listener of this.statusListeners) {
      try {
        listener(statuses);
      } catch (err) {
        console.error('Error in status listener:', err);
      }
    }
  }

  private log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    for (const listener of this.logListeners) {
      try {
        listener(`[Relay] ${msg}`, level);
      } catch {
        // ignore
      }
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {
        // ignore
      }
      this.broadcastChannel = null;
    }

    for (const client of this.relays.values()) {
      if (client.reconnectTimer) {
        window.clearTimeout(client.reconnectTimer);
      }
      if (client.ws) {
        try {
          client.ws.close();
        } catch {
          // ignore
        }
      }
    }
    this.relays.clear();
    this.eventListeners = [];
    this.statusListeners = [];
    this.logListeners = [];
    this.deduplicator.reset();
  }
}
