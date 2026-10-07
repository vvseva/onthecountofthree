/**
 * UI Component: Video Player Stage and Tactile Retro Controls
 */

import { computeVideoFingerprint, extractVideoDuration, FingerprintResult } from '../../fingerprint/hasher';
import { generateTestVideoBlob } from '../../fingerprint/testVideoGenerator';

export interface VideoPlayerCallbacks {
  onFingerprintComputed: (res: FingerprintResult) => void;
  onUserPlayPause: () => void;
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

  private isUserScrubbing = false;
  private callbacks: VideoPlayerCallbacks;

  constructor(callbacks: VideoPlayerCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'video-section';

    this.element.innerHTML = `
      <div class="video-stage-container" id="stage-container">
        <video id="sync-video" playsinline preload="auto"></video>

        <!-- Dropzone Overlay -->
        <div class="dropzone-overlay" id="dropzone-overlay">
          <div class="dropzone-icon">📼</div>
          <div class="dropzone-title">Select Local Video File</div>
          <div class="dropzone-subtitle">
            Drag and drop your video file here, or choose an option below.
            Identical local files (e.g. MP4, WebM, MKV) will sync seamlessly.
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

          <div class="dropzone-privacy-note">
            🛡 ZERO DATA LEAKAGE: Videos are played strictly from local disk. No video bytes or filenames are ever sent.
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
      </div>
    `;

    this.video = this.element.querySelector('#sync-video')!;
    this.dropzone = this.element.querySelector('#dropzone-overlay')!;
    this.fileInput = this.element.querySelector('#video-file-input')!;
    this.testVideoBtn = this.element.querySelector('#btn-gen-test-video')!;
    this.playPauseBtn = this.element.querySelector('#btn-play-pause')!;
    this.scrubber = this.element.querySelector('#scrubber')!;
    this.timeDisplay = this.element.querySelector('#time-display')!;
    this.volumeSlider = this.element.querySelector('#vol-slider')!;
    this.muteBtn = this.element.querySelector('#btn-mute')!;
    this.fullscreenBtn = this.element.querySelector('#btn-fullscreen')!;
    this.rateBadge = this.element.querySelector('#rate-badge')!;
    this.fileDetailsBadge = this.element.querySelector('#file-details')!;

    this.setupEvents();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  private setupEvents(): void {
    // Dropzone file picker
    const browseBtn = this.element.querySelector('#btn-browse-file')!;
    browseBtn.addEventListener('click', () => this.fileInput.click());

    this.element.querySelector('#btn-change-file')!.addEventListener('click', () => {
      this.dropzone.style.display = 'flex';
    });

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files && this.fileInput.files[0]) {
        this.loadVideoFile(this.fileInput.files[0]);
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

    // Drag and Drop
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
        this.loadVideoFile(dt.files[0]);
      }
    });

    // Window global drag & drop fallback
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if ((e.target as HTMLElement).closest('#stage-container')) return;
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        this.loadVideoFile(dt.files[0]);
      }
    });

    // Play/Pause button
    this.playPauseBtn.addEventListener('click', () => {
      this.togglePlayPause();
    });

    // Rewind / Forward 5s
    this.element.querySelector('#btn-back-5')!.addEventListener('click', () => {
      this.seekRelative(-5);
    });

    this.element.querySelector('#btn-fwd-5')!.addEventListener('click', () => {
      this.seekRelative(5);
    });

    // Scrubber scrubbing
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
  }

  public async loadVideoFile(file: File): Promise<void> {
    this.callbacks.onLog(`[Video] Loading file (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);
    this.callbacks.onAnnounce('Loading video file and computing fingerprint');

    // Revoke previous URL if any
    if (this.video.src && this.video.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.video.src);
    }

    const objectUrl = URL.createObjectURL(file);
    this.video.src = objectUrl;
    this.dropzone.style.display = 'none';

    // Wait for metadata to obtain duration
    const duration = await extractVideoDuration(this.video);

    // Compute fuzzy fingerprint: 4MB head + 1MB tail + duration
    const fp = await computeVideoFingerprint(file, duration);
    this.callbacks.onLog(`[Fingerprint] Code generated: ${fp.code} (SHA-256: ${fp.fullDigestHex.slice(0, 16)}...)`);
    this.fileDetailsBadge.textContent = `CODE: ${fp.code}`;
    this.fileDetailsBadge.title = `Fuzzy Fingerprint: ${fp.code}\nFull Hash: ${fp.fullDigestHex}\nDuration: ${duration.toFixed(2)}s`;

    this.callbacks.onFingerprintComputed(fp);
    this.callbacks.onAnnounce(`Video loaded. Fingerprint verification code is ${fp.code}`);
  }

  public togglePlayPause(): void {
    if (this.video.paused) {
      this.video.play().catch(err => {
        this.callbacks.onLog(`[Video] Play error: ${err}`, 'warn');
      });
    } else {
      this.video.pause();
    }
  }

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
