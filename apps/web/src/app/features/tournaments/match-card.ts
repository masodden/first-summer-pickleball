import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { MatchDto } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { TelegramService } from '../../core/telegram';
import { TournamentStore } from '../../core/tournament-store';
import { Avatar } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';

/**
 * Карточка корта.
 *
 * Счёт можно вводить, пока раунд идёт (running/paused) или уже завершён.
 * Сохранение на сервере сразу помечает матч finished.
 */
@Component({
  selector: 'app-match-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RatingChip],
  host: { '[class.card--live]': "match().status === 'running'" },
  template: `
    <div
      class="glass card--tight court"
      [class.court--finished]="match().status === 'finished' || match().status === 'skipped'"
    >
      <div class="row row--between">
        <span class="court__label">{{ courtLabel() }}</span>

        <div class="row court__status">
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

            @if (scoreEntry()) {
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

      @if (scoreEntry()) {
        <div class="presets">
          @for (preset of presets; track preset[0] + ':' + preset[1]) {
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
        @if (!scoreValid()) {
          <p class="tiny center" style="color: var(--danger)">{{ t()('score.tieNotAllowed') }}</p>
        }
      } @else if (canManage() && match().status === 'scheduled') {
        <p class="tiny center muted">{{ t()('match.roundNotStarted') }}</p>
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

  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;

  readonly match = input.required<MatchDto>();

  protected readonly editing = signal(false);
  protected readonly draftA = signal(0);
  protected readonly draftB = signal(0);

  protected readonly canManage = this.store.canManage;
  protected readonly courtLabel = computed(() => this.i18n.court(this.match().courtName));
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

  /** Компактный ряд пресетов в одну строку. */
  protected readonly presets: readonly [number, number][] = [
    [11, 9],
    [11, 7],
    [7, 11],
    [9, 11],
  ];

  protected readonly scoreValid = computed(() => {
    const tieAllowed = this.store.tournament()?.tieRule === 'draw';
    if (this.draftA() === this.draftB() && !tieAllowed) return false;
    return this.draftA() >= 0 && this.draftB() >= 0;
  });

  constructor() {
    effect(() => {
      const match = this.match();
      if (this.editing()) return;
      if (match.teamA.score === null && match.teamB.score === null) {
        this.draftA.set(11);
        this.draftB.set(0);
        return;
      }
      this.draftA.set(match.teamA.score ?? 0);
      this.draftB.set(match.teamB.score ?? 0);
    });
  }

  protected isWinner(first: boolean): boolean {
    const { teamA, teamB } = this.match();
    if (teamA.score === null || teamB.score === null) return false;
    return first ? teamA.score > teamB.score : teamB.score > teamA.score;
  }

  protected startEditing(): void {
    const match = this.match();
    this.draftA.set(match.teamA.score ?? 11);
    this.draftB.set(match.teamB.score ?? 0);
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

  protected async save(): Promise<void> {
    if (!this.scoreValid()) return;
    await this.store.setScore(this.match(), this.draftA(), this.draftB());
    this.editing.set(false);
  }
}
