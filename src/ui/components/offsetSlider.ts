/**
 * UI Component: Manual Audio/Video Offset Slider (-2.0s to +2.0s)
 */

export interface OffsetSliderCallbacks {
  onOffsetChange: (offsetSeconds: number) => void;
}

export class OffsetSliderComponent {
  private element: HTMLElement;
  private slider: HTMLInputElement;
  private valueBox: HTMLElement;
  private callbacks: OffsetSliderCallbacks;

  constructor(callbacks: OffsetSliderCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'offset-container';

    this.element.innerHTML = `
      <span class="offset-label" title="Compensate for differences in studio bumper logos or release cuts">
        ⏱ MANUAL SYNC OFFSET:
      </span>

      <div class="offset-slider-group">
        <button class="retro-btn small" id="btn-nudge-minus" title="Step -100ms">-0.1s</button>
        <input type="range" class="offset-slider" id="offset-range" min="-2.0" max="2.0" step="0.05" value="0.0" aria-label="Manual stream sync offset in seconds" />
        <button class="retro-btn small" id="btn-nudge-plus" title="Step +100ms">+0.1s</button>
        <span class="offset-val-box" id="offset-readout">0.00s</span>
        <button class="retro-btn small" id="btn-offset-reset" title="Reset offset to zero">Reset (0s)</button>
      </div>
    `;

    this.slider = this.element.querySelector('#offset-range')!;
    this.valueBox = this.element.querySelector('#offset-readout')!;

    this.setupEvents();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  private setupEvents(): void {
    this.slider.addEventListener('input', () => {
      const val = parseFloat(this.slider.value);
      this.updateDisplay(val);
      this.callbacks.onOffsetChange(val);
    });

    this.element.querySelector('#btn-nudge-minus')!.addEventListener('click', () => {
      const val = Math.max(-2.0, parseFloat(this.slider.value) - 0.1);
      this.setVal(val);
    });

    this.element.querySelector('#btn-nudge-plus')!.addEventListener('click', () => {
      const val = Math.min(2.0, parseFloat(this.slider.value) + 0.1);
      this.setVal(val);
    });

    this.element.querySelector('#btn-offset-reset')!.addEventListener('click', () => {
      this.setVal(0.0);
    });
  }

  private setVal(val: number): void {
    const rounded = Math.round(val * 100) / 100;
    this.slider.value = rounded.toFixed(2);
    this.updateDisplay(rounded);
    this.callbacks.onOffsetChange(rounded);
  }

  private updateDisplay(val: number): void {
    const sign = val > 0 ? '+' : '';
    this.valueBox.textContent = `${sign}${val.toFixed(2)}s`;
  }
}
