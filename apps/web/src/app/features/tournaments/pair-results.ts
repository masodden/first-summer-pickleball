import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  displayStageName,
  placementSlots,
  slotHeading,
  type BracketConfig,
  type MatchDto,
  type PlayerDto,
  type RoundDto,
  type TeamStandingRowDto,
  type TeamTieBreakKind,
  type TranslationKey,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { pairSeed } from './pair-seed';

interface PlaceRow {
  place: number;
  label: string | null;
  medal: 'gold' | 'silver' | 'bronze' | null;
}

interface GroupTable {
  title: string;
  rows: TeamStandingRowDto[];
  notes: string[];
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

function pairName(row: TeamStandingRowDto): string {
  return `${row.players[0].fullName} / ${row.players[1].fullName}`;
}

function pairNameFromPlayers(players: readonly PlayerDto[]): string {
  return players.map((player) => player.fullName).join(' / ');
}

function decidedSides(
  match: MatchDto,
): { winner: PlayerDto[]; loser: PlayerDto[] } | null {
  if (match.teamA.score === null || match.teamB.score === null) return null;
  if (match.teamA.players.length < 2 || match.teamB.players.length < 2) return null;
  if (match.teamA.score === match.teamB.score) return null;
  const aWon = match.teamA.score > match.teamB.score;
  return {
    winner: aWon ? match.teamA.players : match.teamB.players,
    loser: aWon ? match.teamB.players : match.teamA.players,
  };
}

function clusterAfter(rows: readonly TeamStandingRowDto[], start: number): TeamStandingRowDto[] {
  const head = rows[start];
  if (!head) return [];
  const cluster = [head];
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.wins !== head.wins) break;
    cluster.push(row);
  }
  return cluster;
}

const TIE_BREAK_KEY: Record<TeamTieBreakKind, TranslationKey> = {
  headToHead: 'standings.tie.headToHead',
  miniLeague: 'standings.tie.miniLeague',
  circularDiff: 'standings.tie.circularDiff',
  pointDiff: 'standings.tie.pointDiff',
  headToHeadDiff: 'standings.tie.headToHeadDiff',
  vsNextHighest: 'standings.tie.vsNextHighest',
  pointsFor: 'standings.tie.pointsFor',
};

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
 * Группы, плей-офф и итоговые места фиксированных пар.
 *
 * Медали не ставим в групповую таблицу: там место в группе, а 1–12
 * собираются из финала, бронзы и матчей за место.
 */
