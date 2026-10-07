import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCredentials } from './src/crypto/keyManager.ts';
import { createEphemeralIdentity, signEphemeralSyncEvent } from './src/network/nostrIdentity.ts';
import { encryptPayload, decryptPayload } from './src/crypto/e2ee.ts';
import { EventDeduplicator } from './src/network/deduplicator.ts';

test('End-to-End Simulation: Two clients sync in same room', async () => {
  // 1. Room creation
  const room = await generateRoomCredentials();

  // 2. Client A and Client B
  const idA = createEphemeralIdentity();
  const idB = createEphemeralIdentity();
  const dedupB = new EventDeduplicator();

  // 3. Client A emits PLAY event
  const payloadA = {
    version: 1,
    senderId: 'PEER_AAA',
    sequenceId: 1,
    timestamp: Date.now(),
    type: 'PLAY',
    playbackTime: 14.5,
    playbackRate: 1.0,
    paused: false,
    fingerprint: 'AD42-4362'
  };

  const encrypted = await encryptPayload(payloadA, room.aesKey);
  const event = signEphemeralSyncEvent(idA, room.hashedRoomTag, encrypted);

  // 4. Client B receives event
  assert.equal(dedupB.isDuplicateEventId(event.id), false);
  const decryptedByB = await decryptPayload(event.content, room.aesKey);

  assert.ok(decryptedByB);
  assert.equal(decryptedByB.senderId, 'PEER_AAA');
  assert.equal(decryptedByB.type, 'PLAY');
  assert.equal(decryptedByB.playbackTime, 14.5);
  assert.equal(decryptedByB.fingerprint, 'AD42-4362');

  // 5. Client B replies with PONG
  const payloadB = {
    version: 1,
    senderId: 'PEER_BBB',
    sequenceId: 1,
    timestamp: Date.now(),
    type: 'PONG',
    playbackTime: 14.5,
    playbackRate: 1.0,
    paused: false,
    pingNonce: 'nonce123',
    echoTimestamp: payloadA.timestamp
  };

  const encryptedB = await encryptPayload(payloadB, room.aesKey);
  const eventB = signEphemeralSyncEvent(idB, room.hashedRoomTag, encryptedB);

  const decryptedByA = await decryptPayload(eventB.content, room.aesKey);
  assert.ok(decryptedByA);
  assert.equal(decryptedByA.senderId, 'PEER_BBB');
  assert.equal(decryptedByA.type, 'PONG');
  assert.equal(decryptedByA.pingNonce, 'nonce123');
});
