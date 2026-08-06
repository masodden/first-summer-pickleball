import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n';
import { SessionStore } from '../../core/session';
import { TelegramService } from '../../core/telegram';
import { TrainingStore } from '../../core/training-store';
import { Racket } from '../../ui/ball';

@Component({
  selector: 'app-training-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Racket],
  template: `
    @if (training(); as item) {
      <div class="stack stack--4 stagger">
        <section class="glass card--tight stack stack--3">
          <div class="grid">
            <div class="cell">
              <span class="tiny faint">{{ t()('training.courtBlocks') }}</span>
              <span class="strong">{{ blocksLabel() }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('training.pricePerCourtHour') }}</span>
              <span class="strong numeric">{{ item.pricePerCourtHour }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('training.totalCostLabel') }}</span>
              <span class="strong numeric">{{ item.totalCost }}</span>
            </div>
            <div class="cell">
              <span class="tiny faint">{{ t()('training.players') }}</span>
              <span class="strong numeric">{{ participantsLabel() }}</span>
            </div>
          </div>
        </section>

        <section class="glass card--tight stack stack--2">
          <h3>{{ t()('training.venue') }}</h3>
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
            <h3>{{ t()('training.description') }}</h3>
            <p class="small text-block">{{ item.description }}</p>
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
              <h3>{{ t()('training.needDupr') }}</h3>
              <a class="btn btn--primary btn--block" routerLink="/claim">
                {{ t()('claim.submit') }}
              </a>
            </div>
          } @else if (participation(); as mine) {
            <div class="row">
              <app-racket [size]="34" />
              <div class="grow stack stack--1">
                <span class="strong">
                  {{ t()(mine.status === 'waitlisted' ? 'waitlist.joined' : 'training.joined') }}
                </span>
                @if (mine.status === 'waitlisted' && mine.waitlistPosition !== null) {
                  <span class="tiny muted">
                    {{ t()('waitlist.position', { position: mine.waitlistPosition }) }}
                  </span>
                } @else if (mine.confirmedAndPaid) {
                  <span class="tiny muted">{{ t()('checkin.paid') }}</span>
                }
              </div>
              @if (store.canLeave()) {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  [disabled]="store.isBusy('leave')"
                  (click)="store.leave()"
                >
                  {{ t()('training.leave') }}
                </button>
              }
            </div>
          } @else if (store.isActive()) {
            <button
              type="button"
              class="btn btn--go btn--block btn--lg"
              [disabled]="store.isBusy('join')"
              (click)="store.join()"
            >
              {{ t()(store.isFull() ? 'waitlist.title' : 'training.join') }}
            </button>
            @if (store.isFull()) {
              <p class="tiny center muted">{{ t()('participant.full') }}</p>
            }
          } @else {
            <p class="small muted center">{{ t()('training.finished') }}</p>
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
      gap: 4px;
    }

    .text-block {
      white-space: pre-wrap;
    }
  `,
})
export class TrainingInfoTab {
  private readonly telegram = inject(TelegramService);
  protected readonly store = inject(TrainingStore);
  protected readonly session = inject(SessionStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly training = this.store.training;
  protected readonly participation = computed(() => this.training()?.myParticipation ?? null);

  protected blocksLabel(): string {
    const blocks = this.training()?.courtBlocks ?? [];
    return blocks.map((block) => `${block.courts}×${block.hours}ч`).join(' + ') || '—';
  }

  protected participantsLabel(): string {
    const item = this.training();
    if (!item) return '—';
    if (item.maxPlayers === null) {
      return this.i18n.translate('training.participantsOpen', {
        count: this.store.registered().length,
      });
    }
    return this.i18n.translate('training.participantsCount', {
      count: this.store.registered().length,
      max: item.maxPlayers,
    });
  }

  protected openMap(url: string): void {
    this.telegram.openExternal(url);
  }
}
