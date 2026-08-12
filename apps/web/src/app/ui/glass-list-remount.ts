import { DestroyRef, type WritableSignal } from '@angular/core';

/**
 * После остановки скролла бампит generation — чтобы @for с track
 * `${generation}:${id}` пересоздал DOM строк. В Telegram WebView это
 * сбрасывает залипший backdrop-filter на нижних glass-карточках
 * без полной перезагрузки и без сети.
 *
 * Слушатели и debounce-таймер снимаются в destroyRef — утечек нет.
 * Короткие списки и страницы без реального скролла пропускаются.
 */
export function bindGlassListRemount(
  generation: WritableSignal<number>,
  options: {
    destroyRef: DestroyRef;
    /** Не перемонтировать во время редактирования / оверлея. */
    paused?: () => boolean;
    /** Сколько строк в списке сейчас (registered + waitlist). */
    itemCount?: () => number;
    /** Ниже этого числа remount не нужен — баг только у доскролла. */
    minItems?: number;
    minScrollY?: number;
    cooldownMs?: number;
  },
): void {
  const minScrollY = options.minScrollY ?? 48;
  const minItems = options.minItems ?? 7;
  const cooldownMs = options.cooldownMs ?? 500;
  let debounceTimer: number | null = null;
  let dirty = false;
  let lastRemountAt = 0;

  const clearTimer = (): void => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const shouldSkip = (): boolean => {
    if (options.paused?.()) return true;
    if (window.scrollY < minScrollY) return true;
    const overflow = document.documentElement.scrollHeight - window.innerHeight;
    if (overflow < minScrollY) return true;
    if ((options.itemCount?.() ?? minItems) < minItems) return true;
    return false;
  };

  const remount = (): void => {
    if (!dirty) return;
    dirty = false;
    clearTimer();
    if (shouldSkip()) return;
    const now = Date.now();
    if (now - lastRemountAt < cooldownMs) return;
    lastRemountAt = now;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (shouldSkip()) return;
        generation.update((value) => value + 1);
      });
    });
  };

  const onScroll = (): void => {
    dirty = true;
    clearTimer();
    // scrollend есть не везде (особенно iOS / Telegram) — debounce как запасной.
    debounceTimer = window.setTimeout(remount, 160);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scrollend', remount, { passive: true });
  // Отпускание пальца после жеста скролла — раньше, чем дождёмся debounce.
  window.addEventListener('touchend', remount, { passive: true });

  options.destroyRef.onDestroy(() => {
    clearTimer();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('scrollend', remount);
    window.removeEventListener('touchend', remount);
  });
}
