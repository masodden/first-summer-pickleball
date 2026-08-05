import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StandingRowDto, StandingsSortKey } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { TournamentStore } from '../../core/tournament-store';
import { Avatar } from '../../ui/player-line';

type SortDirection = 'asc' | 'desc';

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
  imports: [RouterLink, Avatar],
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
                    class="th--sortable"
                    [attr.aria-sort]="
                      sortKey() === column.key
                        ? direction() === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : null
                    "
                    [title]="t()('standings.sortHint')"
                    (click)="sortBy(column.key)"
                  >
                    {{ column.label }}
                    <span class="arrow" [class.arrow--active]="sortKey() === column.key">
                      {{ sortKey() === column.key && direction() === 'asc' ? '↑' : '↓' }}
                    </span>
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
                    <!-- Рейтинг здесь не показываем: строка узкая, DUPR виден в карточке игрока. -->
                    <a class="player" [routerLink]="['/players', row.player.id]">
                      <app-avatar [player]="row.player" [size]="28" />
                      <span class="truncate">{{ row.player.fullName }}</span>
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

        <p class="tiny faint center">
          {{ t()('standings.sortBy') }}: {{ activeLabel() }} ·
          {{ t()(direction() === 'asc' ? 'standings.sortAsc' : 'standings.sortDesc') }}
        </p>
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

    .th--sortable {
      cursor: pointer;
      white-space: nowrap;
    }

    .arrow {
      margin-left: 3px;
      font-size: 11px;
      opacity: 0.25;
    }

    .arrow--active {
      opacity: 1;
      color: var(--accent-strong);
    }
  `,
})
export class TournamentStandingsTab {
  private readonly i18n = inject(I18nService);
  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;
  protected readonly tournament = this.store.tournament;

  private readonly override = signal<StandingsSortKey | null>(null);
  private readonly directionSignal = signal<SortDirection>('desc');

  /** Пока столбец не выбран вручную, действует настройка турнира. */
  protected readonly sortKey = computed<StandingsSortKey>(
    () => this.override() ?? this.tournament()?.standingsSort[0] ?? 'points',
  );

  protected readonly direction = this.directionSignal.asReadonly();

  protected readonly columns = computed<Column[]>(() => {
    const columns: Column[] = [
      {
        key: 'points',
        label: this.i18n.translate('standings.points'),
        value: (row) => row.pointsFor,
      },
      { key: 'wins', label: this.i18n.translate('standings.wins'), value: (row) => row.wins },
    ];
    // Ничьи считаются и показываются только когда турнир их допускает.
    if (this.tournament()?.tieRule === 'draw') {
      columns.push({
        key: 'draws',
        label: this.i18n.translate('standings.draws'),
        value: (row) => row.draws,
      });
    }
    columns.push(
      { key: 'losses', label: this.i18n.translate('standings.losses'), value: (row) => row.losses },
      { key: 'diff', label: this.i18n.translate('standings.diff'), value: (row) => row.diff },
      { key: 'played', label: this.i18n.translate('standings.played'), value: (row) => row.played },
      {
        key: 'pointsAgainst',
        label: this.i18n.translate('standings.pointsAgainst'),
        value: (row) => row.pointsAgainst,
      },
    );
    return columns;
  });

  protected readonly activeLabel = computed(
    () => this.columns().find((column) => column.key === this.sortKey())?.label ?? '',
  );

  /**
   * Порядок строк на экране. Место и медали остаются от расчёта сервера —
   * это итог турнира, он не зависит от того, каким столбцом сейчас смотрят.
   * При равных значениях сохраняем турнирный порядок.
   */
  protected readonly rows = computed(() => {
    const column = this.columns().find((item) => item.key === this.sortKey());
    const rows = [...this.store.standings()];
    if (!column) return rows;
    const sign = this.directionSignal() === 'asc' ? 1 : -1;
    return rows.sort(
      (left, right) => sign * (column.value(left) - column.value(right)) || left.rank - right.rank,
    );
  });

  /** Повторное касание того же столбца переворачивает порядок. */
  protected sortBy(key: StandingsSortKey): void {
    if (this.sortKey() === key) {
      this.directionSignal.update((value) => (value === 'desc' ? 'asc' : 'desc'));
      return;
    }
    this.override.set(key);
    this.directionSignal.set('desc');
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
