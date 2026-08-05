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
import type { MatchDto } from '@fsp/shared';
import { ClockService, elapsedMs, formatClock } from '../../core/clock';
import { I18nService } from '../../core/i18n';
import { TelegramService } from '../../core/telegram';
import { TournamentStore } from '../../core/tournament-store';
import { Avatar } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';

/**
 * Карточка корта.
 *
 * Всё, что нужно на площадке, — на одном экране без переходов: кто играет,
 * сколько идёт игра, кнопки старта и паузы, ввод счёта. Таймер считается от
 * серверного времени старта, поэтому на всех устройствах он одинаковый, а
 * закончить игру можно только вручную — свисток даёт человек, а не секундомер.
 */
@Component({
  selector: 'app-match-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RatingChip],
  host: { '[class.card--live]': "match().status === 'running'" },
  template: `
    <div class="glass card--tight court" [class.court--finished]="match().status === 'finished'">
      <div class="row row--between">
        <span class="court__label">{{ t()('match.court', { number: match().court }) }}</span>

        <div class="row court__status">
          @if (timeLimit() !== null) {
            <span
              class="timer numeric"
              [class.timer--over]="overtime()"
              [class.timer--running]="match().status === 'running'"
            >
              {{ clockLabel() }}
            </span>
          }

          @switch (match().status) {
            @case ('running') {
              <span class="chip chip--go">{{ t()('match.started') }}</span>
            }
            @case ('paused') {
              <span class="chip chip--accent">{{ t()('match.paused') }}</span>
            }
            @case ('finished') {
              <span class="chip">{{ t()('match.finishedLabel') }}</span>
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
                  <app-rating-chip [player]="player" [showLabel]="false" />
                </div>
              }
            </div>

            @if (editing()) {
              <div class="score-editor">
                <button
                  type="button"
                  class="step"
                  [attr.aria-label]="'-1'"
                  (click)="bump(first, -1)"
                >
                  −
                </button>
                <span class="score numeric">{{ first ? draftA() : draftB() }}</span>
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
              <span class="score numeric" [class.score--empty]="team.score === null">
                {{ team.score ?? '—' }}
              </span>
            }
          </div>
        }
      </div>

      @if (editing()) {
        <div class="stack stack--2">
          <div class="row row--wrap presets">
            @for (preset of presets(); track preset[0] + ':' + preset[1]) {
              <button type="button" class="chip" (click)="setDraft(preset[0], preset[1])">
                {{ preset[0] }}:{{ preset[1] }}
              </button>
            }
          </div>
          <div class="row">
            <button type="button" class="btn btn--sm btn--glass grow" (click)="cancelEditing()">
              {{ t()('common.cancel') }}
            </button>
            <button
              type="button"
              class="btn btn--sm btn--primary grow"
              [disabled]="!scoreValid() || busy()"
              (click)="save()"
            >
              {{ t()('score.save') }}
            </button>
          </div>
          @if (!scoreValid()) {
            <p class="tiny center" style="color: var(--danger)">{{ t()('score.tieNotAllowed') }}</p>
          }
        </div>
      } @else if (canManage()) {
        <div class="row row--wrap actions">
          @switch (match().status) {
            @case ('scheduled') {
              <button
                type="button"
                class="btn btn--sm btn--go grow"
                [disabled]="busy()"
                (click)="start()"
              >
                {{ t()('match.start') }}
              </button>
            }
            @case ('running') {
              <button
                type="button"
                class="btn btn--sm btn--glass"
                [disabled]="busy()"
                (click)="store.pauseMatch(match())"
              >
                {{ t()('match.pause') }}
              </button>
              <button
                type="button"
                class="btn btn--sm btn--primary grow"
                [disabled]="busy()"
                (click)="finish()"
              >
                {{ t()('match.finish') }}
              </button>
            }
            @case ('paused') {
              <button
                type="button"
                class="btn btn--sm btn--go"
                [disabled]="busy()"
                (click)="store.startMatch(match())"
              >
                {{ t()('match.resume') }}
              </button>
              <button
                type="button"
                class="btn btn--sm btn--primary grow"
                [disabled]="busy()"
                (click)="finish()"
              >
                {{ t()('match.finish') }}
              </button>
            }
            @case ('finished') {
              <button type="button" class="btn btn--sm btn--glass grow" (click)="startEditing()">
                {{ hasScore() ? t()('score.edit') : t()('match.enterScore') }}
              </button>
            }
          }
        </div>
      }

      @if (overtime() && match().status === 'running') {
        <p class="tiny center muted">{{ t()('match.timeUpHint') }}</p>
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
    }

    .court--finished {
      opacity: 0.92;
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

    .timer {
      font-family: var(--font-mono);
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-muted);
    }

    .timer--running {
      color: var(--text-strong);
    }

    .timer--over {
      color: var(--danger);
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

    .score--empty {
      color: var(--text-faint);
      font-weight: 600;
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
      border: 1px solid var(--glass-border-strong);
      border-radius: 50%;
      background: var(--surface-input);
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
      gap: var(--space-2);
      justify-content: center;
    }

    .presets .chip {
      cursor: pointer;
    }

    .actions {
      gap: var(--space-2);
    }
  `,
})
export class MatchCard {
  private readonly clock = inject(ClockService);
  private readonly telegram = inject(TelegramService);
  private readonly i18n = inject(I18nService);

  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;

