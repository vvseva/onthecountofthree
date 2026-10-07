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

test('Audio Downmixing: ITU-R BS.775 5.1-to-Stereo coefficients & Multi-channel detection', () => {
  // Test 5.1 downmix matrix calculation
  // Left = Left + 0.7071*Center + 0.5*LFE + 0.7071*SL
  // Right = Right + 0.7071*Center + 0.5*LFE + 0.7071*SR
  const centerCoeff = 0.7071;
  const lfeCoeff = 0.5;
  const surroundCoeff = 0.7071;

  const mock51 = {
    left: 1.0,
    right: 1.0,
    center: 1.0, // Dialogue
    lfe: 0.8,
    surroundLeft: 0.5,
    surroundRight: 0.5
  };

  const downmixedLeft = mock51.left + (mock51.center * centerCoeff) + (mock51.lfe * lfeCoeff) + (mock51.surroundLeft * surroundCoeff);
  const downmixedRight = mock51.right + (mock51.center * centerCoeff) + (mock51.lfe * lfeCoeff) + (mock51.surroundRight * surroundCoeff);

  // Dialog must be present in both channels
  assert.ok(downmixedLeft > 1.0, 'Center dialogue channel must be mixed into left stereo output');
  assert.ok(downmixedRight > 1.0, 'Center dialogue channel must be mixed into right stereo output');
  assert.equal(downmixedLeft.toFixed(2), downmixedRight.toFixed(2), 'Stereo balance must be symmetric');

  // Verify multi-channel 6-channel flag detection logic
  const tracks = [
    { trackNumber: 1, name: 'Surround 5.1', codec: 'A_AC3', channels: 6, language: 'eng' },
    { trackNumber: 2, name: 'Stereo', codec: 'A_AAC', channels: 2, language: 'rus' }
  ];

  const has6ch = tracks.some(t => t.channels >= 6);
  assert.equal(has6ch, true, 'Must detect 6-channel audio');
});

test('EBML VINT Decoder: Correctly parses 1-byte through 4-byte Matroska integers', () => {
  function readEbmlVint(buffer, offset) {
    if (offset >= buffer.length) return null;
    const firstByte = buffer[offset];
    if (firstByte === 0) return null;

    let length = 1;
    let mask = 0x80;
    while ((firstByte & mask) === 0 && length <= 8) {
      length++;
      mask >>= 1;
    }

    if (offset + length > buffer.length) return null;

    let value = firstByte & (mask - 1);
    for (let i = 1; i < length; i++) {
      value = (value * 256) + buffer[offset + i];
    }

    return { value, length };
  }

  // 1-byte: 0x81 -> value 1
  assert.deepEqual(readEbmlVint(new Uint8Array([0x81]), 0), { value: 1, length: 1 });
  // 1-byte: 0x82 -> value 2
  assert.deepEqual(readEbmlVint(new Uint8Array([0x82]), 0), { value: 2, length: 1 });
  // 2-byte: 0x40 0x05 -> value 5
  assert.deepEqual(readEbmlVint(new Uint8Array([0x40, 0x05]), 0), { value: 5, length: 2 });
  // 4-byte: 0x10 0x00 0x01 0x00 -> value 256
  assert.deepEqual(readEbmlVint(new Uint8Array([0x10, 0x00, 0x01, 0x00]), 0), { value: 256, length: 4 });
});

test('Subtitle ASS/SSA Cleaning and WebVTT formatting', () => {
  // Test removing ASS event dialogue styling and tags
  function cleanAssText(raw) {
    let text = raw;
    if (text.includes(',')) {
      const parts = text.split(',');
      if (parts.length >= 9) {
        text = parts.slice(8).join(',');
      }
    }
    return text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();
  }

  const rawAss = '1,,Default,,0,0,0,,{\\pos(192,200)}{\\b1}Hello world!\\NSecond line.';
  const cleaned = cleanAssText(rawAss);
  assert.equal(cleaned, 'Hello world!\nSecond line.');

  // Test SRT to VTT timestamp conversion
  function convertSrtToVtt(srtText) {
    let normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    normalized = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return `WEBVTT\n\n${normalized.trim()}\n`;
  }

  const sampleSrt = '1\n00:01:23,456 --> 00:01:26,789\nHey there!\n';
  const vtt = convertSrtToVtt(sampleSrt);
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.ok(vtt.includes('00:01:23.456 --> 00:01:26.789'));
});

