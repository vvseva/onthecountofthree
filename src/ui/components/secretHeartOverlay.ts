/**
 * Secret Romantic Fullscreen Overlay for "/polina" chat command
 * Displays a full-screen declaration "Полина ты мне очень нравишься"
 * with floating and bursting heart emojis, romantic glowing aesthetics,
 * click-to-spawn hearts, and gentle audio chime.
 */

export class SecretHeartOverlay {
  private overlay: HTMLElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private heartInterval: number | null = null;

  public show(): void {
    if (this.overlay) {
      this.hide();
    }

    this.playRomanticChime();

    const el = document.createElement('div');
    el.className = 'polina-overlay';
    el.id = 'polina-secret-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Полина ты мне очень нравишься');

    el.innerHTML = `
      <div class="polina-backdrop"></div>
      <div class="polina-hearts-container" id="polina-hearts-container"></div>
      
      <div class="polina-center-card">
        <div class="polina-hearts-crown">
          ❤️ 💖 💕 💗 💓 💞 💘 💝
        </div>
        <h1 class="polina-title">
          Полина, ты мне очень нравишься
        </h1>
        <div class="polina-sub-hearts">
          <span class="pulsing-heart">❤️</span>
          <span class="pulsing-heart delay-1">💖</span>
          <span class="pulsing-heart delay-2">💕</span>
          <span class="pulsing-heart delay-3">💗</span>
          <span class="pulsing-heart delay-4">💓</span>
        </div>
        <div class="polina-hint">
          Нажми в любое место, чтобы добавить сердечки • Нажми Закрыть или ESC для выхода
        </div>
        <button class="retro-btn primary polina-close-btn" id="polina-close-btn">
          Закрыть ❤️
        </button>
      </div>
    `;

    document.body.appendChild(el);
    this.overlay = el;

    // Generate initial bursting hearts
    this.spawnInitialHearts();

    // Continuously float hearts
    this.heartInterval = window.setInterval(() => {
      this.spawnFloatingHeart();
    }, 180);

    // Click anywhere to spawn extra hearts
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'polina-close-btn') {
        this.hide();
        return;
      }
      this.spawnHeartAt(e.clientX, e.clientY);
    });

    // ESC to close
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  public hide(): void {
    if (this.heartInterval) {
      clearInterval(this.heartInterval);
      this.heartInterval = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.overlay) {
      this.overlay.classList.add('polina-fade-out');
      const toRemove = this.overlay;
      setTimeout(() => {
        toRemove.remove();
      }, 350);
      this.overlay = null;
    }
  }

  private spawnInitialHearts(): void {
    const container = this.overlay?.querySelector('#polina-hearts-container');
    if (!container) return;

    const emojis = ['❤️', '💖', '💕', '💗', '💓', '💞', '💘', '💝', '💟', '🌹', '✨'];
    for (let i = 0; i < 45; i++) {
      const heart = document.createElement('span');
      heart.className = 'floating-heart';
      heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      
      const left = Math.random() * 100;
      const size = 20 + Math.random() * 38;
      const duration = 3.5 + Math.random() * 4.5;
      const delay = Math.random() * 3.5;
      const sway = (Math.random() - 0.5) * 60;

      heart.style.left = `${left}%`;
      heart.style.fontSize = `${size}px`;
      heart.style.animationDuration = `${duration}s`;
      heart.style.animationDelay = `-${delay}s`;
      heart.style.setProperty('--sway-x', `${sway}px`);

      container.appendChild(heart);
    }
  }

  private spawnFloatingHeart(): void {
    const container = this.overlay?.querySelector('#polina-hearts-container');
    if (!container) return;

    const emojis = ['❤️', '💖', '💕', '💗', '💓', '💞', '💘', '💝', '✨'];
    const heart = document.createElement('span');
    heart.className = 'floating-heart';
    heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];

    const left = Math.random() * 100;
    const size = 18 + Math.random() * 36;
    const duration = 3.5 + Math.random() * 3.5;
    const sway = (Math.random() - 0.5) * 70;

    heart.style.left = `${left}%`;
    heart.style.fontSize = `${size}px`;
    heart.style.animationDuration = `${duration}s`;
    heart.style.setProperty('--sway-x', `${sway}px`);

    container.appendChild(heart);

    setTimeout(() => {
      heart.remove();
    }, duration * 1000);
  }

  private spawnHeartAt(x: number, y: number): void {
    const emojis = ['❤️', '💖', '💕', '💗', '💓', '💞', '💘', '💝', '✨'];
    for (let i = 0; i < 5; i++) {
      const heart = document.createElement('span');
      heart.className = 'click-burst-heart';
      heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];

      const offsetX = (Math.random() - 0.5) * 80;
      const offsetY = (Math.random() - 0.5) * 80;
      const size = 22 + Math.random() * 24;

      heart.style.left = `${x}px`;
      heart.style.top = `${y}px`;
      heart.style.fontSize = `${size}px`;
      heart.style.setProperty('--burst-x', `${offsetX}px`);
      heart.style.setProperty('--burst-y', `${offsetY - 50}px`);

      this.overlay?.appendChild(heart);

      setTimeout(() => {
        heart.remove();
      }, 1200);
    }
  }

  private playRomanticChime(): void {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // C5, E5, G5, B5, C6 arpeggio
      const notes = [523.25, 659.25, 783.99, 987.77, 1046.50];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.12);

        gain.gain.setValueAtTime(0.0001, ctx.currentTime + index * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + index * 0.12 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + index * 0.12 + 0.8);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + index * 0.12);
        osc.stop(ctx.currentTime + index * 0.12 + 0.85);
      });
    } catch {
      // AudioContext unavailable
    }
  }
}
