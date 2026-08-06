import { computed, inject, Injectable, signal } from '@angular/core';
import {
  isRoleAtLeast,
  type AuthResponseDto,
  type ClaimInput,
  type Locale,
  type Role,
  type SessionDto,
} from '@fsp/shared';
import { ApiClient, ApiFailure } from './api';
import { I18nService } from './i18n';
import { TelegramService } from './telegram';

interface SessionResponse {
  session: SessionDto | null;
}

/**
 * Состояние входа.
 *
 * Без входа приложение работает как табло: смотреть турниры может кто угодно.
 * Вход происходит автоматически при открытии из Telegram — подпись initData
 * проверяет сервер, поэтому вводить ничего не нужно.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiClient);
  private readonly telegram = inject(TelegramService);
  private readonly i18n = inject(I18nService);

  private readonly sessionSignal = signal<SessionDto | null>(null);
  private readonly readySignal = signal(false);
  private readonly busySignal = signal(false);

  readonly session = this.sessionSignal.asReadonly();
  readonly ready = this.readySignal.asReadonly();
  readonly busy = this.busySignal.asReadonly();

  readonly role = computed<Role | null>(() => this.sessionSignal()?.role ?? null);
  readonly isAuthenticated = computed(() => this.sessionSignal() !== null);
  readonly isModerator = computed(() => isRoleAtLeast(this.role(), 'moderator'));
  /** Тренировки: организатор и выше. */
  readonly canManageTrainings = computed(() => isRoleAtLeast(this.role(), 'organizer'));
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly player = computed(() => this.sessionSignal()?.player ?? null);
  readonly playerId = computed(() => this.sessionSignal()?.player?.id ?? null);
  /** Нужно ли предложить привязать DUPR перед заявкой на турнир. */
  readonly needsDuprLink = computed(
    () => this.isAuthenticated() && this.sessionSignal()?.player === null,
  );
  readonly canJoinTournaments = computed(() => this.playerId() !== null);
  readonly telegramAvailable = this.telegram.available;
  /** После «Выйти» можно восстановить сессию без свежей подписи Telegram. */
  private readonly pausedSignInSignal = signal(false);
  readonly canSignInAgain = computed(
    () => this.telegram.available || this.pausedSignInSignal(),
  );

  async init(): Promise<void> {
    try {
      if (this.telegram.available && this.telegram.initData) {
        await this.loginWithTelegram(this.telegram.initData);
      } else if (this.api.token()) {
        const response = await this.api.get<SessionResponse>('/api/auth/session');
        this.applySession(response.session);
      } else if (this.api.hasPausedToken()) {
        this.pausedSignInSignal.set(true);
      }
    } catch (error) {
      // Не смогли войти — остаёмся наблюдателем, приложение всё равно работает.
      if (error instanceof ApiFailure && error.code === 'unauthorized') {
        this.api.setToken(null);
      }
      this.sessionSignal.set(null);
      if (this.api.hasPausedToken()) this.pausedSignInSignal.set(true);
    } finally {
      this.readySignal.set(true);
    }
  }

  async loginWithTelegram(initData: string): Promise<void> {
    const response = await this.api.post<AuthResponseDto>('/api/auth/telegram', { initData });
    this.api.setToken(response.token);
    this.applySession(response.session);
  }

  /** Локальный вход без Telegram: доступен, только если сервер это разрешил. */
  async devLogin(role: Role = 'admin', name = 'Локальный организатор'): Promise<void> {
    const response = await this.api.post<AuthResponseDto>('/api/auth/dev', {
      role,
      name,
      telegramId: `dev-${role}`,
    });
    this.api.setToken(response.token);
    this.applySession(response.session);
  }

  async refresh(): Promise<void> {
    if (!this.api.token()) return;
    const response = await this.api.get<SessionResponse>('/api/auth/session');
    this.applySession(response.session);
  }

  async claimDupr(input: ClaimInput): Promise<void> {
    this.busySignal.set(true);
    try {
      const response = await this.api.post<SessionResponse>('/api/auth/claim', input);
      this.applySession(response.session);
    } finally {
      this.busySignal.set(false);
    }
  }

  async useInvite(token: string): Promise<void> {
    const response = await this.api.post<SessionResponse>(
      `/api/auth/invite/${encodeURIComponent(token)}`,
    );
    this.applySession(response.session);
  }

  async updateSettings(patch: {
    locale?: Locale;
    notificationsEnabled?: boolean;
    reducedMotion?: boolean;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string | null;
  }): Promise<void> {
    if (patch.locale) this.i18n.setLocale(patch.locale);
    if (!this.isAuthenticated()) return;
    const response = await this.api.patch<SessionResponse>('/api/me/settings', patch);
    this.applySession(response.session);
  }

  signOut(): void {
    this.api.pauseToken();
    this.sessionSignal.set(null);
    this.pausedSignInSignal.set(true);
  }

  /**
   * Повторный вход после «Выйти».
   *
   * Сначала поднимаем сохранённый JWT — повторная отправка того же initData
   * часто даёт «подпись не сходится». Telegram initData — запасной путь.
   */
  async signInAgain(): Promise<void> {
    if (this.api.resumePausedToken()) {
      try {
        await this.refresh();
        if (this.sessionSignal()) {
          this.pausedSignInSignal.set(false);
          return;
        }
      } catch {
        this.api.setToken(null);
      }
    }

    if (this.telegram.available && this.telegram.initData) {
      await this.loginWithTelegram(this.telegram.initData);
      this.pausedSignInSignal.set(false);
      return;
    }

    throw new ApiFailure(
      'unauthorized',
      'Не удалось войти. Закройте Mini App и откройте бота снова.',
      false,
    );
  }

  private applySession(session: SessionDto | null): void {
    this.sessionSignal.set(session);
    if (session) this.i18n.setLocale(session.locale);
  }
}
