import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ParticipantDto } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { parseRatingInput, sanitizeRatingInput } from '../../core/rating-input';
import { SessionStore } from '../../core/session';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { TournamentStore } from '../../core/tournament-store';
import { PlayerLine } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';
import { PlayerPicker } from '../players/player-picker';

/**
 * Вкладка «Участники»: приём игроков и подтверждение оплаты.
 *
 * Это самый нагруженный экран организатора: люди подходят по одному, кто-то
 * заявляется сам с телефона, у кого-то рейтинг устарел. Поэтому галочка оплаты,
 * правка рейтинга и удаление лежат в одной строке, а счётчик подтверждённых
 * всегда виден сверху — по нему понятно, можно ли формировать игры.
 */
@Component({
  selector: 'app-tournament-players',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PlayerLine, RatingChip, PlayerPicker],
  template: `
    @if (tournament(); as item) {
      <div class="stack stack--4">
        @if (store.canManage()) {
          <section class="glass card--tight stack stack--3">
            <div class="row row--between">
              <div class="stack stack--1">
                <h3>{{ t()('checkin.title') }}</h3>
                <span class="small muted">
                  {{
                    t()('checkin.confirmedOf', {
                      confirmed: store.confirmedCount(),
                      total: store.registered().length,
                    })
                  }}
                </span>
              </div>
              <span
                class="chip"
                [class.chip--go]="store.allConfirmed()"
                [class.chip--accent]="!store.allConfirmed()"
              >
                {{ store.confirmedCount() }}/{{ store.registered().length }}
              </span>
            </div>

            <p class="tiny faint">{{ t()('checkin.hint') }}</p>

            @if (item.status !== 'finished' && item.status !== 'running') {
              <button type="button" class="btn btn--primary btn--block" (click)="picker.set(true)">
                {{ t()('participant.add') }}
              </button>
            }
          </section>
        }

        <section class="stack stack--2">
          @if (store.registered().length === 0) {
            <div class="glass card empty-state">
              <p>{{ t()('common.empty') }}</p>
            </div>
          }

          <div class="stack stack--2">
            @for (participant of store.registered(); track participant.id; let index = $index) {
              <div
                class="glass card--tight person"
                [class.person--confirmed]="participant.confirmedAndPaid"
              >
                <span class="person__index tiny faint numeric">{{ index + 1 }}</span>

                <app-player-line
                  class="grow"
                  [player]="participant.player"
                  [showRating]="false"
                  [subtitle]="participant.addedBySelf ? t()('participant.selfAdded') : null"
                />

                @if (editing() === participant.player.id) {
                  <input
                    class="input rating-input numeric"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    [value]="draftRating()"
                    (input)="draftRating.set(sanitizeRating(inputValue($event)))"
                    (keydown.enter)="saveRating(participant)"
                  />
                  <button
                    type="button"
                    class="btn btn--sm btn--primary"
                    [disabled]="savingRating()"
                    (click)="saveRating(participant)"
                  >
                    {{ t()('common.save') }}
                  </button>
                } @else {
                  <button
                    type="button"
                    class="rating-button"
                    [disabled]="!canEditRating()"
                    [attr.aria-label]="t()('rating.edit')"
                    (click)="startEditing(participant)"
                  >
                    <app-rating-chip [player]="participant.player" [showLabel]="false" />
                  </button>
                }

                @if (store.canManage()) {
                  <label class="checkbox" [attr.aria-label]="t()('checkin.paid')">
                    <input
                      type="checkbox"
                      [checked]="participant.confirmedAndPaid"
                      [disabled]="item.status === 'finished'"
                      (change)="togglePaid(participant, $event)"
                    />
                    <span class="checkbox__box"></span>
                  </label>

                  @if (item.status === 'registration' || item.status === 'registration_closed') {
                    <button
                      type="button"
                      class="btn btn--icon btn--ghost"
                      [attr.aria-label]="t()('participant.remove')"
                      [disabled]="store.isBusy('remove:' + participant.player.id)"
                      (click)="store.removeParticipant(participant.player.id)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  }
                }
              </div>
            }
          </div>
        </section>

        @if (store.waitlisted().length > 0) {
          <section class="stack stack--2">
            <h3>{{ t()('waitlist.title') }}</h3>
            @for (participant of store.waitlisted(); track participant.id) {
              <div class="glass glass--subtle card--tight person">
                <span class="person__index tiny faint numeric">
                  {{ participant.waitlistPosition }}
                </span>
                <app-player-line class="grow" [player]="participant.player" />
                @if (store.canManage()) {
                  <button
                    type="button"
                    class="btn btn--sm btn--glass"
                    [disabled]="store.isBusy('promote:' + participant.player.id)"
                    (click)="store.promote(participant.player.id)"
                  >
                    {{ t()('waitlist.promote') }}
                  </button>
                }
              </div>
            }
          </section>
        }

        @if (store.canManage() && item.status !== 'running' && item.status !== 'finished') {
          <section class="glass card--tight stack stack--2">
            @if (store.allConfirmed()) {
              <p class="small strong center">{{ t()('checkin.allConfirmed') }}</p>
            } @else {
              <p class="small muted center">{{ t()('checkin.notAllConfirmed') }}</p>
            }
            <button
              type="button"
              class="btn btn--go btn--lg btn--block"
              [disabled]="!store.canStart() || store.isBusy('start')"
              (click)="store.start()"
            >
              {{ t()('tournament.start') }}
            </button>
            <a class="tiny center muted" [routerLink]="['/tournaments', item.id, 'rounds']">
              {{ t()('match.generateSchedule') }}
            </a>
          </section>
        }
      </div>

      @if (picker()) {
        <app-player-picker
          [taken]="takenIds()"
          (closed)="picker.set(false)"
          (picked)="add($event)"
        />
      }
    }
  `,
  styles: `
    .person {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      transition: border-color var(--duration-base) ease;
    }

    .person--confirmed {
      border-color: color-mix(in srgb, var(--success) 45%, transparent);
    }

    .person__index {
      width: 18px;
      text-align: right;
      flex: 0 0 auto;
    }

    .rating-button {
      border: 0;
      padding: 0;
      background: transparent;
      cursor: pointer;
    }

    .rating-button:disabled {
      cursor: default;
    }

    .rating-input {
      width: 92px;
      min-height: 36px;
      padding: 4px var(--space-3);
    }

    .icon {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
    }
  `,
})
export class TournamentPlayersTab {
  private readonly api = inject(TournamentApi);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly store = inject(TournamentStore);
  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;
  protected readonly tournament = this.store.tournament;

