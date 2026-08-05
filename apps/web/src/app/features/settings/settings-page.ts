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
            </div>
            <app-rating-chip [player]="player" />
          </div>
          <a class="btn btn--sm btn--glass btn--block" [routerLink]="['/players', player.id]">
            {{ t()('player.profile') }}
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
            <span class="small muted">{{ t()('auth.notInTelegramHint') }}</span>
            @if (allowDevLogin()) {
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

      <section class="glass glass--subtle card--tight stack stack--3">
        <div class="row">
          <app-ball [size]="26" motion="bounce" />
          <div class="grow stack stack--1">
            <span class="strong">{{ t()('app.name') }}</span>
            <span class="tiny faint">
              {{ t()('settings.version') }} {{ version }} · {{ platform() }}
            </span>
          </div>
        </div>

        <button type="button" class="feedback" (click)="openFeedback()">
          <span class="small">{{ t()('settings.feedback') }}</span>
          <span class="feedback__handle">&#64;{{ feedbackHandle }}</span>
        </button>
      </section>
    </div>
  `,
  styles: `
    .feedback {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
      width: 100%;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--color-primary) 8%, transparent);
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: background var(--motion-fast);
    }

    .feedback:hover,
    .feedback:focus-visible {
      background: color-mix(in srgb, var(--color-primary) 16%, transparent);
    }

    .feedback__handle {
      font-weight: 600;
      color: var(--color-primary);
      white-space: nowrap;
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
}
