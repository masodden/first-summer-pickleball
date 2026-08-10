import { inject, Injectable, signal } from '@angular/core';
import type { TranslationKey } from '@fsp/shared';
import { ApiFailure } from './api';
import { I18nService } from './i18n';
import { TelegramService } from './telegram';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Кнопка «Повторить»: показывается только когда повтор осмысленен. */
  retry?: () => void;
  /** 0 — не скрывать автоматически. */
  timeout: number;
}

const ERROR_TITLES: Record<string, TranslationKey> = {
  unauthorized: 'errors.unauthorized',
  forbidden: 'errors.forbidden',
  not_found: 'errors.not_found',
  validation_failed: 'errors.validation_failed',
  conflict_version: 'errors.conflict_version',
  duplicate_dupr_id: 'errors.duplicate_dupr_id',
  dupr_id_already_claimed: 'errors.dupr_id_already_claimed',
  bootstrap_code_invalid: 'errors.bootstrap_code_invalid',
  invite_invalid: 'errors.invite_invalid',
  tournament_wrong_status: 'errors.tournament_wrong_status',
  already_in_parallel_tournament: 'errors.already_in_parallel_tournament',
  not_all_confirmed: 'errors.not_all_confirmed',
  not_enough_players: 'errors.not_enough_players',
  schedule_impossible: 'errors.schedule_impossible',
  round_not_finished: 'errors.round_not_finished',
  match_wrong_status: 'errors.match_wrong_status',
  score_required: 'errors.score_required',
  rate_limited: 'errors.rate_limited',
  internal: 'errors.internal',
  network: 'errors.network',
};

/**
 * Тосты.
 *
 * Ключевое требование: ни одно действие не должно «просто не сработать».
 * Поэтому любая ошибка показывается человеку, а если её можно повторить —
 * рядом появляется кнопка повтора того же самого действия.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly i18n = inject(I18nService);
  private readonly telegram = inject(TelegramService);
  private readonly items = signal<Toast[]>([]);
  private nextId = 1;

  readonly toasts = this.items.asReadonly();

  success(title: string, message?: string): void {
    this.telegram.notify('success');
    this.push({ kind: 'success', title, ...(message ? { message } : {}), timeout: 2600 });
  }

  info(title: string, message?: string): void {
    this.push({ kind: 'info', title, ...(message ? { message } : {}), timeout: 3400 });
  }

  error(title: string, message?: string, retry?: () => void): void {
    this.telegram.notify('error');
    this.push({
      kind: 'error',
      title,
      ...(message ? { message } : {}),
      ...(retry ? { retry } : {}),
      // Ошибку с повтором не убираем сама: человек должен решить, что делать.
      timeout: retry ? 0 : 5200,
    });
  }

  /** Превращает ошибку API в тост с правильным текстом и кнопкой повтора. */
  failure(error: unknown, retry?: () => void): void {
    const t = this.i18n.t();

    if (error instanceof ApiFailure) {
      const key = ERROR_TITLES[error.code] ?? 'errors.unknown';
      const title = t(key);
      const details = error.message && error.message !== title ? error.message : undefined;
      this.error(title, details, error.retryable ? retry : undefined);
      return;
    }

    this.error(t('errors.actionFailed'), error instanceof Error ? error.message : undefined, retry);
  }

  dismiss(id: number): void {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }

  clear(): void {
    this.items.set([]);
  }

  private push(toast: Omit<Toast, 'id'>): void {
    const id = this.nextId++;
    this.items.update((items) => [...items.slice(-3), { ...toast, id }]);
    if (toast.timeout > 0) {
      setTimeout(() => this.dismiss(id), toast.timeout);
    }
  }
}
