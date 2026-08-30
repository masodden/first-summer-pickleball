import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  displayStageName,
  slotHeading,
  type BracketConfig,
  type MatchDto,
  type RoundDto,
  type TeamStandingRowDto,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';

interface GroupTable {
  title: string;
  rows: TeamStandingRowDto[];
}

interface KnockoutItem {
  heading: string;
  match: MatchDto;
  games: { scoreA: number; scoreB: number }[];
}

interface KnockoutStageView {
  id: string;
  name: string;
  kind: 'playoff' | 'consolation' | 'other';
  showHeadings: boolean;
  matches: KnockoutItem[];
}

function pairLabel(match: MatchDto, side: 'A' | 'B', empty: string): string {
  const players = side === 'A' ? match.teamA.players : match.teamB.players;
  if (players.length === 0) return empty;
  return players.map((player) => player.fullName).join(' / ');
}

function playedGames(match: MatchDto): { scoreA: number; scoreB: number }[] {
  return (match.games ?? []).filter((game) => game.scoreA > 0 || game.scoreB > 0);
}

function flattenMatches(rounds: readonly RoundDto[]): MatchDto[] {
  return rounds.flatMap((round) => round.matches);
}

/** 5–8, затем за 5 и 7, потом 9–12 и одиночные места. */
function consolationOrder(name: string): number {
  const nums = [...name.matchAll(/(\d+)/g)].map((match) => Number(match[1]));
  const start = nums[0] ?? 99;
  return start * 2 + (nums.length > 1 ? 0 : 1);
}

/**
 * Группы, плей-офф и призёры фиксированных пар.
 *
 * Медали не ставим в групповую таблицу: там место в группе, а золото/серебро/бронза
 * — из финала и матча за 3-е, как в одиночном турнире после финиша.
 */