@Component({
  selector: 'app-pair-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (places().length > 0) {
      <section class="stack stack--2">
        <h3>{{ t()('standings.places') }}</h3>
        <div class="glass card--tight podium">
          @for (row of places(); track row.place) {
            <div class="podium__row">
              @if (row.medal && row.label) {
                <span
                  class="medal"
                  [class]="'medal--' + row.medal"
                  [title]="medalLabel(row.medal)"
                >
                  {{ row.place }}
                </span>
              } @else {
                <span class="place-num numeric muted">{{ row.place }}</span>
              }
              <span class="pair" [class.pair--empty]="!row.label">
                {{ row.label ?? t()('standings.tbd') }}
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
                        <span
                          class="seed"
                          [title]="t()('standings.seed', { n: row.seed })"
                        >[{{ row.seed }}]</span>
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
        @if (group.notes.length > 0) {
          <div class="stack stack--1 notes">
            @for (note of group.notes; track note) {
              <p class="tiny muted">{{ note }}</p>
            }
          </div>
        }
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
                <span class="knockout__name">
                  @if (seedOf(item.match, 'A'); as n) {
                    <span class="seed" [title]="t()('standings.seed', { n })">[{{ n }}]</span>
                  }
                  <span class="knockout__pair">{{ pairLabel(item.match, 'A') }}</span>
                </span>
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
                <span class="knockout__name">
                  @if (seedOf(item.match, 'B'); as n) {
                    <span class="seed" [title]="t()('standings.seed', { n })">[{{ n }}]</span>
                  }
                  <span class="knockout__pair">{{ pairLabel(item.match, 'B') }}</span>
                </span>
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

    .table .pair {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4em;
    }

    .seed {
      flex-shrink: 0;
      color: var(--text-faint);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum';
    }

    .podium .pair {
      flex: 1;
    }

    .pair--empty {
      color: var(--text-faint);
      font-weight: 500;
    }

    .place-num {
      width: 28px;
      text-align: center;
      flex-shrink: 0;
      font-weight: 700;
    }

    .pair__sep {
      color: var(--text-faint);
      font-weight: 500;
    }

    .notes {
      padding: 0 2px;
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
      display: flex;
      align-items: baseline;
      gap: 0.4em;
      min-width: 0;
      font-weight: 600;
      color: var(--text-strong);
    }

    .knockout__pair {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

  protected readonly places = computed((): PlaceRow[] => {
    const config = this.config();
    if (!config) return [];
    const slots = placementSlots(config);
    if (slots.length === 0) return [];
    const matches = flattenMatches(this.rounds()).filter(
      (match) => match.stage === 'playoff' || match.stage === 'consolation',
    );
    if (matches.length === 0) return [];
    const bySlot = new Map(matches.map((match) => [match.bracketSlot ?? '', match]));
    const maxPlace = Math.max(...slots.flatMap((slot) => [slot.winnerPlace, slot.loserPlace]));
    const rows: PlaceRow[] = Array.from({ length: maxPlace }, (_, index) => ({
      place: index + 1,
      label: null,
      medal: index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : null,
    }));
    for (const slot of slots) {
      const match = bySlot.get(slot.slotId);
      if (!match) continue;
      const decided = decidedSides(match);
      if (!decided) continue;
      const winner = rows[slot.winnerPlace - 1];
      const loser = rows[slot.loserPlace - 1];
      if (winner) winner.label = pairNameFromPlayers(decided.winner);
      if (loser) loser.label = pairNameFromPlayers(decided.loser);
    }
    return rows;
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
    return indexes.map((index) => {
      const ranked = (byGroup.get(index) ?? []).slice().sort((a, b) => a.rank - b.rank);
      return {
        title: many
          ? this.i18n.translate('standings.groupN', { number: index + 1 })
          : this.i18n.translate('standings.groupStage'),
        rows: ranked,
        notes: this.tieNotes(ranked),
      };
    });
  });

  private tieNotes(rows: readonly TeamStandingRowDto[]): string[] {
    const notes: string[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const kind = rows[index]?.tieBreak;
      if (!kind) continue;
      const cluster = clusterAfter(rows, index);
      if (cluster.length < 2) continue;
      const labels = cluster.map(pairName);
      notes.push(
        this.i18n.translate(TIE_BREAK_KEY[kind], {
          above: labels[0]!,
          below: labels[1] ?? '',
          pairs: this.pairList(labels),
          wins: cluster[0]!.wins,
        }),
      );
    }
    return notes;
  }

  private pairList(labels: readonly string[]): string {
    const and = this.i18n.locale() === 'en' ? 'and' : 'и';
    if (labels.length <= 1) return labels[0] ?? '';
    if (labels.length === 2) return `${labels[0]} ${and} ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')} ${and} ${labels[labels.length - 1]}`;
  }

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

  protected seedOf(match: MatchDto, side: 'A' | 'B'): number | null {
    const team = side === 'A' ? match.teamA : match.teamB;
    return pairSeed(this.teamStandings(), team.players);
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

  protected medalLabel(medal: 'gold' | 'silver' | 'bronze'): string {
    if (medal === 'gold') return this.i18n.translate('standings.medalGold');
    if (medal === 'silver') return this.i18n.translate('standings.medalSilver');
    return this.i18n.translate('standings.medalBronze');
  }
}
