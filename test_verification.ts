import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCredentials, importRoomCredentials, sha256Hex } from './src/crypto/keyManager.ts';
import { encryptPayload, decryptPayload } from './src/crypto/e2ee.ts';
import { EventDeduplicator } from './src/network/deduplicator.ts';
import { SyncPayload } from './src/types.ts';

test('KeyManager: generates and re-imports room credentials accurately', async () => {
  const creds = await generateRoomCredentials();
  assert.ok(creds.roomId);
  assert.equal(creds.roomId.length, 32);
  assert.ok(creds.keyBase64);
  assert.ok(creds.hashedRoomTag);

  // Hash check
  const expectedHash = await sha256Hex(creds.roomId);
  assert.equal(creds.hashedRoomTag, expectedHash);

  // Re-importing from base64
  const imported = await importRoomCredentials(creds.roomId, creds.keyBase64);
  assert.equal(imported.roomId, creds.roomId);
  assert.equal(imported.hashedRoomTag, creds.hashedRoomTag);
});

test('E2EE: encrypts and decrypts SyncPayload with fresh 12-byte IV', async () => {
  const creds = await generateRoomCredentials();

  const payload: SyncPayload = {
    version: 1,
    senderId: 'ABCD1234',
    sequenceId: 42,
    timestamp: Date.now(),
    type: 'PLAY',
    playbackTime: 123.45,
    playbackRate: 1.0,
    paused: false,
    fingerprint: 'A7C2-9F10'
  };

  const encryptedWireBase64 = await encryptPayload(payload, creds.aesKey);
  assert.ok(encryptedWireBase64);

  // Decrypt with correct key
  const decrypted = await decryptPayload(encryptedWireBase64, creds.aesKey);
  assert.ok(decrypted);
  assert.equal(decrypted.version, 1);
  assert.equal(decrypted.senderId, 'ABCD1234');
  assert.equal(decrypted.sequenceId, 42);
  assert.equal(decrypted.type, 'PLAY');
  assert.equal(decrypted.playbackTime, 123.45);
  assert.equal(decrypted.fingerprint, 'A7C2-9F10');

  // Attempt decrypt with different key must fail gracefully (return null)
  const anotherCreds = await generateRoomCredentials();
  const failedDecrypted = await decryptPayload(encryptedWireBase64, anotherCreds.aesKey);
  assert.equal(failedDecrypted, null);
});

test('Deduplicator: filters duplicate event IDs and sender sequence IDs', () => {
  const dedup = new EventDeduplicator();

  assert.equal(dedup.isDuplicateEventId('evt-1'), false);
  assert.equal(dedup.isDuplicateEventId('evt-1'), true); // duplicate!
  assert.equal(dedup.isDuplicateEventId('evt-2'), false);

  const p1: SyncPayload = {
    version: 1,
    senderId: 'PEER1',
    sequenceId: 10,
    timestamp: Date.now(),
    type: 'PLAY',
    playbackTime: 0,
    playbackRate: 1.0,
    paused: false
  };

  assert.equal(dedup.isDuplicatePayload(p1), false);
  assert.equal(dedup.isDuplicatePayload(p1), true); // duplicate seq!

  const p2: SyncPayload = { ...p1, sequenceId: 11 };
  assert.equal(dedup.isDuplicatePayload(p2), false); // next seq ok!
});
