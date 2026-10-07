/**
 * UI Component: Video Player Stage and Tactile Retro Controls
 * Enhanced with synchronized "On The Count Of Three" countdown overlay,
 * pause notification banner, subtitle/audio track management, 5.1 stereo downmix,
 * and responsive full-screen scaling for all screen sizes.
 */

import { computeVideoFingerprint, extractVideoDuration, FingerprintResult } from '../../fingerprint/hasher';
import { SubtitleAndAudioManager } from './subtitles';
import { ContainerInspectionResult } from '../../media/trackInspector';

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
  private playPauseBtn: HTMLButtonElement;
  private scrubber: HTMLInputElement;
  private timeDisplay: HTMLElement;
  private volumeSlider: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private fullscreenBtn: HTMLButtonElement;
  private rateBadge: HTMLElement;
  private fileDetailsBadge: HTMLElement;

  // Overlays
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
  private audioFileInput: HTMLInputElement;
  private audioSelectEl: HTMLSelectElement;
  private downmixBtn: HTMLButtonElement;
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
            Drag and drop your local video file here (MP4, MKV, WebM), or click Browse.
            Also accepts subtitle (.srt, .vtt) and external audio (.mp3, .m4a, .aac) files.
          </div>

          <div class="dropzone-actions">
            <button class="retro-btn primary" id="btn-browse-file">
              📂 Select Local Video File...
            </button>
          </div>

          <input type="file" id="video-file-input" accept="video/*,.mkv,.mp4,.webm,.avi" style="display: none;" />
          <input type="file" id="sub-file-input" accept=".srt,.vtt,text/vtt" style="display: none;" />
          <input type="file" id="audio-file-input" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac,.ac3" style="display: none;" />

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
            <select id="audio-select" class="retro-select" title="Select audio track or load external audio">
              <option value="default">Default Audio (Embedded)</option>
              <option value="load">+ Load External Audio File...</option>
            </select>
            <button class="retro-btn small" id="btn-toggle-downmix" title="Toggle 5.1 Surround to Stereo Downmix & Dialogue Boost">🎚 5.1 Downmix</button>
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
    this.audioFileInput = this.element.querySelector('#audio-file-input')!;
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
    this.downmixBtn = this.element.querySelector('#btn-toggle-downmix')!;
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

    // Audio file input & track selection
    this.audioFileInput.addEventListener('change', () => {
      if (this.audioFileInput.files && this.audioFileInput.files[0]) {
        const file = this.audioFileInput.files[0];
        const loadedName = this.subtitleManager.loadExternalAudio(file);
        this.callbacks.onLog(`[Audio] Loaded external audio track: ${loadedName}`);
        this.callbacks.onAnnounce(`External audio track loaded: ${loadedName}`);
        this.updateAudioSelectWithExternal(loadedName);
      }
    });

    this.audioSelectEl.addEventListener('change', () => {
      const val = this.audioSelectEl.value;
      if (val === 'load') {
        this.audioFileInput.click();
      } else if (val === 'default') {
        this.subtitleManager.useDefaultEmbeddedAudio();
        this.callbacks.onLog('[Audio] Switched to default embedded audio track.');
      } else if (val.startsWith('native_')) {
        const idx = parseInt(val.replace('native_', ''), 10);
        this.subtitleManager.selectNativeAudioTrack(idx);
        this.callbacks.onLog(`[Audio] Switched to native track #${idx + 1}`);
      }
    });

    this.downmixBtn.addEventListener('click', () => {
      const success = this.subtitleManager.enableDownmixing();
      if (success) {
        this.downmixBtn.textContent = '🎚 5.1 Downmix [ON]';
        this.downmixBtn.style.color = '#008000';
        this.callbacks.onLog('[Audio] 5.1 to Stereo downmixer enabled with dialogue boost.');
        this.callbacks.onAnnounce('5.1 surround sound downmixer activated');
      }
    });

    // Drag and Drop (video, subtitle, and audio files)
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
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.srt') || lowerName.endsWith('.vtt')) {
          this.handleLoadedSubtitle(file);
        } else if (
          lowerName.endsWith('.mp3') ||
          lowerName.endsWith('.m4a') ||
          lowerName.endsWith('.aac') ||
          lowerName.endsWith('.wav') ||
          lowerName.endsWith('.ogg') ||
          lowerName.endsWith('.flac')
        ) {
          const loadedName = this.subtitleManager.loadExternalAudio(file);
          this.callbacks.onLog(`[Audio] Loaded dropped audio track: ${loadedName}`);
          this.updateAudioSelectWithExternal(loadedName);
        } else {
          this.loadVideoFile(file);
        }
      }
    });

    // Play/Pause button
    this.playPauseBtn.addEventListener('click', () => {
      this.triggerPlayPauseAction();
    });

    // Time update & scrubbing
    this.video.addEventListener('timeupdate', () => {
      if (!this.isUserScrubbing && this.video.duration) {
        this.scrubber.value = ((this.video.currentTime / this.video.duration) * 100).toString();
        this.updateTimeDisplay(this.video.currentTime, this.video.duration);
      }
    });

    this.scrubber.addEventListener('input', () => {
      this.isUserScrubbing = true;
      if (this.video.duration) {
        const target = (parseFloat(this.scrubber.value) / 100) * this.video.duration;
        this.updateTimeDisplay(target, this.video.duration);
      }
    });

    this.scrubber.addEventListener('change', () => {
      this.isUserScrubbing = false;
      if (this.video.duration) {
        const target = (parseFloat(this.scrubber.value) / 100) * this.video.duration;
        this.video.currentTime = target;
        this.callbacks.onUserSeek(target);
      }
    });

    // ±5s buttons
    this.element.querySelector('#btn-back-5')!.addEventListener('click', () => {
      this.seekRelative(-5);
    });

    this.element.querySelector('#btn-fwd-5')!.addEventListener('click', () => {
      this.seekRelative(5);
    });

    // Volume & Mute
    this.volumeSlider.addEventListener('input', () => {
      this.video.volume = parseFloat(this.volumeSlider.value);
      this.video.muted = false;
      this.updateMuteButtonIcon();
    });

    this.muteBtn.addEventListener('click', () => {
      this.toggleMute();
    });

    // Fullscreen
    this.fullscreenBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
      const isFs = !!document.fullscreenElement;
      this.fullscreenBtn.textContent = isFs ? '🗗 Exit Fullscreen' : '⛶ Fullscreen';
    });

    document.addEventListener('webkitfullscreenchange', () => {
      const isFs = !!(document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      this.fullscreenBtn.textContent = isFs ? '🗗 Exit Fullscreen' : '⛶ Fullscreen';
    });

    // Playback rate sync indicator
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

    // Video play/pause UI sync
    this.video.addEventListener('play', () => {
      this.playPauseBtn.textContent = '⏸ Pause';
      this.hidePauseBanner();
    });

    this.video.addEventListener('pause', () => {
      this.playPauseBtn.textContent = '▶ Play';
    });
  }

  private async handleLoadedSubtitle(file: File): Promise<void> {
    try {
      const label = await this.subtitleManager.loadSubtitleFile(file);
      this.callbacks.onLog(`[Subtitles] Loaded: ${label}`);
      this.callbacks.onAnnounce(`Subtitles loaded from ${label}`);

      const opt = document.createElement('option');
      opt.value = 'custom';
      opt.textContent = `✔ ${label}`;
      opt.selected = true;

      const noneOpt = this.subSelectEl.querySelector('option[value="none"]');
      if (noneOpt) {
        noneOpt.insertAdjacentElement('afterend', opt);
      } else {
        this.subSelectEl.appendChild(opt);
      }

      (this.element.querySelector('#sub-offset-group') as HTMLElement).style.display = 'flex';
    } catch (err) {
      alert(`Could not parse subtitle file: ${err}`);
    }
  }

  private refreshAudioTrackOptions(inspection?: ContainerInspectionResult): void {
    this.audioSelectEl.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'default';
    defaultOpt.textContent = 'Default Audio (Embedded)';
    this.audioSelectEl.appendChild(defaultOpt);

    // 1. Native tracks (Safari / supported browser)
    const nativeTracks = this.subtitleManager.getAvailableNativeAudioTracks();
    if (nativeTracks.length > 0) {
      nativeTracks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = `native_${t.index}`;
        opt.textContent = `${t.label} (${t.language})`;
        if (t.enabled) opt.selected = true;
        this.audioSelectEl.appendChild(opt);
      });
    } else if (inspection && inspection.audioTracks.length > 0) {
      // 2. Container detected tracks from MKV / MP4
      inspection.audioTracks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = `info_${t.trackNumber}`;
        const chStr = t.channels === 6 ? ' 5.1ch' : (t.channels === 2 ? ' Stereo' : ` ${t.channels}ch`);
        opt.textContent = `Track ${t.trackNumber}: ${t.name} [${t.codec}${chStr}]`;
        this.audioSelectEl.appendChild(opt);
      });
    }

    // 3. Load External Audio Option
    const loadOpt = document.createElement('option');
    loadOpt.value = 'load';
    loadOpt.textContent = '+ Load External Audio File (.mp3, .m4a, .aac)...';
    this.audioSelectEl.appendChild(loadOpt);
  }

  private updateAudioSelectWithExternal(filename: string): void {
    let extOpt = this.audioSelectEl.querySelector('option[value="external"]') as HTMLOptionElement;
    if (!extOpt) {
      extOpt = document.createElement('option');
      extOpt.value = 'external';
      this.audioSelectEl.insertBefore(extOpt, this.audioSelectEl.firstChild);
    }
    extOpt.textContent = `✔ ${filename} (External Track)`;
    extOpt.selected = true;
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

    // Inspect container audio tracks and multi-channel configuration
    const inspection = await this.subtitleManager.inspectVideoFile(file);
    if (inspection.hasMultiChannel) {
      this.downmixBtn.textContent = '🎚 5.1 Downmix [ON]';
      this.downmixBtn.style.color = '#008000';
      this.callbacks.onLog(`[Audio] 6-channel 5.1 audio detected in ${file.name}. Stereo downmixing auto-enabled.`);
      this.callbacks.onAnnounce('6-channel 5.1 audio detected. Stereo downmixer enabled.');
    } else {
      this.downmixBtn.textContent = '🎚 5.1 Downmix';
      this.downmixBtn.style.color = '';
    }

    if (inspection.hasUnsupportedAudio) {
      const codecs = inspection.audioTracks.map((t) => t.codec).join(', ');
      this.callbacks.onLog(
        `[Audio Warning] MKV contains ${codecs} which browsers often lack decoders for. If no sound plays, attach an audio track via "+ Load External Audio File".`,
        'warn'
      );
    }

    this.refreshAudioTrackOptions(inspection);

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

    const tick = () => {
      const now = Date.now();
      const remainingMs = targetStartTime - now;

      if (remainingMs <= 0) {
        this.cancelCountdown();
        this.playSoftBeep(784, 0.2); // G5 resolve
        onComplete();
        return;
      }

      const sec = Math.ceil(remainingMs / 1000);
      this.countdownNumberEl.textContent = sec.toString();

      if (sec !== lastBeepSec && sec >= 1 && sec <= 3) {
        lastBeepSec = sec;
        const freqs = [523.25, 587.33, 659.25]; // C5, D5, E5
        const f = freqs[3 - sec] || 523.25;
        this.playSoftBeep(f, 0.08);
      }

      this.countdownTimer = window.requestAnimationFrame(tick);
    };

    tick();
  }

  public cancelCountdown(): void {
    if (this.countdownTimer) {
      window.cancelAnimationFrame(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownOverlay.style.display = 'none';
  }

  private playSoftBeep(freq: number, duration: number): void {
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration + 0.02);
    } catch {
      // AudioContext unavailable
    }
  }

  // ================= Pause Banner Overlay =================

  public showPauseBanner(text: string): void {
    this.pauseBannerTextEl.textContent = text;
    this.pauseBannerOverlay.style.display = 'block';
  }

  public hidePauseBanner(): void {
    this.pauseBannerOverlay.style.display = 'none';
  }

  // ================= Media Controls Helper Methods =================

  public seekRelative(seconds: number): void {
    if (isNaN(this.video.duration)) return;
    const target = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    this.video.currentTime = target;
    this.callbacks.onUserSeek(target);
    this.callbacks.onAnnounce(`Seek ${seconds > 0 ? '+' : ''}${seconds} seconds`);
  }

  public adjustVolume(delta: number): void {
    const newVol = Math.max(0, Math.min(1, this.video.volume + delta));
    this.video.volume = newVol;
    this.volumeSlider.value = newVol.toString();
    this.video.muted = false;
    this.updateMuteButtonIcon();
    this.callbacks.onAnnounce(`Volume ${Math.round(newVol * 100)} percent`);
  }

  public toggleMute(): void {
    this.video.muted = !this.video.muted;
    this.updateMuteButtonIcon();
    this.callbacks.onAnnounce(this.video.muted ? 'Muted' : 'Unmuted');
  }

  private updateMuteButtonIcon(): void {
    if (this.video.muted || this.video.volume === 0) {
      this.muteBtn.textContent = '🔇';
    } else {
      this.muteBtn.textContent = '🔊';
    }
  }

  public toggleFullscreen(): void {
    const stage = this.element.querySelector('#stage-container') as HTMLElement;
    const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);

    if (!isFs) {
      if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(() => {
          if ((this.video as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen) {
            (this.video as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
          }
        });
      } else if ((this.video as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen) {
        (this.video as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen) {
        (document as unknown as { webkitExitFullscreen: () => void }).webkitExitFullscreen();
      }
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

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}
