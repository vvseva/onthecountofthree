/**
 * Module A: Local Video Ingestion & Fuzzy Fingerprinting
 * 
 * Computes an 8-character verification fingerprint without hashing gigabytes:
 * 1. Read first 4 MB of file.
 * 2. Read final 1 MB of file.
 * 3. Incorporate HTMLMediaElement.duration.
 * 4. Compute SHA-256 over the combined buffer.
 * 5. Truncate to 8 characters formatted as XXXX-XXXX (e.g. A7C2-9F10).
 */

const HEAD_BYTES = 4 * 1024 * 1024; // 4 MB
const TAIL_BYTES = 1 * 1024 * 1024; // 1 MB

export interface FingerprintResult {
  code: string;           // Formatted 8-character code, e.g. "A7C2-9F10"
  rawHex: string;         // First 8 hex characters, uppercase
  fullDigestHex: string;  // Full 64-character SHA-256 digest
  duration: number;       // Duration in seconds used in calculation
}

/**
 * Reads a Blob/File slice into an ArrayBuffer
 */
async function readBlobSlice(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Computes the 8-character fuzzy fingerprint for a local video file.
 */
export async function computeVideoFingerprint(file: File | Blob, duration: number): Promise<FingerprintResult> {
  const fileSize = file.size;

  // 1. Slice first 4 MB
  const headSlice = file.slice(0, Math.min(HEAD_BYTES, fileSize));
  const headBuffer = await readBlobSlice(headSlice);

  // 2. Slice final 1 MB (if file is larger than 1MB, otherwise slice whatever is available)
  const tailStart = Math.max(0, fileSize - TAIL_BYTES);
  const tailSlice = file.slice(tailStart, fileSize);
  const tailBuffer = await readBlobSlice(tailSlice);

  // 3. Format duration string as UTF-8 bytes (normalized to 2 decimal places to prevent micro-jitter)
  const durationStr = `DUR:${duration.toFixed(2)}`;
  const durationBytes = new TextEncoder().encode(durationStr);

  // Combine into a single buffer
  const totalLength = headBuffer.byteLength + tailBuffer.byteLength + durationBytes.byteLength;
  const combined = new Uint8Array(totalLength);

  let offset = 0;
  combined.set(new Uint8Array(headBuffer), offset);
  offset += headBuffer.byteLength;

  combined.set(new Uint8Array(tailBuffer), offset);
  offset += tailBuffer.byteLength;

  combined.set(durationBytes, offset);

  // 4. Compute SHA-256 over combined buffer
  const digestBuffer = await crypto.subtle.digest('SHA-256', combined);
  const digestArray = Array.from(new Uint8Array(digestBuffer));
  const fullDigestHex = digestArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  // 5. Truncate to 8 characters and format as XXXX-XXXX (e.g. A7C2-9F10)
  const raw8 = fullDigestHex.slice(0, 8);
  const formattedCode = `${raw8.slice(0, 4)}-${raw8.slice(4, 8)}`;

  return {
    code: formattedCode,
    rawHex: raw8,
    fullDigestHex,
    duration
  };
}

/**
 * Waits for video element metadata to load to extract exact duration.
 */
export async function extractVideoDuration(videoElement: HTMLVideoElement): Promise<number> {
  if (videoElement.duration && !isNaN(videoElement.duration) && videoElement.duration > 0) {
    return videoElement.duration;
  }

  return new Promise((resolve) => {
    const onLoadedMetadata = () => {
      videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
      resolve(videoElement.duration || 0);
    };

    if (videoElement.readyState >= 1) {
      resolve(videoElement.duration || 0);
    } else {
      videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
    }
  });
}
