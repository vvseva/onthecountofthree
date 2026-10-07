/**
 * Module B: End-to-End Encryption & Key Exchange
 * Manages Room ID generation, 256-bit AES-GCM key export/import,
 * and URL hash fragment persistence.
 */

export interface RoomCredentials {
  roomId: string;             // 16 random bytes as hex (32 characters)
  aesKey: CryptoKey;          // 256-bit AES-GCM key
  keyBase64: string;          // Exported raw key in base64
  hashedRoomTag: string;      // SHA-256 hex of roomId (used as Nostr tag, zero metadata leakage)
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  // Normalize URL-safe base64 if needed
  let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) {
    normalized += '=';
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes SHA-256 hex digest of a string
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Generates fresh room credentials (Room ID + 256-bit AES-GCM Key).
 */
export async function generateRoomCredentials(): Promise<RoomCredentials> {
  // 16 random bytes for Room ID
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const roomId = bytesToHex(randomBytes);

  // Generate 256-bit AES-GCM key (exportable)
  const aesKey = await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );

  const rawKey = await crypto.subtle.exportKey('raw', aesKey);
  const keyBase64 = bufferToBase64(rawKey);
  const hashedRoomTag = await sha256Hex(roomId);

  return {
    roomId,
    aesKey,
    keyBase64,
    hashedRoomTag
  };
}

/**
 * Imports existing credentials from Room ID and Base64 raw key.
 */
export async function importRoomCredentials(roomId: string, keyBase64: string): Promise<RoomCredentials> {
  const rawKeyBytes = base64ToBuffer(keyBase64);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawKeyBytes as unknown as BufferSource,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );

  const hashedRoomTag = await sha256Hex(roomId);

  return {
    roomId,
    aesKey,
    keyBase64,
    hashedRoomTag
  };
}

/**
 * Parses credentials from current window.location.hash.
 * Expected format: #room=<roomId>&key=<base64Key>
 */
export async function parseCredentialsFromHash(): Promise<RoomCredentials | null> {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const roomId = params.get('room');
  const key = params.get('key');

  if (!roomId || !key) return null;

  try {
    return await importRoomCredentials(roomId, key);
  } catch (err) {
    console.error('Failed to parse room credentials from hash:', err);
    return null;
  }
}

/**
 * Sets the browser URL hash without causing a page reload.
 */
export function setUrlHash(roomId: string, keyBase64: string): void {
  const newHash = `#room=${encodeURIComponent(roomId)}&key=${encodeURIComponent(keyBase64)}`;
  window.history.replaceState(null, '', newHash);
}

/**
 * Generates the full shareable invite URL.
 */
export function buildShareUrl(roomId: string, keyBase64: string): string {
  const origin = window.location.origin + window.location.pathname;
  return `${origin}#room=${encodeURIComponent(roomId)}&key=${encodeURIComponent(keyBase64)}`;
}
