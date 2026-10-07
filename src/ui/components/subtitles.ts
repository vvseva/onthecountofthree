/**
 * Subtitle and Audio Track Manager
 * Parses .srt and .vtt subtitle files, attaches WebVTT tracks to HTMLMediaElement,
 * manages subtitle timing offset (-5.0s to +5.0s), inspects audio tracks,
 * provides 5.1 surround-to-stereo downmixing with dialogue boost,
 * and synchronizes external audio tracks (.mp3, .m4a, .aac, .wav, .ogg).
 */

import { inspectContainerAudioTracks, ContainerInspectionResult } from '../../media/trackInspector';

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
  // Normalize line endings
  let normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Replace comma decimal separators with dots in timestamps: 00:00:20,000 --> 00:00:20.000
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
 * Web Audio 5.1 Surround to Stereo Downmixer & Dialogue Booster
 * Routes 6-channel surround sound (Left, Right, Center, LFE, Surround Left, Surround Right)
 * into a balanced 2-channel stereo output according to ITU-R BS.775,
 * boosting dialogue on the center channel so movies with 6 channels play sound properly.
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

        // Determine channel count (typically 6 for 5.1 surround, or 2 for stereo)
        const channels = Math.max(2, this.sourceNode.channelCount || 2);
        this.splitter = this.audioCtx.createChannelSplitter(channels);
        this.merger = this.audioCtx.createChannelMerger(2);

        this.sourceNode.connect(this.splitter);

        if (channels >= 6) {
          // ITU-R BS.775 coefficients for 5.1 -> 2.0 Stereo:
          // Left output (0):
          const centerGainL = this.audioCtx.createGain();
          centerGainL.gain.value = 0.7071;
          const lfeGainL = this.audioCtx.createGain();
          lfeGainL.gain.value = 0.5;
          const slGainL = this.audioCtx.createGain();
          slGainL.gain.value = 0.7071;

          this.splitter.connect(this.merger, 0, 0); // Left -> Left
          this.splitter.connect(centerGainL, 2);
          centerGainL.connect(this.merger, 0, 0);
          this.splitter.connect(lfeGainL, 3);
          lfeGainL.connect(this.merger, 0, 0);
          this.splitter.connect(slGainL, 4);
          slGainL.connect(this.merger, 0, 0);

          // Right output (1):
          const centerGainR = this.audioCtx.createGain();
          centerGainR.gain.value = 0.7071;
          const lfeGainR = this.audioCtx.createGain();
          lfeGainR.gain.value = 0.5;
          const srGainR = this.audioCtx.createGain();
          srGainR.gain.value = 0.7071;

          this.splitter.connect(this.merger, 1, 1); // Right -> Right
          this.splitter.connect(centerGainR, 2);
          centerGainR.connect(this.merger, 0, 1);
          this.splitter.connect(lfeGainR, 3);
          lfeGainR.connect(this.merger, 0, 1);
          this.splitter.connect(srGainR, 5);
          srGainR.connect(this.merger, 0, 1);
        } else {
          // Pass-through stereo with dialogue boost
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
 * Synchronized External Audio Track Manager
 * Allows loading separate audio files (.mp3, .m4a, .aac, .ogg, .wav, .flac)
 * and plays them in strict sync with video element playback, seek, rate, and volume.
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

    // Synchronize audio element with video element
    this.video.muted = true; // Mute video's embedded audio track
    this.isExternalActive = true;

    this.video.addEventListener('play', this.onVideoPlay);
    this.video.addEventListener('pause', this.onVideoPause);
    this.video.addEventListener('seeking', this.onVideoSeeking);
    this.video.addEventListener('seeked', this.onVideoSeeked);
    this.video.addEventListener('ratechange', this.onVideoRateChange);
    this.video.addEventListener('volumechange', this.onVideoVolumeChange);

    if (!this.video.paused) {
      this.audioElement.play().catch(() => {});
    }

    return this.filename;
  }

  public disable(): void {
    if (this.isExternalActive) {
      if (this.audioElement) {
        this.audioElement.pause();
      }
      this.video.muted = false; // Restore embedded audio
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
    this.video.removeEventListener('volumechange', this.onVideoVolumeChange);

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

  private onVideoVolumeChange = () => {
    if (this.isExternalActive && this.audioElement) {
      this.audioElement.volume = this.video.volume;
      this.audioElement.muted = this.video.muted;
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
  private isSrt = false;
  private currentOffset = 0; // seconds
  private downmixEngine: AudioDownmixEngine;
  private externalAudioManager: ExternalAudioManager;
  private lastInspectionResult: ContainerInspectionResult | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.downmixEngine = new AudioDownmixEngine(video);
    this.externalAudioManager = new ExternalAudioManager(video);
  }

  public async inspectVideoFile(file: File): Promise<ContainerInspectionResult> {
    const inspection = await inspectContainerAudioTracks(file);
    this.lastInspectionResult = inspection;

    // Automatically enable 5.1 downmixing if multi-channel surround sound (6ch) is detected
    if (inspection.hasMultiChannel) {
      this.downmixEngine.enable();
    }

    return inspection;
  }

  public getInspectionResult(): ContainerInspectionResult | null {
    return this.lastInspectionResult;
  }

  public enableDownmixing(): boolean {
    return this.downmixEngine.enable();
  }

  public isDownmixActive(): boolean {
    return this.downmixEngine.getIsEnabled();
  }

  public loadExternalAudio(file: File): string {
    return this.externalAudioManager.loadTrack(file);
  }

  public useDefaultEmbeddedAudio(): void {
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
    this.applySubtitlesWithOffset(this.currentOffset, file.name);
    return file.name;
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
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i];
        if (t.label.startsWith(trackLabel)) {
          t.mode = 'showing';
        } else {
          t.mode = 'hidden';
        }
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
    for (let i = 0; i < this.video.textTracks.length; i++) {
      this.video.textTracks[i].mode = 'disabled';
    }
  }

  /**
   * Inspects available native audio tracks if supported by browser (e.g. Safari).
   */
  public getAvailableNativeAudioTracks(): { index: number; label: string; language: string; enabled: boolean }[] {
    const media = this.video as unknown as { audioTracks?: { length: number; [index: number]: { label: string; language: string; enabled: boolean } } };
    if (!media.audioTracks) {
      return [];
    }

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