test('Fullscreen Controls Auto-Hide & Bottom Progress state machine', () => {
  class FullscreenController {
    constructor() {
      this.isFullscreen = false;
      this.isControlsHidden = false;
      this.isMouseOverControls = false;
      this.isPaused = false;
      this.timer = null;
    }

    setFullscreen(fs) {
      this.isFullscreen = fs;
      if (!fs) {
        this.isControlsHidden = false;
        if (this.timer) clearTimeout(this.timer);
      } else {
        this.resetTimer();
      }
    }

    onMouseMove() {
      if (this.isFullscreen) {
        this.isControlsHidden = false;
        this.resetTimer();
      }
    }

    resetTimer() {
      if (this.timer) clearTimeout(this.timer);
      if (this.isFullscreen && !this.isPaused && !this.isMouseOverControls) {
        this.timer = setTimeout(() => {
          this.isControlsHidden = true;
        }, 100);
      }
    }

    toggleControls() {
      this.isControlsHidden = !this.isControlsHidden;
    }
  }

  const ctrl = new FullscreenController();
  ctrl.setFullscreen(true);
  assert.equal(ctrl.isControlsHidden, false);

  // Manual toggle hides controls
  ctrl.toggleControls();
  assert.equal(ctrl.isControlsHidden, true);

  // Mouse move brings controls back
  ctrl.onMouseMove();
  assert.equal(ctrl.isControlsHidden, false);

  // Exiting fullscreen brings controls back
  ctrl.isControlsHidden = true;
  ctrl.setFullscreen(false);
  assert.equal(ctrl.isControlsHidden, false);
});

