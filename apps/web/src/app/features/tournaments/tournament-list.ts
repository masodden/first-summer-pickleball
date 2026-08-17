import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TournamentSummaryDto } from '@fsp/shared';
import { isTournamentActive } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { SessionStore } from '../../core/session';
import { TournamentApi } from '../../core/tournament-api';
import { Ball, Racket } from '../../ui/ball';
import { DomainSwitch } from '../../ui/domain-switch';
import { StatusBadge } from '../../ui/status-badge';
import { consumeFirstVisit } from '../../core/motion';

type Filter = 'active' | 'finished' | 'archived';

function compareTournaments(
  a: TournamentSummaryDto,
  b: TournamentSummaryDto,
  closed: boolean,
): number {
  if (closed) {
    return b.startsAt.localeCompare(a.startsAt) || b.createdAt.localeCompare(a.createdAt);
  }
  const rank = (status: TournamentSummaryDto['status']): number =>
    status === 'running' ? 0 : 1;
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  return a.startsAt.localeCompare(b.startsAt) || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Главный экран: список турниров.
 *
 * Турниры одного дня часто идут параллельно (advanced и intermediate), поэтому
 * они группируются по дате: организатору видно, что играется прямо сейчас, и он
 * переключается между своими турнирами одним касанием.
 */
@Component({
  selector: 'app-tournament-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DomainSwitch, StatusBadge, Ball, Racket],
  template: `
    <div class="stack stack--4">
      <div class="row row--between header">
        <app-domain-switch />
        @if (session.isModerator()) {
          <a class="btn btn--primary btn--sm create" routerLink="/tournaments/new">
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
          {{ t()('status.activeFilter') }}
        </button>
        <button
          type="button"
          class="chip"
          [class.chip--accent]="filter() === 'finished'"
          (click)="filter.set('finished')"
        >
          {{ t()('status.finishedFilter') }}
        </button>
        @if (session.isAdmin()) {
          <button
            type="button"
            class="chip chip--ghost"
            [class.chip--accent]="filter() === 'archived'"
            (click)="filter.set('archived')"
          >
            {{ t()('status.archiveFilter') }}
          </button>
        }
      </div>

      @if (tournaments.isLoading()) {
        <div class="stack stack--3">
          @for (item of [1, 2, 3]; track item) {
            <div class="skeleton" style="height: 104px"></div>
          }
        </div>
      } @else if (tournaments.error()) {
        <div class="glass card center stack stack--3">
          <p class="muted">{{ t()('errors.network') }}</p>
          <button type="button" class="btn btn--glass" (click)="tournaments.reload()">
            {{ t()('common.retry') }}
          </button>
        </div>
      } @else if (groups().length === 0) {
        @if (filter() === 'active') {
          <div class="glass card empty-state">
            <app-racket [size]="56" [swing]="true" />
            <h3>{{ t()('tournament.empty') }}</h3>
            @if (session.isModerator()) {
              <p class="small">{{ t()('tournament.emptyHint') }}</p>
              <a class="btn btn--primary" routerLink="/tournaments/new">
                {{ t()('tournament.create') }}
              </a>
            }
          </div>
        } @else {
          <p class="center small muted">
            {{
              filter() === 'archived'
                ? t()('tournament.emptyArchive')
                : t()('tournament.emptyFinished')
            }}
          </p>
        }
      } @else {
        @for (group of groups(); track group.day) {
          <section class="stack stack--3">
            <div class="row">
              <h2 class="grow">{{ group.day }}</h2>
              @if (group.items.length > 1) {
                <span class="chip chip--pink">{{ t()('tournament.parallel') }}</span>
              }
            </div>

            <div class="stack stack--3" [class.stagger]="stagger">
              @for (item of group.items; track item.id) {
                <a class="glass card--tight tile" [routerLink]="['/tournaments', item.id]">
                  <div class="row row--between">
                    <app-status-badge [status]="item.status" />
                    <span class="tile__time numeric">{{ time(item.startsAt) }}</span>
                  </div>

                  <div class="row">
                    <div class="grow stack tile__body">
                      <div class="row tile__title">
                        <h3 class="grow">{{ item.title }}</h3>
                        @if (item.category) {
                          <span class="chip chip--accent tile__level">{{ item.category }}</span>
                        }
                      </div>
                      <div class="row row--wrap tile__meta">
                        <span class="chip">{{ format(item.format) }}</span>
                        <span class="chip">{{ i18n.courts(item.courts) }}</span>
                        @if (item.roundsPlanned) {
                          <span class="chip">{{ i18n.games(item.roundsPlanned) }}</span>
                        } @else {
                          <span class="chip">{{ t()('tournament.roundsInfinite') }}</span>
                        }
                      </div>
                    </div>

                    @if (item.status === 'running') {
                      <app-ball [size]="26" motion="bounce" />
                    }
                  </div>

                  <div class="stack stack--1">
                    <div class="row tiny muted">
                      <span class="grow truncate">
                        {{ item.venueName ?? t()('common.notSet') }}
                      </span>
                      <span class="numeric">
                        {{
                          t()('tournament.participantsCount', {
                            count: item.participantCount,
                            max: item.maxPlayers,
                          })
                        }}
                      </span>
                    </div>
                    <div
                      class="progress"
                      role="progressbar"
                      [attr.aria-valuenow]="item.participantCount"
                      [attr.aria-valuemax]="item.maxPlayers"
                      [attr.aria-label]="
                        t()('tournament.participantsCount', {
                          count: item.participantCount,
                          max: item.maxPlayers,
                        })
                      "
                    >
                      <span class="progress__fill" [style.width]="fill(item) + '%'"></span>
                    </div>
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

    .create {
      flex: 0 0 auto;
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
      align-items: flex-start;
      gap: var(--space-2);
      min-width: 0;
    }

    .tile__title h3 {
      min-width: 0;
      line-height: 1.25;
      overflow-wrap: break-word;
    }

    .tile__level {
      flex: 0 0 auto;
      margin-top: 2px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
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
export class TournamentListPage {
  private readonly api = inject(TournamentApi);
  protected readonly i18n = inject(I18nService);
  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;
  protected readonly stagger = consumeFirstVisit('tournament-list');

  protected readonly filter = signal<Filter>('active');

  protected readonly tournaments = resource({
    loader: () => this.api.listTournaments().then((response) => response.items),
    defaultValue: [] as TournamentSummaryDto[],
  });

  private readonly visible = computed(() => {
    const mode = this.filter();
    return this.tournaments.value().filter((item) => {
      if (mode === 'active') return isTournamentActive(item.status);
      if (mode === 'finished') return item.status === 'finished';
      return item.status === 'archived';
    });
  });

  /**
   * Турниры одного дня вместе (параллельные потоки).
   * Порядок: сначала идущие, затем ближайшие по дате; в архиве — свежие сверху.
   */
  protected readonly groups = computed(() => {
    const closed = this.filter() !== 'active';
    const sorted = [...this.visible()].sort((a, b) => compareTournaments(a, b, closed));

    const byDay = new Map<string, TournamentSummaryDto[]>();
    for (const item of sorted) {
      const day = this.i18n.formatDay(item.startsAt);
      const bucket = byDay.get(day);
      if (bucket) bucket.push(item);
      else byDay.set(day, [item]);
    }

    return [...byDay.entries()].map(([day, items]) => ({
      day,
      items: items.sort((a, b) => compareTournaments(a, b, closed)),
    }));
  });

  protected time(value: string): string {
    return this.i18n.formatDate(value, { day: undefined, month: undefined });
  }

  protected format(value: TournamentSummaryDto['format']): string {
    return this.i18n.translate(value === 'americano' ? 'format.americano' : 'format.mexicano');
  }

  protected fill(item: TournamentSummaryDto): number {
    const max = Number(item.maxPlayers) || 0;
    const count = Number(item.participantCount) || 0;
    if (max <= 0 || count <= 0) return 0;
    return Math.min(100, Math.round((count / max) * 100));
  }
}
