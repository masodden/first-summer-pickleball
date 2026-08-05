import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Подтверждение необратимых действий.
 *
 * Удаление турнира и его завершение спрашиваются явно: во время игры телефон
 * лежит в кармане, и случайное нажатие не должно стоить всей истории.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly pending = signal<PendingConfirm | null>(null);
  readonly request = this.pending.asReadonly();

  ask(options: ConfirmOptions): Promise<boolean> {
    // Предыдущий вопрос закрываем как отказ, чтобы не копить диалоги.
    this.pending()?.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.pending.set({ ...options, resolve });
    });
  }

  answer(value: boolean): void {
    const current = this.pending();
    if (!current) return;
    this.pending.set(null);
    current.resolve(value);
  }
}
