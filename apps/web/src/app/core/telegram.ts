import { Injectable, signal } from '@angular/core';
import { bindAppViewport } from './telegram-viewport';

interface TelegramHaptics {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}

interface TelegramBackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { language_code?: string } };
  colorScheme?: 'light' | 'dark';
  version?: string;
  platform?: string;
  viewportHeight?: number;
  viewportStableHeight?: number;
  isExpanded?: boolean;
  BackButton?: TelegramBackButton;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  openLink?(url: string): void;
  openTelegramLink?(url: string): void;
  /** Bot API 8.0+: нативный диалог сохранения файла (iOS/Android WebView). */
  downloadFile?(
    params: { url: string; file_name: string },
    callback?: (accepted: boolean) => void,
  ): void;
  isVersionAtLeast?(version: string): boolean;
  HapticFeedback?: TelegramHaptics;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
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
  private closingGuards = 0;

  /** Есть ли живой Telegram WebApp с initData (пересчитываем — скрипт может ожить позже). */
  get available(): boolean {
    return Boolean(this.app?.initData && this.app.initData.length > 0);
  }

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
    document.documentElement.dataset['tgPlatform'] = this.platform;
    if (this.available) document.documentElement.classList.add('in-tg');
    bindAppViewport(this.app);
    if (!this.app) return;
    this.app.ready();
    this.app.expand();
    // Иначе свайп вниз закрывает приложение прямо во время ввода счёта.
    this.app.disableVerticalSwipes?.();
    this.app.onEvent?.('themeChanged', () => {
      this.colorScheme.set(this.app?.colorScheme ?? 'light');
    });
  }

  /**
   * Кнопка «назад» в шапке Telegram.
   * Пока видна — системная «назад» на Android тоже уходит сюда, а не закрывает Mini App.
   */
  setBackButtonVisible(visible: boolean): void {
    const button = this.app?.BackButton;
    if (!button?.show || !button?.hide) return;
    try {
      if (visible) button.show();
      else button.hide();
    } catch {
      // Старые клиенты без BackButton API.
    }
  }

  /** Подписка на BackButton / Android system back. Возвращает отписку. */
  onBackButton(handler: () => void): () => void {
    const button = this.app?.BackButton;
    if (button?.onClick && button?.offClick) {
      button.onClick(handler);
      return () => button.offClick(handler);
    }
    // Fallback на событие WebApp.
    this.app?.onEvent?.('backButtonClicked', handler);
    return () => this.app?.offEvent?.('backButtonClicked', handler);
  }

  tap(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    if (!this.hapticsEnabled()) return;
    try {
      this.app?.HapticFeedback?.impactOccurred(style);
    } catch {
      // Desktop и старые клиенты: метод есть, но вызов бросает.
    }
  }

  notify(type: 'error' | 'success' | 'warning'): void {
    if (!this.hapticsEnabled()) return;
    try {
      this.app?.HapticFeedback?.notificationOccurred(type);
    } catch {
      // Desktop и старые клиенты.
    }
  }

  select(): void {
    if (!this.hapticsEnabled()) return;
    try {
      this.app?.HapticFeedback?.selectionChanged();
    } catch {
      // Desktop и старые клиенты.
    }
  }

  /**
   * Пока открыт ввод счёта — свайп вниз не закрывает Mini App.
   * Несколько карточек делят один счётчик.
   */
  acquireClosingConfirmation(): () => void {
    if (!this.app?.enableClosingConfirmation) return () => undefined;
    this.closingGuards += 1;
    if (this.closingGuards === 1) {
      try {
        this.app.enableClosingConfirmation();
      } catch {
        this.closingGuards = 0;
        return () => undefined;
      }
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.closingGuards = Math.max(0, this.closingGuards - 1);
      if (this.closingGuards === 0) {
        try {
          this.app?.disableClosingConfirmation?.();
        } catch {
          // Старые клиенты.
        }
      }
    };
  }

  /** Шаринг ссылки в чат Telegram, иначе обычное открытие. */
  shareUrl(url: string, text?: string): void {
    const share = new URL('https://t.me/share/url');
    share.searchParams.set('url', url);
    if (text) share.searchParams.set('text', text);
    this.openExternal(share.toString());
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

  private hapticsEnabled(): boolean {
    return document.documentElement.dataset['reducedMotion'] !== 'true';
  }

  /**
   * Скачивание файла в Mini App.
   *
   * Обычный `<a download>` в WebView Telegram на iOS/Android не работает
   * (sandbox без allow-downloads). Нужен нативный `downloadFile` или открытие
   * ссылки во внешнем браузере. URL должен быть https и отдавать файл с
   * Content-Disposition: attachment.
   */
  tryDownloadFile(url: string, fileName: string): boolean {
    const app = this.app;
    if (!app?.downloadFile) return false;
    if (app.isVersionAtLeast && !app.isVersionAtLeast('8.0')) return false;
    try {
      app.downloadFile({ url, file_name: fileName });
      return true;
    } catch {
      return false;
    }
  }
}
