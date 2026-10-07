/**
 * Subtitle and Audio Track Manager
 * Parses .srt and .vtt subtitle files, extracts embedded MKV subtitle tracks (SRT/UTF-8/ASS),
 * manages subtitle timing offset (-5.0s to +5.0s),
 * decodes E-AC-3 / AC-3 audio via WASM libavcodec decoder with ITU-R BS.775 5.1 downmixing,
 * and synchronizes external audio tracks (.mp3, .m4a, .aac, .wav, .ogg).
 */

import { demuxMatroska, extractMatroskaSubtitles, extractAndDecodeEac3Track, DemuxResult, DemuxedTrackInfo, SubtitleCue } from '../../media/mkvDemuxer';
export type { DemuxedTrackInfo, DemuxResult, SubtitleCue };

export interface SubtitleTrackInfo {
  id: string;
  label: string;
  language: string;
  blobUrl?: string;
  rawText?: string;
}

/**
 * Converts standard SubRip (.srt) text to WebVTT format.
 */
export function convertSrtToVtt(srtText: string): string {
  let normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  normalized = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${normalized.trim()}\n`;
}

/**
 * Creates a WebVTT Object URL from raw text (either .srt or .vtt).
 */
export function createVttBlobUrl(text: string, isSrt = false): string {
  const vttContent = isSrt ? convertSrtToVtt(text) : (text.startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`);
  const blob = new Blob([vttContent], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

/**
 * Parses raw .srt or .vtt subtitle text into structured SubtitleCue objects
 * for ultra-fast, zero-latency DOM overlay rendering.
 */
export function parseSrtOrVttToCues(rawText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIdx = -1;
    let match: RegExpExecArray | null = null;
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

/**
 * Web Audio 5.1 Surround to Stereo Downmixer & Dialogue Booster
 * Routes 6-channel surround sound into stereo with dialogue boost.
 */
export class AudioDownmixEngine {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private masterGain: GainNode | null = null;
  private isEnabled = false;
  private isAttached = false;
  private video: HTMLVideoElement;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  public enable(): boolean {
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return false;

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      if (!this.isAttached) {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.video);
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = 1.35; // Dialogue boost

        const channels = Math.max(2, this.sourceNode.channelCount || 2);
        this.splitter = this.audioCtx.createChannelSplitter(channels);
        this.merger = this.audioCtx.createChannelMerger(2);

        this.sourceNode.connect(this.splitter);

        if (channels >= 6) {
          const centerGainL = this.audioCtx.createGain();
          centerGainL.gain.value = 0.7071;
          const lfeGainL = this.audioCtx.createGain();
          lfeGainL.gain.value = 0.5;
          const slGainL = this.audioCtx.createGain();
          slGainL.gain.value = 0.7071;

          this.splitter.connect(this.merger, 0, 0);
          this.splitter.connect(centerGainL, 2);
          centerGainL.connect(this.merger, 0, 0);
          this.splitter.connect(lfeGainL, 3);
          lfeGainL.connect(this.merger, 0, 0);
          this.splitter.connect(slGainL, 4);
          slGainL.connect(this.merger, 0, 0);

          const centerGainR = this.audioCtx.createGain();
          centerGainR.gain.value = 0.7071;
          const lfeGainR = this.audioCtx.createGain();
          lfeGainR.gain.value = 0.5;
          const srGainR = this.audioCtx.createGain();
          srGainR.gain.value = 0.7071;

          this.splitter.connect(this.merger, 1, 1);
          this.splitter.connect(centerGainR, 2);
          centerGainR.connect(this.merger, 0, 1);
          this.splitter.connect(lfeGainR, 3);
          lfeGainR.connect(this.merger, 0, 1);
          this.splitter.connect(srGainR, 5);
          srGainR.connect(this.merger, 0, 1);
        } else {
          this.splitter.connect(this.merger, 0, 0);
          this.splitter.connect(this.merger, 1, 1);
        }

        this.merger.connect(this.masterGain);
        this.masterGain.connect(this.audioCtx.destination);
        this.isAttached = true;
      }

      this.isEnabled = true;
      return true;
    } catch (err) {
      console.warn('Web Audio downmix could not be attached:', err);
      return false;
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }
}

/**
 * Synchronized AudioBuffer Player (for WASM E-AC-3 / AC-3 decoded streams)
 */
export class AudioBufferSynchronizer {
  private audioCtx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private video: HTMLVideoElement;
  private isSynchronizing = false;
  private currentVol = 1.0;
  private isMuted = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  public resumeAudio(): void {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  public setBuffer(buffer: AudioBuffer, existingCtx?: AudioContext): void {
    this.cleanup();
    this.buffer = buffer;
    if (existingCtx) {
      this.audioCtx = existingCtx;
    } else if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = this.isMuted ? 0 : this.currentVol;
    this.gainNode.connect(this.audioCtx.destination);

    this.video.volume = 0; // Silence native HTML5 element
    this.isSynchronizing = true;

    this.video.addEventListener('play', this.onPlay);
    this.video.addEventListener('pause', this.onPause);
    this.video.addEventListener('seeking', this.onSeek);
    this.video.addEventListener('seeked', this.onSeek);
    this.video.addEventListener('ratechange', this.onRateChange);

    if (!this.video.paused) {
      this.play(this.video.currentTime);
    }
  }

  public setVolume(vol: number): void {
    this.currentVol = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.value = this.isMuted ? 0 : this.currentVol;
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : this.currentVol;
    }
  }

  private play(fromSec: number): void {
    if (!this.audioCtx || !this.buffer || !this.gainNode) return;
    this.stop();

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    this.source = this.audioCtx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this.video.playbackRate;
    this.source.connect(this.gainNode);

    const safeFrom = Math.max(0, Math.min(this.buffer.duration, fromSec));
    this.source.start(0, safeFrom);
  }

  private stop(): void {
    if (this.source) {
      try { this.source.stop(); } catch {}
      this.source.disconnect();
      this.source = null;
    }
  }

  private onPlay = () => this.play(this.video.currentTime);
  private onPause = () => this.stop();
  private onSeek = () => {
    if (!this.video.paused) {
      this.play(this.video.currentTime);
    }
  };
  private onRateChange = () => {
    if (this.source) {
      this.source.playbackRate.value = this.video.playbackRate;
    }
  };

  public getIsActive(): boolean {
    return this.isSynchronizing;
  }

  public cleanup(): void {
    this.stop();
    this.video.removeEventListener('play', this.onPlay);
    this.video.removeEventListener('pause', this.onPause);
    this.video.removeEventListener('seeking', this.onSeek);
    this.video.removeEventListener('seeked', this.onSeek);
    this.video.removeEventListener('ratechange', this.onRateChange);

    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch {}
      this.gainNode = null;
    }
    this.buffer = null;
    this.isSynchronizing = false;
    this.video.volume = this.currentVol;
  }
}

