import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n';
import { SessionStore } from '../../core/session';
import { TournamentApi } from '../../core/tournament-api';
import { PlayerLine } from '../../ui/player-line';
import { PlayerPicker } from './player-picker';

/**
 * База игроков клуба — вкладка только для модератора и админа.
 *
 * Список большой (справочник DUPR по стране), поэтому основной способ работы —
 * поиск по имени или DUPR ID. Модератор может завести карточку прямо отсюда.
 */
@Component({
  selector: 'app-player-directory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PlayerLine, PlayerPicker],
  template: `
    <div class="stack stack--4">
      <div class="row row--between">
        <h1>{{ t()('player.directory') }}</h1>
        @if (session.isModerator()) {
          <button type="button" class="btn btn--primary btn--sm" (click)="picker.set(true)">
            {{ t()('participant.addNew') }}
          </button>
        }
      </div>

      <input
        class="input"
        type="search"
        autocomplete="off"
        [placeholder]="t()('participant.searchPlaceholder')"
        [value]="query()"
        (input)="query.set(value($event))"
      />

      @if (players.isLoading()) {
        <div class="stack stack--2">
          @for (item of [1, 2, 3, 4, 5]; track item) {
            <div class="skeleton" style="height: 58px"></div>
          }
        </div>
      } @else if (players.error()) {
        <div class="glass card center stack stack--3">
          <p class="muted">{{ t()('errors.network') }}</p>
          <button type="button" class="btn btn--glass" (click)="players.reload()">
            {{ t()('common.retry') }}
          </button>
        </div>
      } @else if (items().length === 0) {
        <div class="glass card empty-state">
          <p>{{ t()('common.empty') }}</p>
        </div>
      } @else {
        <div class="stack stack--2">
          @for (player of items(); track player.id) {
            <a class="glass card--tight person" [routerLink]="['/players', player.id]">
              <app-player-line class="grow" [player]="player" [link]="false" />
            </a>
          }
        </div>
      }
    </div>

    @if (picker()) {
      <app-player-picker
        [startInCreate]="true"
        (closed)="picker.set(false)"
        (picked)="onCreated()"
      />
    }
  `,
  styles: `
    .person {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      color: inherit;
    }

    .person:hover {
      text-decoration: none;
      box-shadow: var(--glass-shadow-lg);
    }
  `,
})
export class PlayerDirectoryPage {
  private readonly api = inject(TournamentApi);
  private readonly i18n = inject(I18nService);

  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;

  protected readonly query = signal('');
  private readonly debounced = signal('');
  protected readonly picker = signal(false);

  protected readonly players = resource({
    params: () => this.debounced(),
    loader: ({ params }) => this.api.searchPlayers(params).then((response) => response.items),
  });

  protected readonly items = computed(() => this.players.value() ?? []);

  private timer: number | null = null;

  constructor() {
    effect((onCleanup) => {
      const value = this.query();
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.debounced.set(value.trim()), 260);
      onCleanup(() => {
        if (this.timer !== null) clearTimeout(this.timer);
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected onCreated(): void {
    this.picker.set(false);
    this.players.reload();
  }
}