  readonly match = input.required<MatchDto>();

  protected readonly editing = signal(false);
  protected readonly draftA = signal(0);
  protected readonly draftB = signal(0);

  protected readonly canManage = this.store.canManage;
  protected readonly busy = computed(() => this.store.isBusy(`match:${this.match().id}`));
  protected readonly hasScore = computed(
    () => this.match().teamA.score !== null && this.match().teamB.score !== null,
  );
  protected readonly timeLimit = computed(() => this.match().durationMs);

  private readonly elapsed = computed(() => elapsedMs(this.match(), this.clock.now()));

  protected readonly overtime = computed(() => {
    const limit = this.timeLimit();
    return limit !== null && this.elapsed() >= limit;
  });

  /** Показываем остаток, а когда время вышло — сколько уже переиграли. */
  protected readonly clockLabel = computed(() => {
    const limit = this.timeLimit();
    if (limit === null) return formatClock(this.elapsed());
    const left = limit - this.elapsed();
    return left >= 0 ? formatClock(left) : `+${formatClock(-left)}`;
  });

  /** Частые исходы игры до N очков: одно касание вместо десяти нажатий «плюс». */
  protected readonly presets = computed<[number, number][]>(() => {
    const target = this.store.tournament()?.pointsToWin ?? 11;
    return [
      [target, Math.max(0, target - 5)],
      [target, Math.max(0, target - 2)],
      [Math.max(0, target - 5), target],
      [Math.max(0, target - 2), target],
    ];
  });

  protected readonly scoreValid = computed(() => {
    const tieAllowed = this.store.tournament()?.tieRule === 'draw';
    if (this.draftA() === this.draftB() && !tieAllowed) return false;
    return this.draftA() >= 0 && this.draftB() >= 0;
  });

  constructor() {
    const release = this.clock.acquire();
    inject(DestroyRef).onDestroy(release);

    // Пока идёт правка счёта, чужие обновления матча не сбрасывают черновик.
    effect(() => {
      const match = this.match();
      if (this.editing()) return;
      this.draftA.set(match.teamA.score ?? 0);
      this.draftB.set(match.teamB.score ?? 0);
    });
  }

  protected isWinner(first: boolean): boolean {
    const { teamA, teamB } = this.match();
    if (teamA.score === null || teamB.score === null) return false;
    return first ? teamA.score > teamB.score : teamB.score > teamA.score;
  }

  protected async start(): Promise<void> {
    this.telegram.tap('medium');
    await this.store.startMatch(this.match());
  }

  protected async finish(): Promise<void> {
    this.telegram.tap('medium');
    await this.store.finishMatch(this.match());
    // Сразу открываем ввод счёта: это следующий шаг организатора.
    if (!this.hasScore()) this.startEditing();
  }

  protected startEditing(): void {
    const match = this.match();
    const target = this.store.tournament()?.pointsToWin ?? 11;
    this.draftA.set(match.teamA.score ?? target);
    this.draftB.set(match.teamB.score ?? 0);
    this.editing.set(true);
  }

  protected cancelEditing(): void {
    this.editing.set(false);
  }

  protected bump(first: boolean, delta: number): void {
    this.telegram.tap();
    const target = first ? this.draftA : this.draftB;
    target.update((value) => Math.max(0, Math.min(200, value + delta)));
  }

  protected setDraft(a: number, b: number): void {
    this.telegram.tap();
    this.draftA.set(a);
    this.draftB.set(b);
  }

  protected async save(): Promise<void> {
    if (!this.scoreValid()) return;
    await this.store.setScore(this.match(), this.draftA(), this.draftB());
    this.editing.set(false);
  }
}
