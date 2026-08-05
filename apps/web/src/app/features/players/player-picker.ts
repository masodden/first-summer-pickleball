import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import { isValidDuprId, type PlayerDto } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { parseRatingInput, sanitizeRatingInput } from '../../core/rating-input';
import { SessionStore } from '../../core/session';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { PlayerLine } from '../../ui/player-line';

/**
 * Выбор игрока из базы или создание карточки на месте.
 *
 * На площадке постоянно появляется кто-то без DUPR: приходит с другом.
 * Карточку можно завести гостевой — ID добавят позже и сольют с настоящей.
 */
@Component({
  selector: 'app-player-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerLine],
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div
        class="sheet glass glass--strong"
        role="dialog"
        aria-modal="true"
        (click)="$event.stopPropagation()"
      >
        <div class="row row--between">
          <h3>{{ t()('participant.add') }}</h3>
          <button type="button" class="btn btn--icon btn--ghost" (click)="closed.emit()">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        @if (mode() === 'search') {
          <input
            class="input"
            type="search"
            autocomplete="off"
            [placeholder]="t()('participant.searchPlaceholder')"
            [value]="query()"
            (input)="onQuery($event)"
          />

          <div class="results scroll-y">
            @if (players.isLoading()) {
              <div class="stack stack--2">
                @for (item of [1, 2, 3]; track item) {
                  <div class="skeleton" style="height: 52px"></div>
                }
              </div>
            } @else if (results().length === 0) {
              <p class="small muted center">{{ t()('common.empty') }}</p>
            } @else {
              <div class="stack stack--1">
                @for (player of results(); track player.id) {
                  <button
                    type="button"
                    class="result"
                    [disabled]="taken().has(player.id)"
                    (click)="picked.emit(player.id)"
                  >
                    <app-player-line [player]="player" [link]="false" [avatarSize]="34" />
                    @if (taken().has(player.id)) {
                      <span class="chip chip--go">✓</span>
                    }
                  </button>
                }
              </div>
            }
          </div>

          @if (session.isModerator()) {
            <button type="button" class="btn btn--glass btn--block" (click)="mode.set('create')">
              {{ t()('participant.addNew') }}
            </button>
          }
        } @else {
          <div class="stack stack--3">
            <div class="row">
              <label class="field grow">
                <span class="field__label">{{ t()('player.firstName') }}</span>
                <input class="input" [value]="firstName()" (input)="firstName.set(value($event))" />
              </label>
              <label class="field grow">
                <span class="field__label">{{ t()('player.lastName') }}</span>
                <input class="input" [value]="lastName()" (input)="lastName.set(value($event))" />
              </label>
            </div>

            <label class="field">
              <span class="field__label">
                {{ t()('claim.duprId') }} · {{ t()('common.optional') }}
              </span>
              <input
                class="input"
                autocapitalize="characters"
                maxlength="6"
                [class.input--invalid]="duprInvalid()"
                [value]="duprId()"
                (input)="duprId.set(value($event).toUpperCase())"
              />
              <span class="field__hint">{{ t()('participant.guestHint') }}</span>
            </label>

            <label class="field">
              <span class="field__label">{{ t()('rating.doubles') }}</span>
              <input
                class="input numeric"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                [value]="rating()"
                (input)="rating.set(sanitizeRating(value($event)))"
              />
              <span class="field__hint">{{ t()('rating.range') }}</span>
            </label>

            <div class="row">
              <button type="button" class="btn btn--glass grow" (click)="mode.set('search')">
                {{ t()('common.back') }}
              </button>
              <button
                type="button"
                class="btn btn--primary grow"
                [disabled]="!canCreate() || saving()"
                (click)="create()"
              >
                {{ t()('common.add') }}
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 65;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      background: rgba(36, 26, 22, 0.42);
      backdrop-filter: blur(4px);
      animation: fade-in var(--duration-fast) ease both;
    }

    .sheet {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      width: min(100%, 520px);
      max-height: 86dvh;
      padding: var(--space-5) var(--space-4) calc(env(safe-area-inset-bottom, 0px) + var(--space-5));
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      animation: sheet-up var(--duration-base) var(--ease-out) both;
    }

    @keyframes sheet-up {
      from {
        transform: translateY(16px);
        opacity: 0.6;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .results {
      min-height: 120px;
      max-height: 46dvh;
      overflow-y: auto;
    }

    .result {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      padding: var(--space-2) var(--space-3);
      border: 0;
      border-radius: var(--radius-md);
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    .result > *:first-child {
      flex: 1 1 auto;
      min-width: 0;
    }

    .result:hover:not(:disabled) {
      background: var(--surface-hover);
    }

    .result:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .icon {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
    }
  `,
})
export class PlayerPicker {
  private readonly api = inject(TournamentApi);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;

  /** Уже добавленные игроки: их видно, но выбрать нельзя. */
  readonly taken = input<Set<string>>(new Set<string>());

  readonly picked = output<string>();
  readonly closed = output<void>();

  protected readonly mode = signal<'search' | 'create'>('search');
  protected readonly query = signal('');
  private readonly debouncedQuery = signal('');

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly duprId = signal('');
  protected readonly rating = signal('');
  protected readonly saving = signal(false);

  protected readonly players = resource({
    params: () => this.debouncedQuery(),
    loader: ({ params }) => this.api.searchPlayers(params).then((response) => response.items),
    defaultValue: [] as PlayerDto[],
  });

  protected readonly results = computed(() => this.players.value());

  protected readonly duprInvalid = computed(() => {
    const value = this.duprId().trim();
    return value.length > 0 && !isValidDuprId(value);
  });

  protected readonly canCreate = computed(
    () =>
      this.firstName().trim().length > 0 &&
      this.lastName().trim().length > 0 &&
      !this.duprInvalid(),
  );

  private timer: number | null = null;

  constructor() {
    // Поиск не дёргает сервер на каждую букву.
    effect((onCleanup) => {
      const value = this.query();
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.debouncedQuery.set(value.trim()), 260);
      onCleanup(() => {
        if (this.timer !== null) clearTimeout(this.timer);
      });
    });
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected sanitizeRating(value: string): string {
    return sanitizeRatingInput(value);
  }

  protected async create(): Promise<void> {
    if (!this.canCreate()) return;
    this.saving.set(true);
    try {
      const { player } = await this.api.createPlayer({
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        duprId: this.duprId().trim() ? this.duprId().trim() : null,
        doublesRating: parseRatingInput(this.rating()),
      });
      this.toast.success(this.i18n.translate('player.created'));
      this.picked.emit(player.id);
    } catch (error) {
      this.toast.failure(error, () => void this.create());
    } finally {
      this.saving.set(false);
    }
  }
}
