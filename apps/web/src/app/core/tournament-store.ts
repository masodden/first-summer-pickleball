import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  formatDuprExportFilename,
  groupLinkedRoster,
  isFixedPairsFormat,
  isUnpairedParticipant,
  validateBracketConfig,
  type MatchDto,
  type TranslationKey,
  type MatchGameDto,
  type ParticipantDto,
  type RoundDto,
  type StandingRowDto,
  type TeamStandingRowDto,
  type TournamentDto,
  type UpdateTournamentInput,
} from '@fsp/shared';
import { ApiFailure } from './api';
import { I18nService } from './i18n';
import { RealtimeService } from './realtime';
import { findMatch, patchMatchInRounds, upsertRound } from './round-sync';
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
  private readonly teamStandingsSignal = signal<TeamStandingRowDto[]>([]);
  private readonly loadingSignal = signal(true);
  private readonly errorSignal = signal<ApiFailure | null>(null);
  private readonly busySignal = signal<Set<string>>(new Set());
  private readonly viewRoundSignal = signal(0);

  readonly id = this.idSignal.asReadonly();
  readonly tournament = this.tournamentSignal.asReadonly();
  readonly participants = this.participantsSignal.asReadonly();
  readonly rounds = this.roundsSignal.asReadonly();
  readonly standings = this.standingsSignal.asReadonly();
  readonly teamStandings = this.teamStandingsSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly loadError = this.errorSignal.asReadonly();
  readonly connection = this.realtime.state;

  readonly registered = computed(() =>
    this.participantsSignal()
      .filter((item) => item.status === 'registered')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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
  readonly isFixedPairs = computed(() => {
    const format = this.tournamentSignal()?.format;
    return format ? isFixedPairsFormat(format) : false;
  });
  readonly unpaired = computed(() => {
    const items = this.registered();
    const byId = new Map(items.map((item) => [item.player.id, item]));
    return items.filter((item) => isUnpairedParticipant(item, byId));
  });
  readonly linkedPairs = computed(() => groupLinkedRoster(this.registered()).pairs);
  readonly pairCount = computed(() => this.linkedPairs().length);
  /** На вкладке: пары, когда все слинкованы; иначе игроки (ещё есть без пары). */
  readonly rosterTabCount = computed(() => {
    if (!this.isFixedPairs()) return this.registered().length;
    if (this.registered().length > 0 && this.unpaired().length === 0) return this.pairCount();
    return this.registered().length;
  });
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
  readonly roundState = computed<'scheduled' | 'running' | 'paused' | 'finished' | 'skipped'>(
    () => {
      const round = this.currentRound();
      const matches = round?.matches ?? [];
      if (matches.length === 0) return 'scheduled';
      if (round?.skipped || matches.every((match) => match.status === 'skipped')) return 'skipped';
      if (matches.some((match) => match.status === 'running')) return 'running';
      if (matches.some((match) => match.status === 'paused')) return 'paused';
      if (matches.every((match) => match.status === 'finished')) return 'finished';
      return 'scheduled';
    },
  );

  /** Предыдущий раунд закрыт — можно стартовать или пропустить текущий. */
  readonly previousRoundClosed = computed(() => {
    const index = this.viewRoundSignal();
    if (index <= 0) return true;
    return this.roundsSignal()[index - 1]?.closed ?? false;
  });

  /** На кортах уже идёт другой раунд — новый/пропущенный стартовать нельзя. */
  readonly otherRoundLive = computed(() => {
    const index = this.viewRoundSignal();
    return this.roundsSignal().some(
      (round) =>
        round.index !== index &&
        round.matches.some((match) => match.status === 'running' || match.status === 'paused'),
    );
  });

  readonly canStartViewedRound = computed(() => {
    if (!this.canRunRound()) return false;
    if (!this.isFixedPairs() && (!this.previousRoundClosed() || this.otherRoundLive())) return false;
    const state = this.roundState();
    return state === 'scheduled' || state === 'skipped';
  });

  /** Пропуск только в americano: в mexicano следующий раунд зависит от счёта. */
  readonly canSkipViewedRound = computed(
    () =>
      this.canRunRound() &&
      !this.isMexicano() &&
      !this.isFixedPairs() &&
      this.previousRoundClosed() &&
      this.roundState() === 'scheduled',
  );

  readonly canUnskipViewedRound = computed(
    () => this.canRunRound() && this.roundState() === 'skipped' && !this.otherRoundLive(),
  );

  /** Кто сейчас на корте — чтобы не стартовать ту же пару из другого раунда. */
  readonly livePlayerIds = computed(() => {
    const ids = new Set<string>();
    for (const round of this.roundsSignal()) {
      for (const match of round.matches) {
        if (match.status !== 'running' && match.status !== 'paused') continue;
        for (const player of [...match.teamA.players, ...match.teamB.players]) {
          ids.add(player.id);
        }
      }
    }
    return ids;
  });

  matchPlayersBusy(match: MatchDto): boolean {
    const live = this.livePlayerIds();
    return [...match.teamA.players, ...match.teamB.players].some((player) => live.has(player.id));
  }

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
    if (this.isFixedPairs()) {
      const config = tournament.bracketConfig;
      return (
        this.allConfirmed() &&
        this.unpaired().length === 0 &&
        this.registered().length >= 4 &&
        this.registered().length % 2 === 0 &&
        config !== null &&
        validateBracketConfig(config).length === 0
      );
    }
    return this.allConfirmed() && this.registered().length >= 4;
  });

  readonly startBlockedReason = computed((): TranslationKey => {
    if (this.canStart()) return 'tournament.startHint';
    if (this.isFixedPairs()) {
      const config = this.tournamentSignal()?.bracketConfig;
      if (!config || validateBracketConfig(config).length > 0) return 'bracket.cannotStart';
      if (this.unpaired().length > 0) return 'partner.needPairs';
    }
    return 'checkin.notAllConfirmed';
  });

  /** Перемешать пары можно, пока ни один матч не начали. */
  readonly canReshuffle = computed(() => {
    const tournament = this.tournamentSignal();
    if (!tournament?.canManage || tournament.status !== 'running') return false;
    if (this.isFixedPairs()) return false;
    return this.roundsSignal().every((round) =>
      round.matches.every((match) => match.status === 'scheduled'),
    );
  });

  /** Откат к «регистрация завершена» — пока ни один матч не начат. */
  readonly canUnstart = computed(() => {
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
    if (this.isFixedPairs()) return false;
    if (tournament.roundsPlanned !== null && rounds.length >= tournament.roundsPlanned)
      return false;
    return true;
  });

  readonly canFinish = computed(() => {
    const tournament = this.tournamentSignal();
    if (!tournament?.canManage || tournament.status !== 'running') return false;
    const rounds = this.roundsSignal();
    if (rounds.length === 0) return false;

    const hasLive = rounds.some((round) =>
      round.matches.some((match) => match.status === 'running' || match.status === 'paused'),
    );
    if (hasLive) return false;

    if (tournament.format === 'mexicano') {
      // Можно закончить после любого сыгранного раунда; ещё не начатый
      // следующий раунд медалям не мешает.
      if (!rounds.some((round) => round.allScored)) return false;
      return rounds.every(
        (round) =>
          round.allScored ||
          round.skipped ||
          round.matches.every((match) => match.status === 'scheduled'),
      );
    }

    return rounds.every((round) => round.allScored);
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
      this.teamStandingsSignal.set(state.teamStandings ?? []);
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
      const fromWaitlist = this.waitlisted().some((item) => item.player.id === playerId);
      await this.api.removeParticipant(id, playerId);
      await this.load({ silent: true });
      this.toast.success(
        this.i18n.translate(fromWaitlist ? 'waitlist.removed' : 'participant.removed'),
      );
    });
  }

  join(): Promise<void> {
    return this.run('join', async () => {
      const id = this.requireId();
      const result = await this.api.join(id);
      // Join мог только что завести гостевую карточку — подтянем playerId в сессию.
      await this.session.refresh();
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

  linkPartner(playerId: string, partnerPlayerId: string): Promise<void> {
    return this.run(`partner:${playerId}`, async () => {
      await this.api.linkPartner(this.requireId(), playerId, partnerPlayerId);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('partner.linked'));
    });
  }

  unlinkPartner(playerId: string): Promise<void> {
    return this.run(`partner:${playerId}`, async () => {
      await this.api.unlinkPartner(this.requireId(), playerId);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('partner.unlinked'));
    });
  }

  promote(playerId: string, replacePlayerId?: string): Promise<void> {
    return this.run(`promote:${playerId}`, async () => {
      await this.api.promote(this.requireId(), playerId, replacePlayerId);
      await this.load({ silent: true });
      this.toast.success(
        this.i18n.translate(replacePlayerId ? 'waitlist.replaced' : 'waitlist.promoted'),
      );
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

  announceRegistration(): Promise<void> {
    return this.run(
      'announce',
      async () => {
        const { sent } = await this.api.announceRegistration(this.requireId());
        this.toast.success(
          this.i18n.translate('tournament.announceRegistrationSent', { count: sent }),
        );
      },
      () => void this.announceRegistration(),
    );
  }

  start(): Promise<void> {
    return this.run('start', async () => {
      await this.api.start(this.requireId());
      await this.load({ silent: true });
      this.goToActiveRound();
      this.telegram.tap('medium');
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

  unstart(): Promise<void> {
    return this.run('unstart', async () => {
      const { tournament } = await this.api.unstart(this.requireId());
      this.tournamentSignal.set(tournament);
      await this.load({ silent: true });
      this.toast.success(this.i18n.translate('tournament.unstarted'));
    });
  }

  finish(): Promise<void> {
    return this.run('finish', async () => {
      const { tournament } = await this.api.finish(this.requireId());
      this.tournamentSignal.set(tournament);
      await this.load({ silent: true });
      this.telegram.tap('heavy');
      this.toast.success(this.i18n.translate('tournament.finished'));
    });
  }

  reopen(): Promise<void> {
    return this.run('reopen', async () => {
      const { tournament } = await this.api.reopen(this.requireId());
      this.tournamentSignal.set(tournament);
      await this.load({ silent: true });
      this.telegram.tap();
      this.toast.success(this.i18n.translate('tournament.reopened'));
    });
  }

  archive(): Promise<void> {
    return this.run('archive', async () => {
      const { tournament } = await this.api.archive(this.requireId());
      this.tournamentSignal.set(tournament);
      this.toast.success(this.i18n.translate('tournament.archived'));
    });
  }

  unarchive(): Promise<void> {
    return this.run('unarchive', async () => {
      const { tournament } = await this.api.unarchive(this.requireId());
      this.tournamentSignal.set(tournament);
      this.toast.success(this.i18n.translate('tournament.unarchived'));
    });
  }

  exportCsv(): Promise<void> {
    return this.run('export', async () => {
      const tournament = this.tournamentSignal();
      if (!tournament) return;
      const filename = formatDuprExportFilename(tournament.startsAt, tournament.title);
      await this.api.exportCsv(tournament.id, filename);
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

  skipRound(): Promise<void> {
    return this.roundAction('skip');
  }

  unskipRound(): Promise<void> {
    return this.roundAction('unskip');
  }

  private roundAction(action: 'start' | 'pause' | 'finish' | 'skip' | 'unskip'): Promise<void> {
    const index = this.viewRoundSignal();
    return this.run(
      `round:${action}`,
      async () => {
        const { rounds } = await this.api.roundAction(this.requireId(), index, action);
        this.roundsSignal.set(rounds);
        if (action === 'start') this.telegram.tap('medium');
        else if (action === 'finish') this.telegram.notify('success');
        else this.telegram.tap();
        void this.refreshStandings();
      },
      () => void this.roundAction(action),
    );
  }

  // --- Матчи ---

  setScore(match: MatchDto, scoreA: number, scoreB: number, games?: MatchGameDto[]): Promise<void> {
    return this.matchAction(
      match,
      () => this.api.setScore(match.id, scoreA, scoreB, match.version, games),
      'score.saved',
    );
  }

  startMatch(match: MatchDto): Promise<void> {
    return this.matchAction(match, () => this.api.startMatch(match.id, match.version));
  }

  pauseMatch(match: MatchDto): Promise<void> {
    return this.matchAction(match, () => this.api.pauseMatch(match.id, match.version));
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
      const { standings, teamStandings } = await this.api.getStandings(id);
      this.standingsSignal.set(standings);
      this.teamStandingsSignal.set(teamStandings ?? []);
    } catch {
      // Таблица не критична: она всё равно придёт событием WebSocket.
    }
  }

  /** Статус и права — без раундов, чтобы не затереть живой счёт. */
  private async refreshTournament(): Promise<void> {
    const id = this.idSignal();
    if (!id) return;
    try {
      const { tournament } = await this.api.getTournament(id);
      this.tournamentSignal.set(tournament);
    } catch {
      // Следующее событие или повторный вход подтянут карточку.
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
    this.roundsSignal.update((rounds) => patchMatchInRounds(rounds, match));
  }

  private hapticIfMyMatch(next: MatchDto): void {
    const me = this.session.playerId();
    if (!me || this.isBusy(`match:${next.id}`)) return;
    const players = [...next.teamA.players, ...next.teamB.players];
    if (!players.some((player) => player.id === me)) return;

    const prev = findMatch(this.roundsSignal(), next.id);
    if (!prev) return;
    const scoreChanged =
      prev.teamA.score !== next.teamA.score || prev.teamB.score !== next.teamB.score;
    const justFinished = prev.status !== 'finished' && next.status === 'finished';
    if (!scoreChanged && prev.status === next.status) return;
    if (justFinished) this.telegram.notify('success');
    else this.telegram.select();
  }

  private applyEvent(event: import('@fsp/shared').ServerEvent): void {
    if (!('tournamentId' in event) || event.tournamentId !== this.idSignal()) return;

    switch (event.type) {
      case 'participants.updated':
        this.participantsSignal.set(event.participants);
        break;
      case 'match.updated':
        this.hapticIfMyMatch(event.match);
        this.patchMatch(event.match);
        break;
      case 'round.updated':
        this.roundsSignal.update((rounds) => upsertRound(rounds, event.round));
        break;
      case 'standings.updated':
        this.standingsSignal.set(event.standings);
        if (event.teamStandings) this.teamStandingsSignal.set(event.teamStandings);
        break;
      case 'schedule.rebuilt':
        this.roundsSignal.set(event.rounds);
        break;
      case 'tournament.changed':
        // Только карточка турнира (статус, права). Раунды уже пришли сокетом —
        // полный load() затирал свежий счёт устаревшим HTTP.
        void this.refreshTournament();
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