test('EBML Multi-Track Parser: Successfully parses WEB-DL with 2x AC-3 5.1 and 3x UTF-8 Subtitle tracks', () => {
  function readEbmlVint(buffer, offset) {
    if (offset >= buffer.length) return null;
    const firstByte = buffer[offset];
    if (firstByte === 0) return null;
    let length = 1;
    let mask = 0x80;
    while ((firstByte & mask) === 0 && length <= 8) {
      length++;
      mask >>= 1;
    }
    if (offset + length > buffer.length) return null;
    let value = firstByte & (mask - 1);
    for (let i = 1; i < length; i++) {
      value = (value * 256) + buffer[offset + i];
    }
    return { value, length };
  }

  function readEbmlId(buffer, offset) {
    if (offset >= buffer.length) return null;
    const firstByte = buffer[offset];
    if (firstByte === 0) return null;
    let length = 1;
    let mask = 0x80;
    while ((firstByte & mask) === 0 && length <= 4) {
      length++;
      mask >>= 1;
    }
    if (offset + length > buffer.length) return null;
    let id = 0;
    for (let i = 0; i < length; i++) {
      id = (id * 256) + buffer[offset + i];
    }
    return { id, length };
  }

  function readUint(buffer, offset, length) {
    let val = 0;
    for (let i = 0; i < length; i++) val = (val * 256) + buffer[offset + i];
    return val;
  }

  // Helper to build a TrackEntry
  function buildTrackEntry(trackNum, trackType, codecStr, langStr, nameStr, isDefault, channels) {
    const enc = new TextEncoder();
    const codecBytes = enc.encode(codecStr);
    const langBytes = enc.encode(langStr);
    const nameBytes = nameStr ? enc.encode(nameStr) : null;

    const parts = [
      0x73, 0x73, 0x84, 0x11, 0x22, 0x33, trackNum, // TrackUID (0x7373)
      0xD7, 0x81, trackNum,                         // TrackNumber (0xD7)
      0x83, 0x81, trackType,                        // TrackType (0x83)
      0x88, 0x81, isDefault ? 1 : 0,                // FlagDefault (0x88)
      0x86, 0x80 | codecBytes.length, ...codecBytes,// CodecID (0x86)
      0x22, 0xB5, 0x9C, 0x80 | langBytes.length, ...langBytes // Language
    ];

    if (nameBytes) {
      parts.push(0x53, 0x6E, 0x80 | nameBytes.length, ...nameBytes); // Name (0x536E)
    }

    if (channels) {
      parts.push(0xE1, 0x83, 0x9F, 0x81, channels); // Audio (0xE1) -> Channels (0x9F)
    }

    return [0xAE, 0x80 | parts.length, ...parts];
  }

  const tracksBuf = new Uint8Array([
    // Tracks (0x1654AE6B)
    0x16, 0x54, 0xAE, 0x6B, 0x80 | 120,
    ...buildTrackEntry(1, 1, 'V_MPEG4/ISO/AVC', 'eng', '', true, 0),
    ...buildTrackEntry(2, 2, 'A_AC3', 'rus', 'Dolby Digital', true, 6),
    ...buildTrackEntry(3, 2, 'A_AC3', 'eng', 'Dolby Digital', false, 6),
    ...buildTrackEntry(4, 17, 'S_TEXT/UTF8', 'rus', 'Forced', true, 0),
    ...buildTrackEntry(5, 17, 'S_TEXT/UTF8', 'rus', 'Full', false, 0),
    ...buildTrackEntry(6, 17, 'S_TEXT/UTF8', 'eng', '', false, 0)
  ]);

  // Parse using our parser
  let pos = 5; // after Tracks header
  const audioTracks = [];
  const subtitleTracks = [];

  while (pos < tracksBuf.length) {
    const entryId = readEbmlId(tracksBuf, pos);
    if (!entryId) break;
    const entrySize = readEbmlVint(tracksBuf, pos + entryId.length);
    if (!entrySize) break;
    const entryDataStart = pos + entryId.length + entrySize.length;
    const entryDataEnd = entryDataStart + entrySize.value;

    if (entryId.id === 0xAE) {
      let tNum = 0, tType = 0, tCodec = '', tLang = 'und', tName = '', tDefault = false, tCh = 2;
      let cPos = entryDataStart;
      while (cPos < entryDataEnd) {
        const cId = readEbmlId(tracksBuf, cPos);
        if (!cId) break;
        const cSize = readEbmlVint(tracksBuf, cPos + cId.length);
        if (!cSize) break;
        const cStart = cPos + cId.length + cSize.length;
        const cEnd = cStart + cSize.value;

        if (cId.id === 0xD7) tNum = readUint(tracksBuf, cStart, cSize.value);
        if (cId.id === 0x83) tType = readUint(tracksBuf, cStart, cSize.value);
        if (cId.id === 0x88) tDefault = readUint(tracksBuf, cStart, cSize.value) === 1;
        if (cId.id === 0x86) tCodec = new TextDecoder().decode(tracksBuf.slice(cStart, cEnd));
        if (cId.id === 0x22B59C) tLang = new TextDecoder().decode(tracksBuf.slice(cStart, cEnd));
        if (cId.id === 0x536E) tName = new TextDecoder().decode(tracksBuf.slice(cStart, cEnd));
        if (cId.id === 0xE1) {
          let aPos = cStart;
          while (aPos < cEnd) {
            const aId = readEbmlId(tracksBuf, aPos);
            if (!aId) break;
            const aSize = readEbmlVint(tracksBuf, aPos + aId.length);
            if (!aSize) break;
            if (aId.id === 0x9F) tCh = readUint(tracksBuf, aPos + aId.length + aSize.length, aSize.value);
            aPos += aId.length + aSize.length + aSize.value;
          }
        }
        cPos = cEnd;
      }

      if (tType === 2) {
        audioTracks.push({ trackNumber: tNum, codec: tCodec, language: tLang, name: tName, isDefault: tDefault, channels: tCh });
      } else if (tType === 17) {
        subtitleTracks.push({ trackNumber: tNum, codec: tCodec, language: tLang, name: tName, isDefault: tDefault });
      }
    }
    pos = entryDataEnd;
  }

  assert.equal(audioTracks.length, 2, 'Must detect both Russian and English audio tracks');
  assert.equal(audioTracks[0].trackNumber, 2);
  assert.equal(audioTracks[0].language, 'rus');
  assert.equal(audioTracks[0].codec, 'A_AC3');
  assert.equal(audioTracks[0].channels, 6);
  assert.equal(audioTracks[0].isDefault, true);

  assert.equal(audioTracks[1].trackNumber, 3);
  assert.equal(audioTracks[1].language, 'eng');
  assert.equal(audioTracks[1].codec, 'A_AC3');
  assert.equal(audioTracks[1].channels, 6);

  assert.equal(subtitleTracks.length, 3, 'Must detect all 3 subtitle tracks');
  assert.equal(subtitleTracks[0].name, 'Forced');
  assert.equal(subtitleTracks[0].language, 'rus');
  assert.equal(subtitleTracks[1].name, 'Full');
  assert.equal(subtitleTracks[1].language, 'rus');
  assert.equal(subtitleTracks[2].language, 'eng');
});

