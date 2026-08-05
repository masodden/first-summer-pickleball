import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../core/i18n';
import { ToastService, type Toast } from '../core/toast';

/**
 * Стопка тостов над интерфейсом.
 *
 * Ошибка с кнопкой «Повторить» не исчезает сама: организатор в разгаре турнира
 * не должен пропустить, что счёт не сохранился.
 */
@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" role="status" aria-live="polite">
      @for (toast of toasts(); track toast.id) {
        <div class="toast glass glass--strong" [class]="'toast--' + toast.kind">
          <div class="toast__icon" aria-hidden="true">
            @switch (toast.kind) {
              @case ('success') {
                <svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" /></svg>
              }
              @case ('error') {
                <svg viewBox="0 0 24 24"><path d="M12 7v8M12 17.5v.5" /></svg>
              }
              @default {
                <svg viewBox="0 0 24 24"><path d="M12 11v6M12 7.5v.5" /></svg>
              }
            }
          </div>

          <div class="toast__body">
            <p class="toast__title">{{ toast.title }}</p>
            @if (toast.message) {
              <p class="toast__message">{{ toast.message }}</p>
            }
          </div>

          <div class="toast__actions">
            @if (toast.retry) {
              <button type="button" class="btn btn--sm btn--glass" (click)="retry(toast)">
                {{ t()('common.retry') }}
              </button>
            }
            <button
              type="button"
              class="toast__close"
              [attr.aria-label]="t()('common.close')"
              (click)="dismiss(toast.id)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
      z-index: 60;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      width: min(100% - 24px, 460px);
      transform: translateX(-50%);
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      pointer-events: auto;
      animation: fade-rise var(--duration-base) var(--ease-spring) both;
    }

    .toast__icon {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      flex: 0 0 auto;
      border-radius: 50%;
      margin-top: 1px;
    }

    .toast__icon svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .toast--success .toast__icon {
      background: var(--success-soft);
      color: var(--success);
    }

    .toast--error .toast__icon {
      background: var(--danger-soft);
      color: var(--danger);
    }

    .toast--info .toast__icon {
      background: var(--accent-soft);
      color: var(--accent-strong);
    }

    .toast__body {
      flex: 1 1 auto;
      min-width: 0;
    }

    .toast__title {
      font-weight: 650;
      color: var(--text-strong);
    }

    .toast__message {
      font-size: 13px;
      color: var(--text-muted);
    }

    .toast__actions {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      flex: 0 0 auto;
    }

    .toast__close {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--text-faint);
      cursor: pointer;
    }

    .toast__close svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
    }

    .toast__close:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  `,
})
export class ToastHost {
  private readonly service = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly toasts = this.service.toasts;
  protected readonly t = this.i18n.t;

  protected retry(toast: Toast): void {
    this.service.dismiss(toast.id);
    toast.retry?.();
  }

  protected dismiss(id: number): void {
    this.service.dismiss(id);
  }
}
