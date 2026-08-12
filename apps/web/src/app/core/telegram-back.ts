import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ConfirmService } from './confirm';
import { TelegramService } from './telegram';

/** Корневые экраны таббара — здесь «назад» должна закрывать Mini App. */
const ROOT_PATHS = new Set(['/tournaments', '/trainings', '/players', '/admin']);

/**
 * Нативная «назад» в Telegram Mini App.
 *
 * Пока виден WebApp.BackButton, Android system back вызывает его, а не сворачивает
 * приложение. Сначала закрываем confirm/оверлей, иначе шаг назад по нашему стеку
 * (не browser history — после deep-link history.back() часто закрывает Mini App).
 */
@Injectable({ providedIn: 'root' })
export class TelegramBackNavigation {
  private readonly telegram = inject(TelegramService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly url = signal(normalizePath(this.router.url));
  /** Открытые sheet/picker — back сначала закрывает их. */
  private readonly overlayDepth = signal(0);
  private stack: string[] = [normalizePath(this.router.url)];
  private navigatingBack = false;
  private started = false;

  constructor() {
    // effect в конструкторе — injection context гарантирован (после await в initializer теряется).
    effect(() => {
      if (!this.started) return;
      this.url();
      this.overlayDepth();
      this.confirm.request();
      untracked(() => this.syncButton());
    });
  }

  start(): void {
    if (this.started || !this.telegram.available) return;
    this.started = true;

    const stop = this.telegram.onBackButton(() => this.handleBack());
    this.destroyRef.onDestroy(() => {
      stop();
      this.telegram.setBackButtonVisible(false);
    });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        const next = normalizePath(event.urlAfterRedirects);
        this.url.set(next);
        this.pushUrl(next);
      });

    this.syncButton();
  }

  /** Пока открыт оверлей — BackButton виден даже на корневом табе. */
  acquireOverlay(): () => void {
    this.overlayDepth.update((n) => n + 1);
    return () => {
      this.overlayDepth.update((n) => Math.max(0, n - 1));
    };
  }

  private pushUrl(next: string): void {
    if (this.navigatingBack) {
      this.navigatingBack = false;
      const idx = this.stack.lastIndexOf(next);
      this.stack = idx >= 0 ? this.stack.slice(0, idx + 1) : [next];
      return;
    }

    const top = this.stack[this.stack.length - 1];
    if (top === next) return;

    // Переключение таба с корня — начинаем новую ветку.
    if (ROOT_PATHS.has(next)) {
      this.stack = [next];
      return;
    }

    this.stack.push(next);
  }

  private syncButton(): void {
    const show =
      this.overlayDepth() > 0 || this.confirm.request() !== null || !ROOT_PATHS.has(this.url());
    this.telegram.setBackButtonVisible(show);
  }

  private handleBack(): void {
    if (this.confirm.request()) {
      this.confirm.answer(false);
      return;
    }

    if (this.overlayDepth() > 0) {
      document.dispatchEvent(new CustomEvent('fsp:back'));
      return;
    }

    if (ROOT_PATHS.has(this.url())) {
      this.telegram.setBackButtonVisible(false);
      return;
    }

    if (this.stack.length > 1) {
      this.stack.pop();
      const prev = this.stack[this.stack.length - 1] ?? this.fallbackParent(this.url());
      this.navigatingBack = true;
      void this.router.navigateByUrl(prev);
      return;
    }

    this.navigatingBack = true;
    void this.router.navigateByUrl(this.fallbackParent(this.url()));
  }

  private fallbackParent(path: string): string {
    if (path.startsWith('/tournaments/')) return '/tournaments';
    if (path.startsWith('/trainings/')) return '/trainings';
    if (path.startsWith('/players/')) return '/players';
    if (path.startsWith('/settings')) return '/players';
    if (path.startsWith('/claim')) return '/settings';
    return '/tournaments';
  }
}

function normalizePath(url: string): string {
  const path = url.split('?')[0]?.split('#')[0] ?? '';
  if (!path || path === '/') return '/tournaments';
  return path.replace(/\/$/, '') || '/tournaments';
}
