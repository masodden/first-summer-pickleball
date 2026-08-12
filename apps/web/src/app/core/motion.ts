import type { ActivatedRouteSnapshot } from '@angular/router';
import { tabDirection } from './tab-view-transition';

const NAV_CLASSES = ['vt-push', 'vt-pop', 'vt-inner-forward', 'vt-inner-back'] as const;

const TOURNAMENT_TABS = ['info', 'players', 'rounds', 'standings'] as const;
const TRAINING_TABS = ['info', 'players'] as const;

export type NavMotion = 'tab' | 'push' | 'pop' | 'inner-forward' | 'inner-back' | 'fade';

const firstVisits = new Set<string>();

export function reducedMotion(): boolean {
  return (
    document.documentElement.dataset['reducedMotion'] === 'true' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Stagger только при первом появлении экрана за сессию. */
export function consumeFirstVisit(key: string): boolean {
  if (firstVisits.has(key)) return false;
  firstVisits.add(key);
  return true;
}

export function pathFromSnapshot(snapshot: ActivatedRouteSnapshot): string {
  let node: ActivatedRouteSnapshot = snapshot;
  while (node.parent) node = node.parent;
  const parts: string[] = [];
  let current: ActivatedRouteSnapshot | null = node;
  while (current) {
    for (const segment of current.url) parts.push(segment.path);
    current = current.firstChild;
  }
  return `/${parts.join('/')}`;
}

function parse(url: string): { parts: string[]; root: string; id: string | null; tab: string | null } {
  const parts = (url.split('?')[0]?.split('#')[0] ?? '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean);
  const root = parts[0] ?? '';
  const second = parts[1] ?? null;
  const id = second && second !== 'new' ? second : null;
  const tab = parts[2] ?? (id ? 'info' : null);
  return { parts, root, id, tab };
}

function innerIndex(root: string, tab: string | null): number {
  if (!tab) return -1;
  if (root === 'tournaments') return TOURNAMENT_TABS.indexOf(tab as (typeof TOURNAMENT_TABS)[number]);
  if (root === 'trainings') return TRAINING_TABS.indexOf(tab as (typeof TRAINING_TABS)[number]);
  return -1;
}

export function classifyNav(fromUrl: string, toUrl: string): NavMotion {
  if (tabDirection(fromUrl, toUrl)) return 'tab';

  const from = parse(fromUrl);
  const to = parse(toUrl);

  if (from.root === to.root && from.id && from.id === to.id) {
    const fromIdx = innerIndex(from.root, from.tab);
    const toIdx = innerIndex(to.root, to.tab);
    if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
      return toIdx > fromIdx ? 'inner-forward' : 'inner-back';
    }
  }

  if (
    !from.id &&
    !to.id &&
    (from.root === 'tournaments' || from.root === 'trainings') &&
    (to.root === 'tournaments' || to.root === 'trainings') &&
    from.root !== to.root
  ) {
    return to.root === 'trainings' ? 'inner-forward' : 'inner-back';
  }

  if (to.parts.length > from.parts.length) return 'push';
  if (to.parts.length < from.parts.length) return 'pop';
  return 'fade';
}

export function applyNavViewTransition(fromUrl: string, toUrl: string): void {
  const root = document.documentElement;
  for (const name of NAV_CLASSES) root.classList.remove(name);

  if (reducedMotion()) return;

  const kind = classifyNav(fromUrl, toUrl);
  if (kind === 'push') root.classList.add('vt-push');
  else if (kind === 'pop') root.classList.add('vt-pop');
  else if (kind === 'inner-forward') root.classList.add('vt-inner-forward');
  else if (kind === 'inner-back') root.classList.add('vt-inner-back');
}

export function clearNavViewTransition(): void {
  document.documentElement.classList.remove(...NAV_CLASSES);
}
