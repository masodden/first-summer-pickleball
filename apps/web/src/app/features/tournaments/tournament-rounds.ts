import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ClockService, elapsedMs, formatClock } from '../../core/clock';
import { ConfirmService } from '../../core/confirm';
import { I18nService } from '../../core/i18n';
import { TournamentStore } from '../../core/tournament-store';
import { Ball, Racket } from '../../ui/ball';
import { PlayerLine } from '../../ui/player-line';
import { MatchCard } from './match-card';

/**
 * Вкладка «Игры».
 *
 * Все корты раунда видны одновременно — организатор ведёт их параллельно, не
 * листая экраны. По раундам можно ходить свободно: в americano расписание
 * известно заранее, поэтому игроки заранее смотрят, с кем и когда играют.
 */
@Component({
  selector: 'app-tournament-rounds',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatchCard, PlayerLine, Ball, Racket],
  template: `
    @if (tournament(); as item) {
      @if (store.roundCount() === 0) {
        <div class="glass card empty-state">
          <app-racket [size]="56" [swing]="true" />
          <h3>{{ t()('match.noRounds') }}</h3>
          @if (store.canManage()) {
            <p class="small">
              {{ store.canStart() ? t()('tournament.startHint') : t()('checkin.notAllConfirmed') }}
            </p>
            <button
              type="button"
              class="btn btn--go"
              [disabled]="!store.canStart() || store.isBusy('start')"
              (click)="start()"
            >
              {{ t()('match.generateSchedule') }}
            </button>
          }
        </div>
      } @else {
        <div class="stack stack--4">
          <div class="glass glass--subtle card--tight stack stack--3">
            <div class="row row--between">
              <button
                type="button"
                class="btn btn--icon btn--glass"
                [disabled]="store.viewRound() === 0"
                [attr.aria-label]="t()('match.previousRound')"
                (click)="store.showRound(store.viewRound() - 1)"
              >
                <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
                  <path d="M14 6l-6 6 6 6" />
                </svg>
              </button>

              <div class="center stack stack--1">
                <span class="strong">
                  {{
                    plannedRounds()
                      ? t()('match.roundOf', {
                          index: store.viewRound() + 1,
                          total: plannedRounds() ?? 0,
                        })
                      : t()('match.round', { index: store.viewRound() + 1 })
                  }}
                </span>
                @if (roundStatus(); as status) {
                  <span class="tiny muted">{{ status }}</span>
                }
              </div>

              <button
                type="button"
                class="btn btn--icon btn--glass"
                [disabled]="store.viewRound() >= store.roundCount() - 1"
                [attr.aria-label]="t()('common.next')"
                (click)="store.showRound(store.viewRound() + 1)"
              >
                <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
                  <path d="M10 6l6 6-6 6" />
                </svg>
              </button>
            </div>

            <div class="row scroll-x pills">
              @for (round of store.rounds(); track round.index) {
                <button
                  type="button"
                  class="pill"
                  [class.pill--active]="round.index === store.viewRound()"
                  [class.pill--done]="round.closed"
                  [class.pill--skipped]="round.skipped"
                  (click)="store.showRound(round.index)"
                >
                  {{ round.index + 1 }}
                </button>
              }
            </div>

            <!-- Один свисток на все корты: раунд стартует и заканчивается целиком. -->
            <div class="row round-control">
              <div class="stack stack--1 grow">
                <span
                  class="round-clock numeric"
                  [class.round-clock--running]="store.roundState() === 'running'"
                  [class.round-clock--over]="overtime()"
                >
                  {{ clockLabel() }}
                </span>
                @if (overtime()) {
                  <span class="tiny" style="color: var(--danger)">{{ t()('match.timeUpHint') }}</span>
                } @else if (
                  store.canRunRound() &&
                  (store.roundState() === 'scheduled' || store.roundState() === 'skipped') &&
                  !store.previousRoundClosed()
                ) {
                  <span class="tiny muted">{{ t()('match.roundWaitingPrevious') }}</span>
                } @else if (store.canRunRound() && store.otherRoundLive()) {
                  <span class="tiny muted">{{ t()('match.roundWaitingLive') }}</span>
                }
              </div>

              @if (store.canRunRound()) {
                @switch (store.roundState()) {
                  @case ('scheduled') {
                    @if (!store.isMexicano()) {
                      <button
                        type="button"
                        class="btn btn--icon btn--glass"
                        [disabled]="!store.canSkipViewedRound() || store.isBusy('round:skip')"
                        [attr.aria-label]="t()('match.skipRound')"
                        (click)="skipRound()"
                      >
                        <svg viewBox="0 0 24 24" class="icon icon--solid" aria-hidden="true">
                          <path d="M5 5.5v13l9-6.5z" />
                          <rect x="16" y="5" width="3" height="14" rx="1" />
                        </svg>
                      </button>
                    }
                    <button
                      type="button"
                      class="btn btn--icon btn--go"
                      [disabled]="!store.canStartViewedRound() || store.isBusy('round:start')"
                      [attr.aria-label]="t()('match.startRound')"
                      (click)="store.startRound()"
                    >
                      <svg viewBox="0 0 24 24" class="icon icon--solid" aria-hidden="true">
                        <path d="M8 5.5v13l11-6.5z" />
                      </svg>
                    </button>
                    @if (store.isMexicano() && store.canFinish()) {
                      <button
                        type="button"
                        class="btn btn--glass"
                        [disabled]="store.isBusy('finish')"
                        (click)="finish()"
                      >
                        {{ t()('tournament.finishShort') }}
                      </button>
                    }
                  }
                  @case ('finished') {
                    @if (store.isMexicano() && store.canFinish()) {
                      <button
                        type="button"
                        class="btn btn--primary"
                        [disabled]="store.isBusy('finish')"
                        (click)="finish()"
                      >
                        {{ t()('tournament.finishShort') }}
                      </button>
                    }
                  }
                  @case ('skipped') {
                    <button
                      type="button"
                      class="btn btn--icon btn--glass"
                      [disabled]="!store.canUnskipViewedRound() || store.isBusy('round:unskip')"
                      [attr.aria-label]="t()('match.unskipRound')"
                      (click)="unskipRound()"
                    >
                      <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
                        <path d="M9 15l-5-5 5-5" />
                        <path d="M4 10h10a5 5 0 010 10H9" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="btn btn--icon btn--go"
                      [disabled]="!store.canStartViewedRound() || store.isBusy('round:start')"
                      [attr.aria-label]="t()('match.startRound')"
                      (click)="store.startRound()"
                    >
                      <svg viewBox="0 0 24 24" class="icon icon--solid" aria-hidden="true">
                        <path d="M8 5.5v13l11-6.5z" />
                      </svg>
                    </button>
                  }
                  @case ('running') {
                    <button
                      type="button"
                      class="btn btn--icon btn--glass"
                      [disabled]="store.isBusy('round:pause')"
                      [attr.aria-label]="t()('match.pause')"
                      (click)="store.pauseRound()"
                    >
                      <svg viewBox="0 0 24 24" class="icon icon--solid" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="btn btn--primary"
                      [disabled]="store.isBusy('round:finish')"
                      (click)="store.finishRound()"
                    >
                      {{ t()('match.finishRound') }}
                    </button>
                  }
                  @case ('paused') {
                    <button
                      type="button"
                      class="btn btn--icon btn--go"
                      [disabled]="store.isBusy('round:start')"
                      [attr.aria-label]="t()('match.resume')"
                      (click)="store.startRound()"
                    >
                      <svg viewBox="0 0 24 24" class="icon icon--solid" aria-hidden="true">
                        <path d="M8 5.5v13l11-6.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="btn btn--primary"
                      [disabled]="store.isBusy('round:finish')"
                      (click)="store.finishRound()"
                    >
                      {{ t()('match.finishRound') }}
                    </button>
                  }
                }
              }
            </div>

            @if (store.canManage() && store.canReshuffle()) {
              <button type="button" class="btn btn--sm btn--glass btn--block" (click)="reshuffle()">
                {{ t()('match.reshuffle') }}
              </button>
            }
          </div>

          @if (store.currentRound(); as round) {
            <div class="stack stack--3">
              @for (match of round.matches; track match.id) {
                <app-match-card [match]="match" />
              }
            </div>

            @if (round.sittingOut.length > 0) {
              <section class="glass glass--subtle card--tight stack stack--2">
                <span class="tiny faint">{{ t()('match.sittingOut') }}</span>
                @for (player of round.sittingOut; track player.id) {
                  <app-player-line [player]="player" [avatarSize]="30" [showRating]="true" />
                }
              </section>
            }

            <section class="stack stack--2">
              @if (!round.allScored) {
                <p class="tiny center muted">{{ t()('match.roundNotScored') }}</p>
              }

              @if (store.isLastGeneratedRound()) {
                @if (store.canManage() && store.canCreateNextRound()) {
                  <div class="stack stack--2">
                    <button
                      type="button"
                      class="btn btn--primary btn--block"
                      [class.btn--lg]="!(store.isMexicano() && store.canFinish())"
                      [disabled]="store.isBusy('next-round')"
                      (click)="store.createNextRound()"
                    >
                      {{ isMexicano() ? t()('match.createNextRound') : t()('match.nextRound') }}
                    </button>
                    @if (store.isMexicano() && store.canFinish()) {
                      <button
                        type="button"
                        class="btn btn--glass btn--block"
                        [disabled]="store.isBusy('finish')"
                        (click)="finish()"
                      >
                        {{ t()('tournament.finish') }}
                      </button>
                    }
                  </div>
                } @else if (allDone()) {
                  <div class="glass card--tight row">
                    <app-ball [size]="26" motion="bounce" />
                    <span class="grow strong">{{ t()('match.allRoundsDone') }}</span>
                    @if (store.canManage() && store.canFinish()) {
                      <button
                        type="button"
                        class="btn btn--sm btn--primary"
                        [disabled]="store.isBusy('finish')"
                        (click)="finish()"
                      >
                        {{ t()('tournament.finish') }}
                      </button>
                    }
                  </div>
                }
              } @else {
                <button
                  type="button"
                  class="btn btn--glass btn--block"
                  (click)="store.showRound(store.viewRound() + 1)"
                >
                  {{ t()('match.nextRound') }}
                </button>
              }
            </section>
          }
        </div>
      }
    }
  `,
  styles: `
    .icon {
      width: 17px;
      height: 17px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .icon--solid {
      fill: currentColor;
      stroke: none;
    }

    .pills {
      gap: var(--space-2);
      padding-bottom: 2px;
    }

    .pill {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      flex: 0 0 auto;
      border: 1px solid var(--control-border);
      border-radius: 50%;
      background: var(--control-bg);
      font-size: 13px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition:
        background var(--duration-fast) ease,
        transform var(--duration-fast) var(--ease-spring);
    }

    .pill:active {
      transform: scale(0.94);
    }

    .pill--done {
      color: var(--success);
      border-color: color-mix(in srgb, var(--success) 45%, transparent);
    }

    .pill--skipped {
      color: var(--text-muted);
      border-style: dashed;
    }

    .pill--active {
      background: linear-gradient(160deg, var(--clay-400), var(--clay-600));
      border-color: transparent;
      color: #fff;
    }

    .pill--active.pill--skipped {
      border-style: solid;
    }

    .round-control {
      gap: var(--space-2);
      align-items: center;

      /* Иконки play/pause — 40px; текстовые рядом должны совпадать по высоте. */
      > .btn:not(.btn--icon) {
        min-height: 40px;
        height: 40px;
        padding: 0 var(--space-4);
        font-size: 13.5px;
      }
    }

    .round-clock {
      font-family: var(--font-mono);
      font-size: 22px;
      font-weight: 700;
      color: var(--text-muted);
    }

    .round-clock--running {
      color: var(--text-strong);
    }

    .round-clock--over {
      color: var(--danger);
    }
  `,
})
export class TournamentRoundsTab {
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly clock = inject(ClockService);
  private readonly router = inject(Router);

  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;
  protected readonly tournament = this.store.tournament;
  protected readonly plannedRounds = this.store.plannedRounds;
  protected readonly isMexicano = this.store.isMexicano;

