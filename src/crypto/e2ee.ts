/**
 * Module B: End-to-End Encryption (E2EE)
 * Web Crypto AES-GCM-256 with prepended fresh 12-byte IVs.
 */

import { SyncPayload } from '../types';

const IV_LENGTH_BYTES = 12; // Standard 96-bit IV for AES-GCM

function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypts a SyncPayload into a base64 wire packet:
 * Wire structure: [ 12-byte IV ][ Ciphertext + 16-byte GCM Tag ]
 */
export async function encryptPayload(payload: SyncPayload, aesKey: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(payload));

  // Fresh 12-byte cryptographically secure random IV for each packet
  const iv = new Uint8Array(IV_LENGTH_BYTES);
  crypto.getRandomValues(iv);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    aesKey,
    plaintextBytes
  );

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);

  // Prepend IV to ciphertext
  const wireBytes = new Uint8Array(IV_LENGTH_BYTES + ciphertextBytes.byteLength);
  wireBytes.set(iv, 0);
  wireBytes.set(ciphertextBytes, IV_LENGTH_BYTES);

  return bufferToBase64(wireBytes);
}

/**
 * Decrypts a base64 wire packet into a SyncPayload:
 * Extracts 12-byte IV and decrypts remaining ciphertext.
 */
export async function decryptPayload(wireBase64: string, aesKey: CryptoKey): Promise<SyncPayload | null> {
  try {
    const wireBytes = base64ToBuffer(wireBase64);
    if (wireBytes.byteLength < IV_LENGTH_BYTES + 16) {
      // Must have at least IV (12) + GCM tag (16)
      console.warn('E2EE packet too short to be valid');
      return null;
    }

    const iv = wireBytes.slice(0, IV_LENGTH_BYTES);
    const ciphertext = wireBytes.slice(IV_LENGTH_BYTES);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      aesKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(decryptedBuffer);
    const payload = JSON.parse(jsonStr) as SyncPayload;

    if (payload.version !== 1 || !payload.type || typeof payload.playbackTime !== 'number') {
      console.warn('Decrypted payload failed schema validation');
      return null;
    }

    return payload;
  } catch (err) {
    // Decryption failed (invalid key, tampered message, or wrong room)
    console.warn('E2EE decryption error (dropping unauthenticated packet):', err);
    return null;
  }
}
