import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { TrainingParticipantDto } from '@fsp/shared';
import { ConfirmService } from '../../core/confirm';
import { I18nService } from '../../core/i18n';
import { TrainingStore } from '../../core/training-store';
import { PlayerLine } from '../../ui/player-line';
import { PlayerPicker } from '../players/player-picker';

@Component({
  selector: 'app-training-players',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerLine, PlayerPicker],
  template: `
    @if (training(); as item) {
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

            @if (store.showAmounts()) {
              <p class="tiny faint">{{ t()('training.amountsReady') }}</p>
            }

            @if (item.status === 'registration') {
              <button type="button" class="btn btn--primary btn--block" (click)="picker.set(true)">
                {{ t()('participant.add') }}
              </button>
            }

            @if (item.status === 'registration' && store.allConfirmed()) {
              <button
                type="button"
                class="btn btn--go btn--block"
                [disabled]="store.isBusy('start')"
                (click)="start()"
              >
                {{ t()('training.start') }}
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

          @for (participant of store.registered(); track participant.id; let index = $index) {
            <div
              class="glass card--tight person"
              [class.person--confirmed]="participant.confirmedAndPaid"
              [class.person--editing]="editingAmount() === participant.player.id"
            >
              <div class="person__main">
                <span class="person__index tiny faint numeric">{{ index + 1 }}</span>

                <app-player-line
                  class="grow"
                  [player]="participant.player"
                  [showRating]="true"
                  [subtitle]="participant.addedBySelf ? t()('participant.selfAdded') : null"
                />

                @if (store.showAmounts()) {
                  <div class="amount-row">
                    <span class="strong numeric amount">{{ participant.amount }}&nbsp;₽</span>
                    @if (store.canManage()) {
                      <button
                        type="button"
                        class="btn btn--icon btn--glass edit-amount"
                        [attr.aria-label]="t()('training.amountEdit')"
                        [attr.aria-expanded]="editingAmount() === participant.player.id"
                        (click)="toggleEditAmount(participant)"
                      >
                        <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                    }
                  </div>
                }

                @if (store.canManage() && item.status !== 'finished') {
                  <label class="checkbox" [attr.aria-label]="t()('checkin.paid')">
                    <input
                      type="checkbox"
                      [checked]="participant.confirmedAndPaid"
                      (change)="togglePaid(participant, $event)"
                    />
                    <span class="checkbox__box"></span>
                  </label>
                }

                @if (store.canManage() && item.status === 'registration') {
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

              @if (store.canManage() && editingAmount() === participant.player.id) {
                <div class="person__edit">
                  <input
                    class="input amount-input numeric"
                    type="number"
                    min="0"
                    [value]="draftAmount()"
                    (input)="draftAmount.set(inputValue($event))"
                    (keydown.enter)="saveAmount(participant)"
                  />
                  <span class="tiny muted">₽</span>
                  <button
                    type="button"
                    class="btn btn--sm btn--primary"
                    [disabled]="store.isBusy('amount:' + participant.player.id)"
                    (click)="saveAmount(participant)"
                  >
                    {{ t()('common.save') }}
                  </button>
                  <button
                    type="button"
                    class="btn btn--sm btn--glass"
                    (click)="resetAmount(participant)"
                  >
                    {{ t()('training.amountReset') }}
                  </button>
                </div>
              }
            </div>
          }
        </section>

        @if (store.waitlisted().length > 0) {
          <section class="stack stack--2">
            <h3>{{ t()('waitlist.title') }}</h3>
            @for (participant of store.waitlisted(); track participant.id) {
              <div class="glass glass--subtle card--tight person">
                <div class="person__main">
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
              </div>
            }
          </section>
        }

        @if (picker()) {
          <app-player-picker
            [taken]="takenIds()"
            (closed)="picker.set(false)"
            (picked)="onPicked($event)"
          />
        }
      </div>
    }
  `,
  styles: `
    .person {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      transition: border-color var(--duration-base) ease;
    }

    .person--confirmed {
      border-color: color-mix(in srgb, var(--lime-400) 45%, var(--control-border));
    }

    .person__main {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 48px;
    }

    .person__index {
      width: 1.5rem;
      text-align: center;
      flex: 0 0 auto;
    }

    .amount-row {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex: 0 0 auto;
    }

    .amount {
      white-space: nowrap;
    }

    .edit-amount {
      width: 34px;
      min-height: 34px;
      color: var(--accent-strong);
    }

    .person__edit {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2);
      padding-left: calc(1.5rem + var(--space-2));
    }

    .amount-input {
      width: 5.5rem;
      min-height: 34px;
      padding: 0 var(--space-2);
    }

    .icon {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class TrainingPlayersTab {
  private readonly confirm = inject(ConfirmService);
  protected readonly store = inject(TrainingStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly training = this.store.training;
  protected readonly picker = signal(false);
  protected readonly editingAmount = signal<string | null>(null);
  protected readonly draftAmount = signal('');

  protected readonly takenIds = computed(
    () => new Set(this.store.participants().map((item) => item.player.id)),
  );

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected togglePaid(participant: TrainingParticipantDto, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    void this.store.setPaid(participant.player.id, checked);
  }

  protected toggleEditAmount(participant: TrainingParticipantDto): void {
    if (this.editingAmount() === participant.player.id) {
      this.editingAmount.set(null);
      return;
    }
    this.editingAmount.set(participant.player.id);
    this.draftAmount.set(String(participant.amount));
  }

  protected async saveAmount(participant: TrainingParticipantDto): Promise<void> {
    const parsed = Number.parseInt(this.draftAmount().trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    await this.store.setAmount(participant.player.id, parsed);
    this.editingAmount.set(null);
  }

  protected async resetAmount(participant: TrainingParticipantDto): Promise<void> {
    await this.store.setAmount(participant.player.id, null);
    this.editingAmount.set(null);
  }

  protected async onPicked(playerId: string): Promise<void> {
    this.picker.set(false);
    await this.store.addParticipant(playerId);
  }

  protected async start(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('training.start'),
      message: this.i18n.translate('training.startConfirm', {
        count: this.store.registered().length,
      }),
      confirmLabel: this.i18n.translate('training.start'),
    });
    if (confirmed) await this.store.start();
  }
}
