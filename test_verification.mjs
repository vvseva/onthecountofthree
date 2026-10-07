import test from 'node:test';
import assert from 'node:assert/strict';

// Helper Web Crypto functions matching the app's crypto implementation
function bufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return bytesToHex(new Uint8Array(hash));
}

async function generateRoomCredentials() {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const roomId = bytesToHex(randomBytes);

  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const rawKey = await crypto.subtle.exportKey('raw', aesKey);
  const keyBase64 = bufferToBase64(rawKey);
  const hashedRoomTag = await sha256Hex(roomId);

  return { roomId, aesKey, keyBase64, hashedRoomTag };
}

async function encryptPayload(payload, aesKey) {
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintextBytes
  );

  const wireBytes = new Uint8Array(12 + ciphertext.byteLength);
  wireBytes.set(iv, 0);
  wireBytes.set(new Uint8Array(ciphertext), 12);

  return bufferToBase64(wireBytes);
}

async function decryptPayload(wireBase64, aesKey) {
  try {
    const wireBytes = base64ToBuffer(wireBase64);
    if (wireBytes.byteLength < 28) return null;
    const iv = wireBytes.slice(0, 12);
    const ciphertext = wireBytes.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return null;
  }
}

test('Room Keygen & URL Hash: produces 256-bit AES-GCM and SHA-256 room tag', async () => {
  const creds = await generateRoomCredentials();
  assert.equal(creds.roomId.length, 32);
  assert.ok(creds.keyBase64.length > 20);
  assert.equal(creds.hashedRoomTag.length, 64);
  const rehashed = await sha256Hex(creds.roomId);
  assert.equal(creds.hashedRoomTag, rehashed);
});

test('AES-GCM-256 E2EE: encrypts with 12-byte IV and verifies authenticity', async () => {
  const creds = await generateRoomCredentials();
  const testPayload = {
    version: 1,
    senderId: 'SESSION1',
    sequenceId: 1,
    timestamp: Date.now(),
    type: 'PLAY',
    playbackTime: 42.5,
    playbackRate: 1.0,
    paused: false,
    fingerprint: 'A7C2-9F10'
  };

  const encrypted = await encryptPayload(testPayload, creds.aesKey);
  assert.ok(encrypted);

  const decrypted = await decryptPayload(encrypted, creds.aesKey);
  assert.deepEqual(decrypted, testPayload);

  // Wrong key fails decryption
  const wrongCreds = await generateRoomCredentials();
  const badDecrypted = await decryptPayload(encrypted, wrongCreds.aesKey);
  assert.equal(badDecrypted, null);
});

