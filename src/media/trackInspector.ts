/**
 * Module: Container Audio Track Inspector
 * Inspects Matroska (.mkv, .webm) and MP4/MOV container headers in JavaScript
 * to extract track languages, codec names, and channel counts (e.g. 5.1 surround vs stereo).
 */

export interface DetectedAudioTrack {
  trackNumber: number;
  name: string;
  language: string;
  codec: string;
  channels: number; // 2 = Stereo, 6 = 5.1 Surround, etc.
  samplingRate?: number;
  isUnsupportedBrowserCodec?: boolean; // AC3, EAC3, DTS often lack decoding in Chrome
}

export interface ContainerInspectionResult {
  containerType: 'MKV' | 'MP4' | 'UNKNOWN';
  audioTracks: DetectedAudioTrack[];
  hasMultiChannel: boolean;
  hasUnsupportedAudio: boolean;
}

/**
 * Reads variable-length integer (VINT) used by Matroska / EBML.
 */
function readEbmlVint(buffer: Uint8Array, offset: number): { value: number; length: number } | null {
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

/**
 * Inspects Matroska / WebM EBML headers for audio tracks.
 */
function inspectMatroskaTracks(buffer: Uint8Array): DetectedAudioTrack[] {
  const tracks: DetectedAudioTrack[] = [];
  let pos = 0;

  // Search for Tracks element ID (0x16, 0x54, 0xAE, 0x6B)
  const tracksId = [0x16, 0x54, 0xAE, 0x6B];
  let tracksOffset = -1;

  for (let i = 0; i < buffer.length - 8; i++) {
    if (
      buffer[i] === tracksId[0] &&
      buffer[i + 1] === tracksId[1] &&
      buffer[i + 2] === tracksId[2] &&
      buffer[i + 3] === tracksId[3]
    ) {
      tracksOffset = i + 4;
      break;
    }
  }

  if (tracksOffset === -1) {
    return tracks;
  }

  const tracksLengthVint = readEbmlVint(buffer, tracksOffset);
  if (!tracksLengthVint) return tracks;

  pos = tracksOffset + tracksLengthVint.length;
  const tracksEnd = Math.min(buffer.length, pos + tracksLengthVint.value);

  // Parse TrackEntry (0xAE) children
  while (pos < tracksEnd - 4) {
    if (buffer[pos] === 0xAE) {
      pos++;
      const entryLenVint = readEbmlVint(buffer, pos);
      if (!entryLenVint) break;
      pos += entryLenVint.length;
      const entryEnd = Math.min(tracksEnd, pos + entryLenVint.value);

      let trackType = 0;
      let trackNum = tracks.length + 1;
      let codecId = '';
      let trackName = '';
      let language = 'und';
      let channels = 2; // Default to stereo if unspecified
      let samplingRate = 48000;

      while (pos < entryEnd - 2) {
        const id = buffer[pos];
        pos++;

        if (id === 0xD7) { // TrackNumber
          const len = readEbmlVint(buffer, pos);
          if (len) {
            pos += len.length;
            trackNum = buffer[pos];
            pos += len.value;
          }
        } else if (id === 0x83) { // TrackType (1=video, 2=audio, 17=subtitle)
          const len = readEbmlVint(buffer, pos);
          if (len) {
            pos += len.length;
            trackType = buffer[pos];
            pos += len.value;
          }
        } else if (id === 0x86) { // CodecID
          const len = readEbmlVint(buffer, pos);
          if (len) {
            pos += len.length;
            const strBytes = buffer.slice(pos, pos + len.value);
            codecId = new TextDecoder().decode(strBytes).replace(/\0/g, '');
            pos += len.value;
          }
        } else if (id === 0x53 && buffer[pos] === 0x6E) { // Name (0x536E)
          pos++;
          const len = readEbmlVint(buffer, pos);
          if (len) {
            pos += len.length;
            const strBytes = buffer.slice(pos, pos + len.value);
            trackName = new TextDecoder().decode(strBytes).replace(/\0/g, '');
            pos += len.value;
          }
        } else if (id === 0x22 && buffer[pos] === 0xB5 && buffer[pos + 1] === 0x9C) { // Language (0x22B59C)
          pos += 2;
          const len = readEbmlVint(buffer, pos);
          if (len) {
            pos += len.length;
            const strBytes = buffer.slice(pos, pos + len.value);
            language = new TextDecoder().decode(strBytes).replace(/\0/g, '');
            pos += len.value;
          }
        } else if (id === 0xE1) { // Audio settings master element
          const len = readEbmlVint(buffer, pos);
          if (len) {
            pos += len.length;
            const audioEnd = Math.min(entryEnd, pos + len.value);
            while (pos < audioEnd - 1) {
              const audioSubId = buffer[pos];
              pos++;
              if (audioSubId === 0x9F) { // Channels
                const cLen = readEbmlVint(buffer, pos);
                if (cLen) {
                  pos += cLen.length;
                  channels = buffer[pos];
                  pos += cLen.value;
                }
              } else if (audioSubId === 0xB5) { // SamplingFrequency
                const sLen = readEbmlVint(buffer, pos);
                if (sLen) {
                  pos += sLen.length;
                  pos += sLen.value;
                }
              } else {
                const skipLen = readEbmlVint(buffer, pos);
                if (skipLen) {
                  pos += skipLen.length + skipLen.value;
                } else {
                  pos++;
                }
              }
            }
          }
        } else {
          // Unknown or unneeded tag, skip
          const skipLen = readEbmlVint(buffer, pos);
          if (skipLen) {
            pos += skipLen.length + skipLen.value;
          } else {
            pos++;
          }
        }
      }

      if (trackType === 2) { // Audio
        const upperCodec = codecId.toUpperCase();
        const isUnsupported =
          upperCodec.includes('AC3') ||
          upperCodec.includes('EAC3') ||
          upperCodec.includes('DTS') ||
          upperCodec.includes('TRUEHD');

        tracks.push({
          trackNumber: trackNum,
          name: trackName || `Track ${trackNum}`,
          language: language !== 'und' ? language : 'und',
          codec: codecId || 'Unknown',
          channels,
          samplingRate,
          isUnsupportedBrowserCodec: isUnsupported
        });
      }

      pos = entryEnd;
    } else {
      pos++;
    }
  }

  return tracks;
}

/**
 * Inspects MP4 / MOV ISO Base Media File Format boxes for audio tracks.
 */
function inspectMp4Tracks(buffer: Uint8Array): DetectedAudioTrack[] {
  const tracks: DetectedAudioTrack[] = [];
  let pos = 0;

  // Search for 'moov' box
  let moovOffset = -1;
  while (pos < buffer.length - 8) {
    const size = (buffer[pos] << 24) | (buffer[pos + 1] << 16) | (buffer[pos + 2] << 8) | buffer[pos + 3];
    const type = String.fromCharCode(buffer[pos + 4], buffer[pos + 5], buffer[pos + 6], buffer[pos + 7]);

    if (type === 'moov') {
      moovOffset = pos + 8;
      break;
    }

    if (size <= 0 || pos + size > buffer.length) {
      pos += 4;
    } else {
      pos += size;
    }
  }

  if (moovOffset === -1) return tracks;

  // Search for 'trak' boxes inside moov
  pos = moovOffset;
  while (pos < buffer.length - 8) {
    const size = (buffer[pos] << 24) | (buffer[pos + 1] << 16) | (buffer[pos + 2] << 8) | buffer[pos + 3];
    const type = String.fromCharCode(buffer[pos + 4], buffer[pos + 5], buffer[pos + 6], buffer[pos + 7]);

    if (type === 'trak') {
      const trakEnd = Math.min(buffer.length, pos + size);
      // Check if this trak has handler 'soun'
      let isAudio = false;
      let codec = 'mp4a';
      let channels = 2;

      for (let i = pos; i < trakEnd - 12; i++) {
        if (
          buffer[i] === 0x73 && buffer[i + 1] === 0x6F &&
          buffer[i + 2] === 0x75 && buffer[i + 3] === 0x6E
        ) { // 'soun'
          isAudio = true;
        }
        // Common MP4 audio fourccs
        const fourcc = String.fromCharCode(buffer[i], buffer[i + 1], buffer[i + 2], buffer[i + 3]);
        if (['mp4a', 'ac-3', 'ec-3', 'dts ', 'opus', 'alac'].includes(fourcc)) {
          codec = fourcc;
          // Channel count is usually at offset + 20 in sample description
          if (i + 22 < trakEnd) {
            const ch = (buffer[i + 20] << 8) | buffer[i + 21];
            if (ch >= 1 && ch <= 8) channels = ch;
          }
        }
      }

      if (isAudio) {
        const isUnsupported = codec === 'ac-3' || codec === 'ec-3' || codec === 'dts ';
        tracks.push({
          trackNumber: tracks.length + 1,
          name: `Audio Track ${tracks.length + 1}`,
          language: 'und',
          codec,
          channels,
          isUnsupportedBrowserCodec: isUnsupported
        });
      }

      pos = trakEnd;
    } else if (size > 0) {
      pos += size;
    } else {
      pos += 4;
    }
  }

  return tracks;
}

/**
 * Inspects a File or Blob header to detect audio tracks, codec compatibility,
 * and whether 6-channel (5.1 surround) audio is present.
 */
export async function inspectContainerAudioTracks(file: File | Blob): Promise<ContainerInspectionResult> {
  // Read first 2 MB of the file
  const sliceSize = Math.min(file.size, 2 * 1024 * 1024);
  const slice = file.slice(0, sliceSize);
  const arrayBuffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  let containerType: 'MKV' | 'MP4' | 'UNKNOWN' = 'UNKNOWN';
  let audioTracks: DetectedAudioTrack[] = [];

  // Check for Matroska EBML signature: 0x1A, 0x45, 0xDF, 0xA3
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    containerType = 'MKV';
    audioTracks = inspectMatroskaTracks(bytes);
  } else if (
    // Check for MP4/MOV ftyp or moov box
    bytes.length > 8 &&
    String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp'
  ) {
    containerType = 'MP4';
    audioTracks = inspectMp4Tracks(bytes);
  }

  const hasMultiChannel = audioTracks.some((t) => t.channels >= 6);
  const hasUnsupportedAudio = audioTracks.some((t) => t.isUnsupportedBrowserCodec);

  return {
    containerType,
    audioTracks,
    hasMultiChannel,
    hasUnsupportedAudio
  };
}