@Component({
  selector: 'app-pair-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (podium().length > 0) {
      <section class="stack stack--2">
        <h3>{{ t()('standings.podium') }}</h3>
        <div class="glass card--tight podium">
          @for (row of podium(); track row.players[0].id + row.players[1].id) {
            <div class="podium__row">
              @if (row.medal) {
                <span
                  class="medal"
                  [class]="'medal--' + row.medal"
                  [title]="medalLabel(row.medal)"
                >
                  {{ medalRank(row.medal) }}
                </span>
              }
              <span class="pair">
                {{ row.players[0].fullName }}
                <span class="pair__sep">/</span>
                {{ row.players[1].fullName }}
              </span>
            </div>
          }
        </div>
      </section>
    }

    @if (groups().length > 1) {
      <h3>{{ t()('standings.groupStage') }}</h3>
    }
    @for (group of groups(); track group.title) {
      <section class="stack stack--2">
        @if (groups().length > 1) {
          <h4>{{ group.title }}</h4>
        } @else {
          <h3>{{ group.title }}</h3>
        }
        <div class="glass card--tight table-shell">
          <div class="scroll-x">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ t()('standings.rank') }}</th>
                  <th scope="col">{{ t()('standings.pair') }}</th>
                  <th scope="col">{{ t()('standings.wins') }}</th>
                  <th scope="col">{{ t()('standings.diff') }}</th>
                  <th scope="col">{{ t()('standings.points') }}</th>
                  <th scope="col">{{ t()('standings.played') }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of group.rows; track row.players[0].id + row.players[1].id) {
                  <tr>
                    <td>
                      <span class="numeric muted">{{ row.rank }}</span>
                    </td>
                    <td>
                      <span class="pair">
                        {{ row.players[0].fullName }} / {{ row.players[1].fullName }}
                      </span>
                    </td>
                    <td class="numeric strong">{{ row.wins }}</td>
                    <td class="numeric">{{ row.diff > 0 ? '+' + row.diff : row.diff }}</td>
                    <td class="numeric">{{ row.pointsFor }}</td>
                    <td class="numeric">{{ row.played }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>
    }

    @for (stage of knockout(); track stage.id) {
      <section class="stack stack--2">
        <h3>{{ stage.name }}</h3>
        @for (item of stage.matches; track item.match.id) {
          <article class="glass card--tight knockout">
            @if (stage.showHeadings) {
              <p class="knockout__label">{{ item.heading }}</p>
            }
            <div class="knockout__board">
              <div
                class="knockout__row"
                [class.knockout__row--win]="winner(item.match) === 'A'"
                [style.grid-template-columns]="scoreColumns(setCount(item.games))"
              >
                <span class="knockout__name">{{ pairLabel(item.match, 'A') }}</span>
                @for (game of extraSets(item.games); track $index) {
                  <span
                    class="knockout__pts"
                    [class.knockout__pts--win]="game.scoreA > game.scoreB"
                  >
                    {{ game.scoreA }}
                  </span>
                }
                <span class="knockout__sum">{{ score(item.match, 'A') }}</span>
              </div>
              <div
                class="knockout__row"
                [class.knockout__row--win]="winner(item.match) === 'B'"
                [style.grid-template-columns]="scoreColumns(setCount(item.games))"
              >
                <span class="knockout__name">{{ pairLabel(item.match, 'B') }}</span>
                @for (game of extraSets(item.games); track $index) {
                  <span
                    class="knockout__pts"
                    [class.knockout__pts--win]="game.scoreB > game.scoreA"
                  >
                    {{ game.scoreB }}
                  </span>
                }
                <span class="knockout__sum">{{ score(item.match, 'B') }}</span>
              </div>
            </div>
          </article>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    h3 {
      margin: 0;
      font-size: 15px;
    }

    h4 {
      margin: 0;
      font-size: 13px;
      font-weight: 650;
      color: var(--text-muted);
    }

    .podium {
      display: flex;
      flex-direction: column;
      padding: 4px 14px;
    }

    .podium__row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--divider);
    }

    .podium__row:first-child {
      border-top: none;
    }

    .pair {
      min-width: 0;
      color: var(--text-strong);
      font-weight: 600;
      line-height: 1.35;
    }

    .podium .pair {
      flex: 1;
    }

    .pair__sep {
      color: var(--text-faint);
      font-weight: 500;
    }

    .medal {
      flex-shrink: 0;
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      font-size: 12.5px;
      font-weight: 800;
      color: var(--ink-900);
      font-variant-numeric: tabular-nums;
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

    .knockout {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
    }

    .knockout__label {
      margin: 0;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .knockout__board {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .knockout__row {
      display: grid;
      width: 100%;
      column-gap: 8px;
      align-items: baseline;
    }

    .knockout__name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      color: var(--text-strong);
    }

    .knockout__pts {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum';
      font-size: 13px;
      color: var(--text-muted);
    }

    .knockout__pts--win {
      color: var(--text-strong);
      font-weight: 700;
    }

    .knockout__sum {
      text-align: right;
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      color: var(--text-strong);
    }

    .knockout__row--win .knockout__name,
    .knockout__row--win .knockout__sum {
      color: var(--accent-strong);
    }
  `,
})
export class PairResults {
  readonly teamStandings = input.required<TeamStandingRowDto[]>();
  readonly rounds = input.required<RoundDto[]>();
  readonly config = input<BracketConfig | null>(null);

  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly podium = computed(() => {
    const order = { gold: 0, silver: 1, bronze: 2 };
    return this.teamStandings()
      .filter((row) => row.medal)
      .sort((a, b) => (order[a.medal!] ?? 9) - (order[b.medal!] ?? 9));
  });

  protected readonly groups = computed((): GroupTable[] => {
    const rows = this.teamStandings();
    if (rows.length === 0) return [];
    const byGroup = new Map<number, TeamStandingRowDto[]>();
    for (const row of rows) {
      const list = byGroup.get(row.groupIndex) ?? [];
      list.push(row);
      byGroup.set(row.groupIndex, list);
    }
    const indexes = [...byGroup.keys()].sort((a, b) => a - b);
    const many = indexes.length > 1 || (this.config()?.groupCount ?? 1) > 1;
    return indexes.map((index) => ({
      title: many
        ? this.i18n.translate('standings.groupN', { number: index + 1 })
        : this.i18n.translate('standings.groupStage'),
      rows: (byGroup.get(index) ?? []).slice().sort((a, b) => a.rank - b.rank),
    }));
  });

  protected readonly knockout = computed((): KnockoutStageView[] => {
    const config = this.config();
    const matches = flattenMatches(this.rounds()).filter(
      (match) => match.stage === 'playoff' || match.stage === 'consolation',
    );
    if (matches.length === 0) return [];
    const bySlot = new Map(matches.map((match) => [match.bracketSlot ?? match.id, match]));
    const used = new Set<string>();
    const stages: KnockoutStageView[] = [];

    for (const stage of config?.stages ?? []) {
      const items: KnockoutItem[] = [];
      for (const slot of stage.slots) {
        const match = bySlot.get(slot.id);
        if (!match) continue;
        used.add(match.id);
        items.push({
          heading: slotHeading(config!, slot.id),
          match,
          games: playedGames(match),
        });
      }
      if (items.length > 0) {
        stages.push({
          id: stage.id,
          name: displayStageName(stage.name),
          kind: stage.kind,
          showHeadings: items.length > 1,
          matches: items,
        });
      }
    }

    const leftover = matches.filter((match) => !used.has(match.id));
    if (leftover.length > 0) {
      stages.push({
        id: 'other',
        name: this.i18n.translate('standings.results'),
        kind: 'other',
        showHeadings: leftover.length > 1,
        matches: leftover.map((match) => ({
          heading: config && match.bracketSlot ? slotHeading(config, match.bracketSlot) : '',
          match,
          games: playedGames(match),
        })),
      });
    }
    const kindOrder = { playoff: 0, consolation: 1, other: 2 };
    return stages.sort((left, right) => {
      if (left.kind !== right.kind) return kindOrder[left.kind] - kindOrder[right.kind];
      if (left.kind !== 'consolation') return 0;
      return consolationOrder(left.name) - consolationOrder(right.name);
    });
  });

  protected pairLabel(match: MatchDto, side: 'A' | 'B'): string {
    return pairLabel(match, side, this.i18n.translate('standings.tbd'));
  }

  /** Серия — колонки по сетам; один гейм не дублируем, остаётся крупный счёт. */
  protected extraSets(games: readonly { scoreA: number; scoreB: number }[]) {
    return games.length > 1 ? games : [];
  }

  protected setCount(games: readonly { scoreA: number; scoreB: number }[]): number {
    return this.extraSets(games).length;
  }

  protected scoreColumns(games: number): string {
    const count = Math.max(0, games);
    if (count === 0) return 'minmax(0, 1fr) auto';
    return `minmax(0, 1fr) repeat(${count}, 2.85ch) auto`;
  }

  protected score(match: MatchDto, side: 'A' | 'B'): string {
    const value = side === 'A' ? match.teamA.score : match.teamB.score;
    return value === null ? '—' : String(value);
  }

  protected winner(match: MatchDto): 'A' | 'B' | null {
    if (match.status !== 'finished' || match.teamA.score === null || match.teamB.score === null) {
      return null;
    }
    if (match.teamA.score > match.teamB.score) return 'A';
    if (match.teamB.score > match.teamA.score) return 'B';
    return null;
  }

  protected medalRank(medal: 'gold' | 'silver' | 'bronze'): number {
    return medal === 'gold' ? 1 : medal === 'silver' ? 2 : 3;
  }

  protected medalLabel(medal: 'gold' | 'silver' | 'bronze'): string {
    if (medal === 'gold') return this.i18n.translate('standings.medalGold');
    if (medal === 'silver') return this.i18n.translate('standings.medalSilver');
    return this.i18n.translate('standings.medalBronze');
  }
}
