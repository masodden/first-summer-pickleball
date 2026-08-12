import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PlayerDto } from '@fsp/shared';
import { I18nService } from '../core/i18n';
import { RatingChip } from './rating-chip';

function safeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Аватар игрока: инициалы всегда на месте, фото появляется после успешной
 * загрузки. Битый URL с Telegram не ломает карточку — остаёмся на буквах.
 *
 * Важно: при WS-обновлении состава объект player пересоздаётся с тем же URL.
 * Нельзя из‑за этого сбрасывать loaded — иначе картинка мигает и в WebView
 * Telegram иногда «глотает» всю строку игрока.
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--avatar-size.px]': 'size()' },
  template: `
    <span class="avatar__initials" aria-hidden="true" [class.is-hidden]="photoReady()">
      {{ initials() }}
    </span>
    @if (displayUrl(); as src) {
      <img
        class="avatar__img"
        [src]="src"
        [alt]="player().fullName || ''"
        [width]="size()"
        [height]="size()"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        [class.is-ready]="photoReady()"
        (load)="onLoad(src)"
        (error)="onError(src)"
      />
    }
  `,
  styles: `
    :host {
      position: relative;
      display: grid;
      place-items: center;
      width: var(--avatar-size, 40px);
      height: var(--avatar-size, 40px);
      flex: 0 0 auto;
      border-radius: 50%;
      overflow: hidden;
      background: linear-gradient(160deg, var(--clay-200), var(--clay-400));
      color: #fff;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: calc(var(--avatar-size, 40px) * 0.36);
      letter-spacing: 0.02em;
      box-shadow: inset 0 0 0 1px var(--glass-border);
    }

    .avatar__initials,
    .avatar__img {
      grid-area: 1 / 1;
    }

    .avatar__initials.is-hidden {
      opacity: 0;
    }

    .avatar__img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
    }

    .avatar__img.is-ready {
      opacity: 1;
    }
  `,
})
export class Avatar {
  readonly player = input.required<PlayerDto>();
  /** Логический размер в CSS-пикселях; URL с Telegram обычно уже ~160–320px. */
  readonly size = input(40);

  /** Актуальный URL с карточки (может приходить снова при каждом WS-тике). */
  private readonly sourceUrl = signal<string | null>(null);
  /** URL, который уже успешно показан. */
  private readonly loadedUrl = signal<string | null>(null);
  /** URL, который уже упал — не пытаемся снова, пока не сменится. */
  private readonly failedUrl = signal<string | null>(null);

  protected readonly initials = computed(() => {
    const player = this.player();
    const first = safeText(player.firstName).at(0) ?? '';
    const last = safeText(player.lastName).at(0) ?? '';
    return `${first}${last}`.toUpperCase() || '?';
  });

  protected readonly displayUrl = computed(() => {
    const url = this.sourceUrl();
    if (!url || url === this.failedUrl()) return null;
    return url;
  });

  protected readonly photoReady = computed(() => {
    const url = this.displayUrl();
    return url !== null && this.loadedUrl() === url;
  });

  constructor() {
    effect(() => {
      const url = safeText(this.player().avatarUrl) || null;
      if (url === this.sourceUrl()) return;
      this.sourceUrl.set(url);
      // Новый URL — даём ещё один шанс, даже если старый падал.
      if (url !== this.failedUrl()) {
        // loadedUrl оставляем: если совпадёт с новым — photoReady сразу true;
        // если нет — покажем инициалы, пока не придёт load.
      }
    });
  }

  protected onLoad(src: string): void {
    this.loadedUrl.set(src);
    if (this.failedUrl() === src) this.failedUrl.set(null);
  }

  protected onError(src: string): void {
    this.failedUrl.set(src);
    if (this.loadedUrl() === src) this.loadedUrl.set(null);
  }
}

/**
 * Строка игрока: аватар, имя и рейтинг.
 *
 * Одна и та же строка используется в списке участников, на кортах и в таблице,
 * поэтому рейтинг виден везде, где важно понимать уровень игрока.
 */
@Component({
  selector: 'app-player-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Avatar, RatingChip],
  template: `
    <div class="line">
      @if (showAvatar()) {
        <app-avatar [player]="player()" [size]="avatarSize()" />
      }

      <div class="line__text grow">
        @if (link()) {
          <a class="line__name truncate" [routerLink]="['/players', player().id]">
            {{ displayName() }}
          </a>
        } @else {
          <span class="line__name truncate">{{ displayName() }}</span>
        }

        @if (subtitle()) {
          <span class="tiny faint truncate">{{ subtitle() }}</span>
        }
      </div>

      @if (showRating()) {
        <app-rating-chip [player]="player()" [showLabel]="false" />
      }
      @if (player().isGuest) {
        <span class="chip chip--pink">{{ t()('participant.guestBadge') }}</span>
      }
    </div>
  `,
  styles: `
    .line {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }

    .line__text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .line__name {
      font-weight: 600;
      color: var(--text-strong);
    }

    a.line__name:hover {
      color: var(--accent);
      text-decoration: none;
    }
  `,
})
export class PlayerLine {
  readonly player = input.required<PlayerDto>();
  readonly subtitle = input<string | null>(null);
  readonly showAvatar = input(true);
  readonly showRating = input(true);
  readonly avatarSize = input(40);
  readonly link = input(true);

  protected readonly t = inject(I18nService).t;

  protected readonly displayName = computed(() => {
    const player = this.player();
    const full = safeText(player.fullName);
    if (full) return full;
    const joined = [safeText(player.firstName), safeText(player.lastName)]
      .filter(Boolean)
      .join(' ');
    return joined || player.id;
  });
}
