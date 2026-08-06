import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ConfirmService } from '../../core/confirm';
import { trainingMiniAppLink } from '../../core/deep-link';
import { I18nService } from '../../core/i18n';
import { TelegramService } from '../../core/telegram';
import { ToastService } from '../../core/toast';
import { TrainingApi } from '../../core/training-api';
import { TrainingStore } from '../../core/training-store';
import { TournamentApi } from '../../core/tournament-api';
import { Ball, Racket } from '../../ui/ball';
import { StatusBadge } from '../../ui/status-badge';

@Component({
  selector: 'app-training-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TrainingStore],
  imports: [RouterOutlet, RouterLink, RouterLinkActive, StatusBadge, Ball, Racket],
  template: `
    @if (store.loading() && !training()) {
      <div class="stack stack--3">
        <div class="skeleton" style="height: 120px"></div>
        <div class="skeleton" style="height: 220px"></div>
      </div>
    } @else if (!training()) {
      <div class="glass card empty-state">
        <h3>{{ t()('errors.not_found') }}</h3>
        <a class="btn btn--glass" routerLink="/trainings">{{ t()('common.back') }}</a>
      </div>
    } @else if (training(); as item) {
      <div class="stack stack--4">
        @if (store.startCelebration()) {
          <div class="celebration glass card center stack stack--3" (click)="store.dismissCelebration()">
            <app-racket [size]="72" [swing]="true" />
            <app-ball [size]="40" motion="bounce" />
            <h2>{{ t()('training.started') }}</h2>
            <p class="small muted">{{ t()('training.runningHint') }}</p>
          </div>
        }

        <header class="glass card--tight stack stack--3">
          <div class="row row--between">
            <app-status-badge [status]="item.status" />
            @if (item.status === 'running') {
              <app-ball [size]="22" motion="bounce" />
            }
          </div>

          <div class="stack stack--1">
            <h1>{{ item.title }}</h1>
            <p class="small muted">
              {{ i18n.formatDate(item.startsAt) }}
              @if (item.venueName) {
                · {{ item.venueName }}
              }
            </p>
          </div>

          <div class="row row--wrap">
            <span class="chip">
              {{ t()('training.courtHours', { hours: formatHours(item.courtHours) }) }}
            </span>
            <span class="chip numeric">
              {{ t()('training.totalCost', { amount: item.totalCost }) }}
            </span>
            @if (item.allConfirmed && item.participantCount > 0) {
              <span class="chip chip--go numeric">
                {{
                  t()('training.suggestedShare', {
                    amount: Math.round(item.totalCost / item.participantCount),
                  })
                }}
              </span>
            }
          </div>

          <div class="row row--wrap actions">
            <button type="button" class="btn btn--sm btn--glass" (click)="copyAppLink()">
              {{ t()('training.appLink') }}
            </button>
            @if (store.canManage()) {
              @if (item.status === 'registration') {
                <button
                  type="button"
                  class="btn btn--sm btn--go"
                  [disabled]="!store.allConfirmed() || store.isBusy('start')"
                  [title]="
                    store.allConfirmed() ? t()('training.startHint') : t()('checkin.notAllConfirmed')
                  "
                  (click)="start()"
                >
                  {{ t()('training.start') }}
                </button>
                <a class="btn btn--sm btn--glass" [routerLink]="['/trainings', item.id, 'edit']">
                  {{ t()('common.edit') }}
                </a>
              }
              @if (item.status === 'running') {
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  [disabled]="store.isBusy('finish')"
                  (click)="finish()"
                >
                  {{ t()('training.finish') }}
                </button>
              }
              @if (item.canDelete) {
                <button type="button" class="btn btn--sm btn--danger" (click)="remove()">
                  {{ t()('common.delete') }}
                </button>
              }
            }
          </div>

          @if (item.status === 'running') {
            <p class="small muted">{{ t()('training.runningHint') }}</p>
          }
        </header>

        <nav class="tabs glass glass--subtle" [attr.aria-label]="t()('training.info')">
          <a class="tab" routerLinkActive="is-active" [routerLink]="['./info']">
            {{ t()('training.info') }}
          </a>
          <a class="tab" routerLinkActive="is-active" [routerLink]="['./players']">
            {{ t()('training.players') }}
            <span class="tab__count numeric">{{ store.registered().length }}</span>
          </a>
        </nav>

        <router-outlet />
      </div>
    }
  `,
  styles: `
    .actions {
      gap: var(--space-2);
    }

    .celebration {
      animation: pop 0.55s var(--ease-spring);
      cursor: pointer;
    }

    @keyframes pop {
      from {
        transform: scale(0.92);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .tabs {
      display: flex;
      gap: 2px;
      padding: 4px;
      border-radius: var(--radius-full);
      overflow-x: auto;
    }

    .tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      flex: 1 1 auto;
      min-height: 36px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-full);
      color: var(--text-muted);
      font-size: 13.5px;
      font-weight: 600;
      white-space: nowrap;
    }

    .tab:hover {
      text-decoration: none;
      color: var(--text-strong);
    }

    .tab.is-active {
      background: var(--glass-bg-strong);
      color: var(--accent-strong);
      box-shadow: var(--glass-shadow);
    }

    .tab__count {
      padding: 0 6px;
      border-radius: var(--radius-full);
      background: var(--accent-soft);
      font-size: 11.5px;
    }
  `,
})
export class TrainingDetailPage {
  private readonly api = inject(TrainingApi);
  private readonly healthApi = inject(TournamentApi);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly telegram = inject(TelegramService);

  protected readonly store = inject(TrainingStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  protected readonly Math = Math;

  readonly id = input.required<string>();
  protected readonly training = this.store.training;

  constructor() {
    effect(() => {
      const id = this.id();
      void this.store.load(id);
    });
  }

  protected formatHours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  protected async copyAppLink(): Promise<void> {
    const current = this.training();
    if (!current) return;
    const health = await this.healthApi.getHealth();
    const botUsername = health.telegramBotUsername;
    if (!botUsername) {
      this.toast.error(this.i18n.translate('tournament.appLinkMissingBot'));
      return;
    }
    const url = trainingMiniAppLink(botUsername, current.id, {
      shortName: health.telegramMiniAppShortName,
    });
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success(this.i18n.translate('training.appLinkCopied'));
    } catch {
      this.telegram.openExternal(url);
    }
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

  protected async finish(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('training.finish'),
      message: this.i18n.translate('training.finishConfirm'),
      confirmLabel: this.i18n.translate('training.finish'),
    });
    if (confirmed) await this.store.finish();
  }

  protected async remove(): Promise<void> {
    const current = this.training();
    if (!current) return;
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('common.delete'),
      message: this.i18n.translate('training.deleteConfirm', { title: current.title }),
      confirmLabel: this.i18n.translate('common.delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.api.deleteTraining(current.id);
      this.toast.success(this.i18n.translate('training.deleted'));
      await this.router.navigate(['/trainings']);
    } catch (error) {
      this.toast.failure(error);
    }
  }
}