/**
 * Synchronized External Audio Track Manager
 */
export class ExternalAudioManager {
  private audioElement: HTMLAudioElement | null = null;
  private video: HTMLVideoElement;
  private isExternalActive = false;
  private objectUrl: string | null = null;
  private filename = '';

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  public loadTrack(file: File): string {
    this.cleanup();
    this.objectUrl = URL.createObjectURL(file);
    this.filename = file.name;
    this.audioElement = new Audio(this.objectUrl);
    this.audioElement.currentTime = this.video.currentTime;
    this.audioElement.volume = this.video.volume;
    this.audioElement.muted = this.video.muted;
    this.audioElement.playbackRate = this.video.playbackRate;

    this.video.volume = 0;
    this.isExternalActive = true;

    this.video.addEventListener('play', this.onVideoPlay);
    this.video.addEventListener('pause', this.onVideoPause);
    this.video.addEventListener('seeking', this.onVideoSeeking);
    this.video.addEventListener('seeked', this.onVideoSeeked);
    this.video.addEventListener('ratechange', this.onVideoRateChange);

    if (!this.video.paused) {
      this.audioElement.play().catch(() => {});
    }

    return this.filename;
  }

  public setVolume(vol: number): void {
    if (this.audioElement) {
      this.audioElement.volume = vol;
    }
  }

  public setMuted(muted: boolean): void {
    if (this.audioElement) {
      this.audioElement.muted = muted;
    }
  }

  public disable(): void {
    if (this.isExternalActive) {
      if (this.audioElement) {
        this.audioElement.pause();
      }
      this.video.volume = 1;
      this.isExternalActive = false;
    }
  }

  public cleanup(): void {
    this.disable();
    this.video.removeEventListener('play', this.onVideoPlay);
    this.video.removeEventListener('pause', this.onVideoPause);
    this.video.removeEventListener('seeking', this.onVideoSeeking);
    this.video.removeEventListener('seeked', this.onVideoSeeked);
    this.video.removeEventListener('ratechange', this.onVideoRateChange);

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.audioElement = null;
    this.filename = '';
  }

  private onVideoPlay = () => {
    if (this.isExternalActive && this.audioElement) {
      this.audioElement.currentTime = this.video.currentTime;
      this.audioElement.play().catch(() => {});
    }
  };

  private onVideoPause = () => {
    if (this.isExternalActive && this.audioElement) {
      this.audioElement.pause();
    }
  };

