import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
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
import type { TournamentFormat, TournamentSummaryDto } from '@fsp/shared';
import { ConfirmService } from '../../core/confirm';
import { tournamentMiniAppLink } from '../../core/deep-link';
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
                <span class="chip chip--go chip--live">{{ t()('standings.live') }}</span>
              }
              @if (item.status === 'running') {
                <app-ball [size]="22" motion="bounce" />
              }
            </div>
          </div>

          <div class="stack stack--2">
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
              @if (item.category) {
                <span class="chip chip--accent">{{ item.category }}</span>
              }
              <span class="chip">{{ formatLabel(item.format) }}</span>
            </div>
          </div>

          <div class="actions">
            <button type="button" class="btn btn--sm btn--glass" (click)="shareAppLink()">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M21.5 4.5L2.8 11.6c-.7.27-.7.66-.13.83l4.8 1.5 1.84 5.64c.23.7.58.86 1.1.54l2.64-2.02 5.1 3.76c.94.52 1.62.25 1.86-.87l3.37-15.88c.34-1.36-.52-1.97-1.48-1.56zM9.3 14.2l9.5-6c.38-.23.73-.1.44.16l-7.7 6.96-.3 3.28-1.94-4.4z"
                />
              </svg>
              {{ t()('tournament.appLinkShort') }}
            </button>
            <button type="button" class="btn btn--sm btn--glass" (click)="copyPublicLink()">
              <svg class="icon--stroke" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 13a5 5 0 007.54.54l1.83-1.83a5 5 0 00-7.07-7.07L10.7 6.24" />
                <path d="M14 11a5 5 0 00-7.54-.54L4.63 12.3a5 5 0 007.07 7.07l1.59-1.59" />
              </svg>
              {{ t()('tournament.boardLinkShort') }}
            </button>

            @if (store.canManage()) {
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
                  <svg class="icon--stroke" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
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
                  {{ t()('tournament.startShort') }}
                </button>
              }
              @if (store.canFinish()) {
                <button
                  type="button"
                  class="btn btn--sm btn--primary actions__wide"
                  [disabled]="store.isBusy('finish')"
                  (click)="finish()"
                >
                  {{ t()('tournament.finish') }}
                </button>
              }
              @if (item.status === 'finished' || item.status === 'archived') {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  [disabled]="store.isBusy('export')"
                  [attr.aria-label]="t()('tournament.exportCsv')"
                  (click)="store.exportCsv()"
                >
                  <svg class="icon--stroke" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3v12" />
                    <path d="M8 11l4 4 4-4" />
                    <path d="M5 21h14" />
                  </svg>
                  {{ t()('tournament.exportCsv') }}
                </button>
              }
              @if (session.isAdmin() && item.status === 'finished') {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  [disabled]="store.isBusy('archive')"
                  (click)="store.archive()"
                >
                  {{ t()('tournament.archive') }}
                </button>
              }
              @if (session.isAdmin() && item.status === 'archived') {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  [disabled]="store.isBusy('unarchive')"
                  (click)="store.unarchive()"
                >
                  {{ t()('tournament.unarchive') }}
                </button>
              }
              @if (item.status !== 'running' || moreOpen()) {
                @if (store.canUnstart()) {
                  <button
                    type="button"
                    class="btn btn--sm btn--glass"
                    [disabled]="store.isBusy('unstart')"
                    (click)="unstart()"
                  >
                    {{ t()('tournament.unstart') }}
                  </button>
                }
                <a class="btn btn--sm btn--glass" [routerLink]="['/tournaments', item.id, 'edit']">
                  {{ t()('common.edit') }}
                </a>
                @if (item.canDelete) {
                  <button type="button" class="btn btn--sm btn--danger" (click)="remove()">
                    {{ t()('common.delete') }}
                  </button>
                }
              }
            }
          </div>
          @if (store.canManage() && item.status === 'running') {
            <button type="button" class="more" (click)="moreOpen.set(!moreOpen())">
              {{ moreOpen() ? t()('common.close') : t()('common.more') }}
            </button>
          }
        </header>

        <nav class="tabs-wrap glass glass--subtle" [attr.aria-label]="t()('tournament.info')">
          <div class="tabs">
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
          </div>
        </nav>

        <div class="vt-sub">
          <router-outlet />
        </div>
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
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
    }

    .actions > .btn {
      width: 100%;
      min-width: 0;
      white-space: normal;
      line-height: 1.2;
      padding-inline: var(--space-3);
    }

    .actions > .btn svg {
      width: 17px;
      height: 17px;
      flex-shrink: 0;
      fill: currentColor;
    }

    .actions > .btn svg.icon--stroke {
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .actions__wide {
      grid-column: 1 / -1;
    }

    .more {
      margin: 0;
      padding: 2px 0 0;
      border: 0;
      background: none;
      color: var(--text-faint);
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
    }

    .more:hover,
    .more:focus-visible {
      color: var(--text-muted);
    }

    .row--gap-sm {
      gap: var(--space-2);
    }

    .tabs-wrap {
      border-radius: var(--radius-full);
      overflow: hidden;
    }

    .tabs {
      display: flex;
      gap: 2px;
      padding: 4px;
      overflow-x: auto;
      overflow-y: hidden;
      flex-wrap: nowrap;
      overscroll-behavior-x: none;
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
  protected readonly telegram = inject(TelegramService);
  private readonly viewState = inject(ViewStateService);

  protected readonly store = inject(TournamentStore);
  protected readonly session = inject(SessionStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  protected readonly moreOpen = signal(false);

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
      this.moreOpen.set(false);
    });

    // Запоминаем открытую вкладку, чтобы следующий турнир открылся на ней же.
    // В конструкторе child-route ещё может не быть — ждём NavigationEnd.
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) this.rememberTab();
    });
  }

  private rememberTab(): void {
    const tab = this.route.firstChild?.snapshot?.routeConfig?.path;
    if (tab) this.viewState.setLastTab(tab);
  }

  protected formatLabel(format: TournamentFormat): string {
    return this.i18n.translate(format === 'mexicano' ? 'format.mexicano' : 'format.americano');
  }

  protected async start(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('tournament.start'),
      message: this.i18n.translate('tournament.startConfirm', {
        count: this.store.registered().length,
      }),
      confirmLabel: this.i18n.translate('tournament.start'),
    });
    if (!confirmed) return;
    await this.store.start();
    await this.router.navigate(['/tournaments', this.id(), 'rounds']);
  }

  protected async unstart(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('tournament.unstart'),
      message: this.i18n.translate('tournament.unstartConfirm'),
      confirmLabel: this.i18n.translate('tournament.unstart'),
    });
    if (!confirmed) return;
    await this.store.unstart();
    await this.router.navigate(['/tournaments', this.id(), 'players']);
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

  protected async shareAppLink(): Promise<void> {
    const current = this.tournament();
    if (!current) return;

    let botUsername: string | null = null;
    let shortName: string | null = null;
    try {
      const health = await this.api.getHealth();
      botUsername = health.telegramBotUsername;
      shortName = health.telegramMiniAppShortName;
    } catch {
      botUsername = null;
    }

    if (!botUsername) {
      this.toast.error(this.i18n.translate('tournament.appLinkMissingBot'));
      return;
    }

    const url = tournamentMiniAppLink(botUsername, current.id, { shortName });
    if (this.telegram.available) {
      this.telegram.shareUrl(url, current.title);
      this.telegram.tap();
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      this.telegram.tap();
      this.toast.success(this.i18n.translate('tournament.appLinkCopied'), url);
    } catch {
      this.toast.info(this.i18n.translate('tournament.appLink'), url);
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
