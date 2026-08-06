import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { courtLabel } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { SessionStore } from '../../core/session';
import { TelegramService } from '../../core/telegram';
import { TournamentStore } from '../../core/tournament-store';
import { Racket } from '../../ui/ball';

/**
 * Вкладка «Информация».
 *
 * Здесь игрок понимает, куда и когда приходить и стоит ли заявляться, а
 * заявиться может одной кнопкой. Наблюдатель видит то же самое без входа.
 */
@Component({
  selector: 'app-tournament-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Racket],
  template: `
    @if (tournament(); as item) {
      <div class="stack stack--4 stagger">
        <section class="glass card--tight stack stack--3">
          <div class="grid">
            @if (item.category) {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.category') }}</span>
                <span class="strong">{{ item.category }}</span>
              </div>
            }
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.format') }}</span>
              <span class="strong">{{ formatLabel() }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.courts') }}</span>
              <span class="strong" [class.numeric]="!item.courtNames">{{ courtsLabel() }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.pointsToWin') }}</span>
              <span class="strong numeric">{{ item.pointsToWin }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.matchDuration') }}</span>
              <span class="strong numeric">
                {{ item.matchDurationMin ?? t()('common.notSet') }}
              </span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.rounds') }}</span>
              <span class="strong numeric">
                {{ item.roundsPlanned ?? t()('tournament.roundsInfinite') }}
              </span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('participant.list') }}</span>
              <span class="strong numeric">
                {{
                  t()('tournament.participantsCount', {
                    count: store.registered().length,
                    max: item.maxPlayers,
                  })
                }}
              </span>
            </div>
            @if (item.entryFee !== null) {
              <div class="cell">
                <span class="tiny faint">{{ t()('tournament.entryFee') }}</span>
                <span class="strong numeric">{{ item.entryFee }}</span>
              </div>
            }
            <div class="cell">
              <span class="tiny faint">{{ t()('tournament.tieRule') }}</span>
              <span class="strong">
                {{ t()(item.tieRule === 'draw' ? 'tie.draw' : 'tie.golden_point') }}
              </span>
            </div>
          </div>

          <p class="small muted">{{ formatDescription() }}</p>
        </section>

        <section class="glass card--tight stack stack--2">
          <h3>{{ t()('tournament.venue') }}</h3>
          <p class="strong">{{ item.venueName ?? t()('common.notSet') }}</p>
          @if (item.venueAddress) {
            <p class="small muted">{{ item.venueAddress }}</p>
          }
          <p class="small muted">{{ i18n.formatDate(item.startsAt) }}</p>
          @if (item.venueMapUrl) {
            <button
              type="button"
              class="btn btn--sm btn--glass"
              (click)="openMap(item.venueMapUrl)"
            >
              {{ t()('tournament.openMap') }}
            </button>
          }
        </section>

        @if (item.description) {
          <section class="glass card--tight stack stack--2">
            <h3>{{ t()('tournament.description') }}</h3>
            <p class="small text-block">{{ item.description }}</p>
          </section>
        }

        @if (item.formatDescription) {
          <section class="glass card--tight stack stack--2">
            <h3>{{ t()('tournament.formatDescription') }}</h3>
            <p class="small text-block">{{ item.formatDescription }}</p>
          </section>
        }

        <section class="glass card--tight stack stack--3">
          @if (!session.isAuthenticated()) {
            <div class="stack stack--2">
              <h3>{{ t()('auth.notInTelegram') }}</h3>
              <p class="small muted">{{ t()('auth.notInTelegramHint') }}</p>
            </div>
          } @else if (session.needsDuprLink()) {
            <div class="stack stack--2">
              <h3>{{ t()('participant.needDupr') }}</h3>
              <a class="btn btn--primary btn--block" routerLink="/claim">
                {{ t()('claim.submit') }}
              </a>
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
          } @else {
            <p class="small muted center">{{ t()('status.registration_closed') }}</p>
          }
        </section>
      </div>
    }
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
      gap: var(--space-3);
    }

    .cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
  `,
})
export class TournamentInfoTab {
  private readonly telegram = inject(TelegramService);

  protected readonly store = inject(TournamentStore);
  protected readonly session = inject(SessionStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly tournament = this.store.tournament;
  protected readonly participation = this.store.myParticipation;

  protected readonly formatLabel = computed(() =>
    this.i18n.translate(
      this.tournament()?.format === 'mexicano' ? 'format.mexicano' : 'format.americano',
    ),
  );

  /** Подписанные корты показываем списком: «4, 5, 6» вместо «3». */
  protected readonly courtsLabel = computed(() => {
    const item = this.tournament();
    if (!item) return '';
    const names = item.courtNames;
    if (!names) return item.courts.toString();
    return Array.from({ length: item.courts }, (_, index) => courtLabel(index + 1, names)).join(
      ', ',
    );
  });

  protected readonly formatDescription = computed(() =>
    this.i18n.translate(
      this.tournament()?.format === 'mexicano'
        ? 'format.mexicano.description'
        : 'format.americano.description',
    ),
  );

  /**
   * Кнопка «Отменить заявку» на вкладке «Информация».
   * Видна обычному игроку (и админу), пока турнир не начат и участие
   * ещё не подтвердили. Крестики в списке участников — только организаторам.
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

  protected openMap(url: string): void {
    this.telegram.openExternal(url);
  }
}
