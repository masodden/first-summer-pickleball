import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import type { TournamentSummaryDto } from '@fsp/shared';
import { ConfirmService } from '../../core/confirm';
import { I18nService } from '../../core/i18n';
import { SessionStore } from '../../core/session';
import { TelegramService } from '../../core/telegram';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { TournamentStore } from '../../core/tournament-store';
import { ViewStateService } from '../../core/view-state';
import { Ball } from '../../ui/ball';
import { StatusBadge } from '../../ui/status-badge';

/**
 * Экран турнира.
 *
 * Всё состояние живёт в `TournamentStore`, а вкладки — это отдельные экраны
 * поверх одних и тех же данных. Благодаря этому организатор ходит между
 * составом, кортами и таблицей, не теряя запущенные таймеры и не перегружая
 * данные заново.
 */
@Component({
  selector: 'app-tournament-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TournamentStore],
  imports: [RouterOutlet, RouterLink, RouterLinkActive, StatusBadge, Ball],
  template: `
    @if (store.loading() && !tournament()) {
      <div class="stack stack--3">
        <div class="skeleton" style="height: 120px"></div>
        <div class="skeleton" style="height: 220px"></div>
      </div>
    } @else if (!tournament()) {
      <div class="glass card empty-state">
        <h3>{{ t()('errors.not_found') }}</h3>
        <a class="btn btn--glass" routerLink="/tournaments">{{ t()('common.back') }}</a>
      </div>
    } @else if (tournament(); as item) {
      <div class="stack stack--4">
        @if (siblings().length > 0) {
          <div class="row scroll-x switcher">
            <a class="chip chip--accent" [routerLink]="['/tournaments', item.id]">
              {{ item.category ?? item.title }}
            </a>
            @for (sibling of siblings(); track sibling.id) {
              <a class="chip" [routerLink]="['/tournaments', sibling.id]">
                {{ sibling.category ?? sibling.title }}
              </a>
            }
          </div>
        }

        <header class="glass card--tight stack stack--3">
          <div class="row row--between">
            <app-status-badge [status]="item.status" />
            <div class="row row--gap-sm">
              @if (store.connection() === 'open' && item.status === 'running') {
                <span class="chip chip--go">{{ t()('standings.live') }}</span>
              }
              @if (item.status === 'running') {
                <app-ball [size]="22" motion="bounce" />
              }
            </div>
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

          @if (store.canManage()) {
            <div class="row row--wrap actions">
              @if (item.status === 'registration') {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  [disabled]="store.isBusy('registration')"
                  (click)="store.setRegistrationOpen(false)"
                >
                  {{ t()('tournament.closeRegistration') }}
                </button>
              }
              @if (item.status === 'registration_closed') {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  [disabled]="store.isBusy('registration')"
                  (click)="store.setRegistrationOpen(true)"
                >
                  {{ t()('tournament.reopenRegistration') }}
                </button>
              }
              @if (item.status === 'registration' || item.status === 'registration_closed') {
                <button
                  type="button"
                  class="btn btn--sm btn--go"
                  [disabled]="!store.canStart() || store.isBusy('start')"
                  [title]="
                    store.canStart() ? t()('tournament.startHint') : t()('checkin.notAllConfirmed')
                  "
                  (click)="start()"
                >
                  {{ t()('tournament.start') }}
                </button>
              }
              @if (store.canFinish()) {
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  [disabled]="store.isBusy('finish')"
                  (click)="finish()"
                >
                  {{ t()('tournament.finish') }}
                </button>
              }
              <a class="btn btn--sm btn--glass" [routerLink]="['/tournaments', item.id, 'edit']">
                {{ t()('common.edit') }}
              </a>
              <button type="button" class="btn btn--sm btn--glass" (click)="copyPublicLink()">
                {{ t()('tournament.publicLink') }}
              </button>
              @if (item.status === 'finished') {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  [disabled]="store.isBusy('export')"
                  (click)="store.exportCsv()"
                >
                  {{ t()('tournament.exportCsv') }}
                </button>
              }
              @if (item.canDelete) {
                <button type="button" class="btn btn--sm btn--danger" (click)="remove()">
                  {{ t()('common.delete') }}
                </button>
              }
            </div>
          }
        </header>

        <nav class="tabs glass glass--subtle" [attr.aria-label]="t()('tournament.info')">
          <a class="tab" routerLinkActive="is-active" [routerLink]="['./info']">
            {{ t()('tournament.info') }}
          </a>
          <a class="tab" routerLinkActive="is-active" [routerLink]="['./players']">
            {{ t()('participant.list') }}
            <span class="tab__count numeric">{{ store.registered().length }}</span>
          </a>
          <a class="tab" routerLinkActive="is-active" [routerLink]="['./rounds']">
            {{ t()('match.courtsTab') }}
            @if (store.roundCount() > 0) {
              <span class="tab__count numeric">{{ store.roundCount() }}</span>
            }
          </a>
          <a class="tab" routerLinkActive="is-active" [routerLink]="['./standings']">
            {{ t()('standings.title') }}
          </a>
        </nav>

        <router-outlet />
      </div>
    }
  `,
  styles: `
    .switcher {
      gap: var(--space-2);
      padding-bottom: 2px;
    }

    .switcher a:hover {
      text-decoration: none;
    }

    .actions {
      gap: var(--space-2);
    }

    .row--gap-sm {
      gap: var(--space-2);
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
export class TournamentDetailPage {
  private readonly api = inject(TournamentApi);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly telegram = inject(TelegramService);
  private readonly viewState = inject(ViewStateService);

  protected readonly store = inject(TournamentStore);
  protected readonly session = inject(SessionStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  /** Приходит из маршрута благодаря `withComponentInputBinding`. */
  readonly id = input.required<string>();

  protected readonly tournament = this.store.tournament;

  private readonly allTournaments = resource({
    loader: () => this.api.listTournaments().then((response) => response.items),
    defaultValue: [] as TournamentSummaryDto[],
  });

  /** Турниры того же дня: обычно это вторая категория, идущая параллельно. */
  protected readonly siblings = computed(() => {
    const current = this.tournament();
    if (!current) return [];
    const day = current.startsAt.slice(0, 10);
    return this.allTournaments
      .value()
      .filter((item) => item.id !== current.id && item.startsAt.slice(0, 10) === day)
      .slice(0, 4);
  });

  constructor() {
    effect(() => {
      void this.store.open(this.id());
    });

    // Запоминаем открытую вкладку, чтобы следующий турнир открылся на ней же.
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) this.rememberTab();
    });
    this.rememberTab();
  }

  private rememberTab(): void {
    const tab = this.route.firstChild?.snapshot.routeConfig?.path;
    if (tab) this.viewState.setLastTab(tab);
  }

  protected async start(): Promise<void> {
    await this.store.start();
    await this.router.navigate(['/tournaments', this.id(), 'rounds']);
  }

  protected async finish(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('tournament.finish'),
      message: this.i18n.translate('tournament.finishConfirm'),
      confirmLabel: this.i18n.translate('tournament.finish'),
    });
    if (!confirmed) return;
    await this.store.finish();
    await this.router.navigate(['/tournaments', this.id(), 'standings']);
  }

  protected async remove(): Promise<void> {
    const current = this.tournament();
    if (!current) return;
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('common.delete'),
      message: this.i18n.translate('tournament.deleteConfirm', { title: current.title }),
      confirmLabel: this.i18n.translate('common.delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      await this.api.deleteTournament(current.id);
      this.toast.success(this.i18n.translate('tournament.deleted'));
      await this.router.navigate(['/tournaments']);
    } catch (error) {
      this.toast.failure(error, () => void this.remove());
    }
  }

  protected async copyPublicLink(): Promise<void> {
    const current = this.tournament();
    if (!current) return;
    const url = `${location.origin}/board/${current.publicSlug}`;
    try {
      await navigator.clipboard.writeText(url);
      this.telegram.tap();
      this.toast.success(this.i18n.translate('common.copied'), url);
    } catch {
      this.toast.info(this.i18n.translate('tournament.publicLink'), url);
    }
  }
}
