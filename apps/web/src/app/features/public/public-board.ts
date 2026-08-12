import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  resource,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n';
import { TournamentApi } from '../../core/tournament-api';
import { Ball } from '../../ui/ball';
import { Avatar } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';
import { StatusBadge } from '../../ui/status-badge';
import { FlipMove, ScoreTick } from '../../ui/motion';

/**
 * Публичное табло по короткой ссылке.
 *
 * Открывается без входа и без Telegram: ссылку кидают в чат клуба, её открывают
 * на планшете у корта. Обновляется само, чтобы за экраном не нужно было следить.
 */
@Component({
  selector: 'app-public-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadge, Avatar, RatingChip, Ball, ScoreTick, FlipMove],
  template: `
    @if (board.isLoading() && !board.hasValue()) {
      <div class="stack stack--3">
        <div class="skeleton" style="height: 120px"></div>
        <div class="skeleton" style="height: 260px"></div>
      </div>
    } @else if (board.value(); as data) {
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
                    <span class="tiny faint">{{ i18n.court(match.courtName) }}</span>
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
          <h2>{{ t()('standings.title') }}</h2>
          @if (data.standings.length === 0) {
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
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  readonly slug = input.required<string>();

  protected readonly board = resource({
    params: () => this.slug(),
    loader: ({ params }) => this.api.getPublicBoard(params),
  });

  constructor() {
    // Табло без входа обновляется опросом: подписка WebSocket тут не нужна.
    const timer = setInterval(() => this.board.reload(), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Показываем последний раунд, в котором ещё не всё сыграно. */
  protected readonly currentRound = computed(() => {
    const rounds = this.board.value()?.rounds ?? [];
    return rounds.find((round) => !round.allScored) ?? rounds[rounds.length - 1] ?? null;
  });
}
