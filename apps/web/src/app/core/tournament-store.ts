import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type {
  MatchDto,
  ParticipantDto,
  RoundDto,
  StandingRowDto,
  TournamentDto,
  UpdateTournamentInput,
} from '@fsp/shared';
import { ApiFailure } from './api';
import { I18nService } from './i18n';
import { RealtimeService } from './realtime';
import { SessionStore } from './session';
import { TelegramService } from './telegram';
import { ToastService } from './toast';
import { TournamentApi } from './tournament-api';
import { ViewStateService } from './view-state';

/**
 * Состояние одного открытого турнира.
 *
 * Сервис живёт вместе с экраном турнира и держит всё, что видно на экранах
 * регистрации, раундов и таблицы. Данные приходят двумя путями: полное
 * состояние при открытии и точечные события WebSocket дальше. Действия
 * организатора применяются оптимистично — на площадке важно, чтобы галочка
 * ставилась мгновенно, а не после ответа сервера.
 */
@Injectable()
export class TournamentStore {
  private readonly api = inject(TournamentApi);
  private readonly realtime = inject(RealtimeService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  private readonly telegram = inject(TelegramService);
  private readonly i18n = inject(I18nService);
  private readonly viewState = inject(ViewStateService);

  private readonly idSignal = signal<string | null>(null);
  private readonly tournamentSignal = signal<TournamentDto | null>(null);
  private readonly participantsSignal = signal<ParticipantDto[]>([]);
  private readonly roundsSignal = signal<RoundDto[]>([]);
  private readonly standingsSignal = signal<StandingRowDto[]>([]);
  private readonly loadingSignal = signal(true);
  private readonly errorSignal = signal<ApiFailure | null>(null);
  private readonly busySignal = signal<Set<string>>(new Set());
  private readonly viewRoundSignal = signal(0);

  readonly id = this.idSignal.asReadonly();
  readonly tournament = this.tournamentSignal.asReadonly();
  readonly participants = this.participantsSignal.asReadonly();
  readonly rounds = this.roundsSignal.asReadonly();
  readonly standings = this.standingsSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly loadError = this.errorSignal.asReadonly();
  readonly connection = this.realtime.state;

  readonly registered = computed(() =>
    this.participantsSignal().filter((item) => item.status === 'registered'),
  );
  readonly waitlisted = computed(() =>
    this.participantsSignal()
      .filter((item) => item.status === 'waitlisted')
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0)),
  );
  readonly confirmedCount = computed(
    () => this.registered().filter((item) => item.confirmedAndPaid).length,
  );
  readonly allConfirmed = computed(
    () => this.registered().length > 0 && this.confirmedCount() === this.registered().length,
  );
  readonly canManage = computed(() => this.tournamentSignal()?.canManage ?? false);
  readonly isMexicano = computed(() => this.tournamentSignal()?.format === 'mexicano');
  readonly roundCount = computed(() => this.roundsSignal().length);
  readonly viewRound = this.viewRoundSignal.asReadonly();
  readonly currentRound = computed<RoundDto | null>(
    () => this.roundsSignal()[this.viewRoundSignal()] ?? null,
  );
  /** Первый незавершённый раунд — на него открывается экран по умолчанию. */
  readonly activeRoundIndex = computed(() => {
    const rounds = this.roundsSignal();
    const index = rounds.findIndex((round) => !round.allScored);
    return index === -1 ? Math.max(0, rounds.length - 1) : index;
  });
  readonly plannedRounds = computed(() => this.tournamentSignal()?.roundsPlanned ?? null);
  readonly isLastGeneratedRound = computed(() => this.viewRoundSignal() >= this.roundCount() - 1);

  /**
   * Состояние раунда целиком: корты начинают и заканчивают вместе, поэтому
   * кнопка и таймер одни на всех. Корт, где уже внесли счёт, считается
   * отыгравшим и на состояние раунда не влияет.
   */
  readonly roundState = computed<'scheduled' | 'running' | 'paused' | 'finished'>(() => {
    const matches = this.currentRound()?.matches ?? [];
    if (matches.length === 0) return 'scheduled';
    if (matches.some((match) => match.status === 'running')) return 'running';
    if (matches.some((match) => match.status === 'paused')) return 'paused';
    if (matches.every((match) => match.status === 'finished')) return 'finished';
    return 'scheduled';
  });

  /**
   * Матч, по которому считается общий таймер раунда. Все корты стартуют
   * одновременно, поэтому годится любой ещё не закрытый; если закрыты все —
   * последний, чтобы на экране осталось итоговое время.
   */
  readonly timerMatch = computed<MatchDto | null>(() => {
    const matches = this.currentRound()?.matches ?? [];
    const live = matches.find((match) => match.status === 'running' || match.status === 'paused');
    if (live) return live;
    const started = matches.filter((match) => match.startedAt !== null);
    return started[started.length - 1] ?? null;
  });

  readonly canRunRound = computed(
    () => this.canManage() && this.tournamentSignal()?.status === 'running',
  );

  /** Можно ли формировать игры: все пришли, оплатили и статус подходящий. */
  readonly canStart = computed(() => {
    const tournament = this.tournamentSignal();
    if (!tournament || !tournament.canManage) return false;
    if (tournament.status !== 'registration' && tournament.status !== 'registration_closed') {
      return false;
    }
    return this.allConfirmed() && this.registered().length >= 4;
  });

  /** Перемешать пары можно, пока ни один матч не начали. */
  readonly canReshuffle = computed(() => {
    const tournament = this.tournamentSignal();
    if (!tournament?.canManage || tournament.status !== 'running') return false;
    return this.roundsSignal().every((round) =>
      round.matches.every((match) => match.status === 'scheduled'),
    );
  });

  readonly canCreateNextRound = computed(() => {
    const tournament = this.tournamentSignal();
    if (!tournament?.canManage || tournament.status !== 'running') return false;
    const rounds = this.roundsSignal();
    const last = rounds[rounds.length - 1];
    if (last && !last.allScored) return false;
    if (tournament.roundsPlanned !== null && rounds.length >= tournament.roundsPlanned)
      return false;
    return true;
  });

  readonly canFinish = computed(() => {
    const tournament = this.tournamentSignal();
    if (!tournament?.canManage || tournament.status !== 'running') return false;
    return this.roundsSignal().every((round) => round.allScored);
  });

  readonly myParticipation = computed(() => {
    const playerId = this.session.playerId();
    if (!playerId) return null;
    return this.participantsSignal().find((item) => item.player.id === playerId) ?? null;
  });

  readonly isFull = computed(() => {
    const tournament = this.tournamentSignal();
    return tournament ? this.registered().length >= tournament.maxPlayers : false;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  isBusy(key: string): boolean {
    return this.busySignal().has(key);
  }

  async open(id: string): Promise<void> {
    if (this.idSignal() === id) return;
    this.close();
    this.idSignal.set(id);
    this.realtime.subscribe(id);
    this.unlisten = this.realtime.listen((event) => this.applyEvent(event));
    await this.load();

    // Возвращаемся к раунду, с которого ушли; если его больше нет — к текущему.
    const remembered = this.viewState.lastRound(id);
    const inRange = remembered !== null && remembered < this.roundCount();
    this.viewRoundSignal.set(inRange ? remembered : this.activeRoundIndex());
  }

  close(): void {
    const id = this.idSignal();
    if (id) this.realtime.unsubscribe(id);
    this.unlisten?.();
    this.unlisten = undefined;
  }

  async load(options: { silent?: boolean } = {}): Promise<void> {
    const id = this.idSignal();
    if (!id) return;
    if (!options.silent) this.loadingSignal.set(true);
    try {
      const state = await this.api.getState(id);
      this.tournamentSignal.set(state.tournament);
      this.participantsSignal.set(state.participants);
      this.roundsSignal.set(state.rounds);
      this.standingsSignal.set(state.standings);
      this.errorSignal.set(null);
    } catch (error) {
      if (error instanceof ApiFailure) this.errorSignal.set(error);
      if (!options.silent) {
        this.toast.failure(error, () => void this.load());
      }
    } finally {
      this.loadingSignal.set(false);
    }
  }

  showRound(index: number): void {
    const max = Math.max(0, this.roundCount() - 1);
    this.setViewRound(Math.min(Math.max(0, index), max));
    this.telegram.tap();
  }

  goToActiveRound(): void {
    this.setViewRound(this.activeRoundIndex());
  }

  private setViewRound(index: number): void {
    this.viewRoundSignal.set(index);
    const id = this.idSignal();
    if (id) this.viewState.setLastRound(id, index);
  }

  // --- Участники ---

  addParticipant(playerId: string): Promise<void> {
    return this.run(`add:${playerId}`, async () => {
      const id = this.requireId();
      await this.api.addParticipant(id, playerId);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('participant.added'));
    });
  }

  removeParticipant(playerId: string): Promise<void> {
    return this.run(`remove:${playerId}`, async () => {
      const id = this.requireId();
      await this.api.removeParticipant(id, playerId);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('participant.removed'));
    });
  }

  join(): Promise<void> {
    return this.run('join', async () => {
      const id = this.requireId();
      const result = await this.api.join(id);
      await this.load({ silent: true });
      this.toast.success(
        this.i18n.translate(result.waitlisted ? 'waitlist.joined' : 'participant.joined'),
      );
    });
  }

  leave(): Promise<void> {
    return this.run('leave', async () => {
      const id = this.requireId();
      await this.api.leave(id);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('participant.left'));
    });
  }

  /**
   * Галочка «пришёл и оплатил». Ставится оптимистично: организатор ведёт очередь
   * людей, и ждать ответа сети на каждый тап нельзя.
   */
  setPaid(playerId: string, value: boolean): Promise<void> {
    const before = this.participantsSignal();
    this.patchParticipant(playerId, { confirmedAndPaid: value });
    this.telegram.tap();

    return this.run(
      `paid:${playerId}`,
      async () => {
        const id = this.requireId();
        try {
          const { participant } = await this.api.setPaid(id, playerId, value);
          this.patchParticipant(playerId, participant);
        } catch (error) {
          this.participantsSignal.set(before);
          throw error;
        }
      },
      () => void this.setPaid(playerId, value),
    );
  }

  promote(playerId: string): Promise<void> {
    return this.run(`promote:${playerId}`, async () => {
      await this.api.promote(this.requireId(), playerId);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('waitlist.promoted'));
    });
  }

  // --- Ход турнира ---

  update(patch: UpdateTournamentInput): Promise<void> {
    return this.run('update', async () => {
      const { tournament } = await this.api.updateTournament(this.requireId(), patch);
      this.tournamentSignal.set(tournament);
      this.toast.success(this.i18n.translate('tournament.updated'));
    });
  }

  setRegistrationOpen(open: boolean): Promise<void> {
    return this.run('registration', async () => {
      const id = this.requireId();
      const { tournament } = open
        ? await this.api.openRegistration(id)
        : await this.api.closeRegistration(id);
      this.tournamentSignal.set(tournament);
    });
  }

  start(): Promise<void> {
    return this.run('start', async () => {
      await this.api.start(this.requireId());
      await this.load({ silent: true });
      this.goToActiveRound();
      this.toast.success(this.i18n.translate('tournament.created'));
    });
  }

  reshuffle(): Promise<void> {
    return this.run('reshuffle', async () => {
      const { rounds } = await this.api.reshuffle(this.requireId());
      this.roundsSignal.set(rounds);
      this.toast.success(this.i18n.translate('match.reshuffled'));
    });
  }

  createNextRound(): Promise<void> {
    return this.run('next-round', async () => {
      const { roundIndex } = await this.api.createNextRound(this.requireId());
      await this.load({ silent: true });
      this.showRound(roundIndex);
    });
  }

  finish(): Promise<void> {
    return this.run('finish', async () => {
      const { tournament } = await this.api.finish(this.requireId());
      this.tournamentSignal.set(tournament);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('tournament.finished'));
    });
  }

  reopen(): Promise<void> {
    return this.run('reopen', async () => {
      const { tournament } = await this.api.reopen(this.requireId());
      this.tournamentSignal.set(tournament);
    });
  }

  exportCsv(): Promise<void> {
    return this.run('export', async () => {
      const tournament = this.tournamentSignal();
      if (!tournament) return;
      await this.api.exportCsv(tournament.id, `${tournament.publicSlug}-results`);
    });
  }

  // --- Раунд целиком ---

  startRound(): Promise<void> {
    return this.roundAction('start');
  }

  pauseRound(): Promise<void> {
    return this.roundAction('pause');
  }

  finishRound(): Promise<void> {
    return this.roundAction('finish');
  }

  private roundAction(action: 'start' | 'pause' | 'finish'): Promise<void> {
    const index = this.viewRoundSignal();
    return this.run(
      `round:${action}`,
      async () => {
        const { rounds } = await this.api.roundAction(this.requireId(), index, action);
        this.roundsSignal.set(rounds);
        this.telegram.tap();
        void this.refreshStandings();
      },
      () => void this.roundAction(action),
    );
  }

  // --- Матчи ---

  setScore(match: MatchDto, scoreA: number, scoreB: number): Promise<void> {
    return this.matchAction(
      match,
      () => this.api.setScore(match.id, scoreA, scoreB, match.version),
      'score.saved',
    );
  }

  private matchAction(
    match: MatchDto,
    action: () => Promise<{ match: MatchDto }>,
    successKey?: 'score.saved',
  ): Promise<void> {
    return this.run(
      `match:${match.id}`,
      async () => {
        const result = await action();
        this.patchMatch(result.match);
        if (successKey) this.toast.success(this.i18n.translate(successKey));
        // Таблица меняется вместе со счётом, но событие может прийти позже.
        void this.refreshStandings();
      },
      undefined,
      async (error) => {
        // Конфликт версий значит, что кто-то уже поменял матч: подтягиваем правду.
        if (error instanceof ApiFailure && error.code === 'conflict_version') {
          await this.load({ silent: true });
        }
      },
    );
  }

  private async refreshStandings(): Promise<void> {
    const id = this.idSignal();
    if (!id) return;
    try {
      const { standings } = await this.api.getStandings(id);
      this.standingsSignal.set(standings);
    } catch {
      // Таблица не критична: она всё равно придёт событием WebSocket.
    }
  }

  private unlisten?: () => void;

  private requireId(): string {
    const id = this.idSignal();
    if (!id) throw new ApiFailure('not_found', 'Турнир не выбран', false);
    return id;
  }

  /** Общая обёртка действий: блокировка кнопки, тост с повтором, хук на ошибку. */
  private async run(
    key: string,
    action: () => Promise<void>,
    retry?: () => void,
    onError?: (error: unknown) => Promise<void>,
  ): Promise<void> {
    if (this.isBusy(key)) return;
    this.setBusy(key, true);
    try {
      await action();
    } catch (error) {
      await onError?.(error);
      this.toast.failure(error, retry);
    } finally {
      this.setBusy(key, false);
    }
  }

  private setBusy(key: string, value: boolean): void {
    this.busySignal.update((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private patchParticipant(playerId: string, patch: Partial<ParticipantDto>): void {
    this.participantsSignal.update((items) =>
      items.map((item) => (item.player.id === playerId ? { ...item, ...patch } : item)),
    );
  }

  private patchMatch(match: MatchDto): void {
    this.roundsSignal.update((rounds) =>
      rounds.map((round) => {
        if (round.index !== match.roundIndex) return round;
        const matches = round.matches.map((item) => (item.id === match.id ? match : item));
        return {
          ...round,
          matches,
          allFinished: matches.every((item) => item.status === 'finished'),
          allScored: matches.every(
            (item) =>
              item.status === 'finished' && item.teamA.score !== null && item.teamB.score !== null,
          ),
        };
      }),
    );
  }

  private applyEvent(event: import('@fsp/shared').ServerEvent): void {
    if (!('tournamentId' in event) || event.tournamentId !== this.idSignal()) return;

    switch (event.type) {
      case 'participants.updated':
        this.participantsSignal.set(event.participants);
        break;
      case 'match.updated':
        this.patchMatch(event.match);
        break;
      case 'round.updated':
        this.roundsSignal.update((rounds) => {
          const exists = rounds.some((round) => round.index === event.round.index);
          return exists
            ? rounds.map((round) => (round.index === event.round.index ? event.round : round))
            : [...rounds, event.round].sort((a, b) => a.index - b.index);
        });
        break;
      case 'standings.updated':
        this.standingsSignal.set(event.standings);
        break;
      case 'schedule.rebuilt':
        this.roundsSignal.set(event.rounds);
        break;
      case 'tournament.changed':
        // Права зависят от пользователя, поэтому турнир перезапрашиваем целиком.
        void this.load({ silent: true });
        break;
      case 'tournament.deleted':
        this.tournamentSignal.set(null);
        this.errorSignal.set(new ApiFailure('not_found', 'Турнир удалён', false));
        break;
      default:
        break;
    }
  }
}
