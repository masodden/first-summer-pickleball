import { NgTemplateOutlet } from '@angular/common';
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
import { SessionStore } from '../../core/session';
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
  imports: [
    NgTemplateOutlet,
    RouterLink,
    PlayerLine,
    RatingChip,
    PlayerPicker,
    TournamentJoinPanel,
    SheetDismiss,
  ],
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
                @if (store.isFixedPairs()) {
                  <span class="tiny faint">{{ pairRosterHint() }}</span>
                }
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
            @if (store.isFixedPairs()) {
              @for (pair of store.linkedPairs(); track pair[0].id; let index = $index) {
                <article
                  class="glass pair"
                  [class.pair--confirmed]="pair[0].partnerLocked"
                >
                  <span class="pair__index faint numeric">{{ index + 1 }}</span>
                  <div class="pair__body">
                    @for (member of pair; track member.id) {
                      <div class="pair__row">
                        <ng-container
                          [ngTemplateOutlet]="memberInner"
                          [ngTemplateOutletContext]="{ participant: member, linked: true }"
                        />
                      </div>
                    }
                  </div>
                  @if (showPairActions(pair[0])) {
                    <div class="pair__side">
                      @if (canUnlinkPartner(pair[0])) {
                        <button
                          type="button"
                          class="btn btn--icon btn--ghost"
                          [attr.aria-label]="t()('partner.confirmUnlink')"
                          (click)="unlink(pair[0])"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
                            <path
                              d="M8.5 15.5l-2 2a3.5 3.5 0 105 5l2-2M15.5 8.5l2-2a3.5 3.5 0 10-5-5l-2 2"
                            />
                            <path d="M4 4l16 16" />
                          </svg>
                        </button>
                      }
                    </div>
                  }
                </article>
              }
              @if (store.unpaired().length > 0) {
                @if (store.linkedPairs().length > 0) {
                  <p class="tiny faint">{{ t()('participant.unpaired') }}</p>
                }
                @for (participant of store.unpaired(); track participant.id) {
                  <ng-container
                    [ngTemplateOutlet]="personCard"
                    [ngTemplateOutletContext]="{ participant, index: null, orphan: true }"
                  />
                }
              }
            } @else {
              @for (participant of store.registered(); track participant.id; let index = $index) {
                <ng-container
                  [ngTemplateOutlet]="personCard"
                  [ngTemplateOutletContext]="{ participant, index: index + 1, orphan: false }"
                />
              }
            }
          </div>
        </section>

        @if (store.waitlisted().length > 0) {
          <section class="stack stack--2">
            <h3>{{ t()('waitlist.title') }}</h3>
            @for (participant of store.waitlisted(); track participant.id) {
              <div class="glass glass--subtle person">
                <span class="person__index faint numeric">
                  {{ participant.waitlistPosition }}
                </span>
                <app-player-line
                  class="grow"
                  [player]="participant.player"
                  [avatarSize]="30"
                  [showRating]="false"
                  [subtitle]="participant.addedBySelf ? t()('participant.selfAdded') : null"
                />
                <app-rating-chip [player]="participant.player" [showLabel]="false" />
                @if (store.canManage()) {
                  <div class="person__actions">
                    <button
                      type="button"
                      class="btn btn--icon person__swap"
                      [attr.aria-label]="
                        store.isFull() ? t()('waitlist.replace') : t()('waitlist.promote')
                      "
                      [disabled]="store.isBusy('promote:' + participant.player.id)"
                      (click)="promoteOrReplace(participant)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
                        <path d="M8 3L4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="btn btn--icon btn--ghost"
                      [attr.aria-label]="t()('waitlist.remove')"
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
          </section>
        }

        @if (
          store.canManage() &&
          item.status !== 'running' &&
          item.status !== 'finished' &&
          item.status !== 'archived'
        ) {
          <section class="glass card--tight stack stack--2">
            @if (store.isFixedPairs() && store.unpaired().length > 0) {
              <p class="small muted center">{{ t()('partner.needPairs') }}</p>
            } @else if (store.allConfirmed()) {
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

      <ng-template
        #personCard
        let-participant="participant"
        let-index="index"
        let-orphan="orphan"
      >
        <div
          class="glass person"
          [class.person--confirmed]="participant.confirmedAndPaid"
          [class.person--orphan]="orphan"
        >
          <span class="person__index faint numeric">{{ index ?? '' }}</span>
          <ng-container
            [ngTemplateOutlet]="memberInner"
            [ngTemplateOutletContext]="{ participant, linked: false }"
          />
        </div>
      </ng-template>

      <ng-template #memberInner let-participant="participant" let-linked="linked">
        <app-player-line
          class="grow"
          [player]="participant.player"
          [avatarSize]="30"
          [showRating]="false"
          [subtitle]="linked ? null : partnerSubtitle(participant)"
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

        @if (showPlayerActions(participant, linked)) {
          <div class="person__actions">
            @if (store.canManage()) {
              <label class="checkbox" [attr.aria-label]="t()('checkin.paid')">
                <input
                  type="checkbox"
                  [checked]="participant.confirmedAndPaid"
                  (change)="togglePaid(participant, $event)"
                />
                <span class="checkbox__box"></span>
              </label>
            }

            @if (!linked && canLinkPartner(participant)) {
              <button
                type="button"
                class="btn btn--icon btn--glass"
                [attr.aria-label]="t()('partner.link')"
                (click)="onLinkClick(participant)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
                  <path d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 5.93" />
                  <path d="M14 11a5 5 0 00-7.07 0L5.52 12.41a5 5 0 007.07 7.07L14 18.07" />
                </svg>
              </button>
            }

            @if (!linked && store.canManage()) {
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
          </div>
        }
      </ng-template>

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

      @if (pairing(); as anchor) {
        <div class="overlay" (click)="pairing.set(null)">
          <div
            class="sheet glass card stack stack--3"
            appSheetDismiss
            (dismissed)="pairing.set(null)"
            (click)="$event.stopPropagation()"
          >
            <div class="row row--between">
              <h3>{{ t()('partner.pick') }}</h3>
              <button
                type="button"
                class="btn btn--icon btn--glass"
                [attr.aria-label]="t()('common.close')"
                (click)="pairing.set(null)"
              >
                <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div class="stack stack--2 replace-list">
              @for (candidate of unpairedExcept(anchor); track candidate.id) {
                <button
                  type="button"
                  class="glass glass--subtle card--tight person replace-pick"
                  (click)="confirmLink(anchor, candidate)"
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
      flex-wrap: nowrap;
      gap: var(--space-2);
      min-width: 0;
      padding: 10px 12px;
      transition:
        border-color var(--duration-base) ease,
        background var(--duration-base) ease;
    }

    .person--confirmed,
    .pair--confirmed {
      border-color: color-mix(in srgb, var(--lime-400) 55%, var(--control-border));
    }

    .pair--confirmed {
      background: color-mix(in srgb, var(--lime-400) 14%, var(--glass-bg, transparent));
    }

    .person--orphan {
      border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    }

    .pair {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      gap: var(--space-2);
      padding: 10px 12px;
      align-items: stretch;
    }

    .pair__index {
      width: 20px;
      align-self: center;
      text-align: right;
      flex: 0 0 auto;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
    }

    .pair__body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .pair__row {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: var(--space-2);
      min-width: 0;
    }

    .pair__row + .pair__row {
      border-top: 1px dashed color-mix(in srgb, var(--glass-border) 80%, transparent);
      padding-top: 8px;
    }

    .pair__side {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .person__index {
      width: 20px;
      text-align: right;
      flex: 0 0 auto;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
    }

    .person--orphan {
      border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    }

    .person :deep(.line),
    .pair :deep(.line) {
      gap: var(--space-2);
    }

    .person :deep(.line__name),
    .pair :deep(.line__name) {
      font-size: 13px;
    }

    .person__actions {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: 6px;
      flex: 0 0 auto;
    }

    .person__actions .btn--icon {
      width: 30px;
      min-height: 30px;
    }

    .person__swap {
      border-radius: 9px;
      background: linear-gradient(160deg, var(--lime-300), var(--lime-500));
      border-color: var(--lime-500);
      color: var(--ink-900);
    }

    .person > app-rating-chip {
      flex: 0 0 auto;
    }

    .rating-button {
      flex: 0 0 auto;
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
  private readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;
  protected readonly stagger = consumeFirstVisit('tournament-players');
  protected readonly tournament = this.store.tournament;

  protected readonly picker = signal(false);
  protected readonly replacing = signal<ParticipantDto | null>(null);
  protected readonly pairing = signal<ParticipantDto | null>(null);
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
    const onBack = (): void => {
      this.replacing.set(null);
      this.pairing.set(null);
    };
    document.addEventListener('fsp:back', onBack);

    effect(() => {
      const open = this.replacing() !== null || this.pairing() !== null;
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

  protected pairRosterHint(): string {
    const pairs = this.i18n.pairs(this.store.pairCount());
    const unpaired = this.store.unpaired().length;
    if (unpaired === 0) return pairs;
    return this.i18n.translate('partner.rosterMixed', { pairs, unpaired });
  }

  protected partnerSubtitle(participant: ParticipantDto): string | null {
    if (this.store.isFixedPairs()) {
      if (participant.partner?.fullName) {
        return `${participant.partner.fullName}${participant.partnerLocked ? ` · ${this.i18n.translate('partner.locked')}` : ''}`;
      }
      return this.i18n.translate('participant.unpaired');
    }
    return participant.addedBySelf ? this.i18n.translate('participant.selfAdded') : null;
  }

  protected registrationOpen(): boolean {
    const status = this.tournament()?.status;
    return status === 'registration' || status === 'registration_closed';
  }

  protected showPlayerActions(participant: ParticipantDto, linked: boolean): boolean {
    if (!this.registrationOpen()) return false;
    if (this.store.canManage()) return true;
    return !linked && this.canLinkPartner(participant);
  }

  protected showPairActions(participant: ParticipantDto): boolean {
    return this.registrationOpen() && this.canUnlinkPartner(participant);
  }

  protected canLinkPartner(participant: ParticipantDto): boolean {
    if (!this.store.isFixedPairs() || participant.partnerLocked || participant.partnerPlayerId) {
      return false;
    }
    if (this.store.canManage()) return true;
    const me = this.session.playerId();
    if (!me) return false;
    const mine = this.store.myParticipation();
    if (mine?.status === 'waitlisted') return false;
    if (participant.player.id === me) return this.store.unpaired().length > 1;
    if (!mine) return this.store.tournament()?.status === 'registration';
    return mine.status === 'registered' && !mine.partnerPlayerId;
  }

  protected canUnlinkPartner(participant: ParticipantDto): boolean {
    if (!this.store.isFixedPairs() || !participant.partnerPlayerId || participant.partnerLocked) {
      return false;
    }
    if (this.store.canManage()) return true;
    const me = this.session.playerId();
    return me === participant.player.id || me === participant.partnerPlayerId;
  }

  protected unpairedExcept(anchor: ParticipantDto): ParticipantDto[] {
    return this.store.unpaired().filter((item) => item.player.id !== anchor.player.id);
  }

  protected onLinkClick(participant: ParticipantDto): void {
    const me = this.session.playerId();
    if (this.store.canManage() || participant.player.id === me) {
      this.openPartnerPicker(participant);
      return;
    }
    void this.linkWithParticipant(participant);
  }

  protected openPartnerPicker(participant: ParticipantDto): void {
    this.pairing.set(participant);
  }

  protected async linkWithParticipant(target: ParticipantDto): Promise<void> {
    const me = this.session.playerId();
    if (!me) return;
    const join = this.store.myParticipation() === null;
    const ok = await this.confirm.ask({
      title: this.i18n.translate('partner.link'),
      message: this.i18n.translate(join ? 'partner.confirmJoin' : 'partner.confirmLink', {
        name: target.player.fullName,
      }),
      confirmLabel: this.i18n.translate('partner.link'),
    });
    if (!ok) return;
    await this.store.linkPartner(join ? target.player.id : me, join ? me : target.player.id);
  }

  protected async confirmLink(anchor: ParticipantDto, partner: ParticipantDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.translate('partner.link'),
      message: this.i18n.translate('partner.confirmLink', { name: partner.player.fullName }),
      confirmLabel: this.i18n.translate('partner.link'),
    });
    if (!ok) return;
    this.pairing.set(null);
    await this.store.linkPartner(anchor.player.id, partner.player.id);
  }

  protected async unlink(participant: ParticipantDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.translate('partner.confirmUnlink'),
      confirmLabel: this.i18n.translate('common.yes'),
      cancelLabel: this.i18n.translate('common.no'),
      danger: true,
    });
    if (!ok) return;
    await this.store.unlinkPartner(participant.player.id);
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
      message: this.i18n.translate(
        this.store.isFixedPairs() ? 'tournament.startConfirmPairs' : 'tournament.startConfirm',
        {
          count: this.store.isFixedPairs()
            ? this.store.pairCount()
            : this.store.registered().length,
        },
      ),
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
