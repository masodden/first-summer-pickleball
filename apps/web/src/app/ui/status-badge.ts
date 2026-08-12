import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { TournamentStatus, TrainingStatus } from '@fsp/shared';
import { I18nService } from '../core/i18n';

/** Статус турнира или тренировки: «Идёт регистрация», «Идёт», «Завершён»/«Архив». */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge-status" [class]="'badge-status--' + status()">{{ label() }}</span>`,
})
export class StatusBadge {
  private readonly i18n = inject(I18nService);
  readonly status = input.required<TournamentStatus | TrainingStatus>();
  /** Для тренировки — женский род: «Завершена». */
  readonly entity = input<'tournament' | 'training'>('tournament');

  protected readonly label = computed(() => {
    switch (this.status()) {
      case 'registration':
        return this.i18n.translate('status.registration');
      case 'registration_closed':
        return this.i18n.translate('status.registration_closed');
      case 'running':
        return this.i18n.translate('status.running');
      case 'finished':
        return this.i18n.translate(
          this.entity() === 'training' ? 'training.statusFinished' : 'status.finished',
        );
      case 'archived':
        return this.i18n.translate('status.archived');
    }
  });
}
