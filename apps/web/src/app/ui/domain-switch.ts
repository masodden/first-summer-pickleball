import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { I18nService } from '../core/i18n';

type DomainItem = {
  path: '/tournaments' | '/trainings';
  labelKey: 'nav.tournaments' | 'nav.trainings';
};

const DOMAINS: readonly DomainItem[] = [
  { path: '/tournaments', labelKey: 'nav.tournaments' },
  { path: '/trainings', labelKey: 'nav.trainings' },
];

/**
 * Компактный переключатель Турниры / Тренировки в шапке списка.
 * Активный пункт всегда слева и крупнее, соседний — серым справа.
 */
@Component({
  selector: 'app-domain-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <nav class="domain-switch" [attr.aria-label]="t()('nav.tournaments')">
      @for (item of ordered(); track item.path) {
        <a
          class="domain-switch__item"
          [class.is-active]="item.path === activePath()"
          [routerLink]="item.path"
          [attr.aria-current]="item.path === activePath() ? 'page' : null"
        >
          {{ t()(item.labelKey) }}
        </a>
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      flex: 1 1 auto;
    }

    .domain-switch {
      display: inline-flex;
      align-items: baseline;
      flex-wrap: nowrap;
      gap: 0.65em;
      min-width: 0;
    }

    .domain-switch__item {
      font-family: inherit;
      font-size: clamp(1.05rem, 3.4vw, 1.25rem);
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.15;
      white-space: nowrap;
      color: var(--text-muted);
      text-decoration: none;
      transition:
        color var(--duration-fast) ease,
        font-size var(--duration-fast) ease;
    }

    .domain-switch__item:hover {
      text-decoration: none;
      color: var(--text);
    }

    .domain-switch__item.is-active {
      font-size: clamp(1.45rem, 4.8vw, 1.75rem);
      font-weight: 800;
      color: var(--text-strong);
    }
  `,
})
export class DomainSwitch {
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  protected readonly t = this.i18n.t;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly activePath = computed(() => {
    const current = this.url();
    return current.startsWith('/trainings') ? '/trainings' : '/tournaments';
  });

  protected readonly ordered = computed(() => {
    const active = this.activePath();
    return [...DOMAINS].sort((a, b) => Number(b.path === active) - Number(a.path === active));
  });
}
