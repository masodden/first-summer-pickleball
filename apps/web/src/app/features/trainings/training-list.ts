import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { isTrainingActive, type TrainingStatus, type TrainingSummaryDto } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { SessionStore } from '../../core/session';
import { TelegramService } from '../../core/telegram';
import { TournamentApi } from '../../core/tournament-api';
import { TrainingApi } from '../../core/training-api';
import { Ball, Racket } from '../../ui/ball';
import { StatusBadge } from '../../ui/status-badge';
import { consumeFirstVisit } from '../../core/motion';

type Filter = 'active' | 'finished';

function compareTrainings(a: TrainingSummaryDto, b: TrainingSummaryDto, finished: boolean): number {
  if (finished) {
    return b.startsAt.localeCompare(a.startsAt) || b.createdAt.localeCompare(a.createdAt);
  }
  const rank = (status: TrainingSummaryDto['status']): number => (status === 'running' ? 0 : 1);
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  return a.startsAt.localeCompare(b.startsAt) || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Список тренировок — отдельный корневой таб.
 */
@Component({
  selector: 'app-training-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadge, Ball, Racket],
  template: `
    <div class="stack stack--4">
      <div class="row row--between header">
        <h1>{{ t()('nav.trainings') }}</h1>
        @if (session.canManageTrainings()) {
          <a class="btn btn--primary btn--sm create" routerLink="/trainings/new">
            {{ t()('common.create') }}
          </a>
        }
      </div>

      <div class="row row--wrap">
        <button
          type="button"
          class="chip"
          [class.chip--accent]="filter() === 'active'"
          (click)="filter.set('active')"
        >
          {{ t()('status.running') }}
        </button>
        <button
          type="button"
          class="chip"
          [class.chip--accent]="filter() === 'finished'"
          (click)="filter.set('finished')"
        >
          {{ t()('training.statusFinished') }}
        </button>
      </div>

      @if (showOrganizerHint()) {
        <p class="small muted organizer-hint">
          {{ t()('training.organizerHint') }}
          <a
            class="organizer-hint__link"
            [href]="'https://t.me/' + clubContact()"
            (click)="openClubContact($event)"
          >
            {{ '@' + clubContact() }}
          </a>
          {{ t()('training.organizerHintAfter') }}
        </p>
      }

      @if (trainings.isLoading()) {
        <div class="stack stack--3">
          @for (item of [1, 2, 3]; track item) {
            <div class="skeleton" style="height: 104px"></div>
          }
        </div>
      } @else if (trainings.error()) {
        <div class="glass card center stack stack--3">
          <p class="muted">{{ t()('errors.network') }}</p>
          <button type="button" class="btn btn--glass" (click)="trainings.reload()">
            {{ t()('common.retry') }}
          </button>
        </div>
      } @else if (groups().length === 0) {
        <div class="glass card empty-state">
          <app-racket [size]="56" [swing]="true" />
          <h3>{{ t()('training.empty') }}</h3>
          @if (session.canManageTrainings()) {
            <p class="small">{{ t()('training.emptyHint') }}</p>
            <a class="btn btn--primary" routerLink="/trainings/new">
              {{ t()('common.create') }}
            </a>
          }
        </div>
      } @else {
        @for (group of groups(); track group.day) {
          <section class="stack stack--3">
            <h2>{{ group.day }}</h2>
            <div class="stack stack--3" [class.stagger]="stagger">
              @for (item of group.items; track item.id) {
                <a class="glass card--tight tile" [routerLink]="['/trainings', item.id]">
                  <div class="row row--between">
                    <app-status-badge entity="training" [status]="badgeStatus(item.status)" />
                    <span class="tile__time numeric">{{ time(item.startsAt) }}</span>
                  </div>

                  <div class="row">
                    <div class="grow stack tile__body">
                      <div class="tile__title">
                        <h3>{{ item.title }}</h3>
                      </div>
                      <div class="row row--wrap tile__meta">
                        <span class="chip">
                          {{ t()('training.courtHours', { hours: formatHours(item.courtHours) }) }}
                        </span>
                        <span class="chip numeric">{{ item.totalCost }}</span>
                      </div>
                    </div>
                    @if (isTrainingActive(item.status)) {
                      <app-ball [size]="26" motion="bounce" />
                    }
                  </div>

                  <div class="stack stack--1">
                    <div class="row tiny muted">
                      <span class="grow truncate">
                        {{ item.venueName ?? t()('common.notSet') }}
                      </span>
                      <span class="numeric">{{ participantsLabel(item) }}</span>
                    </div>
                    @if (item.maxPlayers !== null) {
                      <div
                        class="progress"
                        role="progressbar"
                        [attr.aria-valuenow]="item.participantCount"
                        [attr.aria-valuemax]="item.maxPlayers"
                      >
                        <span class="progress__fill" [style.width]="fill(item) + '%'"></span>
                      </div>
                    }
                  </div>
                </a>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .header {
      align-items: center;
      gap: var(--space-3);
      flex-wrap: nowrap;
    }

    .header h1 {
      min-width: 0;
    }

    .create {
      flex: 0 0 auto;
    }

    .organizer-hint {
      margin: 0;
      line-height: 1.45;
    }

    .organizer-hint__link {
      color: var(--accent-strong);
      font-weight: 650;
      margin: 0 0.15em;
    }

    .tile {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      color: inherit;
      transition:
        transform var(--duration-base) var(--ease-spring),
        box-shadow var(--duration-base) ease;
    }

    .tile:hover {
      text-decoration: none;
      /* Без translateY: с backdrop-filter даёт фантомные линии на web. */
      box-shadow: var(--glass-shadow-lg);
    }

    .tile__time {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--text-strong);
      line-height: 1;
    }

    .tile__body {
      gap: var(--space-2);
      min-width: 0;
    }

    .tile__title {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      min-width: 0;
    }

    .tile__title h3 {
      min-width: 0;
      line-height: 1.25;
      overflow-wrap: break-word;
    }

    .tile__meta {
      gap: var(--space-2);
    }

    .progress {
      height: 6px;
      border-radius: var(--radius-full);
      background: color-mix(in srgb, var(--ink-900) 12%, transparent);
      overflow: hidden;
    }

    .progress__fill {
      display: block;
      height: 100%;
      max-width: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--lime-400), var(--clay-400));
      transition: width var(--duration-slow) var(--ease-out);
    }
  `,
})
export class TrainingListPage {
  private readonly api = inject(TrainingApi);
  private readonly healthApi = inject(TournamentApi);
  private readonly telegram = inject(TelegramService);
  protected readonly i18n = inject(I18nService);
  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;
  protected readonly stagger = consumeFirstVisit('training-list');
  protected readonly clubContact = signal('Katevolchok');

  /** Подсказка только обычным игрокам: организатор уже видит кнопку создания. */
  protected readonly showOrganizerHint = computed(() => this.session.role() === 'user');

  protected readonly filter = signal<Filter>('active');

  protected readonly trainings = resource({
    loader: () => this.api.listTrainings().then((response) => response.items),
    defaultValue: [] as TrainingSummaryDto[],
  });

  private readonly visible = computed(() => {
    const finished = this.filter() === 'finished';
    return this.trainings.value().filter((item) => (item.status === 'finished') === finished);
  });

  protected readonly groups = computed(() => {
    const finished = this.filter() === 'finished';
    const sorted = [...this.visible()].sort((a, b) => compareTrainings(a, b, finished));
    const byDay = new Map<string, TrainingSummaryDto[]>();
    for (const item of sorted) {
      const day = this.i18n.formatDay(item.startsAt);
      const bucket = byDay.get(day);
      if (bucket) bucket.push(item);
      else byDay.set(day, [item]);
    }
    return [...byDay.entries()].map(([day, items]) => ({
      day,
      items: items.sort((a, b) => compareTrainings(a, b, finished)),
    }));
  });

  protected readonly isTrainingActive = isTrainingActive;

  protected badgeStatus(status: TrainingStatus): TrainingStatus {
    return isTrainingActive(status) ? 'running' : 'finished';
  }

  protected time(value: string): string {
    return this.i18n.formatDate(value, { day: undefined, month: undefined });
  }

  protected formatHours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  protected participantsLabel(item: TrainingSummaryDto): string {
    if (item.maxPlayers === null) {
      return this.i18n.translate('training.participantsOpen', { count: item.participantCount });
    }
    return this.i18n.translate('training.participantsCount', {
      count: item.participantCount,
      max: item.maxPlayers,
    });
  }

  protected fill(item: TrainingSummaryDto): number {
    const max = Number(item.maxPlayers) || 0;
    const count = Number(item.participantCount) || 0;
    if (max <= 0 || count <= 0) return 0;
    return Math.min(100, Math.round((count / max) * 100));
  }

  constructor() {
    void this.healthApi.getHealth().then((health) => {
      if (health.clubContactTelegram) this.clubContact.set(health.clubContactTelegram);
    });
  }

  protected openClubContact(event: Event): void {
    event.preventDefault();
    this.telegram.openExternal(`https://t.me/${this.clubContact()}`);
  }
}
