import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StandingRowDto, StandingsSortKey } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { TournamentStore } from '../../core/tournament-store';
import { Avatar } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';

interface Column {
  key: StandingsSortKey;
  label: string;
  value: (row: StandingRowDto) => number;
}

/**
 * Турнирная таблица.
 *
 * По умолчанию сортировка та, что выбрана при создании турнира (обычно очки, а
 * при равенстве — разница). Любой столбец можно сделать главным одним касанием:
 * во время турнира спрашивают и «сколько побед», и «у кого лучше разница».
 */
@Component({
  selector: 'app-tournament-standings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Avatar, RatingChip],
  template: `
    <div class="stack stack--3">
      <div class="row row--between">
        <h2>{{ t()('standings.title') }}</h2>
        @if (tournament()?.status === 'running') {
          <span class="chip chip--go">{{ t()('standings.live') }}</span>
        }
      </div>

      @if (rows().length === 0) {
        <div class="glass card empty-state">
          <p>{{ t()('standings.empty') }}</p>
        </div>
      } @else {
        <div class="glass card--tight scroll-x">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ t()('standings.rank') }}</th>
                <th scope="col">{{ t()('standings.player') }}</th>
                @for (column of columns(); track column.key) {
                  <th
                    scope="col"
                    [attr.aria-sort]="sortKey() === column.key ? 'descending' : null"
                    (click)="sortBy(column.key)"
                  >
                    {{ column.label }}
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.player.id) {
                <tr>
                  <td>
                    @if (row.medal) {
                      <span class="medal" [class]="'medal--' + row.medal" [title]="medalLabel(row)">
                        {{ row.rank }}
                      </span>
                    } @else {
                      <span class="numeric muted">{{ row.rank }}</span>
                    }
                  </td>
                  <td>
                    <a class="player" [routerLink]="['/players', row.player.id]">
                      <app-avatar [player]="row.player" [size]="28" />
                      <span class="truncate">{{ row.player.fullName }}</span>
                      <app-rating-chip [player]="row.player" [showLabel]="false" />
                    </a>
                  </td>
                  @for (column of columns(); track column.key) {
                    <td
                      class="numeric"
                      [class.cell--sorted]="sortKey() === column.key"
                      [class.strong]="column.key === 'points'"
                    >
                      {{ format(column, row) }}
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>

        <p class="tiny faint center">{{ t()('standings.sortBy') }}: {{ activeLabel() }}</p>
      }
    </div>
  `,
  styles: `
    .player {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      max-width: 190px;
      color: var(--text-strong);
      font-weight: 600;
    }

    .player:hover {
      text-decoration: none;
      color: var(--accent);
    }

    .medal {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      font-size: 12.5px;
      font-weight: 800;
      color: var(--ink-900);
      font-variant-numeric: tabular-nums;
      animation: pop-in var(--duration-slow) var(--ease-spring) both;
    }

    .medal--gold {
      background: linear-gradient(160deg, #f7d67a, var(--gold));
      box-shadow: 0 4px 14px -6px rgba(232, 182, 71, 0.9);
    }

    .medal--silver {
      background: linear-gradient(160deg, #e2e6ea, var(--silver));
    }

    .medal--bronze {
      background: linear-gradient(160deg, #e0ab84, var(--bronze));
    }

    .cell--sorted {
      color: var(--accent-strong);
      font-weight: 700;
    }
  `,
})
export class TournamentStandingsTab {
  private readonly i18n = inject(I18nService);
  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;
  protected readonly tournament = this.store.tournament;

  private readonly override = signal<StandingsSortKey | null>(null);

  /** Пока столбец не выбран вручную, действует настройка турнира. */
  protected readonly sortKey = computed<StandingsSortKey>(
    () => this.override() ?? this.tournament()?.standingsSort[0] ?? 'points',
  );

  protected readonly columns = computed<Column[]>(() => [
    {
      key: 'points',
      label: this.i18n.translate('standings.points'),
      value: (row) => row.pointsFor,
    },
    { key: 'wins', label: this.i18n.translate('standings.wins'), value: (row) => row.wins },
    { key: 'losses', label: this.i18n.translate('standings.losses'), value: (row) => row.losses },
    { key: 'diff', label: this.i18n.translate('standings.diff'), value: (row) => row.diff },
    { key: 'played', label: this.i18n.translate('standings.played'), value: (row) => row.played },
    {
      key: 'pointsAgainst',
      label: this.i18n.translate('standings.pointsAgainst'),
      value: (row) => row.pointsAgainst,
    },
  ]);

  protected readonly activeLabel = computed(
    () => this.columns().find((column) => column.key === this.sortKey())?.label ?? '',
  );

  protected readonly rows = computed(() => this.store.standings());

  protected sortBy(key: StandingsSortKey): void {
    this.override.set(key);
    // Сортировку считает сервер: правила ничьих и подрядность мест едины для всех.
    void this.store.setStandingsSort([key, 'points', 'diff', 'wins']);
  }

  protected format(column: Column, row: StandingRowDto): string {
    const value = column.value(row);
    return column.key === 'diff' && value > 0 ? `+${value}` : String(value);
  }

  protected medalLabel(row: StandingRowDto): string {
    switch (row.medal) {
      case 'gold':
        return this.i18n.translate('standings.medalGold');
      case 'silver':
        return this.i18n.translate('standings.medalSilver');
      case 'bronze':
        return this.i18n.translate('standings.medalBronze');
      default:
        return '';
    }
  }
}
