/**
 * UI Component: Video Player Stage and Tactile Retro Controls
 * Enhanced with synchronized "On The Count Of Three" countdown overlay,
 * pause notification banner, subtitle/audio track management, Dolby Digital E-AC-3 / AC-3
 * WASM decoding with 5.1 stereo downmix, responsive full-screen scaling for all screen sizes,
 * and auto-hiding fullscreen controls with bottom progression bar.
 */

import { computeVideoFingerprint, extractVideoDuration, FingerprintResult } from '../../fingerprint/hasher';
import { SubtitleAndAudioManager, DemuxResult } from './subtitles';

export interface VideoPlayerCallbacks {
  onFingerprintComputed: (res: FingerprintResult) => void;
  onUserPlayRequest: (instant: boolean) => void;
  onUserPauseRequest: () => void;
  onUserSeek: (targetTime: number) => void;
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  onAnnounce: (msg: string) => void;
  onAudioDecoded?: (trackName: string) => void;
}

export class VideoPlayerComponent {
  private element: HTMLElement;
  private stageContainer: HTMLElement;
  private videoViewport: HTMLElement;
  private video: HTMLVideoElement;
  private controlsBar: HTMLElement;
  private fsProgressFill: HTMLElement;
  private dropzone: HTMLElement;
  private fileInput: HTMLInputElement;
  private playPauseBtn: HTMLButtonElement;
  private scrubber: HTMLInputElement;
  private timeDisplay: HTMLElement;
  private volumeSlider: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private fullscreenBtn: HTMLButtonElement;
  private toggleControlsBtn: HTMLButtonElement;
  private rateBadge: HTMLElement;
  private fileDetailsBadge: HTMLElement;

  // Overlays
  private countdownOverlay: HTMLElement;
  private countdownNumberEl: HTMLElement;
  private pauseBannerOverlay: HTMLElement;
  private pauseBannerTextEl: HTMLElement;
  private subtitlesOverlay: HTMLElement;

  // Decoding Alert Popup State
  private isDecodingAudio = false;
  private decodingAudioProgress = 0;
  private decodingTrackName = '';
  private decodingAlertOverlay: HTMLElement;
  private decodingAlertProgress: HTMLElement;
  private decodingProgressFill: HTMLElement;
  private decodingAlertTrackName: HTMLElement;

  // Subtitles & Audio
  private subtitleManager: SubtitleAndAudioManager;
  private subFileInput: HTMLInputElement;
  private subSelectEl: HTMLSelectElement;
  private subOffsetSlider: HTMLInputElement;
  private subOffsetReadout: HTMLElement;
  private audioFileInput: HTMLInputElement;
  private audioSelectEl: HTMLSelectElement;
  private downmixBtn: HTMLButtonElement;
  private eac3StatusPill: HTMLElement;
  private instantPlayCheckbox: HTMLInputElement;

  private countdownTimer: number | null = null;
  private isUserScrubbing = false;
  private callbacks: VideoPlayerCallbacks;

  // Volume & Mute state
  private userVolume = 1.0;
  private userMuted = false;

  // Fullscreen controls auto-hide timer
  private fsHideTimer: number | null = null;
  private isMouseOverControls = false;