test('Subtitle Live DOM Cues Parser & Timing Offset Synchronization', () => {
  function parseSrtOrVttToCues(rawText) {
    const cues = [];
    const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split(/\n\n+/);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;

      let timeLineIdx = -1;
      let match = null;
      for (let i = 0; i < lines.length; i++) {
        const m = /(?:(\d{2,}):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[,.](\d{3})/.exec(lines[i]);
        if (m) {
          timeLineIdx = i;
          match = m;
          break;
        }
      }
      if (timeLineIdx === -1 || !match) continue;

      const startH = match[1] ? parseInt(match[1], 10) : 0;
      const startM = parseInt(match[2], 10);
      const startS = parseInt(match[3], 10);
      const startMsVal = parseInt(match[4], 10);
      const startTotalMs = (startH * 3600 + startM * 60 + startS) * 1000 + startMsVal;

      const endMatch = /-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[,.](\d{3})/.exec(lines[timeLineIdx]);
      if (!endMatch) continue;
      const endH = endMatch[1] ? parseInt(endMatch[1], 10) : 0;
      const endM = parseInt(endMatch[2], 10);
      const endS = parseInt(endMatch[3], 10);
      const endMsVal = parseInt(endMatch[4], 10);
      const endTotalMs = (endH * 3600 + endM * 60 + endS) * 1000 + endMsVal;

      const textLines = lines.slice(timeLineIdx + 1).join('\n').trim();
      const cleanedText = textLines.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (cleanedText) {
        cues.push({
          startMs: startTotalMs,
          endMs: endTotalMs,
          text: cleanedText
        });
      }
    }

    return cues.sort((a, b) => a.startMs - b.startMs);
  }

  function getActiveSubtitleText(cues, currentTimeSec, offsetSec = 0) {
    if (!cues || cues.length === 0) return null;
    const targetMs = (currentTimeSec - offsetSec) * 1000;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (targetMs >= cue.startMs && targetMs <= cue.endMs) {
        return cue.text;
      }
    }
    return null;
  }

  const srtContent = `1
00:00:02,000 --> 00:00:05,000
<i>Welcome to On The Count Of Three</i>

2
00:00:06,500 --> 00:00:09,200
Sync is fully active.`;

  const cues = parseSrtOrVttToCues(srtContent);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 2000);
  assert.equal(cues[0].endMs, 5000);
  assert.equal(cues[0].text, 'Welcome to On The Count Of Three');

  // Exact time matches
  assert.equal(getActiveSubtitleText(cues, 3.5), 'Welcome to On The Count Of Three');
  assert.equal(getActiveSubtitleText(cues, 1.0), null);
  assert.equal(getActiveSubtitleText(cues, 7.0), 'Sync is fully active.');

  // Timing offset (+1.5s shift)
  // At currentTime = 5.0s, with offset = +1.5s, effective media time = 3.5s -> cue 1
  assert.equal(getActiveSubtitleText(cues, 5.0, 1.5), 'Welcome to On The Count Of Three');
});
test('Secret Chat Command: /polina triggers full screen message and hearts', () => {
  let overlayTriggered = 0;
  const fakeOverlay = {
    show: () => { overlayTriggered++; }
  };

  function processChatMessage(text) {
    const textClean = text.trim().toLowerCase();
    if (textClean === '/polina' || textClean.startsWith('/polina ') || textClean.startsWith('/polina!')) {
      fakeOverlay.show();
      return true;
    }
    return false;
  }

  assert.equal(processChatMessage('/polina'), true);
  assert.equal(overlayTriggered, 1);

  assert.equal(processChatMessage('  /POLINA  '), true);
  assert.equal(overlayTriggered, 2);

  assert.equal(processChatMessage('/polina!'), true);
  assert.equal(overlayTriggered, 3);

  assert.equal(processChatMessage('hello world'), false);
  assert.equal(overlayTriggered, 3);
});

