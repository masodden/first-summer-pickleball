import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { isBootstrapAdminDupr, isValidDuprId, type PlayerDto } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { parseRatingInput, sanitizeRatingInput } from '../../core/rating-input';
import { SessionStore } from '../../core/session';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { PlayerLine } from '../../ui/player-line';
import { Racket } from '../../ui/ball';

/**
 * Привязка или смена DUPR ID.
 *
 * Для PZQZKM / P5ML0M сразу показывается поле кода администратора — иначе
 * сервер отклоняет запрос до того, как сессия успеет попросить код.
 */
@Component({
  selector: 'app-claim',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerLine, Racket],
  template: `
    <div class="stack stack--4">
      <div class="stack stack--2">
        <h1>{{ changing() ? t()('claim.changeTitle') : t()('claim.title') }}</h1>
        <p class="small muted">
          {{ changing() ? t()('claim.changeHint') : t()('claim.hint') }}
        </p>
      </div>

      @if (currentClaim(); as claim) {
        <section class="glass card--tight stack stack--2">
          <span class="chip" [class.chip--go]="claim.status === 'approved'">
            {{
              t()(
                claim.status === 'approved'
                  ? 'claim.approved'
                  : claim.status === 'rejected'
                    ? 'claim.rejected'
                    : 'claim.pending'
              )
            }}
          </span>
          <span class="small muted">{{ t()('claim.duprId') }}: {{ claim.duprId }}</span>
        </section>
      }

      <section class="glass card--tight stack stack--3">
        <label class="field">
          <span class="field__label">{{ t()('common.search') }}</span>
          <input
            class="input"
            type="search"
            autocomplete="off"
            [placeholder]="t()('claim.searchPlaceholder')"
            [value]="query()"
            (input)="query.set(text($event))"
          />
        </label>

        @if (results().length > 0) {
          <div class="stack stack--1">
            @for (player of results(); track player.id) {
              <button
                type="button"
                class="result"
                [class.result--selected]="selected()?.id === player.id"
                (click)="select(player)"
              >
                <app-player-line [player]="player" [link]="false" [avatarSize]="34" />
              </button>
            }
          </div>
        } @else if (query().length > 1 && !players.isLoading()) {
          <p class="small muted">{{ t()('claim.notFound') }}</p>
        }
      </section>

      <section class="glass card--tight stack stack--3">
        <label class="field">
          <span class="field__label">{{ t()('claim.duprId') }}</span>
          <input
            class="input"
            autocapitalize="characters"
            maxlength="6"
            [class.input--invalid]="duprInvalid()"
            [value]="duprId()"
            (input)="duprId.set(text($event).toUpperCase())"
          />
          <span class="field__hint">{{ t()('claim.duprIdHint') }}</span>
        </label>

        @if (needsBootstrapCode()) {
          <label class="field">
            <span class="field__label">{{ t()('auth.bootstrapCode') }}</span>
            <input
              class="input"
              type="password"
              autocomplete="one-time-code"
              [value]="code()"
              (input)="code.set(text($event))"
            />
            <span class="field__hint">{{ t()('auth.bootstrapHint') }}</span>
          </label>
        }

        @if (!selected()) {
          <div class="row">
            <label class="field grow">
              <span class="field__label">{{ t()('player.firstName') }}</span>
              <input class="input" [value]="firstName()" (input)="firstName.set(text($event))" />
            </label>
            <label class="field grow">
              <span class="field__label">{{ t()('player.lastName') }}</span>
              <input class="input" [value]="lastName()" (input)="lastName.set(text($event))" />
            </label>
          </div>

          <label class="field">
            <span class="field__label">{{ t()('rating.doubles') }}</span>
            <input
              class="input numeric"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              [value]="rating()"
              (input)="rating.set(sanitizeRating(text($event)))"
            />
            <span class="field__hint">{{ t()('rating.range') }}</span>
          </label>
        }

        <button
          type="button"
          class="btn btn--primary btn--lg btn--block"
          [disabled]="!canSubmit() || busy()"
          (click)="submit()"
        >
          {{ changing() ? t()('claim.changeSubmit') : t()('claim.submit') }}
        </button>
      </section>

      <div class="empty-state">
        <app-racket [size]="44" [swing]="true" />
        <p class="tiny faint">{{ t()('claim.inviteHint') }}</p>
      </div>
    </div>
  `,
  styles: `
    .result {
      display: flex;
      width: 100%;
      padding: var(--space-2) var(--space-3);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    .result:hover {
      background: var(--surface-hover);
    }

    .result--selected {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .result > * {
      flex: 1 1 auto;
      min-width: 0;
    }
  `,
})
export class ClaimPage {
  private readonly api = inject(TournamentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly session = inject(SessionStore);
  protected readonly t = this.i18n.t;

  protected readonly query = signal('');
  private readonly debounced = signal('');
  protected readonly selected = signal<PlayerDto | null>(null);
  protected readonly duprId = signal('');
  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly rating = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);

  protected readonly currentClaim = computed(() => this.session.session()?.claim ?? null);
  protected readonly changing = computed(() => this.session.playerId() !== null);
  protected readonly needsBootstrapCode = computed(() => isBootstrapAdminDupr(this.duprId()));

  protected readonly players = resource({
    params: () => this.debounced(),
    loader: ({ params }) =>
      params.length > 1
        ? this.api.searchPlayers(params, false).then((response) => response.items)
        : Promise.resolve([]),
    defaultValue: [] as PlayerDto[],
  });

  protected readonly results = computed(() => this.players.value().slice(0, 8));

  protected readonly duprInvalid = computed(() => {
    const value = this.duprId().trim();
    return value.length > 0 && !isValidDuprId(value);
  });

  protected readonly canSubmit = computed(() => {
    if (this.duprInvalid() || this.duprId().trim().length !== 6) return false;
    if (this.needsBootstrapCode() && this.code().trim().length === 0) return false;
    if (this.selected()) return true;
    return this.firstName().trim().length > 0 && this.lastName().trim().length > 0;
  });

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

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected sanitizeRating(value: string): string {
    return sanitizeRatingInput(value);
  }

  protected select(player: PlayerDto): void {
    this.selected.set(player);
    this.duprId.set(player.duprId ?? '');
    this.firstName.set(player.firstName);
    this.lastName.set(player.lastName);
    this.rating.set(player.doublesRating?.toFixed(3) ?? '');
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    try {
      const parsed = parseRatingInput(this.rating());
      const code = this.code().trim();
      await this.session.claimDupr({
        duprId: this.duprId().trim(),
        firstName: this.firstName().trim() || undefined,
        lastName: this.lastName().trim() || undefined,
        doublesRating: parsed ?? undefined,
        ...(code ? { code } : {}),
      });

      const claim = this.currentClaim();
      this.toast.success(
        this.i18n.translate(claim?.status === 'approved' ? 'claim.approved' : 'claim.pending'),
      );
      if (claim?.status === 'approved') await this.router.navigate(['/tournaments']);
    } catch (error) {
      this.toast.failure(error, () => void this.submit());
    } finally {
      this.busy.set(false);
    }
  }
}
