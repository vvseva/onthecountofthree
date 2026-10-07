/**
 * UI Component: Video Player Stage and Tactile Retro Controls
 * Enhanced with synchronized "On The Count Of Three" countdown overlay,
 * pause notification banner, subtitle/audio track management, and instant play toggle.
 */

import { computeVideoFingerprint, extractVideoDuration, FingerprintResult } from '../../fingerprint/hasher';
import { generateTestVideoBlob } from '../../fingerprint/testVideoGenerator';
import { SubtitleAndAudioManager } from './subtitles';

export interface VideoPlayerCallbacks {
  onFingerprintComputed: (res: FingerprintResult) => void;
  onUserPlayRequest: (instant: boolean) => void;
  onUserPauseRequest: () => void;
  onUserSeek: (targetTime: number) => void;
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  onAnnounce: (msg: string) => void;
}

export class VideoPlayerComponent {
  private element: HTMLElement;
  private video: HTMLVideoElement;
  private dropzone: HTMLElement;
  private fileInput: HTMLInputElement;
  private testVideoBtn: HTMLButtonElement;
  private playPauseBtn: HTMLButtonElement;
  private scrubber: HTMLInputElement;
  private timeDisplay: HTMLElement;
  private volumeSlider: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private fullscreenBtn: HTMLButtonElement;
  private rateBadge: HTMLElement;
  private fileDetailsBadge: HTMLElement;

  // New Overlays
  private countdownOverlay: HTMLElement;
  private countdownNumberEl: HTMLElement;
  private pauseBannerOverlay: HTMLElement;
  private pauseBannerTextEl: HTMLElement;

  // Subtitles & Audio
  private subtitleManager: SubtitleAndAudioManager;
  private subFileInput: HTMLInputElement;
  private subSelectEl: HTMLSelectElement;
  private subOffsetSlider: HTMLInputElement;
  private subOffsetReadout: HTMLElement;
  private audioSelectEl: HTMLSelectElement;
  private instantPlayCheckbox: HTMLInputElement;

  private countdownTimer: number | null = null;
  private isUserScrubbing = false;
  private callbacks: VideoPlayerCallbacks;

