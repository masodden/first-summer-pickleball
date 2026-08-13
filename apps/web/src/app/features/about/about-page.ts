import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { TranslationKey } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { TelegramService } from '../../core/telegram';

/** Подставьте конкретное видео — пока поиск по правилам для новичков. */
const YOUTUBE_RU =
  'https://www.youtube.com/results?search_query=%D0%BF%D0%B8%D0%BA%D0%BB%D0%B1%D0%BE%D0%BB+%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D0%B0+%D0%B4%D0%BB%D1%8F+%D0%BD%D0%B0%D1%87%D0%B8%D0%BD%D0%B0%D1%8E%D1%89%D0%B8%D1%85';
const YOUTUBE_EN = 'https://www.youtube.com/results?search_query=pickleball+rules+for+beginners';

const RULE_CARDS: readonly {
  n: string;
  title: TranslationKey;
  body: TranslationKey;
  tone: 'clay' | 'lime' | 'pink' | 'gold';
}[] = [
  { n: '1', title: 'about.serveTitle', body: 'about.serveBody', tone: 'clay' },
  { n: '2', title: 'about.bounceTitle', body: 'about.bounceBody', tone: 'lime' },
  { n: '3', title: 'about.kitchenTitle', body: 'about.kitchenBody', tone: 'pink' },
  { n: '4', title: 'about.scoreTitle', body: 'about.scoreBody', tone: 'gold' },
];

const FAULTS: readonly TranslationKey[] = [
  'about.faultNet',
  'about.faultBounce',
  'about.faultBody',
  'about.faultOut',
  'about.faultKitchen',
  'about.faultReceiver',
];

/**
 * Правила пиклбола для новичков: схема корта, четыре карточки, одиночка/пара.
 * Корневой таб — Telegram BackButton скрыт, как у турниров и настроек.
 */
