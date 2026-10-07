/**
 * Module: High-Performance Client-Side Matroska (MKV) & MP4 Demuxer
 * Extracts embedded audio tracks and text subtitle tracks (SRT / UTF-8 / WebVTT / ASS)
 * without needing external servers or native desktop players.
 * Decodes Dolby Digital Plus (E-AC-3) and AC-3 via WASM libavcodec decoder with ITU-R BS.775 5.1 downmixing.
 */

import { decoder } from '@audio/decode-eac3';

export interface DemuxedTrackInfo {
  trackNumber: number;
  type: 'audio' | 'subtitle' | 'video';
  name: string;
  language: string;
  codec: string;
  channels?: number;
  samplingRate?: number;
  isDefault?: boolean;
  isForced?: boolean;
  isUnsupportedBrowserCodec?: boolean;
}

export interface DemuxResult {
  containerType: 'MKV' | 'MP4' | 'UNKNOWN';
  format: 'MKV' | 'MP4' | 'UNKNOWN';
  audioTracks: DemuxedTrackInfo[];
  subtitleTracks: DemuxedTrackInfo[];
  timecodeScale: number; // nanoseconds per unit, default 1,000,000 = 1ms
  tracksOffset: number;
  hasMultiChannel: boolean;
  hasUnsupportedAudio: boolean;
}

interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Reads variable-length integer (VINT) used by Matroska / EBML for data lengths.
 * The length marker bit is masked out to return the integer value.
 */
