import { computed, Injectable, signal } from '@angular/core';
import type { ApiErrorBody, ErrorCode } from '@fsp/shared';

const TOKEN_KEY = 'fsp.token';

export type FailureCode = ErrorCode | 'network';

/** Ошибка запроса в понятном для интерфейса виде. */
export class ApiFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }

  /** Ошибки конкретных полей формы, если сервер их прислал. */
  get fields(): Record<string, string> {
    const raw = this.details?.['fields'];
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, string>) : {};
  }
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Действие можно поставить в очередь, если сети нет. Подпись нужна, чтобы
   * показать пользователю, что именно ждёт отправки.
   */
  queueLabel?: string;
  signal?: AbortSignal;
}

export interface QueuedAction {
  id: number;
  label: string;
  method: string;
  path: string;
  body: unknown;
}

/**
 * Клиент API.
 *
 * Работает на fetch, чтобы полностью контролировать разбор ошибок: код ошибки
 * из ответа — это контракт, по которому интерфейс подбирает текст и решает,
 * предлагать ли повтор. Изменяющие запросы, не ушедшие из-за обрыва сети,
 * складываются в очередь и повторяются при восстановлении связи.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly tokenSignal = signal<string | null>(this.readToken());
  private readonly queue = signal<QueuedAction[]>([]);
  private readonly onlineSignal = signal(navigator.onLine);
  private nextQueueId = 1;
  private flushing = false;

  readonly token = this.tokenSignal.asReadonly();
  readonly online = this.onlineSignal.asReadonly();
  readonly queued = this.queue.asReadonly();
  readonly hasQueuedActions = computed(() => this.queue().length > 0);

  constructor() {
    window.addEventListener('online', () => {
      this.onlineSignal.set(true);
      void this.flushQueue();
    });
    window.addEventListener('offline', () => this.onlineSignal.set(false));
  }

  setToken(token: string | null): void {
    this.tokenSignal.set(token);
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Без хранилища сессия проживёт до перезагрузки страницы.
    }
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = this.tokenSignal();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      this.onlineSignal.set(false);
      if (options.queueLabel && method !== 'GET') {
        this.enqueue({
          id: this.nextQueueId++,
          label: options.queueLabel,
          method,
          path,
          body: options.body,
        });
      }
      throw new ApiFailure('network', 'Нет связи с сервером', true);
    }

    this.onlineSignal.set(true);

    if (response.status === 204) return undefined as T;

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload: unknown = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      throw this.toFailure(response.status, payload);
    }
    return payload as T;
  }

  /** Скачивание файла: отдельный путь, потому что тело не JSON. */
  async download(path: string, filename: string): Promise<void> {
    const token = this.tokenSignal();
    const response = await fetch(this.buildUrl(path), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw this.toFailure(response.status, await response.text());

    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  removeQueued(id: number): void {
    this.queue.update((items) => items.filter((item) => item.id !== id));
  }

  clearQueue(): void {
    this.queue.set([]);
  }

  /** Повторяет отложенные действия по очереди, сохраняя их порядок. */
  async flushQueue(): Promise<{ sent: number; failed: number }> {
    if (this.flushing) return { sent: 0, failed: 0 };
    this.flushing = true;
    let sent = 0;
    let failed = 0;

    try {
      for (const action of [...this.queue()]) {
        try {
          await this.request(action.method, action.path, { body: action.body });
          this.removeQueued(action.id);
          sent += 1;
        } catch (error) {
          if (error instanceof ApiFailure && error.code === 'network') {
            failed += 1;
            break;
          }
          // Ошибка не из-за сети: повторять бессмысленно, убираем из очереди.
          this.removeQueued(action.id);
          failed += 1;
        }
      }
    } finally {
      this.flushing = false;
    }

    return { sent, failed };
  }

  private enqueue(action: QueuedAction): void {
    this.queue.update((items) => [...items, action]);
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const queryString = search.toString();
    return queryString ? `${path}?${queryString}` : path;
  }

  private toFailure(status: number, payload: unknown): ApiFailure {
    const body = payload as Partial<ApiErrorBody>;
    if (body?.error?.code) {
      return new ApiFailure(
        body.error.code,
        body.error.message,
        body.error.retryable,
        body.error.details,
      );
    }
    if (status === 401) return new ApiFailure('unauthorized', 'Нужно войти в приложение', false);
    if (status >= 500) return new ApiFailure('internal', 'Что-то сломалось на сервере', true);
    return new ApiFailure('internal', `Ошибка запроса (${status})`, true);
  }

  private readToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
}
