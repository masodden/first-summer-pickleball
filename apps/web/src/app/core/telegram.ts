import { Injectable, signal } from '@angular/core';

interface TelegramHaptics {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { language_code?: string } };
  colorScheme?: 'light' | 'dark';
  version?: string;
  platform?: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  openLink?(url: string): void;
  openTelegramLink?(url: string): void;
  HapticFeedback?: TelegramHaptics;
  onEvent?(event: string, handler: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/**
 * Тонкая обёртка над Telegram Mini App.
 *
 * Приложение обязано работать и в обычном браузере: наблюдатель смотрит табло
 * без Telegram. Поэтому все вызовы здесь необязательные, а `available`
 * показывает, есть ли рядом Telegram.
 */
@Injectable({ providedIn: 'root' })
export class TelegramService {
  private readonly app = window.Telegram?.WebApp;

  readonly available = Boolean(this.app?.initData && this.app.initData.length > 0);
  readonly colorScheme = signal<'light' | 'dark'>(this.app?.colorScheme ?? 'light');

  get initData(): string | null {
    return this.app?.initData?.length ? this.app.initData : null;
  }

  get languageCode(): string | null {
    return this.app?.initDataUnsafe?.user?.language_code ?? null;
  }

  /**
   * Параметр из deep-link (`startapp` / `startattach`).
   * Telegram кладёт его в initDataUnsafe, в initData и иногда в tgWebAppStartParam.
   */
  get startParam(): string | null {
    const fromUnsafe = this.app?.initDataUnsafe?.start_param;
    if (fromUnsafe) return fromUnsafe;

    if (this.app?.initData) {
      try {
        const fromInit = new URLSearchParams(this.app.initData).get('start_param');
        if (fromInit) return fromInit;
      } catch {
        // ignore
      }
    }

    try {
      const fromQuery = new URLSearchParams(window.location.search).get('tgWebAppStartParam');
      if (fromQuery) return fromQuery;
      const hash = window.location.hash.replace(/^#/, '');
      if (hash) {
        const fromHash = new URLSearchParams(hash).get('tgWebAppStartParam');
        if (fromHash) return fromHash;
      }
    } catch {
      // ignore
    }

    return null;
  }

  get platform(): string {
    return this.app?.platform ?? 'web';
  }

  init(): void {
    if (!this.app) return;
    this.app.ready();
    this.app.expand();
    // Иначе свайп вниз закрывает приложение прямо во время ввода счёта.
    this.app.disableVerticalSwipes?.();
    this.app.onEvent?.('themeChanged', () => {
      this.colorScheme.set(this.app?.colorScheme ?? 'light');
    });
  }

  tap(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    this.app?.HapticFeedback?.impactOccurred(style);
  }

  notify(type: 'error' | 'success' | 'warning'): void {
    this.app?.HapticFeedback?.notificationOccurred(type);
  }

  openExternal(url: string): void {
    // Ссылку на переписку открываем внутри мессенджера: openLink увёл бы в браузер.
    if (this.app?.openTelegramLink && url.startsWith('https://t.me/')) {
      this.app.openTelegramLink(url);
      return;
    }
    if (this.app?.openLink) this.app.openLink(url);
    else window.open(url, '_blank', 'noopener');
  }
}
