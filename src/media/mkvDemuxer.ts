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
 * Reads variable-length integer (VINT) used by Matroska / EBML.
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
 * Inspects Matroska SeekHead to locate the exact file offset of Tracks element.
 */
async function locateMatroskaTracksOffset(file: File): Promise<{ tracksOffset: number; segmentOffset: number; timecodeScale: number }> {
  const headSlice = file.slice(0, Math.min(file.size, 512 * 1024));
  const buf = new Uint8Array(await headSlice.arrayBuffer());

  let segmentOffset = 0;
  let tracksOffset = -1;
  let timecodeScale = 1000000; // default 1ms

  // Search for Segment element: 0x18, 0x53, 0x80, 0x67
  for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0x18 && buf[i + 1] === 0x53 && buf[i + 2] === 0x80 && buf[i + 3] === 0x67) {
      const sizeVint = readEbmlVint(buf, i + 4);
      if (sizeVint) {
        segmentOffset = i + 4 + sizeVint.length;
      }
      break;
    }
  }

  // Search SeekHead or Tracks directly: 0x16, 0x54, 0xAE, 0x6B
  for (let i = segmentOffset; i < buf.length - 12; i++) {
    // Check for Tracks ID 0x1654AE6B
    if (buf[i] === 0x16 && buf[i + 1] === 0x54 && buf[i + 2] === 0xAE && buf[i + 3] === 0x6B) {
      tracksOffset = i;
      break;
    }
    // Check Seek entry for Tracks: 0x53 0xAB with value 0x1654AE6B
    if (buf[i] === 0x53 && buf[i + 1] === 0xAB) {
      const idLen = buf[i + 2];
      if (idLen === 4 && buf[i + 3] === 0x16 && buf[i + 4] === 0x54 && buf[i + 5] === 0xAE && buf[i + 6] === 0x6B) {
        // Look for SeekPosition 0x53 0xAC nearby
        for (let j = i + 7; j < i + 35 && j < buf.length - 4; j++) {
          if (buf[j] === 0x53 && buf[j + 1] === 0xAC) {
            const posVint = readEbmlVint(buf, j + 2);
            if (posVint) {
              let pos = 0;
              for (let k = 0; k < posVint.value; k++) {
                pos = (pos * 256) + buf[j + 2 + posVint.length + k];
              }
              tracksOffset = segmentOffset + pos;
              break;
            }
          }
        }
      }
    }
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
          // Check handler type: 'soun' or 'subt' / 'sbtl' / 'text'
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

          // Language tag (mdhd)
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
            name: `Track ${audioTracks.length + 1} (${lang !== 'und' ? lang.toUpperCase() : 'Audio'})`,
            language: lang,
            codec: codec === 'ec-3' ? 'E-AC-3' : (codec === 'ac-3' ? 'AC-3' : codec.toUpperCase()),
            channels,
            isUnsupportedBrowserCodec: isUnsupported
          });
        } else if (isSub) {
          subtitleTracks.push({
            trackNumber: subtitleTracks.length + 1,
            type: 'subtitle',
            name: `Subtitle ${subtitleTracks.length + 1} (${lang !== 'und' ? lang.toUpperCase() : 'Sub'})`,
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
  // Check container signature
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
    const slice = file.slice(tracksOffset, Math.min(file.size, tracksOffset + 512 * 1024));
    tracksBuffer = new Uint8Array(await slice.arrayBuffer());
  } else {
    const slice = file.slice(0, Math.min(file.size, 8 * 1024 * 1024));
    tracksBuffer = new Uint8Array(await slice.arrayBuffer());
  }

  // Scan for Tracks element: 0x16 0x54 0xAE 0x6B
  let pos = 0;
  for (let i = 0; i < tracksBuffer.length - 8; i++) {
    if (tracksBuffer[i] === 0x16 && tracksBuffer[i + 1] === 0x54 && tracksBuffer[i + 2] === 0xAE && tracksBuffer[i + 3] === 0x6B) {
      const lenVint = readEbmlVint(tracksBuffer, i + 4);
      if (lenVint) {
        pos = i + 4 + lenVint.length;
      }
      break;
    }
  }

  // Parse TrackEntry (0xAE) children
  while (pos < tracksBuffer.length - 6) {
    if (tracksBuffer[pos] === 0xAE) {
      pos++;
      const entryLen = readEbmlVint(tracksBuffer, pos);
      if (!entryLen) break;
      pos += entryLen.length;
      const entryEnd = Math.min(tracksBuffer.length, pos + entryLen.value);

      let trackType = 0;
      let trackNum = audioTracks.length + subtitleTracks.length + 1;
      let codecId = '';
      let trackName = '';
      let language = 'und';
      let channels = 2;
      let samplingRate = 48000;

      while (pos < entryEnd - 2) {
        const id = tracksBuffer[pos];
        pos++;

        if (id === 0xD7) { // TrackNumber
          const len = readEbmlVint(tracksBuffer, pos);
          if (len) {
            pos += len.length;
            let val = 0;
            for (let b = 0; b < len.value; b++) {
              val = (val * 256) + tracksBuffer[pos + b];
            }
            trackNum = val;
            pos += len.value;
          }
        } else if (id === 0x83) { // TrackType (1=video, 2=audio, 17=subtitle)
          const len = readEbmlVint(tracksBuffer, pos);
          if (len) {
            pos += len.length;
            trackType = tracksBuffer[pos];
            pos += len.value;
          }
        } else if (id === 0x86) { // CodecID
          const len = readEbmlVint(tracksBuffer, pos);
          if (len) {
            pos += len.length;
            codecId = new TextDecoder().decode(tracksBuffer.slice(pos, pos + len.value)).replace(/\0/g, '');
            pos += len.value;
          }
        } else if (id === 0x53 && tracksBuffer[pos] === 0x6E) { // Name
          pos++;
          const len = readEbmlVint(tracksBuffer, pos);
          if (len) {
            pos += len.length;
            trackName = new TextDecoder().decode(tracksBuffer.slice(pos, pos + len.value)).replace(/\0/g, '');
            pos += len.value;
          }
        } else if (id === 0x22 && tracksBuffer[pos] === 0xB5 && tracksBuffer[pos + 1] === 0x9C) { // Language
          pos += 2;
          const len = readEbmlVint(tracksBuffer, pos);
          if (len) {
            pos += len.length;
            language = new TextDecoder().decode(tracksBuffer.slice(pos, pos + len.value)).replace(/\0/g, '');
            pos += len.value;
          }
        } else if (id === 0xE1) { // Audio settings
          const len = readEbmlVint(tracksBuffer, pos);
          if (len) {
            pos += len.length;
            const aEnd = Math.min(entryEnd, pos + len.value);
            while (pos < aEnd - 1) {
              const aId = tracksBuffer[pos];
              pos++;
              if (aId === 0x9F) { // Channels
                const cLen = readEbmlVint(tracksBuffer, pos);
                if (cLen) {
                  pos += cLen.length;
                  channels = tracksBuffer[pos];
                  pos += cLen.value;
                }
              } else if (aId === 0xB5) { // SamplingFrequency
                const sLen = readEbmlVint(tracksBuffer, pos);
                if (sLen) {
                  pos += sLen.length;
                  pos += sLen.value;
                }
              } else {
                const skip = readEbmlVint(tracksBuffer, pos);
                if (skip) pos += skip.length + skip.value;
                else pos++;
              }
            }
          }
        } else {
          const skip = readEbmlVint(tracksBuffer, pos);
          if (skip) pos += skip.length + skip.value;
          else pos++;
        }
      }

      if (trackType === 2) { // Audio
        const upper = codecId.toUpperCase();
        const isUnsupported =
          upper.includes('EAC3') ||
          upper.includes('AC3') ||
          upper.includes('DTS') ||
          upper.includes('TRUEHD');

        let cleanCodec = codecId.replace(/^A_/, '');
        if (cleanCodec === 'EAC3') cleanCodec = 'E-AC-3 (Dolby Digital Plus)';
        else if (cleanCodec === 'AC3') cleanCodec = 'AC-3 (Dolby Digital)';

        audioTracks.push({
          trackNumber: trackNum,
          type: 'audio',
          name: trackName || `${language !== 'und' ? language.toUpperCase() : 'Audio'} Track ${audioTracks.length + 1}`,
          language: language !== 'und' ? language : 'und',
          codec: cleanCodec,
          channels,
          samplingRate,
          isUnsupportedBrowserCodec: isUnsupported
        });
      } else if (trackType === 17) { // Subtitle
        let cleanCodec = codecId.replace(/^S_TEXT\//, '').replace(/^S_/, '');
        subtitleTracks.push({
          trackNumber: trackNum,
          type: 'subtitle',
          name: trackName || `${language !== 'und' ? language.toUpperCase() : 'Subtitle'} Track ${subtitleTracks.length + 1}`,
          language: language !== 'und' ? language : 'und',
          codec: cleanCodec
        });
      }

      pos = entryEnd;
    } else {
      pos++;
    }
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
  const chunkSize = 2 * 1024 * 1024; // 2MB read chunks
  let fileOffset = 0;
  let currentClusterTimecode = 0;

  while (fileOffset < file.size) {
    const sliceEnd = Math.min(file.size, fileOffset + chunkSize);
    const buf = new Uint8Array(await file.slice(fileOffset, sliceEnd).arrayBuffer());
    if (buf.length < 8) break;

    let pos = 0;
    while (pos < buf.length - 6) {
      // Cluster ID: 0x1F 0x43 0xB6 0x75
      if (buf[pos] === 0x1F && buf[pos + 1] === 0x43 && buf[pos + 2] === 0xB6 && buf[pos + 3] === 0x75) {
        pos += 4;
        const len = readEbmlVint(buf, pos);
        if (len) pos += len.length;
        continue;
      }

      // Timecode element: 0xE7
      if (buf[pos] === 0xE7) {
        pos++;
        const len = readEbmlVint(buf, pos);
        if (len) {
          pos += len.length;
          let tc = 0;
          for (let k = 0; k < len.value; k++) {
            tc = (tc * 256) + buf[pos + k];
          }
          currentClusterTimecode = tc;
          pos += len.value;
          continue;
        }
      }

      // SimpleBlock (0xA3) or Block (0xA1)
      if (buf[pos] === 0xA3 || buf[pos] === 0xA1) {
        pos++;
        const len = readEbmlVint(buf, pos);
        if (!len) { pos++; continue; }
        pos += len.length;
        const blockEnd = pos + len.value;

        const trackVint = readEbmlVint(buf, pos);
        if (trackVint && trackVint.value === targetTrackNum) {
          const headerLen = trackVint.length + 2 + 1; // trackNum + relTimecode(2) + flags(1)
          const relTimecode = (buf[pos + trackVint.length] << 8) | buf[pos + trackVint.length + 1];
          const signedRelTc = (relTimecode > 0x7FFF) ? relTimecode - 0x10000 : relTimecode;
          const payloadStart = pos + headerLen;
          const payloadLen = len.value - headerLen;

          if (payloadLen > 0 && payloadStart + payloadLen <= buf.length) {
            const rawBytes = buf.slice(payloadStart, payloadStart + payloadLen);
            let text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes).trim();

            // Strip ASS/SSA tags (e.g. {\pos(..)}, dialogue formatting fields)
            if (text.includes(',')) {
              const parts = text.split(',');
              if (parts.length >= 9) {
                text = parts.slice(8).join(',');
              }
            }
            text = text.replace(/\{[^}]+\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();

            if (text) {
              const startMs = currentClusterTimecode + signedRelTc;
              const endMs = startMs + 3500;
              cues.push({ startMs, endMs, text });
            }
          }
        }

        if (blockEnd > buf.length) {
          fileOffset += pos + len.value;
          pos = buf.length;
          break;
        } else {
          pos = blockEnd;
        }
        continue;
      }

      // BlockGroup: 0xA0
      if (buf[pos] === 0xA0) {
        pos++;
        const len = readEbmlVint(buf, pos);
        if (len) pos += len.length;
        continue;
      }

      pos++;
    }

    if (pos >= buf.length - 6) {
      fileOffset += Math.max(1, pos);
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

  const chunkSize = 2 * 1024 * 1024; // 2MB stream slices
  let fileOffset = 0;

  try {
    while (fileOffset < file.size) {
      const sliceEnd = Math.min(file.size, fileOffset + chunkSize);
      const buf = new Uint8Array(await file.slice(fileOffset, sliceEnd).arrayBuffer());
      if (buf.length < 8) break;

      let pos = 0;
      const audioBatch: Uint8Array[] = [];

      while (pos < buf.length - 6) {
        // Cluster ID: 0x1F 0x43 0xB6 0x75
        if (buf[pos] === 0x1F && buf[pos + 1] === 0x43 && buf[pos + 2] === 0xB6 && buf[pos + 3] === 0x75) {
          pos += 4;
          const len = readEbmlVint(buf, pos);
          if (len) pos += len.length;
          continue;
        }

        // Timecode: 0xE7
        if (buf[pos] === 0xE7) {
          pos++;
          const len = readEbmlVint(buf, pos);
          if (len) {
            pos += len.length + len.value;
            continue;
          }
        }

        // SimpleBlock (0xA3) or Block (0xA1)
        if (buf[pos] === 0xA3 || buf[pos] === 0xA1) {
          pos++;
          const len = readEbmlVint(buf, pos);
          if (!len) { pos++; continue; }
          pos += len.length;
          const blockEnd = pos + len.value;

          const trackVint = readEbmlVint(buf, pos);
          if (trackVint && trackVint.value === targetTrackNum) {
            const headerLen = trackVint.length + 3; // trackNum + relTimecode(2) + flags(1)
            const payloadStart = pos + headerLen;
            const payloadLen = len.value - headerLen;

            if (payloadLen > 0 && payloadStart + payloadLen <= buf.length) {
              const rawFrame = buf.slice(payloadStart, payloadStart + payloadLen);
              audioBatch.push(rawFrame);
            }
          }

          if (blockEnd > buf.length) {
            fileOffset += pos + len.value;
            pos = buf.length;
            break;
          } else {
            pos = blockEnd;
          }
          continue;
        }

        // BlockGroup: 0xA0
        if (buf[pos] === 0xA0) {
          pos++;
          const len = readEbmlVint(buf, pos);
          if (len) pos += len.length;
          continue;
        }

        pos++;
      }

      // If we collected audio frames in this chunk, feed them to WASM decoder
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
              // ITU-R BS.775 5.1 downmixing with dialogue boost
              const fl = decoded.channelData[0];
              const fr = decoded.channelData[1];
              const fc = decoded.channelData[2]; // Centre
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

      if (pos >= buf.length - 6) {
        fileOffset += Math.max(1, pos);
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
