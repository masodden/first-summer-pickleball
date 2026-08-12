import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ParticipantDto } from '@fsp/shared';
import { ConfirmService } from '../../core/confirm';
import { I18nService } from '../../core/i18n';
import { parseRatingInput, sanitizeRatingInput } from '../../core/rating-input';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { TournamentStore } from '../../core/tournament-store';
import { TelegramBackNavigation } from '../../core/telegram-back';
import { consumeFirstVisit } from '../../core/motion';
import { PlayerLine } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';
import { PlayerPicker } from '../players/player-picker';
import { TournamentJoinPanel } from './tournament-join-panel';
import { SheetDismiss } from '../../ui/motion';

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
  imports: [RouterLink, PlayerLine, RatingChip, PlayerPicker, TournamentJoinPanel, SheetDismiss],
  template: `
    @if (tournament(); as item) {
      <div class="stack stack--4">
        @if (
          store.canManage() &&
          (item.status === 'registration' || item.status === 'registration_closed')
        ) {
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

            <button type="button" class="btn btn--primary btn--block" (click)="picker.set(true)">
              {{ t()('participant.add') }}
            </button>
          </section>
        }

        <app-tournament-join-panel />

        <section class="stack stack--2">
          @if (store.registered().length === 0) {
            <div class="glass card empty-state">
              <p class="muted center">{{ t()('participant.empty') }}</p>
            </div>
          }

          <div class="stack stack--2" [class.stagger]="stagger">
            @for (participant of store.registered(); track participant.id; let index = $index) {
              <div
                class="glass person"
                [class.person--confirmed]="participant.confirmedAndPaid"
              >
                <span class="person__index faint numeric">{{ index + 1 }}</span>

                <app-player-line
                  class="grow"
                  [player]="participant.player"
                  [avatarSize]="30"
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

                @if (
                  store.canManage() &&
                  (item.status === 'registration' || item.status === 'registration_closed')
                ) {
                  <div class="person__actions">
                    <label class="checkbox" [attr.aria-label]="t()('checkin.paid')">
                      <input
                        type="checkbox"
                        [checked]="participant.confirmedAndPaid"
                        (change)="togglePaid(participant, $event)"
                      />
                      <span class="checkbox__box"></span>
                    </label>

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
                  </div>
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
                    (click)="promoteOrReplace(participant)"
                  >
                    {{
                      store.isFull() ? t()('waitlist.replace') : t()('waitlist.promote')
                    }}
                  </button>
                }
              </div>
            }
          </section>
        }

        @if (
          store.canManage() &&
          item.status !== 'running' &&
          item.status !== 'finished' &&
          item.status !== 'archived'
        ) {
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
              (click)="start()"
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

      @if (replacing(); as incoming) {
        <div class="overlay" (click)="replacing.set(null)">
          <div
            class="sheet glass card stack stack--3"
            appSheetDismiss
            (dismissed)="replacing.set(null)"
            (click)="$event.stopPropagation()"
          >
            <div class="row row--between">
              <h3>{{ t()('waitlist.replaceTitle') }}</h3>
              <button
                type="button"
                class="btn btn--icon btn--glass"
                [attr.aria-label]="t()('common.close')"
                (click)="replacing.set(null)"
              >
                <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <p class="small muted">
              {{ t()('waitlist.replaceHint', { name: incoming.player.fullName }) }}
            </p>
            <div class="stack stack--2 replace-list">
              @for (candidate of store.registered(); track candidate.id) {
                <button
                  type="button"
                  class="glass glass--subtle card--tight person replace-pick"
                  [disabled]="store.isBusy('promote:' + incoming.player.id)"
                  (click)="confirmReplace(incoming, candidate)"
                >
                  <app-player-line
                    class="grow"
                    [player]="candidate.player"
                    [avatarSize]="30"
                    [link]="false"
                  />
                </button>
              }
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .person {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 10px 12px;
      transition:
        border-color var(--duration-base) ease,
        background var(--duration-base) ease;
    }

    .person--confirmed {
      border-color: color-mix(in srgb, var(--success) 35%, transparent);
      background: color-mix(in srgb, var(--success) 10%, color-mix(in srgb, var(--glass-bg) 72%, transparent));
    }

    .person__index {
      width: 20px;
      text-align: right;
      flex: 0 0 auto;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
    }

    .person :deep(.line) {
      gap: var(--space-2);
    }

    .person :deep(.line__name) {
      font-size: 13px;
    }

    .person__actions {
      display: flex;
      align-items: center;
      gap: 6px;
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
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: grid;
      place-items: end center;
      padding: max(var(--space-4), env(safe-area-inset-top, 0px)) var(--space-4)
        max(var(--space-4), env(safe-area-inset-bottom, 0px));
      background: rgba(36, 26, 22, 0.42);
      backdrop-filter: blur(4px);
      animation: fade-in var(--duration-fast) ease both;
    }

    .sheet {
      width: min(100%, 440px);
      max-height: min(78dvh, 560px);
      overflow: hidden;
      animation: sheet-up 320ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }

    .replace-list {
      overflow: auto;
      max-height: min(52dvh, 400px);
      overscroll-behavior: contain;
      padding-bottom: var(--space-2);
    }

    .replace-pick {
      width: 100%;
      text-align: left;
      cursor: pointer;
      border: 0;
    }

    .replace-pick:hover {
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    }
  `,
})
export class TournamentPlayersTab {
  private readonly api = inject(TournamentApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  protected readonly store = inject(TournamentStore);
  protected readonly t = this.i18n.t;
  protected readonly stagger = consumeFirstVisit('tournament-players');
  protected readonly tournament = this.store.tournament;

  protected readonly picker = signal(false);
  protected readonly replacing = signal<ParticipantDto | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly draftRating = signal('');
  protected readonly savingRating = signal(false);

  protected readonly takenIds = computed(
    () => new Set(this.store.participants().map((item) => item.player.id)),
  );

  /** Рейтинг ведут вручную, поэтому его правит организатор прямо в списке. */
  protected readonly canEditRating = computed(() => this.store.canManage());

  constructor() {
    const destroyRef = inject(DestroyRef);
    const backNav = inject(TelegramBackNavigation);

    // Как у player-picker: sheet внутри main, таббар снаружи с большим z-index —
    // пока открыта замена, прячем навигацию, чтобы не перехватывала тапы.
    let releaseOverlay: (() => void) | null = null;
    const onBack = (): void => this.replacing.set(null);
    document.addEventListener('fsp:back', onBack);

    effect(() => {
      const open = this.replacing() !== null;
      document.documentElement.classList.toggle('fsp-overlay-open', open);
      if (open && !releaseOverlay) {
        releaseOverlay = backNav.acquireOverlay();
      } else if (!open && releaseOverlay) {
        releaseOverlay();
        releaseOverlay = null;
      }
    });

    destroyRef.onDestroy(() => {
      document.documentElement.classList.remove('fsp-overlay-open');
      document.removeEventListener('fsp:back', onBack);
      releaseOverlay?.();
    });
  }

  protected async add(playerId: string): Promise<void> {
    this.picker.set(false);
    await this.store.addParticipant(playerId);
  }

  protected promoteOrReplace(participant: ParticipantDto): void {
    if (this.store.isFull()) {
      this.replacing.set(participant);
      return;
    }
    void this.store.promote(participant.player.id);
  }

  protected async confirmReplace(
    incoming: ParticipantDto,
    outgoing: ParticipantDto,
  ): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.translate('waitlist.replace'),
      message: this.i18n.translate('waitlist.replaceConfirm', {
        outgoing: outgoing.player.fullName,
        incoming: incoming.player.fullName,
      }),
      confirmLabel: this.i18n.translate('waitlist.replace'),
      danger: true,
    });
    if (!ok) return;
    this.replacing.set(null);
    await this.store.promote(incoming.player.id, outgoing.player.id);
  }

  protected async start(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('tournament.start'),
      message: this.i18n.translate('tournament.startConfirm', {
        count: this.store.registered().length,
      }),
      confirmLabel: this.i18n.translate('tournament.start'),
    });
    if (confirmed) await this.store.start();
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
