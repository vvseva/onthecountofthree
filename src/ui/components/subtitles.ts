/**
 * Subtitle and Audio Track Manager
 * Parses .srt and .vtt subtitle files, attaches WebVTT tracks to HTMLMediaElement,
 * manages subtitle timing offset (-5.0s to +5.0s), and inspects audio tracks.
 */

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

export class SubtitleAndAudioManager {
  private video: HTMLVideoElement;
  private currentTrackEl: HTMLTrackElement | null = null;
  private currentRawText: string | null = null;
  private isSrt = false;
  private currentOffset = 0; // seconds

  constructor(video: HTMLVideoElement) {
    this.video = video;
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

    // Remove previous track element if exists
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

    // Enable mode
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
   * Inspects available audio tracks if supported by browser.
   */
  public getAvailableAudioTracks(): { index: number; label: string; language: string; enabled: boolean }[] {
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

  public selectAudioTrack(index: number): boolean {
    const media = this.video as unknown as { audioTracks?: { length: number; [index: number]: { enabled: boolean } } };
    if (!media.audioTracks || index >= media.audioTracks.length) return false;

    for (let i = 0; i < media.audioTracks.length; i++) {
      media.audioTracks[i].enabled = (i === index);
    }
    return true;
  }
}