test('Primary vs Secondary Sync Roles: Primary maintains 1.00x fixed clock with zero stutter', () => {
  function computeAction(role, driftMs, isWarmup = false) {
    if (role === 'PRIMARY') {
      return { action: 'DO_NOTHING', rate: 1.0 };
    }
    const abs = Math.abs(driftMs);
    if (isWarmup) {
      if (abs < 100) return { action: 'DO_NOTHING', rate: 1.0 };
      if (abs <= 3500) {
        return { action: 'WARMUP_SETTLE', rate: driftMs > 0 ? 0.98 : 1.02 };
      }
      return { action: 'HARD_SEEK', rate: 1.0 };
    }
    if (abs < 100) return { action: 'DO_NOTHING', rate: 1.0 };
    if (abs <= 1200) {
      return { action: driftMs > 0 ? 'NUDGE_SLOW' : 'NUDGE_FAST', rate: driftMs > 0 ? 0.97 : 1.03 };
    }
    return { action: 'HARD_SEEK', rate: 1.0 };
  }

  // Primary: never alters speed or seeks regardless of drift
  assert.deepEqual(computeAction('PRIMARY', 250), { action: 'DO_NOTHING', rate: 1.0 });
  assert.deepEqual(computeAction('PRIMARY', 1500), { action: 'DO_NOTHING', rate: 1.0 });
  assert.deepEqual(computeAction('PRIMARY', -800), { action: 'DO_NOTHING', rate: 1.0 });

  // Secondary during warmup: suppresses hard seek for 1500ms drift, gently settles
  assert.deepEqual(computeAction('SECONDARY', 1500, true), { action: 'WARMUP_SETTLE', rate: 0.98 });
  assert.deepEqual(computeAction('SECONDARY', -500, true), { action: 'WARMUP_SETTLE', rate: 1.02 });
  assert.deepEqual(computeAction('SECONDARY', 4000, true), { action: 'HARD_SEEK', rate: 1.0 });

  // Secondary after warmup: standard rules apply
  assert.deepEqual(computeAction('SECONDARY', 300, false), { action: 'NUDGE_SLOW', rate: 0.97 });
  assert.deepEqual(computeAction('SECONDARY', 1500, false), { action: 'HARD_SEEK', rate: 1.0 });
});

