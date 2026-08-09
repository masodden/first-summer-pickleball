import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, take } from 'rxjs';
import { ApiClient } from './core/api';
import { readTournamentDeepLink, readTrainingDeepLink } from './core/deep-link';
import { I18nService } from './core/i18n';
import { PreferencesService } from './core/preferences';
import { RealtimeService } from './core/realtime';
import { SessionStore } from './core/session';
import { TelegramService } from './core/telegram';
import { ToastService } from './core/toast';
import { Ball } from './ui/ball';
import { ConfirmHost } from './ui/confirm-host';
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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Ball, ToastHost, ConfirmHost],
  template: `
    <a class="skip" href="#main">{{ t()('nav.tournaments') }}</a>

    <!-- view-transition-name: chrome остаётся на месте, анимируется только main. -->
    <header class="header vt-header">
      <div class="header__inner shell">
        <a class="brand" routerLink="/tournaments">
          <app-ball [size]="30" [motion]="connectionBusy() ? 'spin' : 'none'" />
          <span class="brand__text">
            <span class="brand__first">FIRST SUMMER</span>
            <span class="brand__second">PICKLEBALL</span>
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
      <router-outlet />
    </main>

    <nav
      class="tabbar glass glass--strong vt-tabbar"
      [attr.aria-label]="t()('nav.tournaments')"
    >
      <a routerLink="/tournaments" routerLinkActive="is-active" class="tab">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        <span>{{ t()('nav.tournaments') }}</span>
      </a>
      <a routerLink="/players" routerLinkActive="is-active" class="tab">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3.2" />
          <path
            d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M16 11.2a2.8 2.8 0 100-5.6M17 19h3.5c-.3-2.2-1.4-3.8-3-4.5"
          />
        </svg>
        <span>{{ t()('nav.players') }}</span>
      </a>
      @if (session.isAdmin()) {
        <a routerLink="/admin" routerLinkActive="is-active" class="tab">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l7 3v5.5c0 4-2.9 7.6-7 9.5-4.1-1.9-7-5.5-7-9.5V6l7-3z" />
          </svg>
          <span>{{ t()('nav.admin') }}</span>
        </a>
      }
      <a routerLink="/settings" routerLinkActive="is-active" class="tab">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path
            d="M12 3.5v2M12 18.5v2M4.9 7.5l1.7 1M17.4 15.5l1.7 1M4.9 16.5l1.7-1M17.4 8.5l1.7-1"
          />
        </svg>
        <span>{{ t()('nav.settings') }}</span>
      </a>
    </nav>

    <app-toast-host />
    <app-confirm-host />
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 76px);
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
      padding-top: env(safe-area-inset-top, 0px);
      background: linear-gradient(var(--bg-base) 60%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .vt-header {
      view-transition-name: app-header;
    }

    .vt-main {
      view-transition-name: app-main;
    }

    .vt-tabbar {
      view-transition-name: app-tabbar;
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
      padding-top: var(--space-4);
      padding-bottom: var(--space-6);
    }

    .tabbar {
      position: fixed;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
      z-index: 50;
      display: flex;
      gap: var(--space-1);
      width: min(100% - 24px, 420px);
      padding: 6px;
      border-radius: var(--radius-full);
      transform: translateX(-50%);
    }

    .tab {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 7px 4px 6px;
      border-radius: var(--radius-full);
      color: var(--text-muted);
      font-size: 10.5px;
      font-weight: 600;
      transition:
        background var(--duration-fast) ease,
        color var(--duration-fast) ease;
    }

    .tab:hover {
      text-decoration: none;
      color: var(--text-strong);
    }

    .tab svg {
      width: 21px;
      height: 21px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tab.is-active {
      background: var(--accent-soft);
      color: var(--accent-strong);
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

  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;

  constructor() {
    // Тема применяется к documentElement сразу при старте.
    inject(PreferencesService);

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
