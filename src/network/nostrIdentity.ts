/**
 * Module C: Nostr Ephemeral Identity
 * Generates throwaway in-memory Nostr keypair and signs NIP-01 events.
 */

import { generateSecretKey, getPublicKey, finalizeEvent, EventTemplate, VerifiedEvent } from 'nostr-tools';

export interface NostrIdentity {
  secretKey: Uint8Array;
  publicKey: string; // 32-byte hex string
}

/**
 * Creates an ephemeral in-memory Nostr identity.
 * Key is never stored in localStorage, cookies, or disk.
 */
export function createEphemeralIdentity(): NostrIdentity {
  const secretKey = generateSecretKey();
  const publicKey = getPublicKey(secretKey);
  return { secretKey, publicKey };
}

/**
 * Creates and cryptographically signs a Nostr Ephemeral Event (kind 20033).
 * Tagged with the hashed room ID ("d" tag for parameterized filter matching).
 */
export function signEphemeralSyncEvent(
  identity: NostrIdentity,
  hashedRoomTag: string,
  encryptedContentBase64: string
): VerifiedEvent {
  const now = Math.floor(Date.now() / 1000);

  const eventTemplate: EventTemplate = {
    kind: 20033, // Ephemeral event (20000-29999 range per NIP-01 / NIP-16)
    created_at: now,
    tags: [
      ['d', hashedRoomTag],
      ['app', 'onthecountofthree'],
      ['t', 'sync']
    ],
    content: encryptedContentBase64
  };

  return finalizeEvent(eventTemplate, identity.secretKey);
}
