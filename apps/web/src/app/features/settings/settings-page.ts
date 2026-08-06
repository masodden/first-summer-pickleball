import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { APP_VERSION, FEEDBACK_TELEGRAM, SUPPORTED_LOCALES, type Locale } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { PreferencesService, type ThemePreference } from '../../core/preferences';
import { SessionStore } from '../../core/session';
import { TelegramService } from '../../core/telegram';
import { ToastService } from '../../core/toast';
import { Ball } from '../../ui/ball';
import { RatingChip } from '../../ui/rating-chip';

/**
 * Настройки.
 *
 * Язык переключается мгновенно: словари уже в бандле, перезагрузка не нужна.
 * Остальное — про оформление и уведомления, плюс короткая сводка о том, кто вы
 * в приложении и привязан ли DUPR.
 */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Ball, RatingChip],
  template: `
    <div class="stack stack--4">
      <h1>{{ t()('settings.title') }}</h1>

      <section class="glass card--tight stack stack--3">
        @if (session.player(); as player) {
          <div class="row">
            <div class="grow stack stack--1">
              <span class="strong">{{ player.fullName }}</span>
              <span class="tiny muted">{{ roleLabel() }}</span>
              @if (player.duprId) {
                <span class="tiny faint">{{ t()('claim.duprId') }}: {{ player.duprId }}</span>
              }
            </div>
            <app-rating-chip [player]="player" />
          </div>
          <a class="btn btn--sm btn--glass btn--block" [routerLink]="['/players', player.id]">
            {{ t()('player.profile') }}
          </a>
          <a class="btn btn--sm btn--glass btn--block" routerLink="/claim">
            {{ t()('claim.changeSubmit') }}
          </a>
        } @else if (session.isAuthenticated()) {
          <div class="stack stack--2">
            <span class="strong">{{ t()('claim.title') }}</span>
            <span class="small muted">{{ t()('claim.hint') }}</span>
            <a class="btn btn--primary btn--block" routerLink="/claim">{{ t()('claim.submit') }}</a>
          </div>
        } @else {
          <div class="stack stack--2">
            <span class="strong">{{ t()('auth.spectatorMode') }}</span>
            <span class="small muted">
              {{
                session.canSignInAgain()
                  ? t()('auth.signedOutHint')
                  : t()('auth.notInTelegramHint')
              }}
            </span>
            @if (session.canSignInAgain()) {
              <button type="button" class="btn btn--primary btn--block" (click)="signInAgain()">
                {{ t()('auth.signInAgain') }}
              </button>
            } @else if (allowDevLogin()) {
              <button type="button" class="btn btn--glass btn--block" (click)="devLogin()">
                {{ t()('auth.loginTelegram') }}
              </button>
            }
          </div>
        }
      </section>

      <section class="glass card--tight stack stack--3">
        <h3>{{ t()('settings.language') }}</h3>
        <div class="row">
          @for (locale of locales; track locale) {
            <button
              type="button"
              class="btn btn--sm grow"
              [class.btn--primary]="i18n.locale() === locale"
              [class.btn--glass]="i18n.locale() !== locale"
              (click)="setLocale(locale)"
            >
              {{ t()(locale === 'ru' ? 'settings.languageRu' : 'settings.languageEn') }}
            </button>
          }
        </div>
      </section>

      <section class="glass card--tight stack stack--3">
        <h3>{{ t()('settings.appearance') }}</h3>

        <div class="row">
          @for (option of themes; track option) {
            <button
              type="button"
              class="btn btn--sm grow"
              [class.btn--primary]="preferences.theme() === option"
              [class.btn--glass]="preferences.theme() !== option"
              (click)="preferences.setTheme(option)"
            >
              {{ themeLabel(option) }}
            </button>
          }
        </div>

        <div class="row row--between">
          <span class="grow">{{ t()('settings.reducedMotion') }}</span>
          <label class="switch">
            <input
              type="checkbox"
              [checked]="preferences.reducedMotion()"
              (change)="setReducedMotion($event)"
            />
            <span class="switch__track"></span>
            <span class="switch__thumb"></span>
          </label>
        </div>
      </section>

      @if (session.isAuthenticated()) {
        <section class="glass card--tight stack stack--2">
          <div class="row row--between">
            <div class="grow stack stack--1">
              <span>{{ t()('settings.notifications') }}</span>
              <span class="tiny faint">{{ t()('settings.notificationsHint') }}</span>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                [checked]="notifications()"
                (change)="setNotifications($event)"
              />
              <span class="switch__track"></span>
              <span class="switch__thumb"></span>
            </label>
          </div>
        </section>

        <button type="button" class="btn btn--danger btn--block" (click)="session.signOut()">
          {{ t()('auth.signOut') }}
        </button>
      }

      <section class="glass glass--subtle card--tight about">
        <div class="row about__head">
          <app-ball [size]="22" motion="bounce" />
          <div class="grow stack stack--1">
            <span class="strong">{{ t()('app.name') }}</span>
            <span class="tiny faint">
              {{ t()('settings.version') }} {{ version }} · {{ platform() }}
            </span>
          </div>
        </div>

        <button type="button" class="about__link" (click)="openFeedback()">
          <span class="about__badges" aria-hidden="true">
            <span class="about__badge about__badge--tg">
              <svg viewBox="0 0 24 24">
                <path
                  d="M21.5 4.5L2.8 11.6c-.7.27-.7.66-.13.83l4.8 1.5 1.84 5.64c.23.7.58.86 1.1.54l2.64-2.02 5.1 3.76c.94.52 1.62.25 1.86-.87l3.37-15.88c.34-1.36-.52-1.97-1.48-1.56zM9.3 14.2l9.5-6c.38-.23.73-.1.44.16l-7.7 6.96-.3 3.28-1.94-4.4z"
                />
              </svg>
            </span>
            <span class="about__badge about__badge--bug">
              <svg viewBox="0 0 24 24">
                <path
                  d="M20 8h-2.81a5.98 5.98 0 00-1.82-1.96L17 4.41 15.59 3l-2.17 2.17A6.07 6.07 0 0012 5c-.49 0-.96.06-1.42.17L8.41 3 7 4.41l1.62 1.63A5.98 5.98 0 006.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81A6.01 6.01 0 0012 21a6.01 6.01 0 005.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"
                />
              </svg>
            </span>
          </span>
          <span class="about__copy grow">
            <span class="small strong">{{ t()('settings.feedback') }}</span>
            <span class="tiny about__handle">&#64;{{ feedbackHandle }}</span>
          </span>
          <svg class="about__chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </section>
    </div>
  `,
  styles: `
    .about {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-3);
    }

    .about__head {
      gap: var(--space-2);
      min-height: 0;
    }

    .about__link {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      margin: 0;
      padding: 8px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-md);
      background: var(--accent-soft);
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: background var(--duration-fast);
    }

    .about__link:hover,
    .about__link:focus-visible {
      background: color-mix(in srgb, var(--accent) 18%, transparent);
    }

    .about__badges {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
    }

    .about__badge {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1.5px solid var(--glass-bg-strong);
    }

    .about__badge + .about__badge {
      margin-left: -8px;
    }

    .about__badge svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .about__badge--tg {
      background: #2aabee;
      color: #fff;
      z-index: 1;
    }

    .about__badge--tg svg {
      fill: currentColor;
      stroke: none;
    }

    .about__badge--bug {
      background: color-mix(in srgb, var(--warning) 22%, var(--glass-bg));
      color: var(--warning);
    }

    .about__badge--bug svg {
      fill: currentColor;
      stroke: none;
    }

    .about__copy {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      line-height: 1.2;
    }

    .about__handle {
      color: var(--accent-strong);
      font-weight: 600;
    }

    .about__chevron {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      fill: none;
      stroke: var(--text-faint);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class SettingsPage {
  private readonly telegram = inject(TelegramService);
  private readonly toast = inject(ToastService);

  protected readonly session = inject(SessionStore);
  protected readonly preferences = inject(PreferencesService);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly locales = SUPPORTED_LOCALES;
  protected readonly themes: ThemePreference[] = ['system', 'light', 'dark'];
  protected readonly version = APP_VERSION;
  protected readonly feedbackHandle = FEEDBACK_TELEGRAM;

  private readonly notificationsOverride = signal<boolean | null>(null);
  /** Пока пользователь не трогал переключатель, показываем значение с сервера. */
  protected readonly notifications = computed(
    () => this.notificationsOverride() ?? this.session.session()?.notificationsEnabled ?? true,
  );

  protected readonly platform = computed(() => this.telegram.platform);
  /** Локальный вход показываем только вне Telegram: там он не нужен. */
  protected readonly allowDevLogin = computed(
    () => !this.telegram.available && location.hostname === 'localhost',
  );

  protected readonly roleLabel = computed(() => {
    switch (this.session.role()) {
      case 'admin':
        return this.i18n.translate('role.admin');
      case 'moderator':
        return this.i18n.translate('role.moderator');
      case 'user':
        return this.i18n.translate('role.user');
      default:
        return this.i18n.translate('role.spectator');
    }
  });

  protected themeLabel(theme: ThemePreference): string {
    if (theme === 'light') return this.i18n.locale() === 'en' ? 'Light' : 'Светлая';
    if (theme === 'dark') return this.i18n.locale() === 'en' ? 'Dark' : 'Тёмная';
    return this.i18n.locale() === 'en' ? 'System' : 'Как в системе';
  }

  protected async setLocale(locale: Locale): Promise<void> {
    this.i18n.setLocale(locale);
    try {
      await this.session.updateSettings({ locale });
    } catch {
      // Язык уже переключён локально: несохранённая настройка не мешает работе.
    }
  }

  protected setReducedMotion(event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.preferences.setReducedMotion(value);
    void this.session.updateSettings({ reducedMotion: value }).catch(() => undefined);
  }

  protected async setNotifications(event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement).checked;
    this.notificationsOverride.set(value);
    try {
      await this.session.updateSettings({ notificationsEnabled: value });
      this.notificationsOverride.set(null);
      this.toast.success(this.i18n.translate('settings.saved'));
    } catch (error) {
      this.notificationsOverride.set(!value);
      this.toast.failure(error, () => void this.setNotifications(event));
    }
  }

  protected openFeedback(): void {
    this.telegram.openExternal(`https://t.me/${FEEDBACK_TELEGRAM}`);
  }

  protected async devLogin(): Promise<void> {
    try {
      await this.session.devLogin();
      this.toast.success(this.i18n.translate('settings.saved'));
    } catch (error) {
      this.toast.failure(error);
    }
  }

  protected async signInAgain(): Promise<void> {
    try {
      await this.session.signInAgain();
      this.toast.success(this.i18n.translate('settings.saved'));
    } catch (error) {
      this.toast.failure(error, () => void this.signInAgain());
    }
  }
}
