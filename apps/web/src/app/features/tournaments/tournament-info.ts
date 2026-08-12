import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  courtLabel,
  matchWinnerRule,
  type TranslationKey,
  type WinnerRuleId,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { TelegramService } from '../../core/telegram';
import { TournamentStore } from '../../core/tournament-store';
import { consumeFirstVisit } from '../../core/motion';
import { TournamentJoinPanel } from './tournament-join-panel';

/**
 * Вкладка «Информация».
 *
 * Здесь игрок понимает, куда и когда приходить и стоит ли заявляться, а
 * заявиться может одной кнопкой. Наблюдатель видит то же самое без входа.
 */
@Component({
  selector: 'app-tournament-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TournamentJoinPanel],
  template: `
    @if (tournament(); as item) {
      <div class="stack stack--4" [class.stagger]="stagger">
        <section class="glass card--tight stack stack--3">
          <div class="grid">
            @if (item.category) {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.category') }}</span>
                <span class="strong">{{ item.category }}</span>
              </div>
            }
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.format') }}</span>
              <span class="strong">{{ formatLabel() }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.courts') }}</span>
              <span class="strong" [class.numeric]="!item.courtNames">{{ courtsLabel() }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.pointsToWin') }}</span>
              <span class="strong numeric">{{ item.pointsToWin }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.matchDuration') }}</span>
              <span class="strong numeric">
                {{ item.matchDurationMin ?? t()('common.notSet') }}
              </span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.rounds') }}</span>
              <span class="strong numeric">
                {{ item.roundsPlanned ?? t()('tournament.roundsInfinite') }}
              </span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('participant.list') }}</span>
              <span class="strong numeric">
                {{
                  t()('tournament.participantsCount', {
                    count: store.registered().length,
                    max: item.maxPlayers,
                  })
                }}
              </span>
            </div>
            @if (item.entryFee !== null) {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.entryFee') }}</span>
                <span class="strong numeric">{{ item.entryFee }}</span>
              </div>
            }
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.tieRule') }}</span>
              <span class="strong">
                {{ t()(item.tieRule === 'draw' ? 'tie.draw' : 'tie.golden_point') }}
              </span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.standingsSort') }}</span>
              <span class="strong">{{ winnerRuleLabel() }}</span>
            </div>
          </div>

          <p class="small muted">{{ formatDescription() }}</p>
        </section>

        <section class="glass card--tight stack stack--2">
          <h3>{{ t()('tournament.venue') }}</h3>
          <p class="strong">{{ item.venueName ?? t()('common.notSet') }}</p>
          @if (item.venueAddress) {
            <p class="small muted">{{ item.venueAddress }}</p>
          }
          <p class="small muted">{{ i18n.formatDate(item.startsAt) }}</p>
          @if (item.venueMapUrl) {
            <button
              type="button"
              class="btn btn--sm btn--glass"
              (click)="openMap(item.venueMapUrl)"
            >
              {{ t()('tournament.openMap') }}
            </button>
          }
        </section>

        @if (item.description) {
          <section class="glass card--tight stack stack--2">
            <h3>{{ t()('tournament.description') }}</h3>
            <p class="small text-block">{{ item.description }}</p>
          </section>
        }

        @if (item.formatDescription) {
          <section class="glass card--tight stack stack--2">
            <h3>{{ t()('tournament.formatDescription') }}</h3>
            <p class="small text-block">{{ item.formatDescription }}</p>
          </section>
        }

        <app-tournament-join-panel />
      </div>
    }
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
      gap: var(--space-3);
    }

    .cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
  `,
})
export class TournamentInfoTab {
  private readonly telegram = inject(TelegramService);

  protected readonly store = inject(TournamentStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  protected readonly stagger = consumeFirstVisit('tournament-info');

  protected readonly tournament = this.store.tournament;

  protected readonly formatLabel = computed(() =>
    this.i18n.translate(
      this.tournament()?.format === 'mexicano' ? 'format.mexicano' : 'format.americano',
    ),
  );

  /** Подписанные корты показываем списком: «4, 5, 6» вместо «3». */
  protected readonly courtsLabel = computed(() => {
    const item = this.tournament();
    if (!item) return '';
    const names = item.courtNames;
    if (!names) return item.courts.toString();
    return Array.from({ length: item.courts }, (_, index) => courtLabel(index + 1, names)).join(
      ', ',
    );
  });

  protected readonly formatDescription = computed(() =>
    this.i18n.translate(
      this.tournament()?.format === 'mexicano'
        ? 'format.mexicano.description'
        : 'format.americano.description',
    ),
  );

  protected readonly winnerRuleLabel = computed(() => {
    const sort = this.tournament()?.standingsSort ?? [];
    const rule = matchWinnerRule(sort);
    return this.i18n.translate(winnerRuleI18nKey(rule));
  });

  protected openMap(url: string): void {
    this.telegram.openExternal(url);
  }
}

function winnerRuleI18nKey(rule: WinnerRuleId): TranslationKey {
  switch (rule) {
    case 'points_diff':
      return 'tournament.winnerRule.pointsDiff';
    case 'points_wins':
      return 'tournament.winnerRule.pointsWins';
    case 'wins_points':
      return 'tournament.winnerRule.winsPoints';
  }
}