  protected readonly picker = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly draftRating = signal('');
  protected readonly savingRating = signal(false);

  protected readonly takenIds = computed(
    () => new Set(this.store.participants().map((item) => item.player.id)),
  );

  /** Рейтинг ведут вручную, поэтому его правит организатор прямо в списке. */
  protected readonly canEditRating = computed(() => this.store.canManage());

  protected async add(playerId: string): Promise<void> {
    this.picker.set(false);
    await this.store.addParticipant(playerId);
  }

  protected togglePaid(participant: ParticipantDto, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    void this.store.setPaid(participant.player.id, checked);
  }

  protected startEditing(participant: ParticipantDto): void {
    if (!this.canEditRating()) return;
    this.editing.set(participant.player.id);
    this.draftRating.set(participant.player.doublesRating?.toFixed(3) ?? '');
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected sanitizeRating(value: string): string {
    return sanitizeRatingInput(value);
  }

  protected async saveRating(participant: ParticipantDto): Promise<void> {
    const parsed = parseRatingInput(this.draftRating());
    if (parsed !== null && (parsed < 2 || parsed > 8)) {
      this.toast.error(this.i18n.translate('rating.range'));
      return;
    }

    this.savingRating.set(true);
    try {
      await this.api.setRating(participant.player.id, parsed);
      await this.store.load({ silent: true });
      this.editing.set(null);
      this.toast.success(this.i18n.translate('rating.updated'));
    } catch (error) {
      this.toast.failure(error, () => void this.saveRating(participant));
    } finally {
      this.savingRating.set(false);
    }
  }
}
