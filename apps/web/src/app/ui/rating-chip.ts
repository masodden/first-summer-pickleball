import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { PlayerDto } from '@fsp/shared';
import { I18nService } from '../core/i18n';

/**
 * Парный рейтинг DUPR рядом с именем.
 *
 * Рейтинг ведётся вручную, поэтому важно показывать не только число, но и
 * доверие к нему: свежее значение — акцентный чип, давнее — приглушённый,
 * отсутствующее — пунктирный. Так организатор сразу видит, кого переспросить.
 */
@Component({
  selector: 'app-rating-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Гость без рейтинга: чип «НР» рядом с бейджем «Гость» только шумит.
    '[hidden]': 'hideForGuest()',
  },
  template: `
    @if (!hideForGuest()) {
      <span
        class="rating-chip"
        [class.rating-chip--compact]="compact()"
        [class.rating-chip--stale]="player().ratingStale && rating() !== null"
        [class.rating-chip--none]="rating() === null"
        [title]="hint()"
      >
        @if (showLabel()) {
          <span class="rating-chip__label">DUPR</span>
        }
        <span>{{ value() }}</span>
      </span>
    }
  `,
})
export class RatingChip {
  private readonly i18n = inject(I18nService);

  readonly player = input.required<PlayerDto>();
  readonly showLabel = input(true);
  /** Мельче и уже: для строк матча, где главное — имя, а рейтинг рядом справкой. */
  readonly compact = input(false);

  protected readonly rating = computed(() => {
    const value = this.player().doublesRating;
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  });

  protected readonly hideForGuest = computed(
    () => this.player().isGuest && this.rating() === null,
  );

  protected readonly value = computed(() => {
    const rating = this.rating();
    return rating === null ? this.i18n.translate('rating.noneShort') : rating.toFixed(3);
  });

  protected readonly hint = computed(() => {
    const player = this.player();
    const rating = this.rating();
    if (rating === null) return this.i18n.translate('rating.noneHint');

    const parts = [this.i18n.translate('rating.doubles')];
    if (player.ratingUpdatedAt) {
      parts.push(
        this.i18n.translate('rating.updatedAt', {
          date: this.i18n.formatDay(player.ratingUpdatedAt),
        }),
      );
    }
    if (player.ratingSource) {
      parts.push(
        this.i18n.translate(
          player.ratingSource === 'import'
            ? 'rating.sourceImport'
            : player.ratingSource === 'moderator'
              ? 'rating.sourceModerator'
              : 'rating.sourceSelf',
        ),
      );
    }
    if (player.ratingStale) parts.push(this.i18n.translate('rating.stale'));
    return parts.join(' · ');
  });
}
