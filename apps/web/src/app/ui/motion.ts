import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { reducedMotion } from '../core/motion';

/** Строка едет на новое место (FLIP), а не прыгает. */
@Directive({
  selector: '[appFlipMove]',
})
export class FlipMove {
  readonly appFlipMove = input.required<string>();
  readonly appFlipIndex = input(0);

  private readonly el = inject(ElementRef<HTMLElement>);
  private prevTop: number | null = null;

  constructor() {
    afterRenderEffect(() => {
      this.appFlipMove();
      this.appFlipIndex();
      const node = this.el.nativeElement;
      const top = node.getBoundingClientRect().top;
      const prev = this.prevTop;
      this.prevTop = top;
      if (prev === null || reducedMotion()) return;
      const dy = prev - top;
      if (Math.abs(dy) < 1) return;
      node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
        duration: 280,
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
      });
    });
  }
}

/** Цифра счёта: короткий pop при смене, без анимации при reduced motion. */
@Component({
  selector: 'app-score-tick',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <span class="score-tick numeric">{{ label() }}</span> `,
  styles: `
    :host {
      display: inline-block;
      min-width: 40px;
      text-align: center;
    }

    .score-tick {
      display: inline-block;
      font-family: var(--font-display);
      font-weight: 800;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ScoreTick {
  readonly value = input<number | null>(null);
  readonly empty = input('—');

  protected readonly label = computed(() => {
    const value = this.value();
    return value === null ? this.empty() : String(value);
  });

  private readonly el = inject(ElementRef<HTMLElement>);
  private primed = false;

  constructor() {
    afterRenderEffect(() => {
      const text = this.label();
      if (!this.primed) {
        this.primed = true;
        return;
      }
      if (reducedMotion() || text === this.empty()) return;
      this.el.nativeElement.animate(
        [
          { transform: 'translateY(8px)', opacity: 0.35 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    });
  }
}

/** Свайп шита вниз, чтобы закрыть. */
@Directive({
  selector: '[appSheetDismiss]',
})
export class SheetDismiss {
  readonly dismissed = output<void>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private startY = 0;
  private dragging = false;

  constructor() {
    const node = this.el.nativeElement;
    node.addEventListener('pointerdown', this.onDown, { passive: true });
    node.addEventListener('pointermove', this.onMove);
    node.addEventListener('pointerup', this.onUp);
    node.addEventListener('pointercancel', this.onUp);
    inject(DestroyRef).onDestroy(() => {
      node.removeEventListener('pointerdown', this.onDown);
      node.removeEventListener('pointermove', this.onMove);
      node.removeEventListener('pointerup', this.onUp);
      node.removeEventListener('pointercancel', this.onUp);
    });
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (reducedMotion()) return;
    const rect = this.el.nativeElement.getBoundingClientRect();
    if (event.clientY > rect.top + 56) return;
    this.dragging = true;
    this.startY = event.clientY;
    this.el.nativeElement.style.transition = 'none';
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const dy = Math.max(0, event.clientY - this.startY);
    this.el.nativeElement.style.transform = `translateY(${dy}px)`;
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    const node = this.el.nativeElement;
    const dy = Math.max(0, event.clientY - this.startY);
    node.style.transition = 'transform 240ms cubic-bezier(0.32, 0.72, 0, 1)';
    if (dy > 96) {
      node.style.transform = 'translateY(110%)';
      window.setTimeout(() => this.dismissed.emit(), 180);
      return;
    }
    node.style.transform = '';
  };
}
