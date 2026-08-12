import { DestroyRef } from '@angular/core';

/**
 * Telegram WebView + backdrop-filter: нижние glass-строки иногда «залипают»
 * (полупрозрачная плёнка, особенно поверх аватарки). Клик по карточке чинит —
 * значит достаточно инвалидации paint, без Angular remount.
 *
 * После остановки скролла у низа страницы коротко форсируем композитинг
 * на `.person.glass`. Remount `@for` не делаем: он тяжелее и заново рвёт <img>.
 */
export function bindGlassListRepaint(
  options: {
    destroyRef: DestroyRef;
    paused?: () => boolean;
    itemCount?: () => number;
    minItems?: number;
    /** Насколько близко к низу страницы считаем «доскроллили». */
    bottomSlackPx?: number;
    cooldownMs?: number;
  },
): void {
  const minItems = options.minItems ?? 7;
  const bottomSlackPx = options.bottomSlackPx ?? 160;
  const cooldownMs = options.cooldownMs ?? 700;
  let debounceTimer: number | null = null;
  let dirty = false;
  let lastFlushAt = 0;

  const clearTimer = (): void => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const nearBottom = (): boolean => {
    const doc = document.documentElement;
    const remaining = doc.scrollHeight - (window.scrollY + window.innerHeight);
    return remaining <= bottomSlackPx;
  };

  const shouldSkip = (): boolean => {
    if (options.paused?.()) return true;
    if ((options.itemCount?.() ?? minItems) < minItems) return true;
    const overflow = document.documentElement.scrollHeight - window.innerHeight;
    if (overflow < 80) return true;
    if (!nearBottom()) return true;
    return false;
  };

  const flush = (): void => {
    if (!dirty) return;
    dirty = false;
    clearTimer();
    if (shouldSkip()) return;
    const now = Date.now();
    if (now - lastFlushAt < cooldownMs) return;
    lastFlushAt = now;

    requestAnimationFrame(() => {
      if (shouldSkip()) return;
      const rows = document.querySelectorAll<HTMLElement>('.person.glass');
      if (rows.length === 0) return;

      for (const row of rows) {
        row.classList.add('is-glass-flush');
      }
      // Чтение layout — типичный способ сбросить залипший слой в WebKit.
      void document.documentElement.offsetHeight;

      requestAnimationFrame(() => {
        for (const row of rows) {
          row.classList.remove('is-glass-flush');
        }
      });
    });
  };

  const onScroll = (): void => {
    dirty = true;
    clearTimer();
    debounceTimer = window.setTimeout(flush, 180);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scrollend', flush, { passive: true });
  window.addEventListener('touchend', flush, { passive: true });

  options.destroyRef.onDestroy(() => {
    clearTimer();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('scrollend', flush);
    window.removeEventListener('touchend', flush);
  });
}
