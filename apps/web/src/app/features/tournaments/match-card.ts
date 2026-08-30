import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  gameScoreIssue,
  gameSettingsForMatch,
  knownSlotHeading,
  seriesScoreIssue,
  type MatchDto,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { TelegramService } from '../../core/telegram';
import { TournamentStore } from '../../core/tournament-store';
import { Avatar } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';
import { ScoreTick } from '../../ui/motion';

function seriesSlotCount(winsToTake: number): number {
  return Math.max(1, winsToTake * 2 - 1);
}

function padSeriesGames(
  games: readonly { scoreA: number; scoreB: number }[],
  winsToTake: number,
): { scoreA: number; scoreB: number }[] {
  const max = seriesSlotCount(winsToTake);
  const next = games.slice(0, max).map((game) => ({ ...game }));
  while (next.length < max) next.push({ scoreA: 0, scoreB: 0 });
  return next;
}

/**
 * Карточка корта.
 *
 * Счёт можно вводить, пока раунд идёт (running/paused) или уже завершён.
 * Сохранение на сервере сразу помечает матч finished.
 */
@Component({
  selector: 'app-match-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RatingChip, ScoreTick],
  host: {
    '[class.card--live]': "match().status === 'running'",
    '[class.card--done]': "match().status === 'finished' || match().status === 'skipped'",
  },
  template: `
    <div
      class="glass glass--plain card--tight court"
      [class.court--finished]="match().status === 'finished' || match().status === 'skipped'"
    >
      <div class="row row--between">
        <span class="court__label">{{ courtLabel() }}</span>

        <div class="row court__status">
          @switch (match().status) {
            @case ('running') {
              <span class="chip chip--go animate-pop">{{ t()('match.started') }}</span>
            }
            @case ('paused') {
              <span class="chip chip--accent">{{ t()('match.paused') }}</span>
            }
            @case ('finished') {
              <span class="chip">{{ t()('match.finishedLabel') }}</span>
            }
            @case ('skipped') {
              <span class="chip">{{ t()('match.skippedLabel') }}</span>
            }
            @default {
              <span class="chip">{{ t()('match.waiting') }}</span>
            }
          }
        </div>
      </div>

      <div class="teams">
        @for (team of [match().teamA, match().teamB]; track $index; let first = $first) {
          <div class="team" [class.team--winner]="isWinner(first)">
            <div class="team__players">
              @for (player of team.players; track player.id) {
                <div class="team__player">
                  <app-avatar [player]="player" [size]="30" />
                  <span class="truncate">{{ player.fullName }}</span>
                  <app-rating-chip [player]="player" [showLabel]="false" [compact]="true" />
                </div>
              }
            </div>

            @if (scoreEntry() && !isSeries()) {
              <div class="score-editor">
                <button
                  type="button"
                  class="step"
                  [attr.aria-label]="'-1'"
                  (click)="bump(first, -1)"
                >
                  −
                </button>
                <app-score-tick class="score" [value]="first ? draftA() : draftB()" />
                <button
                  type="button"
                  class="step"
                  [attr.aria-label]="'+1'"
                  (click)="bump(first, 1)"
                >
                  +
                </button>
              </div>
            } @else {
              <app-score-tick
                class="score"
                [class.score--empty]="team.score === null"
                [value]="team.score"
              />
            }
          </div>
        }
      </div>

      @if (isSeries() && (scoreEntry() || hasScore())) {
        <p class="tiny center muted">
          {{ t()('match.series', { a: seriesWins().a, b: seriesWins().b }) }}
        </p>
        @for (game of gameSlots(); track $index; let index = $index) {
          <div class="row row--between game-row">
            <span class="tiny faint">{{ t()('match.game', { number: index + 1 }) }}</span>
            @if (scoreEntry()) {
              <div class="score-editor">
                <button type="button" class="step" (click)="bumpGame(index, 'a', -1)">−</button>
                <app-score-tick class="score score--game" [value]="game.scoreA" />
                <button type="button" class="step" (click)="bumpGame(index, 'a', 1)">+</button>
                <span class="tiny faint">:</span>
                <button type="button" class="step" (click)="bumpGame(index, 'b', -1)">−</button>
                <app-score-tick class="score score--game" [value]="game.scoreB" />
                <button type="button" class="step" (click)="bumpGame(index, 'b', 1)">+</button>
              </div>
            } @else {
              <span class="numeric strong">{{ game.scoreA }}:{{ game.scoreB }}</span>
            }
          </div>
        }
      }

      @if (scoreEntry() && !isSeries()) {
        <div class="presets">
          @for (preset of presets(); track preset[0] + ':' + preset[1]) {
            <button
              type="button"
              class="preset"
              [disabled]="busy()"
              (click)="applyPreset(preset[0], preset[1])"
            >
              {{ preset[0] }}:{{ preset[1] }}
            </button>
          }
        </div>
        <div class="row">
          @if (hasScore() && editing()) {
            <button type="button" class="btn btn--sm btn--glass grow" (click)="cancelEditing()">
              {{ t()('common.cancel') }}
            </button>
          }
          <button
            type="button"
            class="btn btn--sm btn--primary grow"
            [disabled]="!scoreValid() || busy()"
            (click)="save()"
          >
            {{ t()('score.save') }}
          </button>
        </div>
        @if (scoreHint(); as hint) {
          <p class="tiny center" style="color: var(--danger)">{{ hint }}</p>
        }
      } @else if (scoreEntry() && isSeries()) {
        <div class="row">
          @if (hasScore() && editing()) {
            <button type="button" class="btn btn--sm btn--glass grow" (click)="cancelEditing()">
              {{ t()('common.cancel') }}
            </button>
          }
          <button
            type="button"
            class="btn btn--sm btn--primary grow"
            [disabled]="!scoreValid() || busy()"
            (click)="save()"
          >
            {{ t()('score.save') }}
          </button>
        </div>
        @if (scoreHint(); as hint) {
          <p class="tiny center" style="color: var(--danger)">{{ hint }}</p>
        }
      } @else if (canManage() && match().status === 'scheduled') {
        @if (store.isFixedPairs()) {
          <button
            type="button"
            class="btn btn--sm btn--go btn--block"
            [disabled]="busy() || store.matchPlayersBusy(match())"
            (click)="store.startMatch(match())"
          >
            {{ t()('match.startMatch') }}
          </button>
          @if (store.matchPlayersBusy(match())) {
            <p class="tiny center muted">{{ t()('match.playersBusy') }}</p>
          }
        } @else {
          <p class="tiny center muted">{{ t()('match.roundNotStarted') }}</p>
        }
      } @else if (canManage() && match().status === 'finished' && hasScore()) {
        <button type="button" class="btn btn--sm btn--glass btn--block" (click)="startEditing()">
          {{ t()('score.edit') }}
        </button>
      }
    </div>
  `,
  styles: `
    .court {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    :host(.card--live) .court {
      border-color: color-mix(in srgb, var(--success) 50%, transparent);
      animation: match-start 320ms var(--ease-spring) both;
    }

    :host(.card--done) .team:not(.team--winner) {
      opacity: 0.55;
      transition: opacity 280ms var(--ease-out);
    }

    .court--finished {
      opacity: 0.98;
    }

    .court__label {
      font-family: var(--font-display);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
    }

    .court__status {
      gap: var(--space-2);
    }

    .teams {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .team {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--glass-bg-subtle);
    }

    .team--winner {
      background: var(--success-soft);
      animation: winner-in 300ms var(--ease-spring) both;
    }

    .team__players {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .team__player {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-strong);
    }

    .team__player span {
      flex: 1 1 auto;
    }

    .score {
      font-family: var(--font-display);
      font-size: 28px;
      font-weight: 800;
      line-height: 1;
      color: var(--text-strong);
      min-width: 40px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .score :deep(.score-tick) {
      font-size: inherit;
      color: inherit;
    }

    .score--game {
      font-size: 18px;
      min-width: 28px;
    }

    .score-editor {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .step {
      width: 34px;
      height: 34px;
      flex: 0 0 auto;
      border: 1px solid var(--control-border);
      border-radius: 50%;
      background: var(--control-bg);
      font-size: 17px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      transition: transform var(--duration-fast) var(--ease-spring);
    }

    .step:active {
      transform: scale(0.92);
    }

    .presets {
      display: flex;
      flex-wrap: nowrap;
      gap: var(--space-2);
      justify-content: center;
    }

    .preset {
      flex: 1 1 0;
      min-width: 0;
      min-height: 36px;
      padding: 6px 8px;
      border: 1px solid var(--control-border);
      border-radius: var(--radius-full);
      background: var(--control-bg);
      color: var(--text-strong);
      font-size: 14px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }

    .preset:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .preset:active:not(:disabled) {
      transform: scale(0.96);
      background: var(--accent-soft);
      border-color: transparent;
      color: var(--accent-strong);
    }
  `,
})
export class MatchCard {
  private readonly telegram = inject(TelegramService);
  private readonly i18n = inject(I18nService);
  private closeGuard: (() => void) | null = null;

  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;

