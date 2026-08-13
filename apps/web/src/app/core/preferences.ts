import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { TelegramService } from './telegram';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'fsp.theme';
const MOTION_KEY = 'fsp.reducedMotion';
const HIDE_ABOUT_TAB_KEY = 'fsp.hideAboutTab';

/**
 * Оформление и анимации.
 *
 * Внутри Telegram тема приходит от клиента, поэтому приложение выглядит частью
 * мессенджера. Вне Telegram берём системную. Отдельный переключатель «меньше
 * анимаций» нужен для тех, кому мяч и стекло мешают. Вкладку «Об игре» можно
 * спрятать локально — без записи на сервер.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly telegram = inject(TelegramService);
  private readonly systemDark = signal(
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  private readonly themeSignal = signal<ThemePreference>(this.readTheme());
  private readonly reducedMotionSignal = signal(this.readMotion());
  private readonly hideAboutTabSignal = signal(this.readHideAboutTab());

  readonly theme = this.themeSignal.asReadonly();
  readonly reducedMotion = this.reducedMotionSignal.asReadonly();
  readonly hideAboutTab = this.hideAboutTabSignal.asReadonly();

  readonly resolvedTheme = computed<'light' | 'dark'>(() => {
    const preference = this.themeSignal();
    if (preference !== 'system') return preference;
    if (this.telegram.available) return this.telegram.colorScheme();
    return this.systemDark() ? 'dark' : 'light';
  });

  constructor() {
    window
      .matchMedia?.('(prefers-color-scheme: dark)')
      .addEventListener('change', (event) => this.systemDark.set(event.matches));

    effect(() => {
      const theme = this.resolvedTheme();
      document.documentElement.dataset['theme'] = theme;
      document.documentElement.dataset['reducedMotion'] = String(this.reducedMotionSignal());
    });
  }

  setTheme(theme: ThemePreference): void {
    this.themeSignal.set(theme);
    this.store(THEME_KEY, theme);
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotionSignal.set(value);
    this.store(MOTION_KEY, String(value));
  }

  setHideAboutTab(value: boolean): void {
    this.hideAboutTabSignal.set(value);
    this.store(HIDE_ABOUT_TAB_KEY, String(value));
  }

  private readTheme(): ThemePreference {
    const raw = this.read(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  }

  private readMotion(): boolean {
    return this.read(MOTION_KEY) === 'true';
  }

  private readHideAboutTab(): boolean {
    return this.read(HIDE_ABOUT_TAB_KEY) === 'true';
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private store(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Настройка не сохранится между сессиями — это не повод падать.
    }
  }
}
