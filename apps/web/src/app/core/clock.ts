import { Injectable, signal } from '@angular/core';

/**
 * Общий тикающий сигнал времени.
 *
 * Таймеры матчей считаются от серверного `startedAt`, а не тикают локально:
 * если экран уснул или страницу перезагрузили, на всех устройствах всё равно
 * останется одно и то же время. Здесь только источник «сейчас», по которому
 * пересчитываются шаблоны.
 */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly nowSignal = signal(Date.now());
  private timer: number | null = null;
  private subscribers = 0;

  readonly now = this.nowSignal.asReadonly();

  /** Пока есть хоть один живой таймер на экране, обновляем время раз в секунду. */
  acquire(): () => void {
    this.subscribers += 1;
    if (this.timer === null) {
      this.nowSignal.set(Date.now());
      this.timer = window.setInterval(() => this.nowSignal.set(Date.now()), 500);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.subscribers -= 1;
      if (this.subscribers <= 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }
}

/** Прошедшее время матча с учётом пауз. */
export function elapsedMs(
  match: {
    startedAt: string | null;
    pausedAt: string | null;
    pausedTotalMs: number;
    finishedAt: string | null;
  },
  now: number,
): number {
  if (!match.startedAt) return 0;
  const started = Date.parse(match.startedAt);
  const end = match.finishedAt
    ? Date.parse(match.finishedAt)
    : match.pausedAt
      ? Date.parse(match.pausedAt)
      : now;
  return Math.max(0, end - started - match.pausedTotalMs);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