  constructor(callbacks: VideoPlayerCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'video-section';

    this.element.innerHTML = `
      <div class="video-stage-container" id="stage-container">
        <video id="sync-video" playsinline preload="auto"></video>

        <!-- Synchronized Countdown Overlay -->
        <div class="countdown-overlay" id="countdown-overlay" style="display: none;" aria-live="assertive">
          <div class="countdown-card">
            <div class="countdown-title">ON THE COUNT OF THREE...</div>
            <div class="countdown-number" id="countdown-number">3</div>
            <div class="countdown-hint">Synchronizing streams • Press Pause to Cancel</div>
          </div>
        </div>

        <!-- Pause Notification Banner -->
        <div class="pause-banner-overlay" id="pause-banner-overlay" style="display: none;" role="status">
          <div class="pause-banner-card">
            <span class="pause-icon">⏸</span>
            <span id="pause-banner-text">Playback Paused</span>
          </div>
        </div>

        <!-- Dropzone Overlay -->
        <div class="dropzone-overlay" id="dropzone-overlay">
          <div class="dropzone-icon">📼</div>
          <div class="dropzone-title">Select Local Video File</div>
          <div class="dropzone-subtitle">
            Drag and drop your video file here (MP4, WebM, MKV).
            Also accepts subtitle files (.srt, .vtt) by drag-and-drop.
          </div>

          <div class="dropzone-actions">
            <button class="retro-btn primary" id="btn-browse-file">
              📂 Browse Local Video...
            </button>
            <button class="retro-btn" id="btn-gen-test-video">
              🧪 Generate Test Pattern (60s)
            </button>
          </div>

          <input type="file" id="video-file-input" accept="video/*" style="display: none;" />
          <input type="file" id="sub-file-input" accept=".srt,.vtt,text/vtt" style="display: none;" />

          <div class="dropzone-privacy-note">
            🛡 ZERO DATA LEAKAGE: Videos play strictly from local disk. No video bytes or filenames are ever sent.
          </div>
        </div>
      </div>

      <!-- Tactile Video Controls Bar -->
      <div class="controls-bar" role="toolbar" aria-label="Video Controls">
        <div class="scrubber-row">
          <span class="time-display" id="time-display" aria-label="Playback Time">00:00:00 / 00:00:00</span>
          <input type="range" class="time-slider" id="scrubber" min="0" max="100" value="0" step="0.1" aria-label="Seek timeline" />
        </div>

        <div class="buttons-row">
          <div class="playback-controls-group">
            <button class="retro-btn primary" id="btn-play-pause" title="Play or Pause (Space)">
              ▶ Play
            </button>
            <button class="retro-btn" id="btn-back-5" title="Rewind 5 seconds (Left Arrow)">
              -5s
            </button>
            <button class="retro-btn" id="btn-fwd-5" title="Fast Forward 5 seconds (Right Arrow)">
              +5s
            </button>
            <button class="retro-btn" id="btn-change-file" title="Load a different video file">
              🔁 Change File
            </button>
          </div>

          <div class="volume-controls-group">
            <span class="status-tag" id="rate-badge" title="Playback Speed">1.00x</span>
            <span class="status-tag" id="file-details" title="Loaded Video File Details">No File</span>
            <button class="retro-btn small" id="btn-mute" title="Mute/Unmute (M)">🔊</button>
            <input type="range" class="volume-slider" id="vol-slider" min="0" max="1" step="0.05" value="1" title="Volume (Up/Down Arrows)" aria-label="Volume slider" />
            <button class="retro-btn small" id="btn-fullscreen" title="Toggle Fullscreen (F)">⛶ Fullscreen</button>
          </div>
        </div>

        <!-- Subtitles, Audio, and Playback Options Strip -->
        <div class="media-options-strip">
          <div class="media-option-item">
            <label for="sub-select">💬 Subtitles:</label>
            <select id="sub-select" class="retro-select">
              <option value="none">Off</option>
              <option value="load">+ Load .srt / .vtt File...</option>
            </select>
          </div>

          <div class="media-option-item" id="sub-offset-group" style="display: none;">
            <label for="sub-offset-range">Sub Offset:</label>
            <input type="range" id="sub-offset-range" min="-5.0" max="5.0" step="0.1" value="0.0" class="sub-offset-slider" />
            <span class="sub-offset-readout" id="sub-offset-readout">0.0s</span>
          </div>

          <div class="media-option-item">
            <label for="audio-select">🔊 Audio:</label>
            <select id="audio-select" class="retro-select">
              <option value="default">Default Track</option>
            </select>
          </div>

          <div class="media-option-item" style="margin-left: auto;">
            <label class="instant-play-label" title="Skip 3-second countdown and start playback immediately">
              <input type="checkbox" id="chk-instant-play" /> Instant Play (No Countdown)
            </label>
          </div>
        </div>
      </div>
    `;

    this.video = this.element.querySelector('#sync-video')!;
    this.dropzone = this.element.querySelector('#dropzone-overlay')!;
    this.fileInput = this.element.querySelector('#video-file-input')!;
    this.subFileInput = this.element.querySelector('#sub-file-input')!;
    this.testVideoBtn = this.element.querySelector('#btn-gen-test-video')!;
    this.playPauseBtn = this.element.querySelector('#btn-play-pause')!;
    this.scrubber = this.element.querySelector('#scrubber')!;
    this.timeDisplay = this.element.querySelector('#time-display')!;
    this.volumeSlider = this.element.querySelector('#vol-slider')!;
    this.muteBtn = this.element.querySelector('#btn-mute')!;
    this.fullscreenBtn = this.element.querySelector('#btn-fullscreen')!;
    this.rateBadge = this.element.querySelector('#rate-badge')!;
    this.fileDetailsBadge = this.element.querySelector('#file-details')!;

    // Overlays
    this.countdownOverlay = this.element.querySelector('#countdown-overlay')!;
    this.countdownNumberEl = this.element.querySelector('#countdown-number')!;
    this.pauseBannerOverlay = this.element.querySelector('#pause-banner-overlay')!;
    this.pauseBannerTextEl = this.element.querySelector('#pause-banner-text')!;

    // Subtitles & Audio
    this.subtitleManager = new SubtitleAndAudioManager(this.video);
    this.subSelectEl = this.element.querySelector('#sub-select')!;
    this.subOffsetSlider = this.element.querySelector('#sub-offset-range')!;
    this.subOffsetReadout = this.element.querySelector('#sub-offset-readout')!;
    this.audioSelectEl = this.element.querySelector('#audio-select')!;
    this.instantPlayCheckbox = this.element.querySelector('#chk-instant-play')!;

    this.setupEvents();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  public isInstantPlayEnabled(): boolean {
    return this.instantPlayCheckbox.checked;
  }

  private setupEvents(): void {
    // Dropzone file picker
    const browseBtn = this.element.querySelector('#btn-browse-file')!;
    browseBtn.addEventListener('click', () => this.fileInput.click());

    this.element.querySelector('#btn-change-file')!.addEventListener('click', () => {
      if (confirm('Change local video file? This will pause playback and reset stream verification.')) {
        this.video.pause();
        this.dropzone.style.display = 'flex';
      }
    });

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files && this.fileInput.files[0]) {
        this.loadVideoFile(this.fileInput.files[0]);
      }
    });

    // Subtitle file input
    this.subFileInput.addEventListener('change', async () => {
      if (this.subFileInput.files && this.subFileInput.files[0]) {
        await this.handleLoadedSubtitle(this.subFileInput.files[0]);
      }
    });

    this.subSelectEl.addEventListener('change', () => {
      const val = this.subSelectEl.value;
      if (val === 'load') {
        this.subFileInput.click();
      } else if (val === 'none') {
        this.subtitleManager.disableSubtitles();
        (this.element.querySelector('#sub-offset-group') as HTMLElement).style.display = 'none';
      }
    });

    this.subOffsetSlider.addEventListener('input', () => {
      const off = parseFloat(this.subOffsetSlider.value);
      this.subOffsetReadout.textContent = `${off > 0 ? '+' : ''}${off.toFixed(1)}s`;
      this.subtitleManager.setSubtitleOffset(off);
    });

    this.audioSelectEl.addEventListener('change', () => {
      const idx = parseInt(this.audioSelectEl.value, 10);
      if (!isNaN(idx)) {
        this.subtitleManager.selectAudioTrack(idx);
      }
    });

    // Test Video generator
    this.testVideoBtn.addEventListener('click', async () => {
      try {
        this.testVideoBtn.disabled = true;
        this.testVideoBtn.textContent = '⏳ Rendering Test Pattern (60s)...';
        const file = await generateTestVideoBlob(60, (pct) => {
          this.testVideoBtn.textContent = `⏳ Rendering: ${pct}%`;
        });
        await this.loadVideoFile(file);
      } catch (err) {
        alert('Could not synthesize test video: ' + err);
      } finally {
        this.testVideoBtn.disabled = false;
        this.testVideoBtn.textContent = '🧪 Generate Test Pattern (60s)';
      }
    });

    // Drag and Drop (both video and subtitle files)
    const stageContainer = this.element.querySelector('#stage-container')!;

    stageContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('dragover');
    });

    stageContainer.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
    });

    stageContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
      const dt = (e as DragEvent).dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        const file = dt.files[0];
        if (file.name.toLowerCase().endsWith('.srt') || file.name.toLowerCase().endsWith('.vtt')) {
          this.handleLoadedSubtitle(file);
        } else {
          this.loadVideoFile(file);
        }
      }
    });

    // Play/Pause button
    this.playPauseBtn.addEventListener('click', () => {
      this.triggerPlayPauseAction();
    });

    // Rewind / Forward 5s
    this.element.querySelector('#btn-back-5')!.addEventListener('click', () => {
      this.seekRelative(-5);
    });

    this.element.querySelector('#btn-fwd-5')!.addEventListener('click', () => {
      this.seekRelative(5);
    });

    // Scrubber
    this.scrubber.addEventListener('mousedown', () => {
      this.isUserScrubbing = true;
    });

    this.scrubber.addEventListener('input', () => {
      const dur = this.video.duration || 0;
      if (dur > 0) {
        const targetTime = (parseFloat(this.scrubber.value) / 100) * dur;
        this.updateTimeDisplay(targetTime, dur);
      }
    });

    this.scrubber.addEventListener('change', () => {
      this.isUserScrubbing = false;
      const dur = this.video.duration || 0;
      if (dur > 0) {
        const targetTime = (parseFloat(this.scrubber.value) / 100) * dur;
        this.video.currentTime = targetTime;
        this.callbacks.onUserSeek(targetTime);
      }
    });

    // Volume & Mute
    this.volumeSlider.addEventListener('input', () => {
      this.video.volume = parseFloat(this.volumeSlider.value);
      this.video.muted = false;
      this.updateVolumeUI();
    });

    this.muteBtn.addEventListener('click', () => {
      this.video.muted = !this.video.muted;
      this.updateVolumeUI();
    });

    // Fullscreen
    this.fullscreenBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    // Video Element status updates
    this.video.addEventListener('timeupdate', () => {
      if (!this.isUserScrubbing) {
        const cur = this.video.currentTime;
        const dur = this.video.duration || 0;
        this.updateTimeDisplay(cur, dur);
        if (dur > 0) {
          this.scrubber.value = ((cur / dur) * 100).toFixed(1);
        }
      }
    });

    this.video.addEventListener('play', () => {
      this.playPauseBtn.innerHTML = '⏸ Pause';
      this.hidePauseBanner();
    });

    this.video.addEventListener('pause', () => {
      this.playPauseBtn.innerHTML = '▶ Play';
    });

    this.video.addEventListener('ratechange', () => {
      this.rateBadge.textContent = `${this.video.playbackRate.toFixed(2)}x`;
      if (this.video.playbackRate !== 1.0) {
        this.rateBadge.style.color = '#000080';
        this.rateBadge.style.fontWeight = 'bold';
      } else {
        this.rateBadge.style.color = '#000000';
        this.rateBadge.style.fontWeight = 'normal';
      }
    });

    this.video.addEventListener('loadedmetadata', () => {
      this.refreshAudioTracksUI();
    });
  }

  private async handleLoadedSubtitle(file: File): Promise<void> {
    try {
      const name = await this.subtitleManager.loadSubtitleFile(file);
      this.callbacks.onLog(`[Subtitles] Loaded: ${name}`);
      this.callbacks.onAnnounce(`Subtitles loaded: ${name}`);

      // Update dropdown option
      const opt = document.createElement('option');
      opt.value = 'custom';
      opt.textContent = `✔ ${name}`;
      opt.selected = true;
      this.subSelectEl.appendChild(opt);

      // Show offset control
      (this.element.querySelector('#sub-offset-group') as HTMLElement).style.display = 'flex';
    } catch (err) {
      alert('Failed to parse subtitle file: ' + err);
    }
  }

  private refreshAudioTracksUI(): void {
    const tracks = this.subtitleManager.getAvailableAudioTracks();
    if (tracks.length > 1) {
      this.audioSelectEl.innerHTML = '';
      tracks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.index.toString();
        opt.textContent = `${t.label} (${t.language})`;
        if (t.enabled) opt.selected = true;
        this.audioSelectEl.appendChild(opt);
      });
    }
  }

  public async loadVideoFile(file: File): Promise<void> {
    this.callbacks.onLog(`[Video] Loading file (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);
    this.callbacks.onAnnounce('Loading video file and computing fingerprint');

    if (this.video.src && this.video.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.video.src);
    }

    const objectUrl = URL.createObjectURL(file);
    this.video.src = objectUrl;
    this.dropzone.style.display = 'none';

    const duration = await extractVideoDuration(this.video);
    const fp = await computeVideoFingerprint(file, duration);

    this.callbacks.onLog(`[Fingerprint] Code generated: ${fp.code}`);
    this.fileDetailsBadge.textContent = `CODE: ${fp.code}`;
    this.fileDetailsBadge.title = `Fuzzy Fingerprint: ${fp.code}\nFull Hash: ${fp.fullDigestHex}\nDuration: ${duration.toFixed(2)}s`;

    this.callbacks.onFingerprintComputed(fp);
    this.callbacks.onAnnounce(`Video loaded. Fingerprint verification code is ${fp.code}`);
  }

  // ================= Countdown Play Engine =================

  public triggerPlayPauseAction(): void {
    if (this.countdownTimer) {
      // Abort countdown if active
      this.cancelCountdown();
      this.callbacks.onUserPauseRequest();
      return;
    }

    if (this.video.paused) {
      this.callbacks.onUserPlayRequest(this.isInstantPlayEnabled());
    } else {
      this.callbacks.onUserPauseRequest();
    }
  }

  public startSynchronizedCountdown(targetStartTime: number, onComplete: () => void): void {
    this.cancelCountdown();
    this.countdownOverlay.style.display = 'flex';

    let lastBeepSec = -1;

    const playPleasantBeep = (freq: number, durationSec = 0.22) => {
      try {
        const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine'; // warm, pleasant pure tone
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

        const now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.02); // soft attack
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec); // smooth release

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + durationSec + 0.05);
      } catch {
        // audio optional
      }
    };

    const updateCountdown = () => {
      const remainingMs = targetStartTime - Date.now();

      if (remainingMs <= 0) {
        this.countdownNumberEl.textContent = 'PLAY!';
        if (lastBeepSec !== 0) {
          lastBeepSec = 0;
          playPleasantBeep(784.0, 0.3); // G5 warm resolve chime
        }

        setTimeout(() => {
          this.countdownOverlay.style.display = 'none';
        }, 350);

        this.cancelCountdown();
        onComplete();
        return;
      }

      const sec = Math.ceil(remainingMs / 1000);
      this.countdownNumberEl.textContent = sec.toString();

      // Emit exactly one pleasant chime beep per countdown second (3, 2, 1)
      if (sec !== lastBeepSec && sec <= 3 && sec >= 1) {
        lastBeepSec = sec;
        if (sec === 3) playPleasantBeep(523.25, 0.2); // C5
        else if (sec === 2) playPleasantBeep(587.33, 0.2); // D5
        else if (sec === 1) playPleasantBeep(659.25, 0.25); // E5
      }
    };

    updateCountdown();
    this.countdownTimer = window.setInterval(updateCountdown, 100);
  }

  public cancelCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownOverlay.style.display = 'none';
  }

  // ================= Pause Banner Overlay =================

  public showPauseBanner(message: string): void {
    this.pauseBannerTextEl.textContent = message;
    this.pauseBannerOverlay.style.display = 'flex';
  }

  public hidePauseBanner(): void {
    this.pauseBannerOverlay.style.display = 'none';
  }

  // ================= Keyboard & Player Controls =================

  public seekRelative(seconds: number): void {
    if (!this.video) return;
    const newTime = Math.max(0, Math.min(this.video.duration || 0, this.video.currentTime + seconds));
    this.video.currentTime = newTime;
  }

  public adjustVolume(delta: number): void {
    const newVol = Math.max(0, Math.min(1, this.video.volume + delta));
    this.video.volume = newVol;
    this.volumeSlider.value = newVol.toString();
    this.video.muted = false;
    this.updateVolumeUI();
  }

  public toggleMute(): void {
    this.video.muted = !this.video.muted;
    this.updateVolumeUI();
  }

  private updateVolumeUI(): void {
    if (this.video.muted || this.video.volume === 0) {
      this.muteBtn.textContent = '🔇';
    } else if (this.video.volume < 0.5) {
      this.muteBtn.textContent = '🔉';
    } else {
      this.muteBtn.textContent = '🔊';
    }
  }

  public toggleFullscreen(): void {
    const stage = this.element.querySelector('#stage-container') as HTMLElement;
    if (!document.fullscreenElement) {
      stage.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  private updateTimeDisplay(current: number, duration: number): void {
    const curStr = this.formatTime(current);
    const durStr = this.formatTime(duration);
    this.timeDisplay.textContent = `${curStr} / ${durStr}`;
  }

  private formatTime(sec: number): string {
    if (isNaN(sec) || sec < 0) sec = 0;
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);

    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) {
      return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }
}