export function readEbmlVint(buffer: Uint8Array, offset: number): { value: number; length: number } | null {
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
 * Reads an EBML Element ID (1 to 4 bytes).
 * For Element IDs, the length marker bit IS preserved as part of the ID number.
 */
export function readEbmlId(buffer: Uint8Array, offset: number): { id: number; length: number } | null {
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

/**
 * Parses integer value from buffer bytes.
 */
function readUint(buffer: Uint8Array, offset: number, length: number): number {
  let val = 0;
  for (let i = 0; i < length; i++) {
    val = (val * 256) + buffer[offset + i];
  }
  return val;
}

/**
 * Parses float value (32-bit or 64-bit IEEE 754) from buffer bytes.
 */
function readFloat(buffer: Uint8Array, offset: number, length: number): number {
  if (length === 4) {
    const dv = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
    return dv.getFloat32(0, false);
  } else if (length === 8) {
    const dv = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
    return dv.getFloat64(0, false);
  }
  return 48000;
}

/**
 * Inspects Matroska SeekHead to locate the exact file offset of Tracks element.
 */
async function locateMatroskaTracksOffset(file: File): Promise<{ tracksOffset: number; segmentOffset: number; timecodeScale: number }> {
  const headSlice = file.slice(0, Math.min(file.size, 1024 * 1024));
  const buf = new Uint8Array(await headSlice.arrayBuffer());

  let segmentOffset = 0;
  let tracksOffset = -1;
  let timecodeScale = 1000000; // default 1ms

  // Search for Segment element: 0x18, 0x53, 0x80, 0x67
  let pos = 0;
  while (pos < buf.length - 8) {
    const idInfo = readEbmlId(buf, pos);
    if (!idInfo) { pos++; continue; }

    if (idInfo.id === 0x18538067) { // Segment
      const sizeInfo = readEbmlVint(buf, pos + idInfo.length);
      if (sizeInfo) {
        segmentOffset = pos + idInfo.length + sizeInfo.length;
        pos = segmentOffset;
      } else {
        pos += idInfo.length;
      }
      break;
    }
    pos++;
  }

  // Inside Segment: parse children (SeekHead, Info, Tracks)
  while (pos < buf.length - 8) {
    const idInfo = readEbmlId(buf, pos);
    if (!idInfo) break;
    const sizeInfo = readEbmlVint(buf, pos + idInfo.length);
    if (!sizeInfo) break;

    const dataStart = pos + idInfo.length + sizeInfo.length;
    const dataEnd = dataStart + sizeInfo.value;

    if (idInfo.id === 0x1654AE6B) { // Tracks directly found!
      tracksOffset = pos;
      break;
    }

    if (idInfo.id === 0x1549A966) { // Info
      // Check for TimecodeScale (0x2AD7B1)
      let infoPos = dataStart;
      while (infoPos < dataEnd && infoPos < buf.length - 4) {
        const iId = readEbmlId(buf, infoPos);
        if (!iId) break;
        const iSize = readEbmlVint(buf, infoPos + iId.length);
        if (!iSize) break;
        if (iId.id === 0x2AD7B1) { // TimecodeScale
          timecodeScale = readUint(buf, infoPos + iId.length + iSize.length, iSize.value);
        }
        infoPos += iId.length + iSize.length + iSize.value;
      }
    }

    if (idInfo.id === 0x114D9B74) { // SeekHead
      let seekPos = dataStart;
      while (seekPos < dataEnd && seekPos < buf.length - 6) {
        const sId = readEbmlId(buf, seekPos);
        if (!sId) break;
        const sSize = readEbmlVint(buf, seekPos + sId.length);
        if (!sSize) break;
        const sDataStart = seekPos + sId.length + sSize.length;
        const sDataEnd = sDataStart + sSize.value;

        if (sId.id === 0x4DBB) { // Seek entry
          let ePos = sDataStart;
          let seekTargetId = 0;
          let seekTargetPos = -1;

          while (ePos < sDataEnd && ePos < buf.length - 4) {
            const entryId = readEbmlId(buf, ePos);
            if (!entryId) break;
            const entrySize = readEbmlVint(buf, ePos + entryId.length);
            if (!entrySize) break;
            const entryDataStart = ePos + entryId.length + entrySize.length;

            if (entryId.id === 0x53AB) { // SeekID
              seekTargetId = readUint(buf, entryDataStart, entrySize.value);
            } else if (entryId.id === 0x53AC) { // SeekPosition
              seekTargetPos = readUint(buf, entryDataStart, entrySize.value);
            }

            ePos += entryId.length + entrySize.length + entrySize.value;
          }

          if (seekTargetId === 0x1654AE6B && seekTargetPos !== -1) {
            tracksOffset = segmentOffset + seekTargetPos;
          }
        }

        seekPos = sDataEnd;
      }
    }

    pos = dataEnd;
  }

  return { tracksOffset, segmentOffset, timecodeScale };
}

/**
 * Inspects MP4 / MOV ISO Base Media File Format boxes for audio and subtitle tracks.
 */
async function inspectMp4File(file: File): Promise<DemuxResult> {
  const sliceSize = Math.min(file.size, 8 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, sliceSize).arrayBuffer());

  const audioTracks: DemuxedTrackInfo[] = [];
  const subtitleTracks: DemuxedTrackInfo[] = [];

  let pos = 0;
  let moovOffset = -1;

  while (pos < buf.length - 8) {
    const size = (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);

    if (type === 'moov') {
      moovOffset = pos + 8;
      break;
    }

    if (size <= 0 || pos + size > buf.length) {
      pos += 4;
    } else {
      pos += size;
    }
  }

  if (moovOffset !== -1) {
    pos = moovOffset;
    while (pos < buf.length - 8) {
      const size = (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
      const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);

      if (type === 'trak') {
        const trakEnd = Math.min(buf.length, pos + size);
        let isAudio = false;
        let isSub = false;
        let codec = 'unknown';
        let channels = 2;
        let lang = 'und';

        for (let i = pos; i < trakEnd - 12; i++) {
          if (buf[i] === 0x73 && buf[i + 1] === 0x6F && buf[i + 2] === 0x75 && buf[i + 3] === 0x6E) {
            isAudio = true;
          }
          if (
            (buf[i] === 0x73 && buf[i + 1] === 0x75 && buf[i + 2] === 0x62 && buf[i + 3] === 0x74) ||
            (buf[i] === 0x73 && buf[i + 1] === 0x62 && buf[i + 2] === 0x74 && buf[i + 3] === 0x6C) ||
            (buf[i] === 0x74 && buf[i + 1] === 0x65 && buf[i + 2] === 0x78 && buf[i + 3] === 0x74)
          ) {
            isSub = true;
          }

          const fourcc = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
          if (['mp4a', 'ac-3', 'ec-3', 'dts ', 'opus', 'alac'].includes(fourcc)) {
            codec = fourcc;
            if (i + 22 < trakEnd) {
              const ch = (buf[i + 20] << 8) | buf[i + 21];
              if (ch >= 1 && ch <= 8) channels = ch;
            }
          }
          if (['tx3g', 'wvtt', 'c608', 'c708'].includes(fourcc)) {
            codec = fourcc;
          }

          if (buf[i] === 0x6D && buf[i + 1] === 0x64 && buf[i + 2] === 0x68 && buf[i + 3] === 0x64 && i + 24 < trakEnd) {
            const langCode = (buf[i + 20] << 8) | buf[i + 21];
            const c1 = String.fromCharCode(((langCode >> 10) & 0x1F) + 0x60);
            const c2 = String.fromCharCode(((langCode >> 5) & 0x1F) + 0x60);
            const c3 = String.fromCharCode((langCode & 0x1F) + 0x60);
            if (c1 >= 'a' && c1 <= 'z') lang = `${c1}${c2}${c3}`;
          }
        }

        if (isAudio) {
          const isUnsupported = codec === 'ac-3' || codec === 'ec-3' || codec === 'dts ';
          audioTracks.push({
            trackNumber: audioTracks.length + 1,
            type: 'audio',
            name: `${lang !== 'und' ? lang.toUpperCase() : 'Audio'} Track ${audioTracks.length + 1}`,
            language: lang,
            codec: codec === 'ec-3' ? 'E-AC-3' : (codec === 'ac-3' ? 'AC-3' : codec.toUpperCase()),
            channels,
            isUnsupportedBrowserCodec: isUnsupported
          });
        } else if (isSub) {
          subtitleTracks.push({
            trackNumber: subtitleTracks.length + 1,
            type: 'subtitle',
            name: `${lang !== 'und' ? lang.toUpperCase() : 'Subtitle'} Track ${subtitleTracks.length + 1}`,
            language: lang,
            codec: codec.toUpperCase()
          });
        }

        pos = trakEnd;
      } else if (size > 0) {
        pos += size;
      } else {
        pos += 4;
      }
    }
  }

  const hasMultiChannel = audioTracks.some((t) => (t.channels || 0) >= 6);
  const hasUnsupportedAudio = audioTracks.some((t) => t.isUnsupportedBrowserCodec);

  return {
    containerType: 'MP4',
    format: 'MP4',
    audioTracks,
    subtitleTracks,
    timecodeScale: 1000000,
    tracksOffset: 0,
    hasMultiChannel,
    hasUnsupportedAudio
  };
}

/**
 * Parses all Audio and Subtitle tracks from a Matroska (MKV / WebM) or MP4 container.
 */
export async function demuxMatroska(file: File): Promise<DemuxResult> {
  const headSlice = file.slice(0, 16);
  const headBytes = new Uint8Array(await headSlice.arrayBuffer());

  // Check MP4 signature
  if (
    headBytes.length > 8 &&
    (String.fromCharCode(headBytes[4], headBytes[5], headBytes[6], headBytes[7]) === 'ftyp' ||
     String.fromCharCode(headBytes[4], headBytes[5], headBytes[6], headBytes[7]) === 'moov')
  ) {
    return inspectMp4File(file);
  }

  const { tracksOffset, timecodeScale } = await locateMatroskaTracksOffset(file);

  const audioTracks: DemuxedTrackInfo[] = [];
  const subtitleTracks: DemuxedTrackInfo[] = [];

  let tracksBuffer: Uint8Array;

  if (tracksOffset !== -1) {
    const slice = file.slice(tracksOffset, Math.min(file.size, tracksOffset + 1024 * 1024));
    tracksBuffer = new Uint8Array(await slice.arrayBuffer());
  } else {
    const slice = file.slice(0, Math.min(file.size, 16 * 1024 * 1024));
    tracksBuffer = new Uint8Array(await slice.arrayBuffer());
  }

  // Find Tracks element: 0x1654AE6B
  let tracksDataStart = 0;
  let tracksDataEnd = tracksBuffer.length;

  for (let i = 0; i < tracksBuffer.length - 8; i++) {
    const idInfo = readEbmlId(tracksBuffer, i);
    if (idInfo && idInfo.id === 0x1654AE6B) {
      const sizeInfo = readEbmlVint(tracksBuffer, i + idInfo.length);
      if (sizeInfo) {
        tracksDataStart = i + idInfo.length + sizeInfo.length;
        tracksDataEnd = Math.min(tracksBuffer.length, tracksDataStart + sizeInfo.value);
        break;
      }
    }
  }

  // Parse TrackEntry (0xAE) children inside Tracks element
  let pos = tracksDataStart;
  while (pos < tracksDataEnd - 4) {
    const entryId = readEbmlId(tracksBuffer, pos);
    if (!entryId) break;
    const entrySize = readEbmlVint(tracksBuffer, pos + entryId.length);
    if (!entrySize) break;

    const entryDataStart = pos + entryId.length + entrySize.length;
    const entryDataEnd = Math.min(tracksDataEnd, entryDataStart + entrySize.value);

    if (entryId.id === 0xAE) { // TrackEntry
      let trackType = 0;
      let trackNum = audioTracks.length + subtitleTracks.length + 1;
      let codecId = '';
      let trackName = '';
      let language = 'und';
      let channels = 2;
      let samplingRate = 48000;
      let isDefault = false;
      let isForced = false;

      let childPos = entryDataStart;
      while (childPos < entryDataEnd - 2) {
        const cId = readEbmlId(tracksBuffer, childPos);
        if (!cId) break;
        const cSize = readEbmlVint(tracksBuffer, childPos + cId.length);
        if (!cSize) break;

        const cDataStart = childPos + cId.length + cSize.length;
        const cDataEnd = cDataStart + cSize.value;

        if (cId.id === 0xD7) { // TrackNumber
          trackNum = readUint(tracksBuffer, cDataStart, cSize.value);
        } else if (cId.id === 0x83) { // TrackType (1=video, 2=audio, 17=subtitle)
          trackType = readUint(tracksBuffer, cDataStart, cSize.value);
        } else if (cId.id === 0x88) { // FlagDefault
          isDefault = readUint(tracksBuffer, cDataStart, cSize.value) === 1;
        } else if (cId.id === 0x55AA) { // FlagForced
          isForced = readUint(tracksBuffer, cDataStart, cSize.value) === 1;
        } else if (cId.id === 0x86) { // CodecID
          codecId = new TextDecoder('utf-8').decode(tracksBuffer.slice(cDataStart, cDataEnd)).replace(/\0/g, '');
        } else if (cId.id === 0x536E) { // Name / Title
          trackName = new TextDecoder('utf-8').decode(tracksBuffer.slice(cDataStart, cDataEnd)).replace(/\0/g, '').trim();
        } else if (cId.id === 0x22B59C) { // Language
          language = new TextDecoder('utf-8').decode(tracksBuffer.slice(cDataStart, cDataEnd)).replace(/\0/g, '').trim();
        } else if (cId.id === 0xE1) { // Audio settings
          let aPos = cDataStart;
          while (aPos < cDataEnd - 2) {
            const aId = readEbmlId(tracksBuffer, aPos);
            if (!aId) break;
            const aSize = readEbmlVint(tracksBuffer, aPos + aId.length);
            if (!aSize) break;
            const aDataStart = aPos + aId.length + aSize.length;

            if (aId.id === 0x9F) { // Channels
              channels = readUint(tracksBuffer, aDataStart, aSize.value);
            } else if (aId.id === 0xB5) { // SamplingFrequency
              samplingRate = readFloat(tracksBuffer, aDataStart, aSize.value);
            }

            aPos = aDataStart + aSize.value;
          }
        }

        childPos = cDataEnd;
      }

      const langClean = language !== 'und' ? language : 'und';

      if (trackType === 2) { // Audio
        const upper = codecId.toUpperCase();
        const isUnsupported =
          upper.includes('EAC3') ||
          upper.includes('AC3') ||
          upper.includes('DTS') ||
          upper.includes('TRUEHD');

        let cleanCodec = codecId.replace(/^A_/, '');
        if (cleanCodec === 'EAC3') cleanCodec = 'E-AC-3';
        else if (cleanCodec === 'AC3') cleanCodec = 'AC-3';

        const chLabel = channels === 6 ? '5.1ch' : (channels === 2 ? 'Stereo' : `${channels}ch`);
        const langDisplay = langClean !== 'und' ? langClean.toUpperCase() : 'Audio';
        const displayName = trackName ? `${trackName} (${chLabel})` : `${langDisplay} Track ${audioTracks.length + 1} (${chLabel})`;

        audioTracks.push({
          trackNumber: trackNum,
          type: 'audio',
          name: displayName,
          language: langClean,
          codec: cleanCodec,
          channels,
          samplingRate,
          isDefault,
          isForced,
          isUnsupportedBrowserCodec: isUnsupported
        });
      } else if (trackType === 17) { // Subtitle
        let cleanCodec = codecId.replace(/^S_TEXT\//, '').replace(/^S_/, '');
        const langDisplay = langClean !== 'und' ? langClean.toUpperCase() : 'Sub';
        const displayName = trackName ? `${trackName} (${langDisplay})` : `${langDisplay} Track ${subtitleTracks.length + 1}`;

        subtitleTracks.push({
          trackNumber: trackNum,
          type: 'subtitle',
          name: displayName,
          language: langClean,
          codec: cleanCodec,
          isDefault,
          isForced
        });
      }
    }

    pos = entryDataEnd;
  }

  const hasMultiChannel = audioTracks.some((t) => (t.channels || 0) >= 6);
  const hasUnsupportedAudio = audioTracks.some((t) => t.isUnsupportedBrowserCodec);

  return {
    containerType: 'MKV',
    format: 'MKV',
    audioTracks,
    subtitleTracks,
    timecodeScale,
    tracksOffset,
    hasMultiChannel,
    hasUnsupportedAudio
  };
}

/**
 * Extracts an embedded subtitle track from Matroska clusters and converts to WebVTT.
 */
export async function extractMatroskaSubtitles(file: File, targetTrackNum: number): Promise<string> {
  const cues: SubtitleCue[] = [];
  const chunkSize = 4 * 1024 * 1024; // 4MB read chunks
  let fileOffset = 0;
  let currentClusterTimecode = 0;

  while (fileOffset < file.size) {
    const sliceEnd = Math.min(file.size, fileOffset + chunkSize);
    const buf = new Uint8Array(await file.slice(fileOffset, sliceEnd).arrayBuffer());
    if (buf.length < 8) break;

    let pos = 0;
    while (pos < buf.length - 8) {
      const idInfo = readEbmlId(buf, pos);
      if (!idInfo) { pos++; continue; }

      const sizeInfo = readEbmlVint(buf, pos + idInfo.length);
      if (!sizeInfo) { pos++; continue; }

      const dataStart = pos + idInfo.length + sizeInfo.length;
      const dataEnd = dataStart + sizeInfo.value;

      // Cluster element: 0x1F43B675
      if (idInfo.id === 0x1F43B675) {
        pos = dataStart; // Enter cluster children
        continue;
      }

      // Timecode: 0xE7
      if (idInfo.id === 0xE7) {
        currentClusterTimecode = readUint(buf, dataStart, sizeInfo.value);
        pos = dataEnd;
        continue;
      }

      // BlockGroup: 0xA0
      if (idInfo.id === 0xA0) {
        pos = dataStart; // Enter BlockGroup children
        continue;
      }

      // SimpleBlock (0xA3) or Block (0xA1)
      if (idInfo.id === 0xA3 || idInfo.id === 0xA1) {
        const trackVint = readEbmlVint(buf, dataStart);
        if (trackVint && trackVint.value === targetTrackNum) {
          const headerLen = trackVint.length + 3; // trackVint + relTimecode(2) + flags(1)
          const relTimecode = (buf[dataStart + trackVint.length] << 8) | buf[dataStart + trackVint.length + 1];
          const signedRelTc = (relTimecode > 0x7FFF) ? relTimecode - 0x10000 : relTimecode;
          const payloadStart = dataStart + headerLen;
          const payloadLen = sizeInfo.value - headerLen;

          if (payloadLen > 0 && payloadStart + payloadLen <= buf.length) {
            const rawBytes = buf.slice(payloadStart, payloadStart + payloadLen);
            let text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes).trim();

            // Strip ASS/SSA tags and metadata fields
            if (text.includes(',')) {
              const parts = text.split(',');
              if (parts.length >= 9) {
                text = parts.slice(8).join(',');
              }
            }
            text = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();

            if (text) {
              const startMs = currentClusterTimecode + signedRelTc;
              const endMs = startMs + 3500;
              cues.push({ startMs, endMs, text });
            }
          }
        }

        // Advance to next block
        if (dataEnd > buf.length) {
          fileOffset += dataEnd;
          pos = 0;
          break;
        } else {
          pos = dataEnd;
          continue;
        }
      }

      // Skip any other element
      if (dataEnd > buf.length) {
        fileOffset += dataEnd;
        pos = 0;
        break;
      } else {
        pos = dataEnd;
      }
    }

    if (pos > 0) {
      fileOffset += pos;
    }
  }

  // Format cues into WebVTT
  cues.sort((a, b) => a.startMs - b.startMs);

  let vtt = 'WEBVTT\n\n';
  for (let idx = 0; idx < cues.length; idx++) {
    const cue = cues[idx];
    const nextStart = cues[idx + 1]?.startMs;
    const finalEnd = nextStart && nextStart > cue.startMs && nextStart < cue.endMs ? nextStart : cue.endMs;
    vtt += `${formatVttTime(cue.startMs)} --> ${formatVttTime(finalEnd)}\n${cue.text}\n\n`;
  }

  return vtt;
}

function formatVttTime(ms: number): string {
  if (ms < 0) ms = 0;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/**
 * Extracts raw E-AC-3 / AC-3 audio packets from Matroska clusters,
 * decodes them using WASM libavcodec eac3 decoder with ITU-R BS.775 5.1 downmixing,
 * and returns a synchronized AudioBuffer.
 */
export async function extractAndDecodeEac3Track(
  file: File,
  targetTrackNum: number,
  audioCtx: AudioContext,
  onProgress?: (pct: number) => void
): Promise<AudioBuffer> {
  const dec = await decoder();

  const leftParts: Float32Array[] = [];
  const rightParts: Float32Array[] = [];
  let detectedSampleRate = 48000;
  let totalSamples = 0;

  const chunkSize = 4 * 1024 * 1024; // 4MB stream slices
  let fileOffset = 0;

  try {
    while (fileOffset < file.size) {
      const sliceEnd = Math.min(file.size, fileOffset + chunkSize);
      const buf = new Uint8Array(await file.slice(fileOffset, sliceEnd).arrayBuffer());
      if (buf.length < 8) break;

      let pos = 0;
      const audioBatch: Uint8Array[] = [];

      while (pos < buf.length - 8) {
        const idInfo = readEbmlId(buf, pos);
        if (!idInfo) { pos++; continue; }

        const sizeInfo = readEbmlVint(buf, pos + idInfo.length);
        if (!sizeInfo) { pos++; continue; }

        const dataStart = pos + idInfo.length + sizeInfo.length;
        const dataEnd = dataStart + sizeInfo.value;

        // Cluster element: 0x1F43B675
        if (idInfo.id === 0x1F43B675) {
          pos = dataStart; // Enter cluster
          continue;
        }

        // Timecode: 0xE7
        if (idInfo.id === 0xE7) {
          pos = dataEnd;
          continue;
        }

        // BlockGroup: 0xA0
        if (idInfo.id === 0xA0) {
          pos = dataStart; // Enter BlockGroup
          continue;
        }

        // SimpleBlock (0xA3) or Block (0xA1)
        if (idInfo.id === 0xA3 || idInfo.id === 0xA1) {
          const trackVint = readEbmlVint(buf, dataStart);
          if (trackVint && trackVint.value === targetTrackNum) {
            const headerLen = trackVint.length + 3; // trackNum + relTimecode(2) + flags(1)
            const payloadStart = dataStart + headerLen;
            const payloadLen = sizeInfo.value - headerLen;

            if (payloadLen > 0 && payloadStart + payloadLen <= buf.length) {
              const rawFrame = buf.slice(payloadStart, payloadStart + payloadLen);
              audioBatch.push(rawFrame);
            }
          }

          if (dataEnd > buf.length) {
            fileOffset += dataEnd;
            pos = 0;
            break;
          } else {
            pos = dataEnd;
            continue;
          }
        }

        // Skip any other element
        if (dataEnd > buf.length) {
          fileOffset += dataEnd;
          pos = 0;
          break;
        } else {
          pos = dataEnd;
        }
      }

      // If audio frames were collected in this chunk, feed them to WASM decoder
      if (audioBatch.length > 0) {
        let totalBatchBytes = 0;
        for (const b of audioBatch) totalBatchBytes += b.length;
        const mergedBatch = new Uint8Array(totalBatchBytes);
        let bOff = 0;
        for (const b of audioBatch) {
          mergedBatch.set(b, bOff);
          bOff += b.length;
        }

        const decoded = dec.decode(mergedBatch);
        if (decoded && decoded.channelData && decoded.channelData.length > 0) {
          detectedSampleRate = decoded.sampleRate || 48000;
          const numChannels = decoded.channelData.length;
          const numSamples = decoded.channelData[0].length;

          if (numSamples > 0) {
            const leftStereo = new Float32Array(numSamples);
            const rightStereo = new Float32Array(numSamples);

            if (numChannels >= 6) {
              // ITU-R BS.775 5.1-to-Stereo downmixing with dialogue boost
              const fl = decoded.channelData[0];
              const fr = decoded.channelData[1];
              const fc = decoded.channelData[2]; // Centre dialogue
              const lfe = decoded.channelData[3];
              const bl = decoded.channelData[4];
              const br = decoded.channelData[5];

              for (let s = 0; s < numSamples; s++) {
                leftStereo[s] = (fl[s] + 0.7071 * fc[s] + 0.5 * lfe[s] + 0.7071 * bl[s]) * 1.25;
                rightStereo[s] = (fr[s] + 0.7071 * fc[s] + 0.5 * lfe[s] + 0.7071 * br[s]) * 1.25;
              }
            } else if (numChannels === 2) {
              leftStereo.set(decoded.channelData[0]);
              rightStereo.set(decoded.channelData[1]);
            } else if (numChannels === 1) {
              leftStereo.set(decoded.channelData[0]);
              rightStereo.set(decoded.channelData[0]);
            }

            leftParts.push(leftStereo);
            rightParts.push(rightStereo);
            totalSamples += numSamples;
          }
        }
      }

      if (pos > 0) {
        fileOffset += pos;
      }

      if (onProgress) {
        onProgress(Math.min(95, Math.round((fileOffset / file.size) * 100)));
      }
    }

    const flushDec = dec.flush();
    if (flushDec && flushDec.channelData && flushDec.channelData.length > 0) {
      const numSamples = flushDec.channelData[0].length;
      if (numSamples > 0) {
        const leftStereo = new Float32Array(numSamples);
        const rightStereo = new Float32Array(numSamples);
        leftStereo.set(flushDec.channelData[0]);
        rightStereo.set(flushDec.channelData[1] || flushDec.channelData[0]);
        leftParts.push(leftStereo);
        rightParts.push(rightStereo);
        totalSamples += numSamples;
      }
    }
  } finally {
    dec.free();
  }

  // Assemble complete AudioBuffer
  const audioBuffer = audioCtx.createBuffer(2, Math.max(1, totalSamples), detectedSampleRate);
  const outL = audioBuffer.getChannelData(0);
  const outR = audioBuffer.getChannelData(1);

  let offset = 0;
  for (let p = 0; p < leftParts.length; p++) {
    outL.set(leftParts[p], offset);
    outR.set(rightParts[p], offset);
    offset += leftParts[p].length;
  }

  if (onProgress) onProgress(100);
  return audioBuffer;
}
