import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService } from '../core/confirm';
import { I18nService } from '../core/i18n';

@Component({
  selector: 'app-confirm-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as confirm) {
      <div class="backdrop" (click)="answer(false)">
        <div
          class="dialog glass glass--strong animate-pop"
          role="alertdialog"
          aria-modal="true"
          (click)="$event.stopPropagation()"
        >
          <h3>{{ confirm.title }}</h3>
          @if (confirm.message) {
            <p class="muted small">{{ confirm.message }}</p>
          }
          <div class="row">
            <button type="button" class="btn btn--glass grow" (click)="answer(false)">
              {{ confirm.cancelLabel ?? t()('common.cancel') }}
            </button>
            <button
              type="button"
              class="btn grow"
              [class.btn--primary]="!confirm.danger"
              [class.btn--danger]="confirm.danger"
              (click)="answer(true)"
            >
              {{ confirm.confirmLabel ?? t()('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: grid;
      place-items: center;
      padding: var(--space-4);
      background: rgba(36, 26, 22, 0.42);
      backdrop-filter: blur(4px);
      animation: fade-in var(--duration-fast) ease both;
    }

    .dialog {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      width: min(100%, 380px);
      padding: var(--space-5);
    }
  `,
})
export class ConfirmHost {
  private readonly service = inject(ConfirmService);
  protected readonly request = this.service.request;
  protected readonly t = inject(I18nService).t;

  protected answer(value: boolean): void {
    this.service.answer(value);
  }
}
