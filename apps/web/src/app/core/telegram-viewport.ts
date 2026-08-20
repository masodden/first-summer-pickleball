/**
 * Высота Mini App на desktop Telegram (особенно macOS) часто не равна
 * `100dvh` / `window.innerHeight`: WebView рисует своё окно, а документ
 * считает другой viewport. Из-за этого появляется системный скролл,
 * «залипает» высота после длинной вкладки и контент не доезжает до таббара.
 *
 * Берём стабильную высоту из Telegram, иначе visualViewport, иначе innerHeight.
 */
export function pickAppHeight(options: {
  stableHeight?: number;
  viewportHeight?: number;
  visualHeight?: number;
  innerHeight: number;
}): number {
  for (const value of [
    options.stableHeight,
    options.viewportHeight,
    options.visualHeight,
    options.innerHeight,
  ]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.round(value);
    }
  }
  return Math.round(options.innerHeight);
}

export function applyAppHeight(options: {
  stableHeight?: number;
  viewportHeight?: number;
  visualHeight?: number;
  innerHeight: number;
}): number {
  const height = pickAppHeight(options);
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  return height;
}

/**
 * На iOS/Android резиновый отскок двигает хедер и таббар, только если
 * скроллится сам документ. На desktop Telegram тот же документ ломает высоту —
 * там оставляем внутренний скролл.
 */
export function usesInnerAppScroll(
  platform: string,
  finePointer = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
): boolean {
  if (platform === 'ios' || platform === 'android') return false;
  if (platform === 'web' || platform === 'unknown') return finePointer();
  return true;
}

export function syncAppScrollMode(platform: string): void {
  document.documentElement.dataset['appScroll'] = usesInnerAppScroll(platform) ? 'inner' : 'page';
}

export function appScrollRoot(): HTMLElement {
  if (document.documentElement.dataset['appScroll'] === 'inner') {
    return document.getElementById('main') ?? document.documentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

type ViewportHost = {
  viewportHeight?: number;
  viewportStableHeight?: number;
  isExpanded?: boolean;
  expand(): void;
  onEvent?(event: string, handler: () => void): void;
};

/**
 * Пишет `--app-height` и держит Mini App развёрнутым при ресайзе окна Telegram.
 */
export function bindAppViewport(app: ViewportHost | undefined): void {
  const apply = () => {
    applyAppHeight({
      stableHeight: app?.viewportStableHeight,
      viewportHeight: app?.viewportHeight,
      visualHeight: window.visualViewport?.height,
      innerHeight: window.innerHeight,
    });
    if (app && app.isExpanded === false) app.expand();
  };

  apply();
  app?.onEvent?.('viewportChanged', apply);
  app?.onEvent?.('safeAreaChanged', apply);
  app?.onEvent?.('contentSafeAreaChanged', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
}