  private onVideoSeeking = () => {
    if (this.isExternalActive && this.audioElement) {
      this.audioElement.currentTime = this.video.currentTime;
    }
  };

  private onVideoSeeked = () => {
    if (this.isExternalActive && this.audioElement) {
      this.audioElement.currentTime = this.video.currentTime;
    }
  };

  private onVideoRateChange = () => {
    if (this.isExternalActive && this.audioElement) {
      this.audioElement.playbackRate = this.video.playbackRate;
    }
  };

  public getActiveFilename(): string | null {
    return this.isExternalActive ? this.filename : null;
  }
}

export class SubtitleAndAudioManager {
  private video: HTMLVideoElement;
  private currentTrackEl: HTMLTrackElement | null = null;
  private currentRawText: string | null = null;
  private currentCues: SubtitleCue[] = [];
  private isSrt = false;
  private currentOffset = 0; // seconds
  private downmixEngine: AudioDownmixEngine;
  private externalAudioManager: ExternalAudioManager;
  private bufferSynchronizer: AudioBufferSynchronizer;
  private currentFile: File | null = null;
  private demuxResult: DemuxResult | null = null;
  private sharedAudioCtx: AudioContext | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.downmixEngine = new AudioDownmixEngine(video);
    this.externalAudioManager = new ExternalAudioManager(video);
    this.bufferSynchronizer = new AudioBufferSynchronizer(video);
  }

  public getSharedAudioContext(): AudioContext {
    if (!this.sharedAudioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.sharedAudioCtx = new AudioCtxClass();
    }
    return this.sharedAudioCtx;
  }

  public resumeAudioContext(): void {
    if (this.sharedAudioCtx && this.sharedAudioCtx.state === 'suspended') {
      this.sharedAudioCtx.resume().catch(() => {});
    }
    this.bufferSynchronizer.resumeAudio();
  }

  public async inspectVideoFile(file: File): Promise<DemuxResult> {
    this.currentFile = file;
    this.demuxResult = await demuxMatroska(file);

    if (this.demuxResult.hasMultiChannel) {
      this.downmixEngine.enable();
    }

    return this.demuxResult;
  }

  public getDemuxResult(): DemuxResult | null {
    return this.demuxResult;
  }

  public async extractAndApplyEmbeddedSubtitle(trackNumber: number): Promise<string> {
    if (!this.currentFile) throw new Error('No video file loaded');
    const result = await extractMatroskaSubtitles(this.currentFile, trackNumber);
    this.currentRawText = result.vttText;
    this.currentCues = result.cues;
    this.isSrt = false;
    const trackInfo = this.demuxResult?.subtitleTracks.find((t) => t.trackNumber === trackNumber);
    const label = trackInfo?.name || `Subtitle ${trackNumber}`;
    this.applySubtitlesWithOffset(this.currentOffset, label);
    return label;
  }

  public async decodeAndPlayEac3Audio(trackNumber: number, onProgress?: (pct: number) => void): Promise<void> {
    if (!this.currentFile) throw new Error('No video file loaded');
    const ctx = this.getSharedAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const audioBuffer = await extractAndDecodeEac3Track(this.currentFile, trackNumber, ctx, onProgress);
    this.bufferSynchronizer.setBuffer(audioBuffer, ctx);
  }

  public setVolume(vol: number): void {
    this.bufferSynchronizer.setVolume(vol);
    this.externalAudioManager.setVolume(vol);
  }

  public setMuted(muted: boolean): void {
    this.bufferSynchronizer.setMuted(muted);
    this.externalAudioManager.setMuted(muted);
  }

  public isDecodedAudioActive(): boolean {
    return this.bufferSynchronizer.getIsActive();
  }

  public enableDownmixing(): boolean {
    return this.downmixEngine.enable();
  }

  public isDownmixActive(): boolean {
    return this.downmixEngine.getIsEnabled();
  }

  public loadExternalAudio(file: File): string {
    this.bufferSynchronizer.cleanup();
    return this.externalAudioManager.loadTrack(file);
  }

  public useDefaultEmbeddedAudio(): void {
    this.bufferSynchronizer.cleanup();
    this.externalAudioManager.disable();
  }

  public getActiveExternalAudio(): string | null {
    return this.externalAudioManager.getActiveFilename();
  }

  public async loadSubtitleFile(file: File): Promise<string> {
    const text = await file.text();
    const isSrtFile = file.name.toLowerCase().endsWith('.srt');
    this.isSrt = isSrtFile;
    this.currentRawText = text;
    this.currentCues = parseSrtOrVttToCues(text);
    this.applySubtitlesWithOffset(this.currentOffset, file.name);
    return file.name;
  }

  public getActiveSubtitleText(currentTimeSec: number): string | null {
    if (!this.currentCues || this.currentCues.length === 0) return null;
    const targetMs = (currentTimeSec - this.currentOffset) * 1000;
    const cues = this.currentCues;

    // O(log N) binary search for subtitle cue matching targetMs
    let low = 0;
    let high = cues.length - 1;
    let matchIdx = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const cue = cues[mid];
      if (targetMs >= cue.startMs && targetMs <= cue.endMs) {
        return cue.text;
      }
      if (targetMs < cue.startMs) {
        high = mid - 1;
      } else {
        matchIdx = mid;
        low = mid + 1;
      }
    }

    if (matchIdx >= 0) {
      const cue = cues[matchIdx];
      if (targetMs >= cue.startMs && targetMs <= cue.endMs) {
        return cue.text;
      }
    }

    return null;
  }

  public setSubtitleOffset(seconds: number): void {
    this.currentOffset = seconds;
    if (this.currentRawText) {
      this.applySubtitlesWithOffset(seconds);
    }
  }

  public getSubtitleOffset(): number {
    return this.currentOffset;
  }

  private applySubtitlesWithOffset(offsetSec: number, trackLabel = 'Custom Subtitles'): void {
    if (!this.currentRawText) return;

    if (this.currentTrackEl) {
      if (this.currentTrackEl.src && this.currentTrackEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.currentTrackEl.src);
      }
      this.currentTrackEl.remove();
      this.currentTrackEl = null;
    }

    let processedText = this.currentRawText;
    if (offsetSec !== 0) {
      processedText = this.adjustTimestamps(this.currentRawText, offsetSec);
    }

    const blobUrl = createVttBlobUrl(processedText, this.isSrt);

    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = `${trackLabel} (${offsetSec > 0 ? '+' : ''}${offsetSec.toFixed(1)}s)`;
    track.srclang = 'en';
    track.src = blobUrl;
    track.default = true;

    this.video.appendChild(track);
    this.currentTrackEl = track;

    setTimeout(() => {
      // Set all textTracks to 'hidden' so the browser's native text renderer does NOT
      // paint duplicate subtitles on top of our custom, high-contrast DOM overlay
      for (let i = 0; i < this.video.textTracks.length; i++) {
        this.video.textTracks[i].mode = 'hidden';
      }
    }, 100);
  }

  private adjustTimestamps(text: string, offsetSec: number): string {
    return text.replace(/(\d{2}):(\d{2}):(\d{2})([,.]\d{3})/g, (_, hh, mm, ss, ms) => {
      const totalSec =
        parseInt(hh, 10) * 3600 +
        parseInt(mm, 10) * 60 +
        parseInt(ss, 10) +
        parseFloat(ms.replace(',', '.'));
      const adjusted = Math.max(0, totalSec + offsetSec);

      const newH = Math.floor(adjusted / 3600).toString().padStart(2, '0');
      const newM = Math.floor((adjusted % 3600) / 60).toString().padStart(2, '0');
      const newS = Math.floor(adjusted % 60).toString().padStart(2, '0');
      const newMs = Math.floor((adjusted % 1) * 1000).toString().padStart(3, '0');

      return `${newH}:${newM}:${newS}.${newMs}`;
    });
  }

  public disableSubtitles(): void {
    this.currentCues = [];
    this.currentRawText = null;
    if (this.currentTrackEl) {
      this.currentTrackEl.remove();
      this.currentTrackEl = null;
    }
    for (let i = 0; i < this.video.textTracks.length; i++) {
      this.video.textTracks[i].mode = 'disabled';
    }
  }

  public getAvailableNativeAudioTracks(): { index: number; label: string; language: string; enabled: boolean }[] {
    const media = this.video as unknown as { audioTracks?: { length: number; [index: number]: { label: string; language: string; enabled: boolean } } };
    if (!media.audioTracks) return [];

    const list = [];
    for (let i = 0; i < media.audioTracks.length; i++) {
      const trk = media.audioTracks[i];
      list.push({
        index: i,
        label: trk.label || `Audio Track ${i + 1}`,
        language: trk.language || 'und',
        enabled: trk.enabled
      });
    }
    return list;
  }

  public selectNativeAudioTrack(index: number): boolean {
    const media = this.video as unknown as { audioTracks?: { length: number; [index: number]: { enabled: boolean } } };
    if (!media.audioTracks || index >= media.audioTracks.length) return false;

    for (let i = 0; i < media.audioTracks.length; i++) {
      media.audioTracks[i].enabled = (i === index);
    }
    return true;
  }
}
