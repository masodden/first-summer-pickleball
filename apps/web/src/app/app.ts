import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, take } from 'rxjs';
import { ApiClient } from './core/api';
import { readTournamentDeepLink, readTrainingDeepLink } from './core/deep-link';
import { I18nService } from './core/i18n';
import { mainScrollBehavior } from './core/motion';
import { PreferencesService } from './core/preferences';
import { RealtimeService } from './core/realtime';
import { SessionStore } from './core/session';
import { TelegramService } from './core/telegram';
import { appScrollRoot } from './core/telegram-viewport';
import { ToastService } from './core/toast';
import { Ball } from './ui/ball';
import { ConfirmHost } from './ui/confirm-host';
import { TabBar } from './ui/tab-bar';
import { ToastHost } from './ui/toast-host';

/**
 * Каркас приложения.
 *
 * Мобильный вид первичен: приложение живёт в Telegram на телефоне организатора.
 * Шапка компактная, навигация внизу под большим пальцем, состояние соединения
 * всегда на виду — во время турнира важно понимать, дошли ли действия до сервера.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, Ball, TabBar, ToastHost, ConfirmHost],
  template: `
    <a class="skip" href="#main">{{ t()('nav.tournaments') }}</a>

    <header class="header vt-header">
      <div class="header__inner shell">
        <a class="brand" routerLink="/tournaments">
          <app-ball [size]="30" [motion]="connectionBusy() ? 'spin' : 'none'" />
          <span class="brand__text">
            <span class="brand__first">PICKLEBALL</span>
            <span class="brand__second">Events</span>
          </span>
        </a>

        <div class="row row--gap-sm">
          @if (offline()) {
            <button type="button" class="chip chip--danger" (click)="flush()">
              {{
                pendingCount() > 0
                  ? t()('common.pendingActions', { count: pendingCount() })
                  : t()('common.offline')
              }}
            </button>
          } @else if (reconnecting()) {
            <span class="chip">{{ t()('common.reconnecting') }}</span>
          } @else if (pendingCount() > 0) {
            <button type="button" class="chip chip--accent" (click)="flush()">
              {{ t()('common.pendingActions', { count: pendingCount() }) }}
            </button>
          }

          @if (!session.isAuthenticated()) {
            <span class="chip">{{ t()('auth.spectatorMode') }}</span>
          }
        </div>
      </div>
    </header>

    <main id="main" class="shell main vt-main">
      <div class="main__body">
        <router-outlet />
      </div>
    </main>

    <app-tab-bar />

    <app-toast-host />
    <app-confirm-host />
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    :host-context(html[data-app-scroll='inner']) {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-height: 100%;
      overflow: hidden;
    }

    .skip {
      position: absolute;
      left: -9999px;
    }

    .skip:focus {
      left: var(--space-4);
      top: var(--space-4);
      z-index: 80;
      padding: var(--space-2) var(--space-4);
      background: var(--glass-bg-strong);
      border-radius: var(--radius-full);
    }

    .shell {
      width: 100%;
      max-width: var(--shell-max);
      margin: 0 auto;
      padding-inline: var(--space-4);
    }

    .header {
      position: sticky;
      top: 0;
      z-index: 40;
      padding-top: calc(
        env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)
      );
      background: linear-gradient(var(--bg-base) 60%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    :host-context(html[data-app-scroll='inner']) .header {
      flex: 0 0 auto;
      position: relative;
    }

    .header__inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      min-height: 58px;
    }

    .row--gap-sm {
      gap: var(--space-2);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-strong);
    }

    .brand:hover {
      text-decoration: none;
    }

    .brand__text {
      display: flex;
      flex-direction: column;
      line-height: 1.05;
      font-family: var(--font-display);
    }

    .brand__first {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.19em;
      color: var(--accent);
    }

    .brand__second {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }

    .main {
      position: relative;
      z-index: 1;
      padding-top: var(--space-4);
      padding-bottom: 0;
      background: transparent;
    }

    :host-context(html[data-app-scroll='inner']) .main {
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }

    /* Отступ внутри скролла, не снаружи: страница уезжает под стеклянный таббар. */
    .main__body {
      padding-bottom: calc(
        env(safe-area-inset-bottom, 0px) + var(--tg-content-safe-area-inset-bottom, 0px) +
          var(--app-tabbar-space)
      );
    }
  `,
})
export class App {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly telegram = inject(TelegramService);
  private lastMainUrl = this.router.url;
  private readonly mainScrolls = new Map<string, number>();

  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;

  constructor() {
    // Тема применяется к documentElement сразу при старте.
    inject(PreferencesService);

    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      const scroller = appScrollRoot();
      if (event instanceof NavigationStart) {
        this.mainScrolls.set(this.lastMainUrl, scroller.scrollTop);
        return;
      }
      if (!(event instanceof NavigationEnd)) return;
      const nextUrl = event.urlAfterRedirects;
      const behavior = mainScrollBehavior(this.lastMainUrl, nextUrl);
      if (behavior === 'top') scroller.scrollTop = 0;
      else if (behavior === 'restore') scroller.scrollTop = this.mainScrolls.get(nextUrl) ?? 0;
      this.lastMainUrl = nextUrl;
    });

    // t.me/bot/play?startapp=t_<uuid> → открыть карточку турнира, а не список.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        take(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        const trainingId = readTrainingDeepLink(this.telegram.startParam);
        if (trainingId) {
          if (this.router.url.startsWith(`/trainings/${trainingId}`)) return;
          void this.router.navigate(['/trainings', trainingId], { replaceUrl: true });
          return;
        }
        const tournamentId = readTournamentDeepLink(this.telegram.startParam);
        if (!tournamentId) return;
        if (this.router.url.startsWith(`/tournaments/${tournamentId}`)) return;
        void this.router.navigate(['/tournaments', tournamentId], { replaceUrl: true });
      });
  }

  protected readonly offline = computed(() => !this.api.online());
  protected readonly reconnecting = computed(() => this.realtime.state() === 'reconnecting');
  protected readonly pendingCount = computed(() => this.api.queued().length);
  protected readonly connectionBusy = computed(
    () => this.realtime.state() === 'connecting' || this.reconnecting(),
  );

  /** Ручная отправка отложенных действий: связь вернулась раньше события. */
  protected async flush(): Promise<void> {
    const { sent, failed } = await this.api.flushQueue();
    if (sent > 0) this.toast.success(this.i18n.translate('common.online'));
    else if (failed > 0)
      this.toast.error(this.i18n.translate('errors.network'), undefined, () => void this.flush());
  }
}
