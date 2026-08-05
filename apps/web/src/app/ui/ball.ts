import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Мяч для пиклбола.
 *
 * Один и тот же мяч работает и логотипом в шапке, и индикатором загрузки:
 * приложение узнаётся по нему, а не по абстрактному спиннеру.
 */
@Component({
  selector: 'app-ball',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ball--spin]': "motion() === 'spin'",
    '[class.ball--bounce]': "motion() === 'bounce'",
    '[style.--ball-size.px]': 'size()',
  },
  template: `
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stop-color="var(--lime-300)" />
          <stop offset="1" stop-color="var(--lime-500)" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="19" [attr.fill]="'url(#' + gradientId + ')'" />
      <g fill="var(--lime-600)" opacity="0.7">
        <circle cx="20" cy="8.5" r="2.3" />
        <circle cx="29.5" cy="14.5" r="2.3" />
        <circle cx="29.5" cy="25.5" r="2.3" />
        <circle cx="20" cy="31.5" r="2.3" />
        <circle cx="10.5" cy="25.5" r="2.3" />
        <circle cx="10.5" cy="14.5" r="2.3" />
        <circle cx="20" cy="20" r="2.3" />
      </g>
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      width: var(--ball-size, 24px);
      height: var(--ball-size, 24px);
      filter: drop-shadow(0 2px 6px rgba(127, 160, 16, 0.4));
    }

    svg {
      width: 100%;
      height: 100%;
    }

    :host(.ball--spin) svg {
      animation: ball-spin 1.1s linear infinite;
    }

    :host(.ball--bounce) svg {
      animation: ball-bounce 1.3s var(--ease-out) infinite;
    }
  `,
})
export class Ball {
  readonly size = input(24);
  readonly motion = input<'none' | 'spin' | 'bounce'>('none');

  /** Уникальный id градиента: на странице может быть несколько мячей. */
  protected readonly gradientId = `ball-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ракетка: используется в пустых состояниях и на экране ожидания. */
@Component({
  selector: 'app-racket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.racket--swing]': 'swing()', '[style.--racket-size.px]': 'size()' },
  template: `
    <svg viewBox="0 0 48 64" aria-hidden="true">
      <ellipse
        cx="24"
        cy="22"
        rx="19"
        ry="21"
        fill="var(--clay-400)"
        stroke="var(--clay-600)"
        stroke-width="2.5"
      />
      <ellipse cx="24" cy="22" rx="13" ry="15" fill="var(--clay-500)" opacity="0.45" />
      <rect x="20.5" y="42" width="7" height="20" rx="3.5" fill="var(--clay-700)" />
      <rect x="18" y="56" width="12" height="6" rx="3" fill="var(--pink-500)" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      width: var(--racket-size, 48px);
      height: calc(var(--racket-size, 48px) * 1.33);
      transform-origin: 50% 90%;
    }

    svg {
      width: 100%;
      height: 100%;
    }

    :host(.racket--swing) {
      animation: racket-swing 1.6s var(--ease-spring) infinite alternate;
    }
  `,
})
export class Racket {
  readonly size = input(48);
  readonly swing = input(false);
}
