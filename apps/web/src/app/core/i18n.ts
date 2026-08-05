import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  DEFAULT_LOCALE,
  DICTIONARIES,
  pluralize,
  resolveLocale,
  translate,
  type Locale,
  type TranslationKey,
  type TranslationParams,
} from '@fsp/shared';
import { TelegramService } from './telegram';

const STORAGE_KEY = 'fsp.locale';

/**
 * Локализация на сигналах.
 *
 * Язык по умолчанию русский. Если приложение открыто в Telegram, берём язык
 * интерфейса пользователя. Выбор в настройках переопределяет всё и переключает
 * язык без перезагрузки: словари уже в бандле.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly telegram = inject(TelegramService);
  private readonly current = signal<Locale>(this.detectInitial());

  readonly locale = this.current.asReadonly();
  readonly available = Object.keys(DICTIONARIES) as Locale[];

  /**
   * Функция перевода, зависящая от сигнала языка: любое использование в шаблоне
   * автоматически пересчитывается при переключении.
   */
  readonly t = computed(() => {
    const locale = this.current();
    return (key: TranslationKey, params?: TranslationParams): string =>
      translate(locale, key, params);
  });

  constructor() {
    effect(() => {
      const locale = this.current();
      document.documentElement.lang = locale;
      try {
        localStorage.setItem(STORAGE_KEY, locale);
      } catch {
        // Приватный режим может запрещать хранилище — язык просто не запомнится.
      }
    });
  }

  setLocale(locale: Locale): void {
    this.current.set(locale);
  }

  translate(key: TranslationKey, params?: TranslationParams): string {
    return translate(this.current(), key, params);
  }

  plural(count: number, forms: readonly [string, string, string]): string {
    return pluralize(this.current(), count, forms);
  }

  /** «12 игроков», «3 корта» — с правильной формой слова. */
  players(count: number): string {
    return this.current() === 'en'
      ? `${count} ${count === 1 ? 'player' : 'players'}`
      : `${count} ${this.plural(count, ['игрок', 'игрока', 'игроков'])}`;
  }

  courts(count: number): string {
    return this.current() === 'en'
      ? `${count} ${count === 1 ? 'court' : 'courts'}`
      : `${count} ${this.plural(count, ['корт', 'корта', 'кортов'])}`;
  }

  /**
   * Подпись корта у матча. Номер получает слово «Корт», собственное название
   * выводится как есть: «Центральный», а не «Корт Центральный».
   */
  court(name: string): string {
    return /^\d+$/.test(name) ? this.translate('match.court', { number: name }) : name;
  }

  games(count: number): string {
    return this.current() === 'en'
      ? `${count} ${count === 1 ? 'game' : 'games'}`
      : `${count} ${this.plural(count, ['игра', 'игры', 'игр'])}`;
  }

  formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(this.current() === 'en' ? 'en-GB' : 'ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(date);
  }

  formatDay(value: string | Date): string {
    return this.formatDate(value, { hour: undefined, minute: undefined, year: 'numeric' });
  }

  private detectInitial(): Locale {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'ru' || stored === 'en') return stored;
    } catch {
      // Хранилище недоступно — идём дальше по цепочке определения.
    }
    const fromTelegram = this.telegram.languageCode;
    if (fromTelegram) return resolveLocale(fromTelegram);
    return DEFAULT_LOCALE;
  }
}