  protected readonly allDone = computed(() =>
    this.store.rounds().every((round) => round.allScored),
  );

  /** Время раунда: одно на все корты, считается от серверного старта. */
  private readonly elapsed = computed(() => {
    const match = this.store.timerMatch();
    return match ? elapsedMs(match, this.clock.now()) : 0;
  });

  /** До старта матчей лимит берём из настроек турнира: на табло сразу видно, сколько играть. */
  private readonly timeLimit = computed(() => {
    const fromMatch = this.store.timerMatch()?.durationMs;
    if (fromMatch !== undefined && fromMatch !== null) return fromMatch;
    const minutes = this.store.tournament()?.matchDurationMin ?? null;
    return minutes === null ? null : minutes * 60_000;
  });

  protected readonly overtime = computed(() => {
    const limit = this.timeLimit();
    const state = this.store.roundState();
    return (
      limit !== null &&
      this.elapsed() >= limit &&
      state !== 'finished' &&
      state !== 'skipped' &&
      state !== 'scheduled'
    );
  });

  /** Показываем остаток, а когда время вышло — сколько уже переиграли. */
  protected readonly clockLabel = computed(() => {
    const limit = this.timeLimit();
    if (limit === null) return formatClock(this.elapsed());
    const left = limit - this.elapsed();
    return left >= 0 ? formatClock(left) : `+${formatClock(-left)}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(this.clock.acquire());
  }

  protected readonly roundStatus = computed(() => {
    const round = this.store.currentRound();
    if (!round) return null;
    if (round.skipped) return this.i18n.translate('match.roundSkipped');
    if (round.allScored) return this.i18n.translate('match.finishedLabel');
    if (round.matches.some((match) => match.status === 'running')) {
      return this.i18n.translate('match.started');
    }
    return null;
  });

  protected async skipRound(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('match.skipRound'),
      message: this.i18n.translate('match.skipRoundConfirm'),
      confirmLabel: this.i18n.translate('match.skipRound'),
    });
    if (confirmed) await this.store.skipRound();
  }

  protected async unskipRound(): Promise<void> {
    await this.store.unskipRound();
  }

  protected async start(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('match.generateSchedule'),
      message: this.i18n.translate('tournament.startConfirm', {
        count: this.store.registered().length,
      }),
      confirmLabel: this.i18n.translate('match.generateSchedule'),
    });
    if (confirmed) await this.store.start();
  }

  protected async reshuffle(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('match.reshuffle'),
      message: this.i18n.translate('match.reshuffleConfirm'),
      confirmLabel: this.i18n.translate('match.reshuffle'),
    });
    if (confirmed) await this.store.reshuffle();
  }

  protected async finish(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('tournament.finish'),
      message: this.i18n.translate('tournament.finishConfirm'),
      confirmLabel: this.i18n.translate('tournament.finishShort'),
    });
    if (!confirmed) return;
    await this.store.finish();
    const id = this.store.tournament()?.id;
    if (id) await this.router.navigate(['/tournaments', id, 'standings']);
  }
}