  readonly match = input.required<MatchDto>();

  protected readonly editing = signal(false);
  protected readonly draftA = signal(0);
  protected readonly draftB = signal(0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.releaseClosingGuard());
    effect(() => {
      if (this.editing()) this.holdClosingGuard();
      else this.releaseClosingGuard();
    });
    effect(() => {
      const match = this.match();
      if (this.editing()) return;
      if (match.games?.length) {
        this.draftGames.set(padSeriesGames(match.games, match.winsToTake));
      } else {
        this.draftGames.set(
          padSeriesGames(
            [{ scoreA: this.pointsToWin(), scoreB: 0 }],
            match.winsToTake,
          ),
        );
      }
      if (match.teamA.score === null && match.teamB.score === null) {
        this.draftA.set(this.pointsToWin());
        this.draftB.set(0);
        return;
      }
      this.draftA.set(match.teamA.score ?? 0);
      this.draftB.set(match.teamB.score ?? 0);
    });
  }

  protected readonly canManage = this.store.canManage;
  protected readonly gameSettings = computed(() => {
    const tournament = this.store.tournament();
    const config = tournament?.bracketConfig ?? null;
    if (config) return gameSettingsForMatch(config, this.match());
    return {
      winsToTake: 1,
      pointsToWin: tournament?.pointsToWin ?? 11,
      winByTwo: false,
    };
  });
  protected readonly courtLabel = computed(() => {
    const match = this.match();
    const court = this.i18n.court(match.courtName);
    const config = this.store.tournament()?.bracketConfig;
    const heading =
      config && match.bracketSlot ? knownSlotHeading(config, match.bracketSlot) : null;
    return heading ? `${court} · ${heading}` : court;
  });
  protected readonly isSeries = computed(() => this.match().winsToTake > 1);
  protected readonly draftGames = signal<{ scoreA: number; scoreB: number }[]>([]);
  protected readonly gameSlots = computed(() => {
    if (!this.isSeries()) return [];
    if (this.scoreEntry()) return this.draftGames();
    return this.match().games ?? [];
  });
  protected readonly seriesWins = computed(() => {
    const games = this.scoreEntry() ? this.draftGames() : (this.match().games ?? []);
    let a = 0;
    let b = 0;
    for (const game of games) {
      if (game.scoreA > game.scoreB) a += 1;
      else if (game.scoreB > game.scoreA) b += 1;
    }
    return { a, b };
  });
  protected readonly busy = computed(() => this.store.isBusy(`match:${this.match().id}`));
  protected readonly hasScore = computed(
    () => this.match().teamA.score !== null && this.match().teamB.score !== null,
  );

  /**
   * Ввод счёта во время раунда и после него.
   * У scheduled / skipped — только подсказка или ничего.
   */
  protected readonly scoreEntry = computed(() => {
    if (!this.canManage()) return false;
    const status = this.match().status;
    if (status !== 'running' && status !== 'paused' && status !== 'finished') return false;
    return this.editing() || !this.hasScore();
  });

  protected readonly pointsToWin = computed(() => this.gameSettings().pointsToWin);

  /**
   * Четыре быстрых счёта: победа до лимита, близкий (минус 2) и более спокойный
   * (минус 4). Для игры до 11 это 11:9 / 11:7, для 15 — 15:13 / 15:11.
   */
  protected readonly presets = computed(() => {
    const win = this.pointsToWin();
    const close = Math.max(0, win - 2);
    const stretch = Math.max(0, win - 4);
    const pairs: Array<[number, number]> = [
      [win, close],
      [win, stretch],
      [stretch, win],
      [close, win],
    ];
    const seen = new Set<string>();
    return pairs.filter(([a, b]) => {
      if (a === b) return false;
      const key = `${a}:${b}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  protected readonly scoreIssue = computed(() => {
    const settings = this.gameSettings();
    if (this.isSeries()) {
      return seriesScoreIssue(this.draftGames(), {
        ...settings,
        winsToTake: this.match().winsToTake,
      });
    }
    const timed = (this.store.tournament()?.matchDurationMin ?? 0) > 0;
    if (this.store.isFixedPairs() || !timed) {
      return gameScoreIssue(this.draftA(), this.draftB(), settings);
    }
    const tieAllowed = this.store.tournament()?.tieRule === 'draw';
    if (this.draftA() === this.draftB() && !tieAllowed) return 'tie';
    return null;
  });

  protected readonly scoreValid = computed(() => this.scoreIssue() === null);

  protected readonly scoreHint = computed(() => {
    const issue = this.scoreIssue();
    if (!issue) return null;
    if (issue === 'tie') return this.i18n.translate('score.tieNotAllowed');
    if (issue === 'winByTwo') return this.i18n.translate('score.needWinByTwo');
    if (issue === 'incomplete' || issue === 'extra') return null;
    return this.i18n.translate('score.needPoints', { points: this.pointsToWin() });
  });

  protected isWinner(first: boolean): boolean {
    const { teamA, teamB } = this.match();
    if (teamA.score === null || teamB.score === null) return false;
    return first ? teamA.score > teamB.score : teamB.score > teamA.score;
  }

  protected startEditing(): void {
    const match = this.match();
    this.draftA.set(match.teamA.score ?? this.pointsToWin());
    this.draftB.set(match.teamB.score ?? 0);
    this.draftGames.set(padSeriesGames(match.games ?? this.draftGames(), match.winsToTake));
    this.editing.set(true);
  }

  protected cancelEditing(): void {
    const match = this.match();
    this.draftA.set(match.teamA.score ?? 0);
    this.draftB.set(match.teamB.score ?? 0);
    this.editing.set(false);
  }

  protected bump(first: boolean, delta: number): void {
    this.telegram.tap();
    const target = first ? this.draftA : this.draftB;
    target.update((value) => Math.max(0, Math.min(200, value + delta)));
    this.editing.set(true);
  }

  protected applyPreset(a: number, b: number): void {
    this.telegram.tap();
    this.draftA.set(a);
    this.draftB.set(b);
    this.editing.set(true);
  }

  protected bumpGame(index: number, side: 'a' | 'b', delta: number): void {
    this.telegram.tap();
    const winsToTake = this.match().winsToTake;
    this.draftGames.update((games) => {
      const next = padSeriesGames(games, winsToTake);
      const game = next[index] ?? { scoreA: 0, scoreB: 0 };
      if (side === 'a') game.scoreA = Math.max(0, Math.min(200, game.scoreA + delta));
      else game.scoreB = Math.max(0, Math.min(200, game.scoreB + delta));
      next[index] = game;
      return next;
    });
    this.editing.set(true);
  }

  protected async save(): Promise<void> {
    if (!this.scoreValid()) return;
    if (this.isSeries()) {
      const settings = this.gameSettings();
      const finished: { scoreA: number; scoreB: number }[] = [];
      const need = this.match().winsToTake;
      let winsA = 0;
      let winsB = 0;
      for (const game of this.draftGames()) {
        if (winsA === need || winsB === need) break;
        if (gameScoreIssue(game.scoreA, game.scoreB, settings)) continue;
        finished.push(game);
        if (game.scoreA > game.scoreB) winsA += 1;
        else winsB += 1;
      }
      await this.store.setScore(this.match(), winsA, winsB, finished);
    } else {
      await this.store.setScore(this.match(), this.draftA(), this.draftB());
    }
    this.editing.set(false);
  }

  private holdClosingGuard(): void {
    if (this.closeGuard) return;
    this.closeGuard = this.telegram.acquireClosingConfirmation();
  }

  private releaseClosingGuard(): void {
    this.closeGuard?.();
    this.closeGuard = null;
  }
}
