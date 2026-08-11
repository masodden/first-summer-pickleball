import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n';
import { SessionStore } from '../../core/session';
import { TournamentStore } from '../../core/tournament-store';
import { Racket } from '../../ui/ball';

/**
 * Самостоятельная запись / отмена заявки.
 * Используется на вкладках «Информация» и «Участники».
 *
 * DUPR не обязателен: без него аккаунт — гость, заявиться можно сразу.
 * Привязать настоящий ID можно позже в настройках /claim.
 */
@Component({
  selector: 'app-tournament-join-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Racket],
  template: `
    @if (tournament(); as item) {
      <section class="glass card--tight stack stack--3">
        @if (!session.isAuthenticated()) {
          <div class="stack stack--2">
            <h3>{{ t()('auth.notInTelegram') }}</h3>
            <p class="small muted">{{ t()('auth.notInTelegramHint') }}</p>
          </div>
        } @else if (participation(); as mine) {
          <div class="row">
            <app-racket [size]="34" />
            <div class="grow stack stack--1">
              <span class="strong">
                {{ t()(mine.status === 'waitlisted' ? 'waitlist.joined' : 'participant.joined') }}
              </span>
              @if (mine.status === 'waitlisted' && mine.waitlistPosition !== null) {
                <span class="tiny muted">
                  {{ t()('waitlist.position', { position: mine.waitlistPosition }) }}
                </span>
              } @else if (mine.confirmedAndPaid) {
                <span class="tiny muted">{{ t()('checkin.paid') }}</span>
              }
              @if (session.isGuestPlayer()) {
                <span class="chip chip--pink">{{ t()('participant.guestBadge') }}</span>
              }
            </div>
            @if (canLeave()) {
              <button
                type="button"
                class="btn btn--sm btn--glass"
                [disabled]="store.isBusy('leave')"
                (click)="store.leave()"
              >
                {{ t()('participant.leave') }}
              </button>
            }
          </div>
          @if (session.isGuestPlayer()) {
            <a class="btn btn--sm btn--glass btn--block" routerLink="/claim">
              {{ t()('participant.linkDuprLater') }}
            </a>
          }
        } @else if (item.status === 'registration') {
          <button
            type="button"
            class="btn btn--go btn--block btn--lg"
            [disabled]="store.isBusy('join')"
            (click)="store.join()"
          >
            {{ t()(store.isFull() ? 'waitlist.title' : 'participant.join') }}
          </button>
          @if (store.isFull()) {
            <p class="tiny center muted">{{ t()('participant.full') }}</p>
          }
          @if (session.isGuestPlayer()) {
            <p class="tiny center muted">{{ t()('participant.guestJoinHint') }}</p>
          }
        } @else {
          <p class="small muted center">{{ t()('status.registration_closed') }}</p>
        }
      </section>
    }
  `,
})
export class TournamentJoinPanel {
  protected readonly store = inject(TournamentStore);
  protected readonly session = inject(SessionStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly tournament = this.store.tournament;
  protected readonly participation = this.store.myParticipation;

  /**
   * «Отменить заявку» — пока турнир не начат и участие ещё не подтвердили.
   * Крестики в списке участников — только организаторам.
   */
  protected readonly canLeave = computed(() => {
    const status = this.tournament()?.status;
    const mine = this.participation();
    return (
      mine !== null &&
      !mine.confirmedAndPaid &&
      (status === 'registration' || status === 'registration_closed')
    );
  });
}
