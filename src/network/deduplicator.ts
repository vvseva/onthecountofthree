/**
 * Module C: Event Deduplicator
 * Filters out duplicate messages received from multiple concurrent relays.
 */

import { SyncPayload } from '../types';

export class EventDeduplicator {
  private seenEventIds = new Set<string>();
  private eventIdQueue: { id: string; time: number }[] = [];
  private senderSequences = new Map<string, number>();
  private readonly maxCacheSize = 1000;
  private readonly ttlMs = 60000; // 60 seconds

  /**
   * Checks if a raw Nostr event ID has already been seen.
   * Returns true if duplicate (should be dropped).
   */
  public isDuplicateEventId(eventId: string): boolean {
    this.cleanExpired();

    if (this.seenEventIds.has(eventId)) {
      return true;
    }

    this.seenEventIds.add(eventId);
    this.eventIdQueue.push({ id: eventId, time: Date.now() });

    if (this.eventIdQueue.length > this.maxCacheSize) {
      const oldest = this.eventIdQueue.shift();
      if (oldest) {
        this.seenEventIds.delete(oldest.id);
      }
    }

    return false;
  }

  /**
   * Checks if an inner SyncPayload is duplicate or out of order.
   * Note: PING/PONG events have their own tokens and are not sequence-filtered.
   */
  public isDuplicatePayload(payload: SyncPayload): boolean {
    if (payload.type === 'PING' || payload.type === 'PONG') {
      return false;
    }

    const lastSeq = this.senderSequences.get(payload.senderId);
    if (lastSeq !== undefined && payload.sequenceId <= lastSeq) {
      return true;
    }

    this.senderSequences.set(payload.senderId, payload.sequenceId);
    return false;
  }

  private cleanExpired(): void {
    const now = Date.now();
    while (this.eventIdQueue.length > 0 && now - this.eventIdQueue[0].time > this.ttlMs) {
      const expired = this.eventIdQueue.shift();
      if (expired) {
        this.seenEventIds.delete(expired.id);
      }
    }
  }

  public reset(): void {
    this.seenEventIds.clear();
    this.eventIdQueue = [];
    this.senderSequences.clear();
  }
}
