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
  trainingCourtHours,
  type CreateTrainingInput,
  type VenueDto,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { TrainingApi } from '../../core/training-api';

interface BlockDraft {
  courts: string;
  hours: string;
}

@Component({
  selector: 'app-training-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack stack--4">
      <h1>{{ isEdit() ? t()('training.edit') : t()('training.create') }}</h1>

      <section class="glass card--tight stack stack--4">
        <label class="field">
          <span class="field__label">{{ t()('training.title') }}</span>
          <input class="input" [value]="title()" (input)="title.set(text($event))" />
        </label>

        <label class="field">
          <span class="field__label">{{ t()('training.startsAt') }}</span>
          <input
            class="input"
            type="datetime-local"
            [value]="startsAt()"
            (input)="startsAt.set(text($event))"
          />
        </label>

        <div class="row row--wrap row--fields">
          <label class="field grow">
            <span class="field__label">{{ t()('training.maxPlayers') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="200"
              [value]="maxPlayersText()"
              [placeholder]="t()('common.optional')"
              (input)="maxPlayersText.set(text($event))"
            />
            <span class="field__hint">{{ t()('training.maxPlayersHint') }}</span>
          </label>

          <label class="field grow">
            <span class="field__label">{{ t()('training.pricePerCourtHour') }}</span>
            <input
              class="input numeric"
              type="number"
              min="0"
              [value]="priceText()"
              (input)="priceText.set(text($event))"
            />
          </label>
        </div>

        <div class="field stack stack--3">
          <span class="field__label">{{ t()('training.courtBlocks') }}</span>
          <span class="field__hint">{{ t()('training.courtBlocksHint') }}</span>

          @for (block of blocks(); track $index; let index = $index) {
            <div class="row row--fields block-row">
              <label class="field grow">
                <span class="field__label">{{ t()('training.blockCourts') }}</span>
                <input
                  class="input numeric"
                  type="number"
                  min="1"
                  max="20"
                  [value]="block.courts"
                  (input)="setBlock(index, 'courts', text($event))"
                />
              </label>
              <label class="field grow">
                <span class="field__label">{{ t()('training.blockHours') }}</span>
                <input
                  class="input numeric"
                  type="number"
                  min="0.5"
                  max="24"
                  step="0.5"
                  [value]="block.hours"
                  (input)="setBlock(index, 'hours', text($event))"
                />
              </label>
              @if (blocks().length > 1) {
                <button
                  type="button"
                  class="btn btn--sm btn--glass"
                  (click)="removeBlock(index)"
                >
                  {{ t()('training.removeBlock') }}
                </button>
              }
            </div>
          }

          <button type="button" class="btn btn--sm btn--glass" (click)="addBlock()">
            {{ t()('training.addBlock') }}
          </button>

          <div class="row row--wrap">
            <span class="chip">
              {{ t()('training.courtHours', { hours: formatHours(courtHours()) }) }}
            </span>
            <span class="chip chip--accent numeric">
              {{ t()('training.totalCost', { amount: totalCost() }) }}
            </span>
          </div>
        </div>

        <label class="field">
          <span class="field__label">{{ t()('training.description') }}</span>
          <textarea
            class="input"
            rows="3"
            [value]="description()"
            (input)="description.set(text($event))"
          ></textarea>
        </label>

        <div class="stack stack--3">
          <h3>{{ t()('training.venue') }}</h3>
          @if (venues.value().length > 0) {
            <div class="venue-chips">
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
            <input
              class="input"
              [value]="venueAddress()"
              (input)="venueAddress.set(text($event))"
            />
          </label>
          <label class="field">
            <span class="field__label">{{ t()('tournament.venueMapUrl') }}</span>
            <input class="input" [value]="venueMapUrl()" (input)="venueMapUrl.set(text($event))" />
          </label>
        </div>
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
          {{ t()('common.save') }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .block-row {
      align-items: end;
      gap: var(--space-2);
    }
  `,
})
export class TrainingFormPage {
  private readonly api = inject(TrainingApi);
  private readonly tournamentApi = inject(TournamentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  /** При редактировании — id из маршрута. */
  readonly id = input<string | undefined>();

  protected readonly title = signal('Тренировка');
  protected readonly startsAt = signal(defaultStart());
  protected readonly maxPlayersText = signal('');
  protected readonly priceText = signal('1500');
  protected readonly blocks = signal<BlockDraft[]>([{ courts: '2', hours: '2' }]);
  protected readonly description = signal('');
  protected readonly venueName = signal('');
  protected readonly venueAddress = signal('');
  protected readonly venueMapUrl = signal('');
  protected readonly saving = signal(false);

  protected readonly venues = resource({
    loader: () => this.tournamentApi.listVenues().then((response) => response.venues),
    defaultValue: [] as VenueDto[],
  });

  protected readonly isEdit = computed(() => Boolean(this.id()));

  protected readonly parsedBlocks = computed(() =>
    this.blocks()
      .map((block) => ({
        courts: Number.parseInt(block.courts, 10),
        hours: Number.parseFloat(block.hours),
      }))
      .filter(
        (block) =>
          Number.isFinite(block.courts) &&
          block.courts >= 1 &&
          Number.isFinite(block.hours) &&
          block.hours >= 0.5,
      ),
  );

  protected readonly courtHours = computed(() => trainingCourtHours(this.parsedBlocks()));
  protected readonly price = computed(() => Number.parseInt(this.priceText().trim(), 10) || 0);
  protected readonly totalCost = computed(() => Math.round(this.courtHours() * this.price()));

  protected readonly valid = computed(() => {
    if (this.title().trim().length < 2) return false;
    if (!this.startsAt()) return false;
    if (this.parsedBlocks().length === 0) return false;
    if (!Number.isFinite(this.price()) || this.price() < 0) return false;
    return true;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (!id) return;
      void this.api.getState(id).then((state) => {
        const item = state.training;
        this.title.set(item.title);
        this.startsAt.set(toLocalInput(item.startsAt));
        this.maxPlayersText.set(item.maxPlayers?.toString() ?? '');
        this.priceText.set(String(item.pricePerCourtHour));
        this.blocks.set(
          item.courtBlocks.map((block) => ({
            courts: String(block.courts),
            hours: String(block.hours),
          })),
        );
        this.description.set(item.description ?? '');
        this.venueName.set(item.venueName ?? '');
        this.venueAddress.set(item.venueAddress ?? '');
        this.venueMapUrl.set(item.venueMapUrl ?? '');
      });
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected formatHours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  protected setBlock(index: number, key: keyof BlockDraft, value: string): void {
    this.blocks.update((list) =>
      list.map((block, i) => (i === index ? { ...block, [key]: value } : block)),
    );
  }

  protected addBlock(): void {
    this.blocks.update((list) => [...list, { courts: '1', hours: '1' }]);
  }

  protected removeBlock(index: number): void {
    this.blocks.update((list) => list.filter((_, i) => i !== index));
  }

  protected applyVenue(venue: VenueDto): void {
    this.venueName.set(venue.name);
    this.venueAddress.set(venue.address ?? '');
    this.venueMapUrl.set(venue.mapUrl ?? '');
  }

  protected cancel(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/trainings', id] : ['/trainings']);
  }

  protected async save(): Promise<void> {
    if (!this.valid()) return;
    this.saving.set(true);

    const maxRaw = this.maxPlayersText().trim();
    const maxPlayers = maxRaw === '' ? null : Number.parseInt(maxRaw, 10);

    const payload: CreateTrainingInput = {
      title: this.title().trim(),
      startsAt: new Date(this.startsAt()).toISOString(),
      maxPlayers: Number.isFinite(maxPlayers as number) ? maxPlayers : null,
      pricePerCourtHour: this.price(),
      courtBlocks: this.parsedBlocks(),
      description: this.description().replace(/\r\n?/g, '\n').trim() || null,
      venueName: this.venueName().trim() || null,
      venueAddress: this.venueAddress().trim() || null,
      venueMapUrl: this.venueMapUrl().trim() || null,
    };

    try {
      const id = this.id();
      if (id) {
        await this.api.updateTraining(id, payload);
        this.toast.success(this.i18n.translate('training.updated'));
        await this.router.navigate(['/trainings', id]);
      } else {
        const { training } = await this.api.createTraining(payload);
        this.toast.success(this.i18n.translate('training.created'));
        await this.router.navigate(['/trainings', training.id, 'players']);
      }
    } catch (error) {
      this.toast.failure(error, () => void this.save());
    } finally {
      this.saving.set(false);
    }
  }
}

function defaultStart(): string {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toLocalInput(date.toISOString());
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
