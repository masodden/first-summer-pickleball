import { ChangeDetectionStrategy, Component, inject, Injector } from '@angular/core';
import { isActive, Router, type UrlTree } from '@angular/router';
import { I18nService } from '../core/i18n';
import { PreferencesService } from '../core/preferences';
import { SessionStore } from '../core/session';
import { swipeToTab, tabDirection } from '../core/tab-view-transition';

function pathFromUrlTree(tree: UrlTree): string {
  const segments = tree.root.children['primary']?.segments ?? [];
  return '/' + segments.map((segment) => segment.path).join('/');
}

/**
 * Нижняя навигация + горизонтальный свайп между корневыми табами.
 */
@Component({
  selector: 'app-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tabbar glass glass--strong vt-tabbar" [attr.aria-label]="t()('nav.tournaments')">
      <a
        href="/tournaments"
        class="tab"
        [class.is-active]="tournamentsActive() || rootActive()"
        (click)="onTabClick($event, '/tournaments')"
      >
        <span class="tab__glyph">
          <svg class="tab__icon tab__icon--outline" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 4.5h8v3.2c0 2.4-1.8 4.3-4 4.3s-4-1.9-4-4.3V4.5z" />
            <path d="M8.2 6.4H5.6c.15 1.7 1.05 2.9 2.5 3.4" />
            <path d="M15.8 6.4h2.6c-.15 1.7-1.05 2.9-2.5 3.4" />
            <path d="M12 11.9v3.1" />
            <path d="M10.3 15h3.4v3.6H10.3z" />
            <path d="M8.8 18.6h6.4" />
          </svg>
          <svg class="tab__icon tab__icon--filled" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7.25 3.75h9.5v3.7c0 2.85-2.05 5.2-4.75 5.55v1.75h2.15v2.1H9.85v-2.1h2.15v-1.75c-2.7-.35-4.75-2.7-4.75-5.55v-3.7zM7.4 5.7H4.55A3.4 3.4 0 007.15 10M16.6 5.7h2.85A3.4 3.4 0 0116.85 10M8.1 19.15h7.8v1.6H8.1z"
            />
          </svg>
        </span>
        <span>{{ t()('nav.tournaments') }}</span>
      </a>
      <a
        href="/trainings"
        class="tab"
        [class.is-active]="trainingsActive()"
        (click)="onTabClick($event, '/trainings')"
      >
        <span class="tab__glyph">
          <svg
            class="tab__icon tab__icon--outline tab__icon--ball"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <g transform="rotate(45 11.2 12)">
              <path
                d="M10 1.5h4A3.6 3.6 0 0 1 17.6 5.1v6.1A3.6 3.6 0 0 1 14 14.8H13.55v6.3a1.55 1.55 0 0 1-3.1 0v-6.3H10A3.6 3.6 0 0 1 6.4 11.2V5.1A3.6 3.6 0 0 1 10 1.5z"
              />
            </g>
            <circle cx="19.6" cy="17.1" r="3.9" />
            <g class="ball-holes">
              <circle cx="19.6" cy="17.1" r="0.62" />
              <circle cx="19.6" cy="14.82" r="0.54" />
              <circle cx="21.62" cy="15.92" r="0.52" />
              <circle cx="21.66" cy="18.28" r="0.54" />
              <circle cx="19.6" cy="19.38" r="0.5" />
              <circle cx="17.58" cy="18.28" r="0.54" />
              <circle cx="17.54" cy="15.92" r="0.46" />
            </g>
          </svg>
          <svg class="tab__icon tab__icon--filled" viewBox="0 0 24 24" aria-hidden="true">
            <g transform="rotate(45 11.2 12)">
              <path
                d="M10 1.5h4A3.6 3.6 0 0 1 17.6 5.1v6.1A3.6 3.6 0 0 1 14 14.8H13.55v6.3a1.55 1.55 0 0 1-3.1 0v-6.3H10A3.6 3.6 0 0 1 6.4 11.2V5.1A3.6 3.6 0 0 1 10 1.5z"
              />
            </g>
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M19.6 13.2a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 1 1 0-7.8zM19.6 16.48a.62.62 0 1 1 0 1.24.62.62 0 1 1 0-1.24zM19.6 14.28a.54.54 0 1 1 0 1.08.54.54 0 1 1 0-1.08zM21.62 15.4a.52.52 0 1 1 0 1.04.52.52 0 1 1 0-1.04zM21.66 17.74a.54.54 0 1 1 0 1.08.54.54 0 1 1 0-1.08zM19.6 18.88a.5.5 0 1 1 0 1 .5.5 0 1 1 0-1zM17.58 17.74a.54.54 0 1 1 0 1.08.54.54 0 1 1 0-1.08zM17.54 15.46a.46.46 0 1 1 0 .92.46.46 0 1 1 0-.92z"
            />
          </svg>
        </span>
        <span>{{ t()('nav.trainings') }}</span>
      </a>
      @if (!preferences.hideAboutTab()) {
        <a
          href="/about"
          class="tab"
          [class.is-active]="aboutActive()"
          (click)="onTabClick($event, '/about')"
        >
          <span class="tab__glyph">
            <svg
              class="tab__icon tab__icon--outline tab__icon--ball"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8.6" />
              <g class="ball-holes">
                <circle cx="12" cy="12" r="1.2" />
                <circle cx="12" cy="6.55" r="1.2" />
                <circle cx="16.5" cy="9.4" r="1.2" />
                <circle cx="16.5" cy="14.6" r="1.2" />
                <circle cx="12" cy="17.45" r="1.2" />
                <circle cx="7.5" cy="14.6" r="1.2" />
                <circle cx="7.5" cy="9.4" r="1.2" />
              </g>
            </svg>
            <svg class="tab__icon tab__icon--filled" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill-rule="evenodd"
                d="M12 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18zM12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3zM12 5.05a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3zM16.5 7.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3zM16.5 13.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3zM12 15.95a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3zM7.5 13.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3zM7.5 7.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3z"
              />
            </svg>
          </span>
          <span>{{ t()('nav.about') }}</span>
        </a>
      }
      @if (session.isModerator()) {
        <a
          href="/players"
          class="tab"
          [class.is-active]="playersActive()"
          (click)="onTabClick($event, '/players')"
        >
          <span class="tab__glyph">
            <svg class="tab__icon tab__icon--outline" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="3.2" />
              <path
                d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M16 11.2a2.8 2.8 0 100-5.6M17 19h3.5c-.3-2.2-1.4-3.8-3-4.5"
              />
            </svg>
            <svg class="tab__icon tab__icon--filled" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="3.6" />
              <path d="M3.2 19.5c.55-3.6 2.95-5.7 5.8-5.7s5.25 2.1 5.8 5.7H3.2z" />
              <circle cx="16.5" cy="9.2" r="2.7" />
              <path d="M16.2 14.2c2.05.35 3.45 1.9 3.85 4.3H14.9c.2-1.85 1-3.3 1.3-3.8z" />
            </svg>
          </span>
          <span>{{ t()('nav.players') }}</span>
        </a>
      }
      @if (session.isAdmin()) {
        <a
          href="/admin"
          class="tab"
          [class.is-active]="adminActive()"
          (click)="onTabClick($event, '/admin')"
        >
          <span class="tab__glyph">
            <svg class="tab__icon tab__icon--outline" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l7 3v5.5c0 4-2.9 7.6-7 9.5-4.1-1.9-7-5.5-7-9.5V6l7-3z" />
            </svg>
            <svg class="tab__icon tab__icon--filled" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l7 3v5.5c0 4-2.9 7.6-7 9.5-4.1-1.9-7-5.5-7-9.5V6l7-3z" />
            </svg>
          </span>
          <span>{{ t()('nav.admin') }}</span>
        </a>
      }
      <a
        href="/settings"
        class="tab"
        [class.is-active]="settingsActive()"
        (click)="onTabClick($event, '/settings')"
      >
        <span class="tab__glyph">
          <!-- Heroicons cog-6-tooth — одна геометрия outline/solid, центр 12×12 -->
          <svg class="tab__icon tab__icon--outline" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
            />
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <svg class="tab__icon tab__icon--filled" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.923-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
            />
          </svg>
        </span>
        <span>{{ t()('nav.settings') }}</span>
      </a>
    </nav>
  `,
  styles: `
    :host {
      display: contents;
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
      transform: translate3d(-50%, 0, 0);
      transition: opacity var(--duration-fast) ease;
    }

    /* Оверлеи из router-outlet ниже таббара — скрываем, чтобы не перекрывал кнопки. */
    :host-context(html.fsp-overlay-open) .tabbar {
      opacity: 0;
      pointer-events: none;
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
      -webkit-tap-highlight-color: transparent;
      transition:
        background var(--duration-fast) ease,
        color var(--duration-fast) ease;
    }

    .tab:focus {
      outline: none;
    }

    .tab:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .tab span:last-child {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tab:hover {
      text-decoration: none;
      color: var(--text-strong);
    }

    .tab__glyph {
      display: grid;
      place-items: center;
      width: 21px;
      height: 21px;
    }

    .tab__icon {
      grid-area: 1 / 1;
      width: 21px;
      height: 21px;
    }

    .tab__icon--outline {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tab__icon--filled {
      fill: currentColor;
      stroke: none;
      opacity: 0;
    }

    .tab__icon--ball .ball-holes {
      fill: currentColor;
      stroke: none;
    }

    .tab.is-active {
      background: var(--accent-soft);
      color: var(--accent-strong);
    }

    .tab.is-active .tab__icon--outline {
      opacity: 0;
    }

    .tab.is-active .tab__icon--filled {
      opacity: 1;
    }
  `,
})
export class TabBar {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly i18n = inject(I18nService);
  private tabSwipeBusy = false;

  protected readonly session = inject(SessionStore);
  protected readonly preferences = inject(PreferencesService);
  protected readonly t = this.i18n.t;

  /** `/` в Mini App (hash Telegram игнорируется по умолчанию). */
  protected readonly rootActive = isActive('/', this.router, { paths: 'exact' });
  protected readonly tournamentsActive = isActive('/tournaments', this.router);
  protected readonly trainingsActive = isActive('/trainings', this.router);
  protected readonly aboutActive = isActive('/about', this.router);
  protected readonly playersActive = isActive('/players', this.router);
  protected readonly adminActive = isActive('/admin', this.router);
  protected readonly settingsActive = isActive('/settings', this.router);

  protected onTabClick(event: Event, target: string): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.blur();
    if (this.tabSwipeBusy) return;

    const current = pathFromUrlTree(
      this.router.lastSuccessfulNavigation()?.finalUrl ?? this.router.parseUrl(this.router.url),
    );
    if (current === target || (current === '/' && target === '/tournaments')) return;

    const direction = tabDirection(current, target);
    if (!direction) {
      void this.router.navigateByUrl(target);
      return;
    }

    this.tabSwipeBusy = true;
    void swipeToTab(this.router, this.injector, target, direction).finally(() => {
      this.tabSwipeBusy = false;
    });
  }
}
