import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { isFixedPairsFormat, knownSlotHeading, type MatchDto, type ServerEvent } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { RealtimeService } from '../../core/realtime';
import { patchMatchInRounds, upsertRound } from '../../core/round-sync';
import { TournamentApi, type PublicBoardDto } from '../../core/tournament-api';
import { Ball } from '../../ui/ball';
import { Avatar } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';
import { StatusBadge } from '../../ui/status-badge';
import { FlipMove, ScoreTick } from '../../ui/motion';
import { PairResults } from '../tournaments/pair-results';

/**
 * Публичное табло по короткой ссылке.
 *
 * Открывается без входа и без Telegram: ссылку кидают в чат клуба, её открывают
 * на планшете у корта. Живёт на той же WebSocket-комнате, что и телефоны
 * организаторов; опрос раз в 15 с — только если сокет оборвался.
 */
@Component({
  selector: 'app-public-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadge, Avatar, RatingChip, Ball, ScoreTick, FlipMove, PairResults],
  template: `
    @if (loading() && !board()) {
      <div class="stack stack--3">
        <div class="skeleton" style="height: 120px"></div>
        <div class="skeleton" style="height: 260px"></div>
      </div>
    } @else if (board(); as data) {
      <div class="stack stack--4">
        <header class="glass card--tight stack stack--2">
          <div class="row row--between">
            <app-status-badge [status]="data.tournament.status" />
            @if (data.tournament.status === 'running') {
              <app-ball [size]="22" motion="bounce" />
            }
          </div>
          <h1>{{ data.tournament.title }}</h1>
          <p class="small muted">
            {{ i18n.formatDate(data.tournament.startsAt) }}
            @if (data.venue.name) {
              · {{ data.venue.name }}
            }
          </p>
          <p class="tiny faint">{{ t()('public.spectatorHint') }}</p>
        </header>

        @if (currentRound(); as round) {
          @for (key of [round.index]; track key) {
            <section class="stack stack--2 round-in">
              <h2>{{ t()('match.round', { index: round.index + 1 }) }}</h2>
              @for (match of round.matches; track match.id) {
                <div class="glass card--tight stack stack--2">
                  <div class="row row--between">
                    <span class="tiny faint">{{ courtLine(match) }}</span>
                    <span class="tiny faint">
                      {{ t()(match.status === 'running' ? 'match.started' : 'match.waiting') }}
                    </span>
                  </div>
                  @for (team of [match.teamA, match.teamB]; track $index) {
                    <div class="row team">
                      <div class="grow stack stack--1">
                        @for (player of team.players; track player.id) {
                          <span class="truncate small strong">{{ player.fullName }}</span>
                        }
                      </div>
                      <app-score-tick class="score" [value]="team.score" />
                    </div>
                  }
                </div>
              }
            </section>
          }
        }

        <section class="stack stack--2">
          <h2>{{ t()(isFixedPairs(data) ? 'standings.results' : 'standings.title') }}</h2>
          @if (isFixedPairs(data)) {
            @if (data.teamStandings.length === 0 && !hasKnockout(data)) {
              <div class="glass glass--subtle card--tight center small muted">
                {{ t()('standings.empty') }}
              </div>
            } @else {
              <app-pair-results
                [teamStandings]="data.teamStandings"
                [rounds]="data.rounds"
                [config]="data.bracketConfig"
              />
            }
          } @else if (data.standings.length === 0) {
            <div class="glass glass--subtle card--tight center small muted">
              {{ t()('standings.empty') }}
            </div>
          } @else {
            <div class="glass card--tight table-shell">
              <div class="scroll-x">
                <table class="table">
                  <thead>
                    <tr>
                      <th scope="col">{{ t()('standings.rank') }}</th>
                      <th scope="col">{{ t()('standings.player') }}</th>
                      <th scope="col">{{ t()('standings.points') }}</th>
                      <th scope="col">{{ t()('standings.wins') }}</th>
                      @if (data.tournament.tieRule === 'draw') {
                        <th scope="col">{{ t()('standings.draws') }}</th>
                      }
                      <th scope="col">{{ t()('standings.diff') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of data.standings; track row.player.id; let index = $index) {
                      <tr [appFlipMove]="row.player.id" [appFlipIndex]="index">
                        <td>
                          @if (row.medal) {
                            <span class="medal" [class]="'medal--' + row.medal">{{ row.rank }}</span>
                          } @else {
                            <span class="numeric muted">{{ row.rank }}</span>
                          }
                        </td>
                        <td>
                          <span class="player">
                            <app-avatar [player]="row.player" [size]="26" />
                            <span class="truncate">{{ row.player.fullName }}</span>
                            <app-rating-chip [player]="row.player" [showLabel]="false" />
                          </span>
                        </td>
                        <td class="numeric strong">{{ row.pointsFor }}</td>
                        <td class="numeric">{{ row.wins }}</td>
                        @if (data.tournament.tieRule === 'draw') {
                          <td class="numeric">{{ row.draws }}</td>
                        }
                        <td class="numeric">{{ row.diff > 0 ? '+' + row.diff : row.diff }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </section>

        <a class="btn btn--glass btn--block" routerLink="/tournaments">
          {{ t()('tournament.list') }}
        </a>
      </div>
    } @else {
      <div class="glass card empty-state">
        <p>{{ t()('errors.not_found') }}</p>
      </div>
    }
  `,
  styles: `
    .team {
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--glass-bg-subtle);
    }

    .score {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 800;
      color: var(--text-strong);
      font-variant-numeric: tabular-nums;
    }

    .score :deep(.score-tick) {
      font-size: inherit;
      color: inherit;
    }

    .round-in {
      animation: round-in-fwd 300ms var(--ease-out) both;
    }

    .player {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      max-width: 180px;
      font-weight: 600;
      color: var(--text-strong);
    }

    .medal {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 800;
      color: var(--ink-900);
    }

    .medal--gold {
      background: linear-gradient(160deg, #f7d67a, var(--gold));
    }
    .medal--silver {
      background: linear-gradient(160deg, #e2e6ea, var(--silver));
    }
    .medal--bronze {
      background: linear-gradient(160deg, #e0ab84, var(--bronze));
    }
  `,
})
export class PublicBoardPage {
  private readonly api = inject(TournamentApi);
  private readonly realtime = inject(RealtimeService);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  readonly slug = input.required<string>();

