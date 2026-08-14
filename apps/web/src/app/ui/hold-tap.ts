import { Directive, output } from '@angular/core';

const HOLD_MS = 400;
const LOCK_MS = 1500;
const MOVE_PX2 = 24 * 24;

/**
 * Короткий тап vs длинный: в Telegram/iOS при удержании pointerdown и
 * contextmenu приходят пачкой, поэтому hold срабатывает один раз на жест.
 */
@Directive({
  selector: '[appHoldTap]',
  host: {
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp($event)',
    '(pointercancel)': 'onUp($event)',
    '(click)': 'onClick($event)',
    '(contextmenu)': 'onContext($event)',
  },
})
export class HoldTap {
  readonly held = output<void>();
  readonly tapped = output<void>();

  private pointerId: number | null = null;
  private holdFired = false;
  private moved = false;
  private downAt = 0;
  private origin: { x: number; y: number } | null = null;
  private lockUntil = 0;

  protected onDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this.pointerId !== null) return;
    if (Date.now() < this.lockUntil) return;

    this.pointerId = event.pointerId;
    this.holdFired = false;
    this.moved = false;
    this.downAt = Date.now();
    this.origin = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  protected onMove(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || this.moved || !this.origin) return;
    const dx = event.clientX - this.origin.x;
    const dy = event.clientY - this.origin.y;
    if (dx * dx + dy * dy > MOVE_PX2) this.moved = true;
  }

  protected onUp(event: PointerEvent): void {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    const held = this.downAt === 0 ? 0 : Date.now() - this.downAt;
    const shouldHold = !this.moved && held >= HOLD_MS;
    this.release(event);
    if (shouldHold) this.emitHold();
  }

  protected onClick(event: Event): void {
    if (this.holdFired || Date.now() < this.lockUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.tapped.emit();
  }

  protected onContext(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.emitHold();
  }

  private release(event: PointerEvent): void {
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      // pointer already released
    }
    this.pointerId = null;
    this.downAt = 0;
    this.origin = null;
  }

  private emitHold(): void {
    if (this.holdFired || Date.now() < this.lockUntil) return;
    this.holdFired = true;
    this.lockUntil = Date.now() + LOCK_MS;
    this.held.emit();
  }
}