  constructor(callbacks: VideoPlayerCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'video-section';

    this.element.innerHTML = `
      <div class="video-stage-container" id="stage-container">
        <!-- Main Video Viewport -->
        <div class="video-viewport" id="video-viewport">
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

          <!-- On-Screen Live Subtitles Overlay -->
          <div class="subtitles-overlay" id="subtitles-overlay" style="display: none;" aria-live="polite"></div>

          <!-- Audio Decoding Alert Modal Popup -->
          <div class="decoding-alert-overlay" id="decoding-alert-overlay" style="display: none;" role="alertdialog" aria-labelledby="decoding-alert-heading">
            <div class="window-frame decoding-alert-card">
              <div class="window-titlebar decoding-titlebar">
                <div class="window-title-left">
                  <span>⏳</span>
                  <span style="font-size: 11px; font-weight: bold;">Audio Decoding In Progress</span>
                </div>
                <div class="window-controls-glyph">
                  <button class="window-btn" id="btn-close-decoding-alert" title="Close">×</button>
                </div>
              </div>
              <div class="decoding-alert-body">
                <div class="decoding-alert-icon">📼</div>
                <div class="decoding-alert-content">
                  <div class="decoding-alert-heading" id="decoding-alert-heading">Please wait for audio to decode!</div>
                  <div class="decoding-alert-desc">
                    Dolby audio track (<strong id="decoding-alert-track-name">Audio Track</strong>) is currently being decoded by the WASM engine.
                  </div>
                  <div class="decoding-progress-container">
                    <div class="decoding-progress-bar">
                      <div class="decoding-progress-fill" id="decoding-progress-fill" style="width: 0%;"></div>
                    </div>
                    <span class="decoding-progress-text" id="decoding-alert-progress">0%</span>
                  </div>
                  <div class="decoding-alert-hint">
                    Playback will have no sound if started before decoding finishes. Please wait a moment.
                  </div>
                </div>
              </div>
              <div class="decoding-alert-actions">
                <button class="retro-btn primary" id="btn-decoding-alert-ok">⏳ Wait for Audio</button>
                <button class="retro-btn" id="btn-decoding-play-anyway">▶ Play Without Sound</button>
              </div>
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

        <!-- Fullscreen Slim Progression Bar (visible when controls are hidden) -->
        <div class="fs-progress-bar" id="fs-progress-bar">
          <div class="fs-progress-fill" id="fs-progress-fill"></div>
        </div>

        <!-- Tactile Video Controls Bar -->
        <div class="controls-bar" id="controls-bar" role="toolbar" aria-label="Video Controls">
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
              <button class="retro-btn small" id="btn-toggle-controls" title="Toggle Controls Visibility (C)">👁 Controls</button>
              <button class="retro-btn small" id="btn-fullscreen" title="Toggle Fullscreen (F)">⛶ Fullscreen</button>
            </div>
          </div>

          <!-- Subtitles, Audio, and Playback Options Strip -->
          <div class="media-options-strip">
            <div class="media-option-item">
              <label for="sub-select">💬 Subtitles:</label>
              <select id="sub-select" class="retro-select" title="Select built-in or external subtitle track">
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
              <span class="status-tag" id="eac3-status-pill" style="display: none;">Dolby Audio</span>
            </div>

            <div class="media-option-item" style="margin-left: auto;">
              <label class="instant-play-label" title="Skip 3-second countdown and start playback immediately">
                <input type="checkbox" id="chk-instant-play" /> Instant Play (No Countdown)
              </label>
            </div>
          </div>
        </div>
      </div>
    `;

    this.stageContainer = this.element.querySelector('#stage-container')!;
    this.videoViewport = this.element.querySelector('#video-viewport')!;
    this.video = this.element.querySelector('#sync-video')!;
    this.controlsBar = this.element.querySelector('#controls-bar')!;
    this.fsProgressFill = this.element.querySelector('#fs-progress-fill')!;
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
    this.toggleControlsBtn = this.element.querySelector('#btn-toggle-controls')!;
    this.rateBadge = this.element.querySelector('#rate-badge')!;
    this.fileDetailsBadge = this.element.querySelector('#file-details')!;

    // Overlays
    this.countdownOverlay = this.element.querySelector('#countdown-overlay')!;
    this.countdownNumberEl = this.element.querySelector('#countdown-number')!;
    this.pauseBannerOverlay = this.element.querySelector('#pause-banner-overlay')!;
    this.pauseBannerTextEl = this.element.querySelector('#pause-banner-text')!;
    this.subtitlesOverlay = this.element.querySelector('#subtitles-overlay')!;

    // Decoding Alert Popup
    this.decodingAlertOverlay = this.element.querySelector('#decoding-alert-overlay')!;
    this.decodingAlertProgress = this.element.querySelector('#decoding-alert-progress')!;
    this.decodingProgressFill = this.element.querySelector('#decoding-progress-fill')!;
    this.decodingAlertTrackName = this.element.querySelector('#decoding-alert-track-name')!;

    this.element.querySelector('#btn-close-decoding-alert')!.addEventListener('click', () => {
      this.hideDecodingAlertPopup();
    });
    this.element.querySelector('#btn-decoding-alert-ok')!.addEventListener('click', () => {
      this.hideDecodingAlertPopup();
    });
    this.element.querySelector('#btn-decoding-play-anyway')!.addEventListener('click', () => {
      this.isDecodingAudio = false;
      this.hideDecodingAlertPopup();
      this.callbacks.onUserPlayRequest(this.isInstantPlayEnabled());
    });

    // Subtitles & Audio
    this.subtitleManager = new SubtitleAndAudioManager(this.video);
    this.subSelectEl = this.element.querySelector('#sub-select')!;
    this.subOffsetSlider = this.element.querySelector('#sub-offset-range')!;
    this.subOffsetReadout = this.element.querySelector('#sub-offset-readout')!;
    this.audioSelectEl = this.element.querySelector('#audio-select')!;
    this.downmixBtn = this.element.querySelector('#btn-toggle-downmix')!;
    this.eac3StatusPill = this.element.querySelector('#eac3-status-pill')!;
    this.instantPlayCheckbox = this.element.querySelector('#chk-instant-play')!;

    this.setupEvents();
    this.setupFullscreenAutoHiding();
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
    browseBtn.addEventListener('click', () => {
      this.subtitleManager.resumeAudioContext();
      this.fileInput.click();
    });

    this.element.querySelector('#btn-change-file')!.addEventListener('click', () => {
      if (confirm('Change local video file? This will pause playback and reset stream verification.')) {
        this.video.pause();
        this.dropzone.style.display = 'flex';
      }
    });

    this.fileInput.addEventListener('change', () => {
      this.subtitleManager.resumeAudioContext();
      if (this.fileInput.files && this.fileInput.files[0]) {
        this.loadVideoFile(this.fileInput.files[0]);
      }
    });

    // Subtitle file input
    this.subFileInput.addEventListener('change', async () => {
      this.subtitleManager.resumeAudioContext();
      if (this.subFileInput.files && this.subFileInput.files[0]) {
        await this.handleLoadedSubtitle(this.subFileInput.files[0]);
      }
    });

    // Subtitle track selection
    this.subSelectEl.addEventListener('change', async () => {
      this.subtitleManager.resumeAudioContext();
      const val = this.subSelectEl.value;
      if (val === 'load') {
        this.subFileInput.click();
      } else if (val === 'none') {
        this.subtitleManager.disableSubtitles();
        this.subtitlesOverlay.style.display = 'none';
        this.subtitlesOverlay.textContent = '';
        (this.element.querySelector('#sub-offset-group') as HTMLElement).style.display = 'none';
        this.callbacks.onAnnounce('Subtitles turned off');
      } else if (val.startsWith('sub_')) {
        const trackNum = parseInt(val.replace('sub_', ''), 10);
        this.callbacks.onLog(`[Subtitles] Extracting embedded track #${trackNum}...`);
        this.callbacks.onAnnounce(`Extracting subtitle track ${trackNum}`);
        try {
          const label = await this.subtitleManager.extractAndApplyEmbeddedSubtitle(trackNum);
          (this.element.querySelector('#sub-offset-group') as HTMLElement).style.display = 'flex';
          this.callbacks.onLog(`[Subtitles] Embedded track active: ${label}`);
          this.callbacks.onAnnounce(`Subtitle track active: ${label}`);
        } catch (err) {
          alert(`Could not extract subtitle track #${trackNum}: ${err}`);
          this.callbacks.onLog(`[Subtitles Error] ${err}`, 'error');
        }
      }
    });

    this.subOffsetSlider.addEventListener('input', () => {
      const off = parseFloat(this.subOffsetSlider.value);
      this.subOffsetReadout.textContent = `${off > 0 ? '+' : ''}${off.toFixed(1)}s`;
      this.subtitleManager.setSubtitleOffset(off);
    });

    // Audio file input & track selection
    this.audioFileInput.addEventListener('change', () => {
      this.subtitleManager.resumeAudioContext();
      if (this.audioFileInput.files && this.audioFileInput.files[0]) {
        const file = this.audioFileInput.files[0];
        const loadedName = this.subtitleManager.loadExternalAudio(file);
        this.callbacks.onLog(`[Audio] Loaded external audio track: ${loadedName}`);
        this.callbacks.onAnnounce(`External audio track loaded: ${loadedName}`);
        this.updateAudioSelectWithExternal(loadedName);
      }
    });

    this.audioSelectEl.addEventListener('change', async () => {
      this.subtitleManager.resumeAudioContext();
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
      } else if (val.startsWith('audio_')) {
        const trkNum = parseInt(val.replace('audio_', ''), 10);
        const demux = this.subtitleManager.getDemuxResult();
        const trk = demux?.audioTracks.find((t) => t.trackNumber === trkNum);

        this.isDecodingAudio = true;
        this.decodingAudioProgress = 0;
        this.decodingTrackName = trk?.name || `Track #${trkNum}`;

        // Always decode and synchronize chosen MKV audio track
        this.callbacks.onLog(`[Audio] Decoding track #${trkNum} (${this.decodingTrackName})...`);
        this.eac3StatusPill.style.display = 'inline-block';
        this.eac3StatusPill.textContent = '⏳ Decoding Audio (0%)...';
        try {
          await this.subtitleManager.decodeAndPlayEac3Audio(trkNum, (pct) => {
            this.decodingAudioProgress = pct;
            this.eac3StatusPill.textContent = `⏳ Decoding Audio (${pct}%)...`;
            if (this.decodingAlertOverlay.style.display !== 'none') {
              this.decodingAlertProgress.textContent = `${pct}%`;
              this.decodingProgressFill.style.width = `${pct}%`;
            }
          });
          this.isDecodingAudio = false;
          this.hideDecodingAlertPopup();
          const langCode = trk && trk.language !== 'und' ? trk.language.toUpperCase() : 'Audio';
          this.eac3StatusPill.textContent = `✔ ${langCode} Active`;
          this.eac3StatusPill.style.color = '#008000';
          this.callbacks.onLog(`[Audio] Track #${trkNum} decoded and active!`);
          this.callbacks.onAnnounce(`Track ${trkNum} active: ${trk?.name || 'Selected Audio'}`);
        } catch (err) {
          this.isDecodingAudio = false;
          this.hideDecodingAlertPopup();
          this.eac3StatusPill.textContent = '⚠ Audio Decode Error';
          this.eac3StatusPill.style.color = '#cc0000';
          this.callbacks.onLog(`[Audio Error] Could not decode track: ${err}`, 'error');
        }
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
    this.stageContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('dragover');
    });

    this.stageContainer.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
    });

    this.stageContainer.addEventListener('drop', (e) => {
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
      this.subtitleManager.resumeAudioContext();
      this.triggerPlayPauseAction();
    });

    // Clicking video viewport toggles play/pause (or shows controls in fullscreen)
    this.videoViewport.addEventListener('click', (e) => {
      this.subtitleManager.resumeAudioContext();
      // Ignore clicks on dropzone or countdown
      if (this.dropzone.style.display !== 'none') return;
      if (this.countdownOverlay.style.display !== 'none') return;
      if (e.target === this.video || e.target === this.videoViewport) {
        this.triggerPlayPauseAction();
      }
    });

    // Time update & scrubbing
    this.video.addEventListener('timeupdate', () => {
      if (!this.isUserScrubbing && this.video.duration) {
        const pct = (this.video.currentTime / this.video.duration) * 100;
        this.scrubber.value = pct.toString();
        this.fsProgressFill.style.width = `${pct}%`;
        this.updateTimeDisplay(this.video.currentTime, this.video.duration);
      }

      // Live Subtitle Overlay Rendering
      const subText = this.subtitleManager.getActiveSubtitleText(this.video.currentTime);
      if (subText) {
        this.subtitlesOverlay.textContent = subText;
        this.subtitlesOverlay.style.display = 'block';
      } else {
        this.subtitlesOverlay.style.display = 'none';
      }
    });

    this.scrubber.addEventListener('input', () => {
      this.isUserScrubbing = true;
      if (this.video.duration) {
        const target = (parseFloat(this.scrubber.value) / 100) * this.video.duration;
        this.fsProgressFill.style.width = `${this.scrubber.value}%`;
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
      this.userVolume = parseFloat(this.volumeSlider.value);
      this.userMuted = false;
      this.applyVolumeAndMute();
      this.callbacks.onAnnounce(`Volume ${Math.round(this.userVolume * 100)} percent`);
    });

    this.muteBtn.addEventListener('click', () => {
      this.toggleMute();
    });

    // Manual controls toggle button
    this.toggleControlsBtn.addEventListener('click', () => {
      this.toggleControlsVisibility();
    });

    // Fullscreen
    this.fullscreenBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
      const isFs = !!document.fullscreenElement;
      this.fullscreenBtn.textContent = isFs ? '🗗 Exit Fullscreen' : '⛶ Fullscreen';
      if (!isFs) {
        this.stageContainer.classList.remove('controls-hidden');
      }
    });

    document.addEventListener('webkitfullscreenchange', () => {
      const isFs = !!(document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      this.fullscreenBtn.textContent = isFs ? '🗗 Exit Fullscreen' : '⛶ Fullscreen';
      if (!isFs) {
        this.stageContainer.classList.remove('controls-hidden');
      }
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
      this.resetFsInactivityTimer();
    });

    this.video.addEventListener('pause', () => {
      this.playPauseBtn.textContent = '▶ Play';
      this.showFullscreenControls();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      this.subtitleManager.resumeAudioContext();

      if (e.code === 'Space') {
        e.preventDefault();
        this.triggerPlayPauseAction();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.seekRelative(-5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.seekRelative(5);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.adjustVolume(0.05);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.adjustVolume(-0.05);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.toggleMute();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this.toggleControlsVisibility();
      }
    });
  }

  // ================= Fullscreen Auto-Hide Engine =================

  private setupFullscreenAutoHiding(): void {
    // When hovering over the controls bar, cancel auto-hide
    this.controlsBar.addEventListener('mouseenter', () => {
      this.isMouseOverControls = true;
      this.clearFsInactivityTimer();
    });

    this.controlsBar.addEventListener('mouseleave', () => {
      this.isMouseOverControls = false;
      this.resetFsInactivityTimer();
    });

    // Any mouse movement or touch in stageContainer reveals controls
    const onUserInteraction = () => {
      const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
      if (isFs) {
        this.showFullscreenControls();
        this.resetFsInactivityTimer();
      }
    };

    this.stageContainer.addEventListener('mousemove', onUserInteraction);
    this.stageContainer.addEventListener('pointermove', onUserInteraction);
    this.stageContainer.addEventListener('touchstart', onUserInteraction);
  }

  private showFullscreenControls(): void {
    this.stageContainer.classList.remove('controls-hidden');
  }

  private hideFullscreenControls(): void {
    const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
    if (isFs && !this.video.paused && !this.isMouseOverControls && !this.isUserScrubbing) {
      this.stageContainer.classList.add('controls-hidden');
    }
  }

  private resetFsInactivityTimer(): void {
    this.clearFsInactivityTimer();
    const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
    if (isFs && !this.video.paused && !this.isMouseOverControls && !this.isUserScrubbing) {
      this.fsHideTimer = window.setTimeout(() => {
        this.hideFullscreenControls();
      }, 3500);
    }
  }

  private clearFsInactivityTimer(): void {
    if (this.fsHideTimer !== null) {
      window.clearTimeout(this.fsHideTimer);
      this.fsHideTimer = null;
    }
  }

  public toggleControlsVisibility(): void {
    if (this.stageContainer.classList.contains('controls-hidden')) {
      this.showFullscreenControls();
      this.resetFsInactivityTimer();
      this.callbacks.onAnnounce('Controls visible');
    } else {
      this.stageContainer.classList.add('controls-hidden');
      this.callbacks.onAnnounce('Controls hidden');
    }
  }

  // ================= Subtitles & Audio Management =================

  private async handleLoadedSubtitle(file: File): Promise<void> {
    try {
      const label = await this.subtitleManager.loadSubtitleFile(file);
      this.callbacks.onLog(`[Subtitles] Loaded external file: ${label}`);
      this.callbacks.onAnnounce(`Subtitles loaded from ${label}`);

      const opt = document.createElement('option');
      opt.value = 'custom';
      opt.textContent = `✔ ${label} (External)`;
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

  private refreshSubtitleTrackOptions(demux: DemuxResult): void {
    this.subSelectEl.innerHTML = '';

    const offOpt = document.createElement('option');
    offOpt.value = 'none';
    offOpt.textContent = 'Off';
    this.subSelectEl.appendChild(offOpt);

    // Populate embedded subtitle tracks
    if (demux.subtitleTracks && demux.subtitleTracks.length > 0) {
      demux.subtitleTracks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = `sub_${t.trackNumber}`;
        const defTag = t.isDefault ? ' [Default]' : (t.isForced ? ' [Forced]' : '');
        opt.textContent = `${t.name}${defTag} [${t.codec}] (Embedded)`;
        this.subSelectEl.appendChild(opt);
      });
    }

    const loadOpt = document.createElement('option');
    loadOpt.value = 'load';
    loadOpt.textContent = '+ Load .srt / .vtt File...';
    this.subSelectEl.appendChild(loadOpt);
  }

  private isEnglishTrack(lang?: string, name?: string): boolean {
    const l = (lang || '').toLowerCase().trim();
    const n = (name || '').toLowerCase();
    return l === 'eng' || l === 'en' || l === 'english' || /\b(eng|english)\b/i.test(n);
  }

  private refreshAudioTrackOptions(demux: DemuxResult): void {
    this.audioSelectEl.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'default';
    defaultOpt.textContent = 'Default Audio (Native)';
    this.audioSelectEl.appendChild(defaultOpt);

    // 1. Native tracks (Safari / supported browser)
    const nativeTracks = this.subtitleManager.getAvailableNativeAudioTracks();
    if (nativeTracks.length > 0) {
      const preferredNative = nativeTracks.find((t) => this.isEnglishTrack(t.language, t.label)) || nativeTracks[0];
      nativeTracks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = `native_${t.index}`;
        opt.textContent = `${t.label} (${t.language})`;
        if (t === preferredNative) opt.selected = true;
        this.audioSelectEl.appendChild(opt);
      });
    } else if (demux && demux.audioTracks.length > 0) {
      // 2. Container detected tracks from MKV / MP4
      const preferredContainer =
        demux.audioTracks.find((t) => this.isEnglishTrack(t.language, t.name)) ||
        demux.audioTracks.find((t) => t.isDefault) ||
        demux.audioTracks[0];

      demux.audioTracks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = `audio_${t.trackNumber}`;
        const chStr = t.channels === 6 ? ' 5.1ch' : (t.channels === 2 ? ' Stereo' : ` ${t.channels || 2}ch`);
        const langStr = t.language !== 'und' ? ` (${t.language.toUpperCase()})` : '';
        const badge = t.isUnsupportedBrowserCodec ? ' [Dolby WASM Decode]' : '';
        const defTag = t.isDefault ? ' [Default]' : '';
        opt.textContent = `${t.name}${langStr} [${t.codec}${chStr}]${defTag}${badge}`;
        if (preferredContainer && t.trackNumber === preferredContainer.trackNumber) {
          opt.selected = true;
        }
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

    // Inspect container audio tracks and subtitles
    const demux = await this.subtitleManager.inspectVideoFile(file);

    this.refreshSubtitleTrackOptions(demux);
    this.refreshAudioTrackOptions(demux);

    if (demux.hasMultiChannel) {
      this.downmixBtn.textContent = '🎚 5.1 Downmix [ON]';
      this.downmixBtn.style.color = '#008000';
      this.callbacks.onLog(`[Audio] 6-channel 5.1 audio detected in ${file.name}. Stereo downmixing auto-enabled.`);
      this.callbacks.onAnnounce('6-channel 5.1 audio detected. Stereo downmixer enabled.');
    } else {
      this.downmixBtn.textContent = '🎚 5.1 Downmix';
      this.downmixBtn.style.color = '';
    }

    // Auto-decode E-AC-3 / AC-3 audio track if present (solves WEB-DL silence on Chromium)
    // Priority: English Dolby track > Default Dolby track > Any Dolby track
    const eac3Track =
      demux.audioTracks.find((t) => this.isEnglishTrack(t.language, t.name) && t.isUnsupportedBrowserCodec) ||
      demux.audioTracks.find((t) => t.isDefault && t.isUnsupportedBrowserCodec) ||
      demux.audioTracks.find((t) => t.isUnsupportedBrowserCodec);

    if (eac3Track) {
      this.isDecodingAudio = true;
      this.decodingAudioProgress = 0;
      this.decodingTrackName = eac3Track.name || `${eac3Track.codec} Track #${eac3Track.trackNumber}`;
      this.eac3StatusPill.style.display = 'inline-block';
      this.eac3StatusPill.textContent = '⏳ Decoding Dolby Audio (0%)...';
      this.callbacks.onLog(`[Audio] WEB-DL ${eac3Track.codec} audio detected (${eac3Track.name}). Starting WASM libavcodec decode...`);
      this.callbacks.onAnnounce(`Decoding Dolby Digital audio: ${eac3Track.name}`);

      // Mark the track as selected in the dropdown
      const selOpt = this.audioSelectEl.querySelector(`option[value="audio_${eac3Track.trackNumber}"]`) as HTMLOptionElement;
      if (selOpt) selOpt.selected = true;

      try {
        await this.subtitleManager.decodeAndPlayEac3Audio(eac3Track.trackNumber, (pct) => {
          this.decodingAudioProgress = pct;
          this.eac3StatusPill.textContent = `⏳ Decoding Dolby Audio (${pct}%)...`;
          if (this.decodingAlertOverlay.style.display !== 'none') {
            this.decodingAlertProgress.textContent = `${pct}%`;
            this.decodingProgressFill.style.width = `${pct}%`;
          }
        });
        this.isDecodingAudio = false;
        this.hideDecodingAlertPopup();
        const langCode = eac3Track.language !== 'und' ? eac3Track.language.toUpperCase() : 'Audio';
        this.eac3StatusPill.textContent = `✔ ${langCode} 5.1 Ready`;
        this.eac3StatusPill.style.color = '#008000';
        this.callbacks.onLog(`[Audio] Dolby Digital audio (${eac3Track.name}) decoded and active!`);
        this.callbacks.onAnnounce(`Dolby Digital audio ready: ${eac3Track.name}`);

        // Broadcast to peer that audio decoding is complete!
        this.callbacks.onAudioDecoded?.(eac3Track.name || `${eac3Track.codec} Track #${eac3Track.trackNumber}`);
      } catch (err) {
        this.isDecodingAudio = false;
        this.hideDecodingAlertPopup();
        this.eac3StatusPill.textContent = '⚠ Audio Decode Error';
        this.eac3StatusPill.style.color = '#cc0000';
        this.callbacks.onLog(`[Audio Error] Could not decode Dolby track: ${err}`, 'error');
      }
    } else {
      this.isDecodingAudio = false;
      this.eac3StatusPill.style.display = 'none';

      // Auto-select English audio track in dropdown if present
      const englishAudio = demux.audioTracks.find((t) => this.isEnglishTrack(t.language, t.name));
      if (englishAudio) {
        const selOpt = this.audioSelectEl.querySelector(`option[value="audio_${englishAudio.trackNumber}"]`) as HTMLOptionElement;
        if (selOpt) selOpt.selected = true;
      }
    }

    // Auto-select subtitles: Prefer English subtitle track if present, otherwise default or forced subtitle track
    const preferredSub =
      demux.subtitleTracks.find((t) => this.isEnglishTrack(t.language, t.name)) ||
      demux.subtitleTracks.find((t) => t.isDefault || t.isForced);
    if (preferredSub) {
      const subOpt = this.subSelectEl.querySelector(`option[value="sub_${preferredSub.trackNumber}"]`) as HTMLOptionElement;
      if (subOpt) {
        subOpt.selected = true;
        this.subtitleManager.extractAndApplyEmbeddedSubtitle(preferredSub.trackNumber).then((label) => {
          (this.element.querySelector('#sub-offset-group') as HTMLElement).style.display = 'flex';
          this.callbacks.onLog(`[Subtitles] Default subtitle track active: ${label}`);
        }).catch(() => {});
      }
    }

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
    this.subtitleManager.resumeAudioContext();
    if (this.countdownTimer) {
      this.cancelCountdown();
      this.callbacks.onUserPauseRequest();
      return;
    }

    if (this.video.paused) {
      if (this.isDecodingAudio) {
        this.showDecodingAlertPopup();
        return;
      }
      this.callbacks.onUserPlayRequest(this.isInstantPlayEnabled());
    } else {
      this.callbacks.onUserPauseRequest();
    }
  }

  public startSynchronizedCountdown(targetStartTime: number, onComplete: () => void): void {
    this.subtitleManager.resumeAudioContext();
    if (this.isDecodingAudio) {
      this.showDecodingAlertPopup();
      return;
    }
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

  // ================= Audio Decoding Alert Popup =================

  public showDecodingAlertPopup(): void {
    this.decodingAlertTrackName.textContent = this.decodingTrackName || 'Dolby Audio';
    this.decodingAlertProgress.textContent = `${this.decodingAudioProgress}%`;
    this.decodingProgressFill.style.width = `${this.decodingAudioProgress}%`;
    this.decodingAlertOverlay.style.display = 'flex';
    this.callbacks.onAnnounce(`Audio decoding in progress, ${this.decodingAudioProgress} percent. Please wait.`);
  }

  public hideDecodingAlertPopup(): void {
    this.decodingAlertOverlay.style.display = 'none';
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
    const newVol = Math.max(0, Math.min(1, this.userVolume + delta));
    this.userVolume = newVol;
    this.userMuted = false;
    this.volumeSlider.value = newVol.toString();
    this.applyVolumeAndMute();
    this.callbacks.onAnnounce(`Volume ${Math.round(newVol * 100)} percent`);
  }

  public toggleMute(): void {
    this.userMuted = !this.userMuted;
    this.applyVolumeAndMute();
    this.callbacks.onAnnounce(this.userMuted ? 'Muted' : 'Unmuted');
  }

  private applyVolumeAndMute(): void {
    const isDecodedActive = this.subtitleManager.isDecodedAudioActive();
    if (isDecodedActive) {
      this.video.volume = 0;
      this.subtitleManager.setVolume(this.userVolume);
      this.subtitleManager.setMuted(this.userMuted);
    } else {
      this.video.volume = this.userMuted ? 0 : this.userVolume;
      this.video.muted = this.userMuted;
      this.subtitleManager.setVolume(this.userVolume);
      this.subtitleManager.setMuted(this.userMuted);
    }
    this.updateMuteButtonIcon();
  }

  private updateMuteButtonIcon(): void {
    if (this.userMuted || this.userVolume === 0) {
      this.muteBtn.textContent = '🔇';
    } else {
      this.muteBtn.textContent = '🔊';
    }
  }

  public toggleFullscreen(): void {
    const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);

    if (!isFs) {
      if (this.stageContainer.requestFullscreen) {
        this.stageContainer.requestFullscreen().catch(() => {
          if ((this.video as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen) {
            (this.video as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
          }
        });
      } else if ((this.video as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen) {
        (this.video as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
      }
      this.showFullscreenControls();
      this.resetFsInactivityTimer();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen) {
        (document as unknown as { webkitExitFullscreen: () => void }).webkitExitFullscreen();
      }
      this.stageContainer.classList.remove('controls-hidden');
      this.clearFsInactivityTimer();
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