@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack stack--5">
      <header class="hero">
        <h1>{{ t()('about.title') }}</h1>
        <p class="lead">{{ t()('about.lead') }}</p>
        <p class="lead">{{ t()('about.lead2') }}</p>
      </header>

      <section class="glass glass--plain court-card stack stack--3">
        <div class="row row--between row--wrap">
          <h2 class="section-title">{{ t()('about.courtTitle') }}</h2>
          <span class="chip chip--go">{{ t()('about.dimNet') }} · {{ t()('about.courtNet') }}</span>
        </div>

        <svg
          class="court"
          viewBox="0 0 536 302"
          role="img"
          [attr.aria-label]="t()('about.courtCaption')"
        >
          <defs>
            <marker
              id="about-serve-head"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0 .4l6.2 2.6L0 5.6z" fill="var(--accent)" />
            </marker>
          </defs>

          <text class="dim dim--side" x="18" y="152" text-anchor="middle" transform="rotate(-90 18 152)">
            {{ t()('about.dimWidth') }}
          </text>

          <text class="dim" x="233" y="16" text-anchor="middle">{{ t()('about.dimKitchen') }}</text>
          <path class="dim-bracket" d="M198 26v10M268 26v10M198 31h70" />

          <rect class="floor" x="48" y="52" width="440" height="200" rx="8" />
          <rect class="service" x="48" y="52" width="150" height="200" />
          <rect class="service" x="338" y="52" width="150" height="200" />
          <rect class="kitchen" x="198" y="52" width="140" height="200" />

          <rect class="outline" x="48" y="52" width="440" height="200" rx="8" />
          <path class="line" d="M198 52v200M338 52v200" />
          <path class="line" d="M48 152h150M338 152h150" />
          <path class="net" d="M268 36v232" />
          <circle class="post" cx="268" cy="36" r="5" />
          <circle class="post" cx="268" cy="268" r="5" />

          <path
            class="serve-arc"
            d="M506 202C370 156 200 116 92 102"
            marker-end="url(#about-serve-head)"
          />

          <circle class="spot spot--serve" cx="506" cy="202" r="9" />
          <circle class="spot spot--return" cx="80" cy="102" r="9" />

          <text class="label label--stack" x="233" y="155">
            {{ t()('about.courtKitchen') }}
          </text>
          <text class="label label--stack" x="303" y="58">
            {{ t()('about.courtKitchen') }}
          </text>
          <text class="label" x="442" y="220" text-anchor="middle">
            {{ t()('about.courtServe') }}
          </text>
          <text class="label" x="86" y="84" text-anchor="middle">
            {{ t()('about.courtReceive') }}
          </text>

          <text class="dim" x="268" y="292" text-anchor="middle">{{ t()('about.dimLength') }}</text>
        </svg>

        <p class="small muted court-card__caption">{{ t()('about.courtCaption') }}</p>
        <p class="tiny faint">{{ t()('about.equipment') }}</p>
      </section>

      <section class="rules">
        @for (card of rules; track card.n) {
          <article class="glass glass--plain rule" [attr.data-tone]="card.tone">
            <div class="rule__head">
              <span class="rule__n" aria-hidden="true">{{ card.n }}</span>
              <h3>{{ t()(card.title) }}</h3>
            </div>
            <p>{{ t()(card.body) }}</p>
          </article>
        }
      </section>

      <p class="score-call glass glass--plain">{{ t()('about.scoreCall') }}</p>

      <section class="formats">
        <article class="glass glass--plain card--tight stack stack--2">
          <h3 class="section-title">{{ t()('about.singlesTitle') }}</h3>
          <p class="small muted">{{ t()('about.singlesBody') }}</p>
        </article>
        <article class="glass glass--plain card--tight stack stack--2">
          <h3 class="section-title">{{ t()('about.doublesTitle') }}</h3>
          <p class="small muted">{{ t()('about.doublesBody') }}</p>
        </article>
      </section>

      <section class="glass glass--plain card--tight stack stack--3">
        <h2 class="section-title">{{ t()('about.faultsTitle') }}</h2>
        <ul class="faults">
          @for (key of faults; track key) {
            <li>{{ t()(key) }}</li>
          }
        </ul>
      </section>

      <button type="button" class="btn btn--primary btn--block video" (click)="openVideo()">
        <svg class="video__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.2v13.6L20.2 12 8 5.2z" />
        </svg>
        {{ t()('about.video') }}
      </button>

      <section class="closing stack stack--3">
        <article class="glass glass--plain card--tight stack stack--2">
          <h2 class="section-title">{{ t()('about.historyTitle') }}</h2>
          <p class="small muted">{{ t()('about.historyBody') }}</p>
        </article>
        <article class="glass glass--plain card--tight stack stack--2 club">
          <h2 class="section-title">{{ t()('about.clubTitle') }}</h2>
          <p class="small muted">{{ t()('about.clubBody') }}</p>
        </article>
      </section>
    </div>
  `,
  styles: `
    .hero {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    h1 {
      margin: 0;
    }

    .lead {
      margin: 0;
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.5;
    }

    .section-title {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .court-card {
      padding: var(--space-4);
    }

    .court-card__caption {
      margin: 0;
      line-height: 1.45;
    }

    .court {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }

    .court text {
      font-family: var(--font-sans);
    }

    .floor {
      fill: color-mix(in srgb, var(--clay-400) 16%, var(--glass-bg-strong));
    }

    .service {
      fill: color-mix(in srgb, var(--accent) 7%, transparent);
    }

    .kitchen {
      fill: color-mix(in srgb, var(--lime-400) 34%, transparent);
    }

    .outline {
      fill: none;
      stroke: var(--text-strong);
      stroke-width: 2;
    }

    .line {
      fill: none;
      stroke: var(--text-strong);
      stroke-width: 1.35;
      opacity: 0.78;
    }

    .net {
      fill: none;
      stroke: var(--text-strong);
      stroke-width: 3;
      stroke-linecap: round;
    }

    .post {
      fill: var(--text-strong);
    }

    .dim-bracket {
      fill: none;
      stroke: var(--text-faint);
      stroke-width: 1.4;
      stroke-linecap: square;
    }

    .serve-arc {
      fill: none;
      stroke: var(--accent);
      stroke-width: 2;
      stroke-dasharray: 5 4;
      stroke-linecap: round;
    }

    .spot {
      stroke: var(--text-inverse);
      stroke-width: 1.75;
    }

    .spot--serve {
      fill: var(--accent);
    }

    .spot--return {
      fill: var(--success);
    }

    .label {
      fill: var(--text-strong);
      font-size: 17px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .label--stack {
      font-size: 14px;
      writing-mode: vertical-rl;
      text-orientation: upright;
      letter-spacing: -0.08em;
    }

    .dim {
      fill: var(--text-faint);
      font-size: 15px;
      font-weight: 650;
    }

    .rules {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
    }

    .rule {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-3);
      min-height: 100%;
    }

    .rule__head {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .rule h3 {
      margin: 0;
      font-size: 14px;
      line-height: 1.2;
    }

    .rule p {
      margin: 0;
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .rule__n {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border-radius: var(--radius-full);
      background: var(--accent-soft);
      color: var(--accent-strong);
      font-size: 12px;
      font-weight: 800;
    }

    .rule[data-tone='lime'] .rule__n {
      background: var(--success-soft);
      color: var(--success);
    }

    .rule[data-tone='pink'] .rule__n {
      background: color-mix(in srgb, var(--pink-400) 22%, transparent);
      color: var(--pink-600);
    }

    .rule[data-tone='gold'] .rule__n {
      background: color-mix(in srgb, var(--gold) 24%, transparent);
      color: color-mix(in srgb, var(--gold) 70%, var(--text-strong));
    }

    .score-call {
      margin: 0;
      padding: var(--space-3) var(--space-4);
      color: var(--text-muted);
      font-size: 13.5px;
      line-height: 1.45;
    }

    .formats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
    }

    .formats p {
      margin: 0;
      line-height: 1.45;
    }

    .faults {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .faults li {
      position: relative;
      padding-left: 16px;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.4;
    }

    .faults li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0.55em;
      width: 7px;
      height: 7px;
      border-radius: var(--radius-full);
      background: var(--accent);
    }

    .video__icon {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      fill: currentColor;
    }

    .club {
      border-color: color-mix(in srgb, var(--lime-400) 35%, var(--glass-border));
    }

    @media (max-width: 380px) {
      .rules,
      .formats {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AboutPage {
  private readonly i18n = inject(I18nService);
  private readonly telegram = inject(TelegramService);
  protected readonly t = this.i18n.t;
  protected readonly rules = RULE_CARDS;
  protected readonly faults = FAULTS;

  protected openVideo(): void {
    this.telegram.tap();
    const url = this.i18n.locale() === 'en' ? YOUTUBE_EN : YOUTUBE_RU;
    this.telegram.openExternal(url);
  }
}
