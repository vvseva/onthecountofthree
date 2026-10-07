/**
 * Generates an in-memory test pattern video (SMPTE bars + frame counter + audio beep)
 * using Canvas + AudioContext + MediaRecorder.
 * Produces an identical file when using deterministic parameters.
 */

export async function generateTestVideoBlob(durationSeconds = 60, onProgress?: (pct: number) => void): Promise<File> {
  const width = 640;
  const height = 360;
  const fps = 25;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // SMPTE-style retro color bars
  const colors = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];

  const stream = canvas.captureStream(fps);

  // Synthesize audio track (silent or 1kHz periodic click)
  let audioTrack: MediaStreamTrack | null = null;
  try {
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.02; // very quiet subtle click
    osc.frequency.value = 440;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) {
      stream.addTrack(audioTrack);
    }
  } catch {
    // Audio synthesis optional
  }

  // Choose supported MIME type
  let mimeType = 'video/webm;codecs=vp8,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = '';
    }
  }

  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const totalFrames = fps * durationSeconds;
  let currentFrame = 0;

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      const file = new File([blob], 'onthecountofthree_test_pattern.webm', { type: blob.type });
      resolve(file);
    };

    recorder.onerror = (err) => reject(err);

    recorder.start();

    function renderNextFrame() {
      if (currentFrame >= totalFrames) {
        recorder.stop();
        return;
      }

      const sec = currentFrame / fps;

      // Draw SMPTE color bars
      const barWidth = width / colors.length;
      colors.forEach((col, idx) => {
        ctx.fillStyle = col;
        ctx.fillRect(idx * barWidth, 0, barWidth, height * 0.65);
      });

      // Bottom bar
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, height * 0.65, width, height * 0.35);

      // System 7 / 90s testcard overlay
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ON THE COUNT OF THREE - SYNC TEST', width / 2, height * 0.74);

      const mins = Math.floor(sec / 60).toString().padStart(2, '0');
      const s = Math.floor(sec % 60).toString().padStart(2, '0');
      const ms = Math.floor((sec % 1) * 100).toString().padStart(2, '0');
      const timecode = `${mins}:${s}.${ms} (FRAME ${currentFrame}/${totalFrames})`;

      ctx.fillStyle = '#00ff66';
      ctx.font = '16px monospace';
      ctx.fillText(timecode, width / 2, height * 0.84);

      // Sweeping radar second indicator
      const sweepX = (sec % 2) / 2 * width;
      ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
      ctx.fillRect(sweepX - 2, 0, 4, height * 0.65);

      currentFrame++;
      if (onProgress && currentFrame % 25 === 0) {
        onProgress(Math.floor((currentFrame / totalFrames) * 100));
      }

      // Fast-forward drawing without waiting real time if possible
      requestAnimationFrame(renderNextFrame);
    }

    renderNextFrame();
  });
}
