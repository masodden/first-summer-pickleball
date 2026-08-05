import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConfirmService } from '../../core/confirm';
import { I18nService } from '../../core/i18n';
import { TournamentStore } from '../../core/tournament-store';
import { Ball, Racket } from '../../ui/ball';
import { PlayerLine } from '../../ui/player-line';
import { MatchCard } from './match-card';

/**
 * Вкладка «Корты».
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
              (click)="store.start()"
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
                  [class.pill--done]="round.allScored"
                  (click)="store.showRound(round.index)"
                >
                  {{ round.index + 1 }}
                </button>
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
                  <app-player-line [player]="player" [avatarSize]="30" />
                }
              </section>
            }

            <section class="stack stack--2">
              @if (!round.allScored) {
                <p class="tiny center muted">{{ t()('match.roundNotScored') }}</p>
              }

              @if (store.isLastGeneratedRound()) {
                @if (store.canManage() && store.canCreateNextRound()) {
                  <button
                    type="button"
                    class="btn btn--primary btn--lg btn--block"
                    [disabled]="store.isBusy('next-round')"
                    (click)="store.createNextRound()"
                  >
                    {{ isMexicano() ? t()('match.createNextRound') : t()('match.nextRound') }}
                  </button>
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
      border: 1px solid var(--glass-border-strong);
      border-radius: 50%;
      background: var(--surface-input);
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

    .pill--active {
      background: linear-gradient(160deg, var(--clay-400), var(--clay-600));
      border-color: transparent;
      color: #fff;
    }
  `,
})
export class TournamentRoundsTab {
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;
  protected readonly tournament = this.store.tournament;
  protected readonly plannedRounds = this.store.plannedRounds;
  protected readonly isMexicano = this.store.isMexicano;

  protected readonly allDone = computed(() =>
    this.store.rounds().every((round) => round.allScored),
  );

  protected readonly roundStatus = computed(() => {
    const round = this.store.currentRound();
    if (!round) return null;
    if (round.allScored) return this.i18n.translate('match.finishedLabel');
    if (round.matches.some((match) => match.status === 'running')) {
      return this.i18n.translate('match.started');
    }
    return null;
  });

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
      confirmLabel: this.i18n.translate('tournament.finish'),
    });
    if (confirmed) await this.store.finish();
  }
}
