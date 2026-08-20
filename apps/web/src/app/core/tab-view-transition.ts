import { afterNextRender, Injector } from '@angular/core';
import type { Router } from '@angular/router';

/** Порядок табов слева направо. */
const TAB_ORDER = ['tournaments', 'trainings', 'about', 'players', 'admin', 'settings'] as const;

type TabKey = (typeof TAB_ORDER)[number];

export type TabDirection = 'forward' | 'back';

const SWIPE_MS = 320;

function rootSegmentFromUrl(url: string): string {
  const path = url.split('?')[0]?.split('#')[0] ?? '';
  return path.replace(/^\//, '').split('/')[0] ?? '';
}

function tabIndex(rootSegment: string): number {
  return TAB_ORDER.indexOf(rootSegment as TabKey);
}

export function tabDirection(
  fromUrlOrSegment: string,
  toUrlOrSegment: string,
): TabDirection | null {
  const fromRoot = fromUrlOrSegment.includes('/')
    ? rootSegmentFromUrl(fromUrlOrSegment)
    : fromUrlOrSegment;
  const toRoot = toUrlOrSegment.includes('/') ? rootSegmentFromUrl(toUrlOrSegment) : toUrlOrSegment;
  const fromIdx = tabIndex(fromRoot);
  const toIdx = tabIndex(toRoot);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return null;
  return toIdx > fromIdx ? 'forward' : 'back';
}

/** Флаг для withViewTransitions: на табах пропускаем VT (иначе остаётся fade). */
export function markTabSwipeActive(active: boolean): void {
  if (active) document.documentElement.dataset['tabSwipe'] = '1';
  else delete document.documentElement.dataset['tabSwipe'];
}

export function isTabSwipeActive(): boolean {
  return document.documentElement.dataset['tabSwipe'] === '1';
}

function reducedMotion(): boolean {
  return (
    document.documentElement.dataset['reducedMotion'] === 'true' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

function waitAnimation(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('animationend', done);
      resolve();
    };
    el.addEventListener('animationend', done);
    window.setTimeout(done, SWIPE_MS + 80);
  });
}

function afterRender(injector: Injector): Promise<void> {
  return new Promise((resolve) => {
    afterNextRender(() => resolve(), { injector });
  });
}

/**
 * Telegram-like горизонтальный свайп между табами без View Transitions.
 * Оба слоя (ghost и новый main) — position:fixed, чтобы translateX(+) не
 * расширял документ. Иначе на Android WebView появляется горизонтальный
 * скролл только «вперёд» и прыгает safe-area / таббар.
 */
export async function swipeToTab(
  router: Router,
  injector: Injector,
  target: string,
  direction: TabDirection,
): Promise<void> {
  const main = document.getElementById('main');
  if (!main || reducedMotion()) {
    markTabSwipeActive(true);
    try {
      await router.navigateByUrl(target);
    } finally {
      markTabSwipeActive(false);
    }
    return;
  }

  markTabSwipeActive(true);

  const rect = main.getBoundingClientRect();
  const header = document.querySelector('header.header');
  const slotTop = header?.getBoundingClientRect().bottom ?? Math.max(rect.top, 0);
  const slotHeight = Math.max(window.innerHeight - slotTop, 0);
  document.documentElement.style.setProperty('--tab-swipe-x', `${Math.round(window.innerWidth)}px`);

  const ghost = main.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.remove('vt-main');
  ghost.classList.add('tab-swipe-ghost', `tab-swipe-ghost--${direction}`);
  pinSwipeLayer(ghost, rect.top, rect.left, rect.width, rect.height, '35');
  ghost.style.pointerEvents = 'none';
  ghost.style.overflow = 'hidden';
  ghost.style.viewTransitionName = 'none';
  document.body.appendChild(ghost);

  const spacer = document.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.height = `${main.offsetHeight}px`;
  spacer.style.pointerEvents = 'none';
  main.insertAdjacentElement('afterend', spacer);

  pinSwipeLayer(main, slotTop, rect.left, rect.width, slotHeight, '36');
  main.style.overflow = 'hidden';
  main.style.viewTransitionName = 'none';
  main.classList.add('tab-swipe-main', `tab-swipe-main--${direction}`, 'tab-swipe-main--prep');

  try {
    // afterNextRender — до navigate: иначе пропускаем первый кадр (скелетон)
    // и ждём уже второй, когда пришёл список игроков.
    const painted = afterRender(injector);
    await router.navigateByUrl(target);
    await painted;
    await waitFrames(2);

    main.classList.remove('tab-swipe-main--prep');
    main.classList.add('tab-swipe-main--run');
    ghost.classList.add('tab-swipe-ghost--run');

    await Promise.all([waitAnimation(main), waitAnimation(ghost)]);
  } finally {
    ghost.remove();
    spacer.remove();
    unpinSwipeLayer(main);
    main.style.removeProperty('overflow');
    main.style.removeProperty('view-transition-name');
    main.classList.remove(
      'tab-swipe-main',
      'tab-swipe-main--forward',
      'tab-swipe-main--back',
      'tab-swipe-main--prep',
      'tab-swipe-main--run',
    );
    document.documentElement.style.removeProperty('--tab-swipe-x');
    markTabSwipeActive(false);
  }
}

function pinSwipeLayer(
  el: HTMLElement,
  top: number,
  left: number,
  width: number,
  height: number,
  zIndex: string,
): void {
  Object.assign(el.style, {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    margin: '0',
    zIndex,
    boxSizing: 'border-box',
  });
}

function unpinSwipeLayer(el: HTMLElement): void {
  el.style.removeProperty('position');
  el.style.removeProperty('top');
  el.style.removeProperty('left');
  el.style.removeProperty('width');
  el.style.removeProperty('height');
  el.style.removeProperty('margin');
  el.style.removeProperty('z-index');
  el.style.removeProperty('box-sizing');
}
