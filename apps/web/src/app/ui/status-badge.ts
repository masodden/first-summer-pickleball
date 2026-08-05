import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { TournamentStatus } from '@fsp/shared';
import { I18nService } from '../core/i18n';

/** Статус турнира: «Идёт регистрация», «Идёт», «Завершён». */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge-status" [class]="'badge-status--' + status()">{{ label() }}</span>`,
})
export class StatusBadge {
  private readonly i18n = inject(I18nService);
  readonly status = input.required<TournamentStatus>();

  protected readonly label = computed(() => {
    switch (this.status()) {
      case 'registration':
        return this.i18n.translate('status.registration');
      case 'registration_closed':
        return this.i18n.translate('status.registration_closed');
      case 'running':
        return this.i18n.translate('status.running');
      case 'finished':
        return this.i18n.translate('status.finished');
    }
  });
}
