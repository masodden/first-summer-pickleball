import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { I18nService } from '../core/i18n';
import { SessionStore } from '../core/session';
import { swipeToTab, tabDirection } from '../core/tab-view-transition';

type TabId = 'tournaments' | 'players' | 'admin' | 'settings';

/**
 * Нижняя навигация + горизонтальный свайп между корневыми табами.
 */
@Component({
  selector: 'app-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      class="tabbar glass glass--strong vt-tabbar"
      [attr.aria-label]="t()('nav.tournaments')"
    >
      <a
        href="/tournaments"
        class="tab"
        [class.is-active]="activeTab() === 'tournaments'"
        (click)="onTabClick($event, '/tournaments')"
      >
        <span class="tab__glyph">
          <svg class="tab__icon tab__icon--outline" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          <svg class="tab__icon tab__icon--filled" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3.5 5.25h17a1.25 1.25 0 010 2.5h-17a1.25 1.25 0 010-2.5zm0 5.5h17a1.25 1.25 0 010 2.5h-17a1.25 1.25 0 010-2.5zm0 5.5h11a1.25 1.25 0 010 2.5h-11a1.25 1.25 0 010-2.5z"
            />
          </svg>
        </span>
        <span>{{ t()('nav.tournaments') }}</span>
      </a>
      <a
        href="/players"
        class="tab"
        [class.is-active]="activeTab() === 'players'"
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
      @if (session.isAdmin()) {
        <a
          href="/admin"
          class="tab"
          [class.is-active]="activeTab() === 'admin'"
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
        [class.is-active]="activeTab() === 'settings'"
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
      transform: translateX(-50%);
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
      transition:
        background var(--duration-fast) ease,
        color var(--duration-fast) ease;
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
  protected readonly t = this.i18n.t;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly activeTab = computed((): TabId | '' => {
    const root = this.url().split('?')[0]?.replace(/^\//, '').split('/')[0] ?? '';
    if (root === 'tournaments' || root === 'trainings') return 'tournaments';
    if (root === 'players' || root === 'admin' || root === 'settings') return root;
    return '';
  });

  protected onTabClick(event: Event, target: string): void {
    event.preventDefault();
    if (this.tabSwipeBusy) return;

    const current = this.url().split('?')[0] ?? '';
    if (current === target) return;

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
