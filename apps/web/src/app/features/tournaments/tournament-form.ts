import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  STANDINGS_SORT_KEYS,
  type CreateTournamentInput,
  type StandingsSortKey,
  type TieRule,
  type TournamentFormat,
  type VenueDto,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';

const PLAYER_PRESETS = [4, 8, 12, 16, 20, 24] as const;

/**
 * Создание и редактирование турнира.
 *
 * Значения по умолчанию рассчитаны на обычную клубную игру: американо, 12
 * игроков, 3 корта, до 11 очков. Организатору остаётся поправить название и
 * время, поэтому турнир создаётся за считанные секунды прямо на площадке.
 */
@Component({
  selector: 'app-tournament-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack stack--4">
      <h1>{{ isEdit() ? t()('tournament.edit') : t()('tournament.createTitle') }}</h1>

      <section class="glass card--tight stack stack--4">
        <label class="field">
          <span class="field__label">{{ t()('tournament.title') }}</span>
          <input class="input" [value]="title()" (input)="title.set(text($event))" />
        </label>

        <div class="row row--wrap">
          <label class="field grow">
            <span class="field__label">{{ t()('tournament.category') }}</span>
            <input
              class="input"
              [value]="category()"
              [placeholder]="t()('tournament.categoryHint')"
              (input)="category.set(text($event))"
            />
          </label>

          <label class="field grow">
            <span class="field__label">{{ t()('tournament.startsAt') }}</span>
            <input
              class="input"
              type="datetime-local"
              [value]="startsAt()"
              (input)="startsAt.set(text($event))"
            />
          </label>
        </div>

        <div class="field">
          <span class="field__label">{{ t()('tournament.format') }}</span>
          <div class="row">
            @for (option of formats; track option) {
              <button
                type="button"
                class="btn btn--sm grow"
                [class.btn--primary]="format() === option"
                [class.btn--glass]="format() !== option"
                (click)="format.set(option)"
              >
                {{ t()(option === 'americano' ? 'format.americano' : 'format.mexicano') }}
              </button>
            }
          </div>
          <span class="field__hint">
            {{
              t()(
                format() === 'americano'
                  ? 'format.americano.description'
                  : 'format.mexicano.description'
              )
            }}
          </span>
        </div>

        <div class="field">
          <span class="field__label">{{ t()('tournament.maxPlayers') }}</span>
          <div class="row row--wrap">
            @for (preset of presets; track preset) {
              <button
                type="button"
                class="chip"
                [class.chip--accent]="maxPlayers() === preset"
                (click)="maxPlayers.set(preset)"
              >
                {{ preset }}
              </button>
            }
            <input
              class="input numeric compact"
              type="number"
              min="4"
              max="200"
              [value]="maxPlayers()"
              (input)="maxPlayers.set(number($event, 12))"
            />
          </div>
        </div>

        <div class="row row--wrap">
          <label class="field grow">
            <span class="field__label">{{ t()('tournament.courts') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="20"
              [value]="courts()"
              (input)="courts.set(number($event, 3))"
            />
            <span class="field__hint">{{ courtsHint() }}</span>
          </label>

          <label class="field grow">
            <span class="field__label">{{ t()('tournament.pointsToWin') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="99"
              [value]="pointsToWin()"
              (input)="pointsToWin.set(number($event, 11))"
            />
          </label>
        </div>

        <div class="row row--wrap">
          <label class="field grow">
            <span class="field__label">{{ t()('tournament.matchDuration') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="180"
              [value]="matchDuration()"
              (input)="matchDuration.set(text($event))"
            />
            <span class="field__hint">{{ t()('tournament.matchDurationHint') }}</span>
          </label>

          <label class="field grow">
            <span class="field__label">{{ t()('tournament.rounds') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="60"
              [value]="rounds()"
              [placeholder]="t()('tournament.roundsInfinite')"
              (input)="rounds.set(text($event))"
            />
            <span class="field__hint">
              {{ suggestedRounds() ? roundsSuggestion() : t()('tournament.roundsHint') }}
            </span>
          </label>
        </div>

        <div class="row row--wrap">
          <label class="field grow">
            <span class="field__label">{{ t()('tournament.tieRule') }}</span>
            <select class="select" [value]="tieRule()" (change)="tieRule.set(tie($event))">
              <option value="draw">{{ t()('tie.draw') }}</option>
              <option value="golden_point">{{ t()('tie.golden_point') }}</option>
            </select>
          </label>

          <label class="field grow">
            <span class="field__label">{{ t()('tournament.standingsSort') }}</span>
            <select class="select" [value]="sortKey()" (change)="sortKey.set(sort($event))">
              @for (key of sortKeys; track key) {
                <option [value]="key">{{ sortLabel(key) }}</option>
              }
            </select>
          </label>
        </div>

        <div class="row row--between">
          <div class="stack stack--1 grow">
            <span class="field__label">{{ t()('tournament.ratingBalance') }}</span>
            <span class="field__hint">{{ t()('tournament.ratingBalanceHint') }}</span>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              [checked]="ratingBalance()"
              (change)="ratingBalance.set(checked($event))"
            />
            <span class="switch__track"></span>
            <span class="switch__thumb"></span>
          </label>
        </div>

        <label class="field">
          <span class="field__label">{{ t()('tournament.entryFee') }}</span>
          <input
            class="input numeric"
            type="number"
            min="0"
            [value]="entryFee()"
            (input)="entryFee.set(text($event))"
          />
        </label>
      </section>

      <section class="glass card--tight stack stack--4">
        <h3>{{ t()('tournament.venue') }}</h3>

        @if (venues.value().length > 0) {
          <div class="row row--wrap">
            <span class="tiny faint">{{ t()('tournament.savedVenues') }}</span>
            @for (venue of venues.value(); track venue.id) {
              <button type="button" class="chip" (click)="applyVenue(venue)">
                {{ venue.name }}
              </button>
            }
          </div>
        }

        <label class="field">
          <span class="field__label">{{ t()('tournament.venueName') }}</span>
          <input class="input" [value]="venueName()" (input)="venueName.set(text($event))" />
        </label>

        <label class="field">
          <span class="field__label">{{ t()('tournament.venueAddress') }}</span>
          <input class="input" [value]="venueAddress()" (input)="venueAddress.set(text($event))" />
        </label>

        <label class="field">
          <span class="field__label">{{ t()('tournament.venueMapUrl') }}</span>
          <input
            class="input"
            type="url"
            inputmode="url"
            placeholder="https://yandex.ru/maps/..."
            [value]="venueMapUrl()"
            (input)="venueMapUrl.set(text($event))"
          />
        </label>
      </section>

      <section class="glass card--tight stack stack--4">
        <label class="field">
          <span class="field__label">{{ t()('tournament.description') }}</span>
          <textarea
            class="textarea"
            [value]="description()"
            (input)="description.set(text($event))"
          ></textarea>
        </label>

        <label class="field">
          <span class="field__label">{{ t()('tournament.formatDescription') }}</span>
          <textarea
            class="textarea"
            [value]="formatDescription()"
            (input)="formatDescription.set(text($event))"
          ></textarea>
        </label>
      </section>

      <div class="row">
        <button type="button" class="btn btn--glass grow" (click)="cancel()">
          {{ t()('common.cancel') }}
        </button>
        <button
          type="button"
          class="btn btn--primary grow"
          [disabled]="!valid() || saving()"
          (click)="save()"
        >
          {{ isEdit() ? t()('common.save') : t()('tournament.create') }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .compact {
      width: 88px;
      min-height: 34px;
      padding: 2px var(--space-3);
    }

    .chip {
      cursor: pointer;
    }
  `,
})
export class TournamentFormPage {
  private readonly api = inject(TournamentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  readonly id = input<string>();

  protected readonly formats: TournamentFormat[] = ['americano', 'mexicano'];
  protected readonly presets = PLAYER_PRESETS;
  protected readonly sortKeys = STANDINGS_SORT_KEYS;

  protected readonly title = signal('');
  protected readonly category = signal('');
  protected readonly format = signal<TournamentFormat>('americano');
  protected readonly startsAt = signal(defaultStart());
  protected readonly courts = signal(3);
  protected readonly maxPlayers = signal(12);
  protected readonly pointsToWin = signal(11);
  protected readonly matchDuration = signal('');
  protected readonly rounds = signal('');
  protected readonly tieRule = signal<TieRule>('draw');
  protected readonly sortKey = signal<StandingsSortKey>('points');
  protected readonly ratingBalance = signal(true);
  protected readonly entryFee = signal('');
  protected readonly venueName = signal('');
  protected readonly venueAddress = signal('');
  protected readonly venueMapUrl = signal('');
  protected readonly description = signal('');
  protected readonly formatDescription = signal('');
  protected readonly saving = signal(false);

  protected readonly isEdit = computed(() => Boolean(this.id()));

  protected readonly venues = resource({
    loader: () => this.api.listVenues().then((response) => response.venues),
    defaultValue: [] as VenueDto[],
  });

  /** Без `id` (создание турнира) параметр пустой и загрузка не запускается. */
  private readonly existing = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.getTournament(params).then((response) => response.tournament),
  });

  /** Полный круг americano: каждый играет с каждым в паре. */
  protected readonly suggestedRounds = computed(() => {
    if (this.format() !== 'americano') return null;
    const players = this.maxPlayers();
    if (players < 4 || players % 4 !== 0) return null;
    return players - 1;
  });

  protected readonly valid = computed(
    () =>
      this.title().trim().length >= 2 &&
      this.startsAt().length > 0 &&
      this.courts() >= 1 &&
      this.maxPlayers() >= 4,
  );

  constructor() {
    effect(() => {
      const tournament = this.existing.value();
      if (!tournament) return;
      this.title.set(tournament.title);
      this.category.set(tournament.category ?? '');
      this.format.set(tournament.format);
      this.startsAt.set(toLocalInput(tournament.startsAt));
      this.courts.set(tournament.courts);
      this.maxPlayers.set(tournament.maxPlayers);
      this.pointsToWin.set(tournament.pointsToWin);
      this.matchDuration.set(tournament.matchDurationMin?.toString() ?? '');
      this.rounds.set(tournament.roundsPlanned?.toString() ?? '');
      this.tieRule.set(tournament.tieRule);
      this.sortKey.set(tournament.standingsSort[0] ?? 'points');
      this.ratingBalance.set(tournament.ratingBalance);
      this.entryFee.set(tournament.entryFee?.toString() ?? '');
      this.venueName.set(tournament.venueName ?? '');
      this.venueAddress.set(tournament.venueAddress ?? '');
      this.venueMapUrl.set(tournament.venueMapUrl ?? '');
      this.description.set(tournament.description ?? '');
      this.formatDescription.set(tournament.formatDescription ?? '');
    });
  }

  protected roundsSuggestion(): string {
    const suggested = this.suggestedRounds();
    return suggested
      ? `${this.i18n.translate('tournament.roundsHint')} · ${this.i18n.games(suggested)}`
      : this.i18n.translate('tournament.roundsHint');
  }

  protected courtsHint(): string {
    // На корте четверо: подсказка помогает не поставить лишний корт.
    const playing = this.courts() * 4;
    const sitting = Math.max(0, this.maxPlayers() - playing);
    return sitting > 0
      ? `${this.i18n.players(playing)} · ${this.i18n.translate('match.sittingOut')}: ${sitting}`
      : this.i18n.players(playing);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected number(event: Event, fallback: number): number {
    const parsed = Number.parseInt((event.target as HTMLInputElement).value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected tie(event: Event): TieRule {
    return (event.target as HTMLSelectElement).value === 'golden_point' ? 'golden_point' : 'draw';
  }

  protected sort(event: Event): StandingsSortKey {
    const value = (event.target as HTMLSelectElement).value as StandingsSortKey;
    return STANDINGS_SORT_KEYS.includes(value) ? value : 'points';
  }

  protected sortLabel(key: StandingsSortKey): string {
    switch (key) {
      case 'points':
        return this.i18n.translate('standings.points');
      case 'wins':
        return this.i18n.translate('standings.wins');
      case 'diff':
        return this.i18n.translate('standings.diff');
      case 'losses':
        return this.i18n.translate('standings.losses');
      case 'played':
        return this.i18n.translate('standings.played');
      case 'pointsAgainst':
        return this.i18n.translate('standings.pointsAgainst');
    }
  }

  protected applyVenue(venue: VenueDto): void {
    this.venueName.set(venue.name);
    this.venueAddress.set(venue.address ?? '');
    this.venueMapUrl.set(venue.mapUrl ?? '');
  }

  protected cancel(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/tournaments', id] : ['/tournaments']);
  }

  protected async save(): Promise<void> {
    if (!this.valid()) return;
    this.saving.set(true);

    const payload: CreateTournamentInput = {
      title: this.title().trim(),
      category: this.category().trim() || null,
      format: this.format(),
      startsAt: new Date(this.startsAt()).toISOString(),
      courts: this.courts(),
      maxPlayers: this.maxPlayers(),
      pointsToWin: this.pointsToWin(),
      matchDurationMin: toNumberOrNull(this.matchDuration()),
      roundsPlanned: toNumberOrNull(this.rounds()) ?? this.suggestedRounds(),
      tieRule: this.tieRule(),
      standingsSort: uniqueSort(this.sortKey()),
      ratingBalance: this.ratingBalance(),
      entryFee: toNumberOrNull(this.entryFee()),
      description: this.description().trim() || null,
      formatDescription: this.formatDescription().trim() || null,
      venueName: this.venueName().trim() || null,
      venueAddress: this.venueAddress().trim() || null,
      venueMapUrl: this.venueMapUrl().trim() || null,
    };

    try {
      const id = this.id();
      if (id) {
        await this.api.updateTournament(id, payload);
        this.toast.success(this.i18n.translate('tournament.updated'));
        await this.router.navigate(['/tournaments', id]);
      } else {
        const { tournament } = await this.api.createTournament(payload);
        this.toast.success(this.i18n.translate('tournament.created'));
        await this.router.navigate(['/tournaments', tournament.id, 'players']);
      }
    } catch (error) {
      this.toast.failure(error, () => void this.save());
    } finally {
      this.saving.set(false);
    }
  }
}

function toNumberOrNull(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Первый ключ — выбранный, дальше разумные тай-брейки. */
function uniqueSort(primary: StandingsSortKey): StandingsSortKey[] {
  const rest: StandingsSortKey[] = ['points', 'diff', 'wins'];
  return [primary, ...rest.filter((key) => key !== primary)];
}

function defaultStart(): string {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toLocalInput(date.toISOString());
}

/** `datetime-local` работает с локальным временем без часового пояса. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
