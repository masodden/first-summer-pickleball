import { DEFAULT_LOCALE, type Locale } from '../domain.js';
import { en } from './en.js';
import { ru, type TranslationKey } from './ru.js';

export type { TranslationKey };
export { ru, en };

export const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { ru, en };

export type TranslationParams = Record<string, string | number>;

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const template = dictionary[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (!params) return template;
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? `{{${name}}}` : String(value);
  });
}

/**
 * Русские числительные требуют трёх форм, английские — двух.
 * Используется для подписей вроде «12 игроков» и «3 корта».
 */
export function pluralize(
  locale: Locale,
  count: number,
  forms: readonly [string, string, string],
): string {
  if (locale === 'en') {
    return count === 1 ? forms[0] : forms[1];
  }
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function resolveLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const normalized = raw.toLowerCase().slice(0, 2);
  return normalized === 'en' ? 'en' : 'ru';
}