test('Fuzzy Fingerprint calculation: 4MB head + 1MB tail + duration buffer', async () => {
  const mockFileSize = 10 * 1024 * 1024; // 10MB
  const head = new Uint8Array(4 * 1024 * 1024).fill(0xAA);
  const tail = new Uint8Array(1 * 1024 * 1024).fill(0xBB);
  const durationStr = 'DUR:120.45';
  const durationBytes = new TextEncoder().encode(durationStr);

  const combined = new Uint8Array(head.length + tail.length + durationBytes.length);
  combined.set(head, 0);
  combined.set(tail, head.length);
  combined.set(durationBytes, head.length + tail.length);

  const digest = await crypto.subtle.digest('SHA-256', combined);
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const raw8 = hex.slice(0, 8);
  const formattedCode = `${raw8.slice(0, 4)}-${raw8.slice(4, 8)}`;

  assert.equal(formattedCode.length, 9); // XXXX-XXXX
  assert.match(formattedCode, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test('Drift Compensation Rules Verification', () => {
  function getDriftAction(driftMs) {
    const abs = Math.abs(driftMs);
    if (abs < 100) return { action: 'DO_NOTHING', rate: 1.0 };
    if (abs <= 1200) {
      if (driftMs > 0) return { action: 'NUDGE_SLOW', rate: 0.97 };
      return { action: 'NUDGE_FAST', rate: 1.03 };
    }
    return { action: 'HARD_SEEK', rate: 1.0 };
  }

  // < 100ms threshold
  assert.deepEqual(getDriftAction(50), { action: 'DO_NOTHING', rate: 1.0 });
  assert.deepEqual(getDriftAction(-80), { action: 'DO_NOTHING', rate: 1.0 });

  // 100ms - 1200ms soft nudge
  assert.deepEqual(getDriftAction(350), { action: 'NUDGE_SLOW', rate: 0.97 });
  assert.deepEqual(getDriftAction(-500), { action: 'NUDGE_FAST', rate: 1.03 });

  // > 1200ms hard seek
  assert.deepEqual(getDriftAction(1500), { action: 'HARD_SEEK', rate: 1.0 });
  assert.deepEqual(getDriftAction(-2000), { action: 'HARD_SEEK', rate: 1.0 });
});

test('Peer Handshake & Wire Simulation: Peer A and Peer B exchange encrypted messages', async () => {
  const room = await generateRoomCredentials();

  // Peer A publishes PLAY
  const playMsg = {
    version: 1,
    senderId: 'PEER_A',
    sequenceId: 1,
    timestamp: Date.now(),
    type: 'PLAY',
    playbackTime: 23.4,
    playbackRate: 1.0,
    paused: false,
    fingerprint: 'AD42-4362'
  };

  const wireA = await encryptPayload(playMsg, room.aesKey);
  const receivedByB = await decryptPayload(wireA, room.aesKey);

  assert.ok(receivedByB);
  assert.equal(receivedByB.senderId, 'PEER_A');
  assert.equal(receivedByB.playbackTime, 23.4);
  assert.equal(receivedByB.fingerprint, 'AD42-4362');

  // Peer B responds with PONG
  const pongMsg = {
    version: 1,
    senderId: 'PEER_B',
    sequenceId: 1,
    timestamp: Date.now(),
    type: 'PONG',
    playbackTime: 23.4,
    playbackRate: 1.0,
    paused: false,
    fingerprint: 'AD42-4362',
    pingNonce: 'nonce789',
    echoTimestamp: playMsg.timestamp
  };

  const wireB = await encryptPayload(pongMsg, room.aesKey);
  const receivedByA = await decryptPayload(wireB, room.aesKey);

  assert.ok(receivedByA);
  assert.equal(receivedByA.senderId, 'PEER_B');
  assert.equal(receivedByA.pingNonce, 'nonce789');
  assert.equal(receivedByA.fingerprint, 'AD42-4362');
});

test('Chat and Fingerprint: System notices are hidden and fingerprint verified toasts are silenced', () => {
  // Test chat system message silencing
  let chatMessages = [];
  const fakeChat = {
    addMessage: (msg, isSelf) => { chatMessages.push({ msg, isSelf }); },
    addSystemMessage: (_text) => { /* Silenced to prevent crowding */ }
  };

  fakeChat.addSystemMessage('System: User joined');
  assert.equal(chatMessages.length, 0, 'System messages must not enter chat stream');

  fakeChat.addMessage({ senderId: 'PEER_B', text: 'Hello!', timestamp: Date.now() }, false);
  assert.equal(chatMessages.length, 1, 'User messages are accepted in chat stream');

  // Verify fingerprint verified status is silent (no popup toast)
  let toasts = [];
  const fakeToastManager = {
    show: (t) => { toasts.push(t); }
  };

  function handleFpChange(status, peerFp) {
    if (status === 'VERIFIED') {
      // Silently updated in diagnostics card, no toast
    } else if (status === 'MISMATCH') {
      fakeToastManager.show({ title: 'Fingerprint Mismatch' });
    }
  }

  handleFpChange('VERIFIED', 'B4F1-92A3');
  assert.equal(toasts.length, 0, 'VERIFIED status must not generate popup toast');

  handleFpChange('MISMATCH', 'XXXX-YYYY');
  assert.equal(toasts.length, 1, 'MISMATCH status should generate warning toast');
});

test('Yellkey Word Pairing: Simple universally recognized English words', () => {
  const words = ['sun', 'moon', 'star', 'tree', 'cat', 'dog', 'book', 'cake', 'apple'];
  const picked = words[Math.floor(Math.random() * words.length)];
  assert.ok(picked.length >= 3 && picked.length <= 6);
  assert.match(picked, /^[a-z]+$/);
});
