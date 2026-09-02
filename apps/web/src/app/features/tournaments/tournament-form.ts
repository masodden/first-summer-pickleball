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
  WINNER_RULE_IDS,
  WINNER_RULE_SORT,
  classicTwelvePairBracket,
  formatDescriptionKey,
  formatNameKey,
  isFixedPairsFormat,
  matchWinnerRule,
  validateBracketConfig,
  type BracketConfig,
  type CreateTournamentInput,
  type TieRule,
  type TournamentFormat,
  type VenueDto,
  type WinnerRuleId,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { BracketEditor } from './bracket-editor';

const PLAYER_PRESETS = [4, 8, 12, 16, 20, 24] as const;
const FIXED_PAIRS_PLAYER_PRESETS = [24, 16, 12, 8] as const;

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
  imports: [BracketEditor],
  template: `
    <div class="stack stack--4">
      <h1>{{ isEdit() ? t()('tournament.edit') : t()('tournament.createTitle') }}</h1>

      <section class="glass card--tight stack stack--4">
        <label class="field">
          <span class="field__label">{{ t()('tournament.title') }}</span>
          <input class="input" [value]="title()" (input)="title.set(text($event))" />
        </label>

        <div class="row row--wrap row--fields">
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
          <div class="row row--wrap">
            @for (option of formats; track option) {
              <button
                type="button"
                class="btn btn--sm grow"
                [class.btn--primary]="format() === option"
                [class.btn--glass]="format() !== option"
                (click)="setFormat(option)"
              >
                {{ t()(formatNameKey(option)) }}
              </button>
            }
          </div>
          <span class="field__hint">{{ t()(formatDescriptionKey(format())) }}</span>
        </div>

        @if (!isFixedPairs()) {
          <label class="field">
            <span class="field__label">{{ t()('tournament.standingsSort') }}</span>
            <select
              class="select"
              [value]="winnerRule()"
              (change)="winnerRule.set(winnerRuleFrom($event))"
            >
              @for (rule of winnerRules; track rule) {
                <option [value]="rule">{{ winnerRuleLabel(rule) }}</option>
              }
            </select>
          </label>
        }

        <div class="field">
          <span class="field__label">{{ t()('tournament.maxPlayers') }}</span>
          <div class="player-count" [class.player-count--tight]="isFixedPairs()">
            @for (preset of playerPresets(); track preset) {
              <button
                type="button"
                class="chip"
                [class.chip--accent]="maxPlayers() === preset"
                (click)="maxPlayersText.set(preset.toString())"
              >
                {{ preset }}
              </button>
            }
            <input
              class="input numeric compact"
              type="number"
              min="4"
              max="200"
              [value]="maxPlayersText()"
              (input)="maxPlayersText.set(text($event))"
            />
          </div>
        </div>

        <div class="row row--wrap row--fields">
          <label class="field grow">
            <span class="field__label">{{ t()('tournament.courts') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="20"
              [value]="courtsText()"
              (input)="courtsText.set(text($event))"
            />
            <span class="field__hint">{{ courtsHint() }}</span>
          </label>

          @if (!isFixedPairs()) {
            <label class="field grow">
              <span class="field__label">{{ t()('tournament.pointsToWin') }}</span>
              <input
                class="input numeric"
                type="number"
                min="1"
                max="99"
                [value]="pointsToWinText()"
                (input)="pointsToWinText.set(text($event))"
              />
            </label>
          }
        </div>

        @if (courtSlots().length > 0) {
          <div class="field">
            <span class="field__label">{{ t()('tournament.courtNames') }}</span>
            <div class="courts">
              @for (slot of courtSlots(); track slot) {
                <label class="court-slot">
                  <span class="tiny faint">{{ courtSlotLabel(slot) }}</span>
                  <input
                    class="input compact"
                    maxlength="24"
                    [value]="courtName(slot)"
                    [placeholder]="(slot + 1).toString()"
                    (input)="setCourtName(slot, text($event))"
                  />
                </label>
              }
            </div>
            <span class="field__hint">{{ t()('tournament.courtNamesHint') }}</span>
          </div>
        }

        @if (!isFixedPairs()) {
          <div class="row row--wrap row--fields">
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

          <label class="field">
            <span class="field__label">{{ t()('tournament.tieRule') }}</span>
            <select class="select" [value]="tieRule()" (change)="tieRule.set(tie($event))">
              <option value="golden_point">{{ t()('tie.golden_point') }}</option>
              <option value="draw">{{ t()('tie.draw') }}</option>
            </select>
          </label>

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
        }

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

        @if (isFixedPairs()) {
          <app-bracket-editor
            [config]="bracketConfig()"
            [maxPlayers]="maxPlayers()"
            (changed)="bracketConfig.set($event)"
            (presetApplied)="applyBracketPreset($event)"
          />
        }
      </section>

      <section class="glass card--tight stack stack--4">
        <h3>{{ t()('tournament.venue') }}</h3>

        @if (venues.value().length > 0) {
          <div class="stack stack--2">
            <span class="tiny faint">{{ t()('tournament.savedVenues') }}</span>
            <div class="venue-chips">
              @for (venue of venues.value(); track venue.id) {
                <button type="button" class="chip" (click)="applyVenue(venue)">
                  {{ venue.name }}
                </button>
              }
            </div>
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
            rows="5"
            [value]="description()"
            (input)="description.set(multiline($event))"
          ></textarea>
        </label>

        <label class="field">
          <span class="field__label">{{ t()('tournament.formatDescription') }}</span>
          <textarea
            class="textarea"
            rows="5"
            [value]="formatDescription()"
            (input)="formatDescription.set(multiline($event))"
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
    .player-count {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
    }

    .player-count--tight {
      flex-wrap: nowrap;
    }

    .player-count--tight .chip {
      flex: 1 1 0;
      justify-content: center;
      min-width: 0;
      padding-inline: 8px;
    }

    .player-count--tight .compact {
      width: 72px;
      flex: 0 0 72px;
    }

    .compact {
      width: 88px;
      min-height: 34px;
      padding: 2px var(--space-3);
    }

    .chip {
      cursor: pointer;
    }

    .courts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .court-slot {
      display: flex;
      flex-direction: column;
      gap: 2px;
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

  protected readonly formats: TournamentFormat[] = ['americano', 'mexicano', 'fixed_pairs'];
  protected readonly formatNameKey = formatNameKey;
  protected readonly formatDescriptionKey = formatDescriptionKey;
  protected readonly winnerRules = WINNER_RULE_IDS;

  protected readonly playerPresets = computed(() =>
    this.isFixedPairs() ? FIXED_PAIRS_PLAYER_PRESETS : PLAYER_PRESETS,
  );

  protected readonly title = signal('');
  protected readonly category = signal('');
  protected readonly format = signal<TournamentFormat>('americano');
  protected readonly startsAt = signal(defaultStart());
  // Числовые поля храним строкой: в поле остаётся ровно то, что набрал организатор,
  // а не подставленное вместо пустоты значение по умолчанию.
  protected readonly courtsText = signal('3');
  protected readonly maxPlayersText = signal('12');
  protected readonly pointsToWinText = signal('11');
  protected readonly matchDuration = signal('');
  protected readonly rounds = signal('');
  protected readonly tieRule = signal<TieRule>('golden_point');
  protected readonly winnerRule = signal<WinnerRuleId>('points_diff');
  protected readonly ratingBalance = signal(true);
  protected readonly bracketConfig = signal<BracketConfig>(classicTwelvePairBracket());
  protected readonly entryFee = signal('');
  protected readonly venueName = signal('');
  protected readonly venueAddress = signal('');
  protected readonly venueMapUrl = signal('');
  protected readonly description = signal('');
  protected readonly formatDescription = signal('');
  protected readonly saving = signal(false);
  /** Названия кортов по позициям; пустое значение — корт остаётся под номером. */
  protected readonly courtNames = signal<string[]>([]);

  protected readonly isEdit = computed(() => Boolean(this.id()));
  protected readonly isFixedPairs = computed(() => isFixedPairsFormat(this.format()));

  protected readonly courts = computed(() => toNumberOrNull(this.courtsText()) ?? 0);
  protected readonly maxPlayers = computed(() => toNumberOrNull(this.maxPlayersText()) ?? 0);
  protected readonly pointsToWin = computed(() => toNumberOrNull(this.pointsToWinText()) ?? 0);

  /** Поля для подписей появляются и исчезают вслед за количеством кортов. */
  protected readonly courtSlots = computed(() =>
    Array.from({ length: Math.min(Math.max(this.courts(), 0), 20) }, (_, index) => index),
  );

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

  protected readonly valid = computed(() => {
    const base =
      this.title().trim().length >= 2 &&
      this.startsAt().length > 0 &&
      this.courts() >= 1 &&
      this.maxPlayers() >= 4;
    if (!this.isFixedPairs()) return base && this.pointsToWin() >= 1;
    return (
      base &&
      this.bracketConfig().groupGames.pointsToWin >= 1 &&
      validateBracketConfig(this.bracketConfig()).length === 0
    );
  });

  constructor() {
    effect(() => {
      const tournament = this.existing.value();
      if (!tournament) return;
      this.title.set(tournament.title);
      this.category.set(tournament.category ?? '');
      this.format.set(tournament.format);
      this.startsAt.set(toLocalInput(tournament.startsAt));
      this.courtsText.set(tournament.courts.toString());
      this.maxPlayersText.set(tournament.maxPlayers.toString());
      this.pointsToWinText.set(tournament.pointsToWin.toString());
      this.matchDuration.set(tournament.matchDurationMin?.toString() ?? '');
      this.rounds.set(tournament.roundsPlanned?.toString() ?? '');
      this.tieRule.set(tournament.tieRule);
      this.winnerRule.set(matchWinnerRule(tournament.standingsSort));
      this.ratingBalance.set(tournament.ratingBalance);
      this.entryFee.set(tournament.entryFee?.toString() ?? '');
      this.venueName.set(tournament.venueName ?? '');
      this.venueAddress.set(tournament.venueAddress ?? '');
      this.venueMapUrl.set(tournament.venueMapUrl ?? '');
      this.description.set(tournament.description ?? '');
      this.formatDescription.set(tournament.formatDescription ?? '');
      this.courtNames.set([...(tournament.courtNames ?? [])]);
      if (tournament.bracketConfig) this.bracketConfig.set(tournament.bracketConfig);
    });
  }

  protected courtName(slot: number): string {
    return this.courtNames()[slot] ?? '';
  }

  protected courtSlotLabel(slot: number): string {
    return this.i18n.translate('tournament.courtSlot', { number: slot + 1 });
  }

  protected setCourtName(slot: number, value: string): void {
    this.courtNames.update((names) => {
      const next = [...names];
      while (next.length <= slot) next.push('');
      next[slot] = value;
      return next;
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
    const playing = Math.max(0, this.courts()) * 4;
    const sitting = Math.max(0, this.maxPlayers() - playing);
    return sitting > 0
      ? `${this.i18n.players(playing)} · ${this.i18n.translate('match.sittingOut')}: ${sitting}`
      : this.i18n.players(playing);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Сохраняем переносы строк при вставке из мессенджера / Word (`\r\n` → `\n`). */
  protected multiline(event: Event): string {
    return this.text(event).replace(/\r\n?/g, '\n');
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected tie(event: Event): TieRule {
    return (event.target as HTMLSelectElement).value === 'golden_point' ? 'golden_point' : 'draw';
  }

  protected winnerRuleFrom(event: Event): WinnerRuleId {
    const value = (event.target as HTMLSelectElement).value as WinnerRuleId;
    return WINNER_RULE_IDS.includes(value) ? value : 'points_diff';
  }

  protected winnerRuleLabel(rule: WinnerRuleId): string {
    switch (rule) {
      case 'points_diff':
        return this.i18n.translate('tournament.winnerRule.pointsDiff');
      case 'points_wins':
        return this.i18n.translate('tournament.winnerRule.pointsWins');
      case 'wins_points':
        return this.i18n.translate('tournament.winnerRule.winsPoints');
    }
  }

  protected setFormat(option: TournamentFormat): void {
    this.format.set(option);
    if (this.isEdit() || !isFixedPairsFormat(option)) return;
    this.maxPlayersText.set('24');
    this.courtsText.set('6');
    this.bracketConfig.set(classicTwelvePairBracket());
  }

  protected applyBracketPreset(preset: { players: number; courts: number }): void {
    this.maxPlayersText.set(preset.players.toString());
    this.courtsText.set(preset.courts.toString());
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
      courtNames: this.courtSlots().map((slot) => this.courtName(slot).trim()),
      maxPlayers: this.maxPlayers(),
      pointsToWin: this.isFixedPairs()
        ? this.bracketConfig().groupGames.pointsToWin
        : this.pointsToWin(),
      matchDurationMin: this.isFixedPairs() ? null : toNumberOrNull(this.matchDuration()),
      roundsPlanned: this.isFixedPairs() ? null : (toNumberOrNull(this.rounds()) ?? this.suggestedRounds()),
      tieRule: this.isFixedPairs() ? 'golden_point' : this.tieRule(),
      standingsSort: [...WINNER_RULE_SORT[this.winnerRule()]],
      ratingBalance: this.isFixedPairs() ? false : this.ratingBalance(),
      entryFee: toNumberOrNull(this.entryFee()),
      description: this.description().replace(/\r\n?/g, '\n').trim() || null,
      formatDescription: this.formatDescription().replace(/\r\n?/g, '\n').trim() || null,
      venueName: this.venueName().trim() || null,
      venueAddress: this.venueAddress().trim() || null,
      venueMapUrl: this.venueMapUrl().trim() || null,
      bracketConfig: this.isFixedPairs() ? this.bracketConfig() : null,
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
