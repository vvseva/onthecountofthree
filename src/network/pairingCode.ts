/**
 * Yellkey-style 1-Minute Ephemeral Pairing Code Engine
 * Uses simple, universally known English words (easy for non-native speakers)
 * to exchange room credentials over Nostr relays within a 60-second window.
 */

import { NostrRelayPool } from './relayPool';
import { NostrIdentity, createEphemeralIdentity } from './nostrIdentity';
import { finalizeEvent, VerifiedEvent } from 'nostr-tools';

export const SIMPLE_WORDS = [
  'sun', 'moon', 'star', 'sky', 'tree', 'bird', 'fish', 'cat', 'dog', 'door',
  'book', 'cake', 'milk', 'tea', 'apple', 'blue', 'red', 'gold', 'rain', 'wind',
  'snow', 'road', 'home', 'song', 'ball', 'boat', 'hat', 'ring', 'cup', 'rose',
  'lake', 'park', 'smile', 'happy', 'hero', 'river', 'bread', 'cloud', 'leaf', 'music',
  'peace', 'light', 'green', 'wave', 'jump', 'walk', 'bell', 'lion', 'bear', 'clock',
  'train', 'plane', 'ocean', 'beach', 'fire', 'wood', 'card', 'desk', 'pen', 'coin',
  'rock', 'hill', 'seed', 'lamp', 'ship', 'shoe', 'flag', 'drum', 'nest', 'pond'
];

export interface PairingPayload {
  roomId: string;
  keyBase64: string;
  createdAt: number;
  word: string;
}

export class PairingCodeService {
  private relayPool: NostrRelayPool;
  private activeBroadcastTimer: number | null = null;
  private activeWord: string | null = null;
  private identity: NostrIdentity;

  constructor(relayPool: NostrRelayPool) {
    this.relayPool = relayPool;
    this.identity = createEphemeralIdentity();
  }

  /**
   * Generates a random simple English word for pairing.
   */
  public generateRandomWord(): string {
    const idx = Math.floor(Math.random() * SIMPLE_WORDS.length);
    return SIMPLE_WORDS[idx];
  }

  /**
   * Starts broadcasting the room credentials tagged with the simple word
   * for up to 60 seconds.
   */
  public startHostingPairingCode(
    word: string,
    roomId: string,
    keyBase64: string,
    onTick: (secondsRemaining: number) => void,
    onExpired: () => void
  ): void {
    this.stopHosting();
    this.activeWord = word.toLowerCase().trim();

    const startTime = Date.now();
    const durationSeconds = 60;

    const payload: PairingPayload = {
      roomId,
      keyBase64,
      createdAt: startTime,
      word: this.activeWord
    };

    const broadcastBeacon = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const eventTemplate = {
        kind: 20033, // Ephemeral event
        created_at: nowSec,
        tags: [
          ['d', `yellkey_${this.activeWord}`],
          ['code', this.activeWord!],
          ['app', 'onthecountofthree_yellkey']
        ],
        content: JSON.stringify(payload)
      };

      const signedEvent = finalizeEvent(eventTemplate, this.identity.secretKey);
      this.relayPool.publish(signedEvent);
    };

    // Broadcast immediately
    broadcastBeacon();

    // Broadcast beacon periodically every 4 seconds while running
    this.activeBroadcastTimer = window.setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      const remainingSec = Math.max(0, durationSeconds - elapsedSec);

      if (remainingSec <= 0) {
        this.stopHosting();
        onExpired();
      } else {
        broadcastBeacon();
        onTick(remainingSec);
      }
    }, 1000);
  }

  public stopHosting(): void {
    if (this.activeBroadcastTimer) {
      clearInterval(this.activeBroadcastTimer);
      this.activeBroadcastTimer = null;
    }
    this.activeWord = null;
  }

  /**
   * Listens for a room beacon matching the simple word.
   * Resolves with room credentials if found within timeout (15s).
   */
  public async resolvePairingCode(word: string, timeoutMs = 15000): Promise<PairingPayload | null> {
    const normalizedWord = word.toLowerCase().trim();
    const tag = `yellkey_${normalizedWord}`;

    // Temporarily subscribe to this tag
    this.relayPool.setRoomTag(tag);

    return new Promise((resolve) => {
      let resolved = false;

      const timer = window.setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, timeoutMs);

      const cleanup = this.relayPool.addEventListener((event: VerifiedEvent) => {
        if (resolved) return;

        try {
          // Check if event tags match
          const hasTag = event.tags.some(t => t[0] === 'd' && t[1] === tag);
          if (!hasTag && !event.tags.some(t => t[0] === 'code' && t[1] === normalizedWord)) {
            return;
          }

          const parsed = JSON.parse(event.content) as PairingPayload;
          if (parsed.roomId && parsed.keyBase64 && parsed.word === normalizedWord) {
            // Check if beacon is less than 90 seconds old
            const ageMs = Date.now() - parsed.createdAt;
            if (ageMs <= 90000) {
              resolved = true;
              clearTimeout(timer);
              cleanup();
              resolve(parsed);
            }
          }
        } catch {
          // ignore unparseable events
        }
      });
    });
  }
}