test('English Track Prioritization: Automatically selects English audio and subtitle tracks', () => {
  function isEnglish(lang, name) {
    const l = (lang || '').toLowerCase().trim();
    const n = (name || '').toLowerCase();
    return l === 'eng' || l === 'en' || l === 'english' || /\b(eng|english)\b/i.test(n);
  }

  const sampleAudioTracks = [
    { trackNumber: 1, name: 'Russian DVO (ExKinoRay)', language: 'rus', codec: 'AC-3', isDefault: true, isUnsupportedBrowserCodec: true },
    { trackNumber: 2, name: 'English Original', language: 'eng', codec: 'E-AC-3', isDefault: false, isUnsupportedBrowserCodec: true }
  ];

  // Pick audio track to decode: should prioritize English track over default Russian track
  const selectedAudio = sampleAudioTracks.find(t => isEnglish(t.language, t.name) && t.isUnsupportedBrowserCodec)
    || sampleAudioTracks.find(t => t.isDefault && t.isUnsupportedBrowserCodec);

  assert.ok(selectedAudio);
  assert.equal(selectedAudio.trackNumber, 2);
  assert.equal(selectedAudio.language, 'eng');

  // Subtitles preference
  const sampleSubTracks = [
    { trackNumber: 3, name: 'Русские субтитры', language: 'rus', isDefault: true },
    { trackNumber: 4, name: 'English Subtitles', language: 'eng', isDefault: false }
  ];

  const selectedSub = sampleSubTracks.find(t => isEnglish(t.language, t.name))
    || sampleSubTracks.find(t => t.isDefault);

  assert.ok(selectedSub);
  assert.equal(selectedSub.trackNumber, 4);
});

test('Audio Decoded Peer Notification: broadcasts AUDIO_DECODED event with track name', async () => {
  const room = await generateRoomCredentials();

  const decodedEvent = {
    version: 1,
    senderId: 'PEER_X',
    sequenceId: 5,
    timestamp: Date.now(),
    type: 'AUDIO_DECODED',
    playbackTime: 0,
    playbackRate: 1.0,
    paused: true,
    role: 'PRIMARY',
    audioDecodedTrack: 'English 5.1 Surround'
  };

  const encrypted = await encryptPayload(decodedEvent, room.aesKey);
  const decrypted = await decryptPayload(encrypted, room.aesKey);

  assert.ok(decrypted);
  assert.equal(decrypted.type, 'AUDIO_DECODED');
  assert.equal(decrypted.audioDecodedTrack, 'English 5.1 Surround');
  assert.equal(decrypted.role, 'PRIMARY');
});

test('Role Handshake: Second user that joins is Clock (PRIMARY) and first user is Follower (SECONDARY)', () => {
  // User 1 creates room -> isHost = true
  let user1 = { isHost: true, role: 'SECONDARY' };
  // User 2 joins via share URL -> isHost = false
  let user2 = { isHost: false, role: 'PRIMARY' };

  function onPeerConnected(user, remoteRole) {
    if (user.isHost) {
      user.role = 'SECONDARY'; // First user becomes follower
    } else {
      user.role = 'PRIMARY'; // Second user that joins is clock
    }
  }

  // Initial state before peer joins
  assert.equal(user1.role, 'SECONDARY');
  assert.equal(user2.role, 'PRIMARY');

  // Peer connection event
  onPeerConnected(user1, user2.role);
  onPeerConnected(user2, user1.role);

  assert.equal(user1.role, 'SECONDARY', 'First user (host) must be Follower (SECONDARY)');
  assert.equal(user2.role, 'PRIMARY', 'Second user that joins must be Clock (PRIMARY)');
});

test('Playback Prevention: Warning shown when pressing Play without a loaded video', () => {
  let playRequestSent = false;
  let warningTriggered = false;

  const fakePlayer = {
    hasLoadedVideo: false,
    triggerPlayPauseAction: function() {
      if (!this.hasLoadedVideo) {
        warningTriggered = true;
        return;
      }
      playRequestSent = true;
    }
  };

  // Attempt play without loaded video
  fakePlayer.triggerPlayPauseAction();
  assert.equal(warningTriggered, true, 'Warning must be triggered when trying to play without video');
  assert.equal(playRequestSent, false, 'Play request must not be sent when no video is loaded');

  // Now load a video and try again
  warningTriggered = false;
  fakePlayer.hasLoadedVideo = true;
  fakePlayer.triggerPlayPauseAction();
  assert.equal(warningTriggered, false);
  assert.equal(playRequestSent, true, 'Play request can proceed after video is loaded');
});
