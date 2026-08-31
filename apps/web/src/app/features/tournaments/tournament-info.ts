import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  formatDescriptionKey,
  formatNameKey,
  groupStagesByGames,
  matchWinnerRule,
  type BracketGameSettings,
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
              <span class="strong numeric">{{ item.courts }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">
                {{
                  t()(store.isFixedPairs() ? 'tournament.pointsToWinGroup' : 'tournament.pointsToWin')
                }}
              </span>
              <span class="strong numeric">{{ groupPoints() }}</span>
            </div>
            @if (!store.isFixedPairs() && playoffPoints(); as playoff) {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.pointsToWinPlayoff') }}</span>
                <span class="strong numeric">{{ playoff }}</span>
              </div>
            }
            @if (!store.isFixedPairs()) {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.matchDuration') }}</span>
                <span class="strong numeric">
                  {{ item.matchDurationMin ?? t()('common.notSet') }}
                </span>
              </div>
            }
            @if (store.isFixedPairs()) {
              <div class="cell">
                <span class="tiny faint">{{ t()('bracket.groups') }}</span>
                <span class="strong numeric">{{ item.bracketConfig?.groupCount ?? 0 }}</span>
              </div>
            } @else {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.rounds') }}</span>
                <span class="strong numeric">
                  {{ item.roundsPlanned ?? t()('tournament.roundsInfinite') }}
                </span>
              </div>
            }
            <div class="cell">
              <span class="tiny faint">{{ t()('participant.list') }}</span>
              <span class="strong numeric">{{ rosterCountLabel() }}</span>
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
            @if (!store.isFixedPairs()) {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.standingsSort') }}</span>
                <span class="strong">{{ winnerRuleLabel() }}</span>
              </div>
            }
          </div>

          <p class="small muted">{{ formatDescription() }}</p>
          @if (formatRules().length > 0) {
            <div class="stack stack--1">
              <span class="tiny faint">{{ t()('tournament.formatRules') }}</span>
              @for (line of formatRules(); track line.label) {
                <p class="small">
                  <span class="muted">{{ line.label }}:</span>
                  {{ line.value }}
                </p>
              }
            </div>
          }
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

  protected readonly formatLabel = computed(() => {
    const format = this.tournament()?.format;
    return format ? this.i18n.translate(formatNameKey(format)) : '';
  });

  protected readonly formatDescription = computed(() => {
    const format = this.tournament()?.format;
    return format ? this.i18n.translate(formatDescriptionKey(format)) : '';
  });

  protected readonly winnerRuleLabel = computed(() => {
    const sort = this.tournament()?.standingsSort ?? [];
    const rule = matchWinnerRule(sort);
    return this.i18n.translate(winnerRuleI18nKey(rule));
  });

  protected readonly groupPoints = computed(() => {
    const item = this.tournament();
    if (!item) return '';
    return item.bracketConfig?.groupGames.pointsToWin ?? item.pointsToWin;
  });

  /** Отдельная строка, только если в плей-офф другой лимит, чем в группе. */
  protected readonly playoffPoints = computed((): string | null => {
    const config = this.tournament()?.bracketConfig;
    if (!config || config.stages.length === 0) return null;
    const group = config.groupGames.pointsToWin;
    const unique = [...new Set(config.stages.map((stage) => stage.games.pointsToWin))];
    if (unique.length === 1 && unique[0] === group) return null;
    return unique.join(' / ');
  });

  protected readonly formatRules = computed((): { label: string; value: string }[] => {
    const config = this.tournament()?.bracketConfig;
    if (!config || !this.store.isFixedPairs()) return [];
    const lines = [
      {
        label: this.i18n.translate('bracket.groupSection'),
        value: this.rulesLabel(config.groupGames),
      },
    ];
    for (const bucket of groupStagesByGames(config.stages)) {
      lines.push({
        label:
          bucket.names.length > 4
            ? this.i18n.translate('bracket.sameRulesMany')
            : bucket.names.join(', '),
        value: this.rulesLabel(bucket.games),
      });
    }
    return lines;
  });

  private rulesLabel(games: BracketGameSettings): string {
    return games.winsToTake <= 1
      ? this.i18n.translate('bracket.gameRulesOne', { points: games.pointsToWin })
      : this.i18n.translate('bracket.gameRulesSeries', {
          wins: games.winsToTake,
          points: games.pointsToWin,
        });
  }

  protected rosterCountLabel(): string {
    const item = this.tournament();
    if (!item) return '';
    if (this.store.isFixedPairs()) {
      const count = this.store.pairCount();
      const max = Math.floor(item.maxPlayers / 2);
      if (this.store.unpaired().length === 0 && count > 0 && count === max) {
        return this.i18n.translate('tournament.pairsCount', { count });
      }
      return this.i18n.translate('tournament.pairsCountOf', { count, max });
    }
    return this.i18n.translate('tournament.participantsCount', {
      count: this.store.registered().length,
      max: item.maxPlayers,
    });
  }

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