  protected readonly board = signal<PublicBoardDto | null>(null);
  protected readonly loading = signal(true);

  constructor() {
    effect((onCleanup) => {
      const slug = this.slug();
      this.loading.set(true);
      let cancelled = false;
      let room: string | null = null;
      let unlisten: (() => void) | undefined;

      void this.api.getPublicBoard(slug).then(
        (data) => {
          if (cancelled) return;
          this.board.set(data);
          this.loading.set(false);
          room = data.tournament.id;
          unlisten = this.realtime.listen((event) => {
            if (!cancelled) this.applyEvent(event, room!, slug);
          });
          this.realtime.subscribe(room);
        },
        () => {
          if (cancelled) return;
          this.board.set(null);
          this.loading.set(false);
        },
      );

      onCleanup(() => {
        cancelled = true;
        unlisten?.();
        if (room) this.realtime.unsubscribe(room);
      });
    });

    // Запасной опрос: только когда сокет не открыт, иначе полный GET затрёт живой счёт.
    const timer = setInterval(() => {
      if (this.realtime.state() === 'open') return;
      const slug = this.slug();
      void this.api
        .getPublicBoard(slug)
        .then((data) => {
          if (this.slug() === slug) this.board.set(data);
        })
        .catch(() => {
          // Табло подождёт следующий тик или восстановление сокета.
        });
    }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Показываем последний раунд, в котором ещё не всё сыграно. */
  protected readonly currentRound = computed(() => {
    const rounds = this.board()?.rounds ?? [];
    return rounds.find((round) => !round.allScored) ?? rounds[rounds.length - 1] ?? null;
  });

  protected isFixedPairs(data: PublicBoardDto): boolean {
    return isFixedPairsFormat(data.tournament.format);
  }

  protected hasKnockout(data: PublicBoardDto): boolean {
    return data.rounds.some((round) =>
      round.matches.some((match) => match.stage === 'playoff' || match.stage === 'consolation'),
    );
  }

  protected courtLine(match: MatchDto): string {
    const court = this.i18n.court(match.courtName);
    const config = this.board()?.bracketConfig;
    const heading =
      config && match.bracketSlot ? knownSlotHeading(config, match.bracketSlot) : null;
    return heading ? `${court} · ${heading}` : court;
  }

  private applyEvent(event: ServerEvent, tournamentId: string, slug: string): void {
    if (!('tournamentId' in event) || event.tournamentId !== tournamentId) return;

    switch (event.type) {
      case 'match.updated':
        this.board.update((data) =>
          data ? { ...data, rounds: patchMatchInRounds(data.rounds, event.match) } : data,
        );
        break;
      case 'round.updated':
        this.board.update((data) =>
          data ? { ...data, rounds: upsertRound(data.rounds, event.round) } : data,
        );
        break;
      case 'schedule.rebuilt':
        this.board.update((data) => (data ? { ...data, rounds: event.rounds } : data));
        break;
      case 'standings.updated':
        this.board.update((data) =>
          data
            ? {
                ...data,
                standings: event.standings,
                teamStandings: event.teamStandings ?? data.teamStandings,
              }
            : data,
        );
        break;
      case 'participants.updated':
        this.board.update((data) =>
          data ? { ...data, participants: event.participants } : data,
        );
        break;
      case 'tournament.changed':
        // Только карточка (статус, название). Раунды уже пришли сокетом.
        void this.refreshCard(slug);
        break;
      case 'tournament.deleted':
        this.board.set(null);
        break;
      default:
        break;
    }
  }

  private async refreshCard(slug: string): Promise<void> {
    try {
      const snapshot = await this.api.getPublicBoard(slug);
      if (this.slug() !== slug) return;
      this.board.update((current) =>
        current
          ? {
              ...current,
              tournament: snapshot.tournament,
              venue: snapshot.venue,
              description: snapshot.description,
            }
          : snapshot,
      );
    } catch {
      // Следующее событие или опрос подтянут карточку.
    }
  }
}
