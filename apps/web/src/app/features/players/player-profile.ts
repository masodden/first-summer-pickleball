import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmService } from '../../core/confirm';
import { I18nService } from '../../core/i18n';
import { parseRatingInput, sanitizeRatingInput } from '../../core/rating-input';
import { SessionStore } from '../../core/session';
import { TelegramService } from '../../core/telegram';
import { ToastService } from '../../core/toast';
import { TournamentApi } from '../../core/tournament-api';
import { Avatar } from '../../ui/player-line';
import { RatingChip } from '../../ui/rating-chip';
import { HoldTap } from '../../ui/hold-tap';
import { consumeFirstVisit } from '../../core/motion';

/**
 * Карточка игрока.
 *
 * Рейтинг DUPR ведётся вручную, поэтому здесь он не только показан, но и
 * редактируется: игрок правит себя сам, организатор — любого. История правок
 * рядом, чтобы было видно, кто и когда поставил значение.
 *
 * DUPR ID показывается только владельцу карточки и организаторам: остальным
 * достаточно имени и рейтинга.
 */
@Component({
  selector: 'app-player-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RatingChip, HoldTap],
  template: `
    @if (profile.isLoading()) {
      <div class="stack stack--3">
        <div class="skeleton" style="height: 140px"></div>
        <div class="skeleton" style="height: 120px"></div>
      </div>
    } @else if (profile.value(); as data) {
      <div class="stack stack--4" [class.stagger]="stagger">
        <section class="glass card--tight stack stack--3 center">
          <app-avatar class="self-center" [player]="data.player" [size]="84" />

          <div class="stack stack--1">
            <h1>{{ data.player.fullName }}</h1>
            <div class="row center-row">
              <app-rating-chip [player]="data.player" />
              @if (data.canSeeDuprId && data.player.duprId) {
                <button
                  type="button"
                  class="chip chip--action"
                  appHoldTap
                  (held)="copyDuprId(data.player.duprId!)"
                  (tapped)="openDupr(data.player.duprId!)"
                >
                  {{ t()('player.duprId') }}: {{ data.player.duprId }}
                </button>
              }
              @if (data.player.isGuest) {
                <span class="chip chip--pink">{{ t()('participant.guestBadge') }}</span>
              }
            </div>
          </div>

          @if (data.player.telegramUsername) {
            <button
              type="button"
              class="btn btn--sm btn--glass tg-handle"
              appHoldTap
              (held)="copyTelegramHandle(data.player.telegramUsername!)"
              (tapped)="openTelegram(data.player.telegramUsername!)"
            >
              @{{ data.player.telegramUsername }}
            </button>
          } @else if (data.player.isClaimed && session.isModerator()) {
            <div class="stack stack--2">
              <span class="chip chip--pink">{{ t()('player.telegramNoUsername') }}</span>
              <p class="tiny muted">{{ t()('player.telegramNoUsernameHint') }}</p>
              <button
                type="button"
                class="btn btn--sm btn--primary"
                [disabled]="saving()"
                (click)="nudgeContact()"
              >
                {{ t()('player.nudgeContact', { contact: clubContact() }) }}
              </button>
            </div>
          }
        </section>

        @if (session.isModerator() && !data.player.isClaimed) {
          <section class="glass card--tight stack stack--3">
            <h3>{{ t()('claim.inviteTitle') }}</h3>
            <p class="small muted">{{ t()('claim.inviteHint') }}</p>
            @if (inviteUrl(); as url) {
              <input class="input" readonly [value]="url" (focus)="selectInput($event)" />
              <p class="tiny faint">
                {{ t()('claim.inviteExpires', { date: i18n.formatDay(inviteExpires()!) }) }}
              </p>
              <button type="button" class="btn btn--primary btn--block" (click)="copyInvite()">
                {{ t()('claim.inviteCopy') }}
              </button>
            } @else {
              <button
                type="button"
                class="btn btn--primary btn--block"
                [disabled]="saving()"
                (click)="createInvite()"
              >
                {{ t()('claim.inviteCreate') }}
              </button>
            }
          </section>
        }

        @if (data.canEdit) {
          <section class="glass card--tight stack stack--3">
            <h3>{{ t()('rating.edit') }}</h3>
            <p class="tiny faint">{{ t()('rating.range') }}</p>

            <div class="row">
              <input
                class="input numeric grow"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                [attr.aria-label]="t()('rating.edit')"
                [value]="rating()"
                (input)="rating.set(sanitizeRating(text($event)))"
              />
              <button
                type="button"
                class="btn btn--primary"
                [disabled]="saving()"
                (click)="saveRating()"
              >
                {{ t()('common.save') }}
              </button>
            </div>
          </section>

          <section class="glass card--tight stack stack--3">
            <h3>{{ t()('player.profile') }}</h3>

            <label class="field">
              <span class="field__label">{{ t()('player.avatarUrl') }}</span>
              <input
                class="input"
                type="url"
                inputmode="url"
                [value]="avatarUrl()"
                (input)="avatarUrl.set(text($event))"
              />
            </label>

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
              <span class="field__label">{{ t()('player.telegram') }}</span>
              <input
                class="input"
                autocapitalize="off"
                autocomplete="off"
                spellcheck="false"
                [placeholder]="t()('player.telegramHint')"
                [value]="telegramUsername()"
                (input)="telegramUsername.set(text($event))"
              />
              <span class="field__hint">{{ t()('player.telegramHint') }}</span>
            </label>

            <button
              type="button"
              class="btn btn--glass btn--block"
              [disabled]="saving()"
              (click)="saveProfile()"
            >
              {{ t()('common.save') }}
            </button>

            @if (data.player.isGuest && session.isModerator()) {
              <div class="stack stack--2">
                <span class="field__label">{{ t()('player.mergeGuest') }}</span>
                <span class="field__hint">{{ t()('player.mergeGuestHint') }}</span>
                <div class="row">
                  <input
                    class="input grow"
                    autocapitalize="characters"
                    [value]="mergeId()"
                    (input)="mergeId.set(text($event).toUpperCase())"
                  />
                  <button
                    type="button"
                    class="btn btn--primary"
                    [disabled]="mergeId().length !== 6 || saving()"
                    (click)="merge()"
                  >
                    {{ t()('common.apply') }}
                  </button>
                </div>
              </div>
            }

            @if (session.isAdmin()) {
              <button
                type="button"
                class="btn btn--danger btn--block"
                [disabled]="saving()"
                (click)="remove()"
              >
                {{ t()('player.delete') }}
              </button>
            }
          </section>
        }

        @if (session.isAdmin()) {
          <section class="glass card--tight stack stack--3">
            <h3>{{ t()('player.role') }}</h3>
            @if (data.isBootstrapAdmin) {
              <span class="chip chip--accent">{{ t()('player.roleClubAdmin') }}</span>
              <p class="tiny faint">{{ t()('admin.bootstrapHint') }}</p>
            } @else {
              <p class="tiny faint">{{ t()('player.roleHint') }}</p>
              <select
                class="select"
                [value]="data.player.clubRole"
                [attr.aria-label]="t()('player.role')"
                [disabled]="saving() || !data.canManageRole"
                (change)="setRole($event)"
              >
                <option value="user">{{ t()('role.user') }}</option>
                <option value="organizer">{{ t()('role.organizer') }}</option>
                <option value="moderator">{{ t()('role.moderator') }}</option>
                <option value="admin">{{ t()('role.admin') }}</option>
              </select>
            }
          </section>
        }

        <section class="glass card--tight stack stack--3">
          <h3>{{ t()('player.stats') }}</h3>
          @if (data.stats.matchesPlayed === 0) {
            <p class="small muted">{{ t()('player.noStats') }}</p>
          } @else {
            <div class="grid">
              <div class="cell">
                <span class="tiny faint">{{ t()('player.statsTournaments') }}</span>
                <span class="value numeric">{{ data.stats.tournamentsPlayed }}</span>
              </div>
              <div class="cell">
                <span class="tiny faint">{{ t()('player.statsMatches') }}</span>
                <span class="value numeric">{{ data.stats.matchesPlayed }}</span>
              </div>
              <div class="cell">
                <span class="tiny faint">{{ t()('player.statsWins') }}</span>
                <span class="value numeric">{{ data.stats.wins }}</span>
              </div>
              @if (data.stats.draws > 0) {
                <div class="cell">
                  <span class="tiny faint">{{ t()('standings.draws') }}</span>
                  <span class="value numeric">{{ data.stats.draws }}</span>
                </div>
              }
              <div class="cell">
                <span class="tiny faint">{{ t()('standings.diff') }}</span>
                <span class="value numeric">{{
                  diff(data.stats.pointsFor, data.stats.pointsAgainst)
                }}</span>
              </div>
              <div class="cell">
                <span class="tiny faint">{{ t()('player.statsMedals') }}</span>
                <span class="value">
                  @if (medals(data.stats) === 0) {
                    <span class="numeric">0</span>
                  } @else {
                    @if (data.stats.gold > 0) {
                      <span class="medal medal--gold">{{ data.stats.gold }}</span>
                    }
                    @if (data.stats.silver > 0) {
                      <span class="medal medal--silver">{{ data.stats.silver }}</span>
                    }
                    @if (data.stats.bronze > 0) {
                      <span class="medal medal--bronze">{{ data.stats.bronze }}</span>
                    }
                  }
                </span>
              </div>
            </div>
          }
        </section>

        @if (data.ratingHistory.length > 0) {
          <section class="glass card--tight stack stack--2">
            <h3>{{ t()('rating.history') }}</h3>
            @for (entry of data.ratingHistory; track entry.id) {
              <div class="row history">
                <span class="numeric strong">{{ entry.rating?.toFixed(3) ?? '—' }}</span>
                <span class="grow tiny muted truncate">
                  {{ sourceLabel(entry.source) }}
                  @if (entry.changedByName) {
                    · {{ entry.changedByName }}
                  }
                </span>
                <span class="tiny faint">{{ i18n.formatDay(entry.createdAt) }}</span>
              </div>
            }
          </section>
        }
      </div>
    } @else {
      <div class="glass card--tight empty-state">
        <p>{{ t()('errors.not_found') }}</p>
      </div>
    }
  `,
  styles: `
    .tg-handle,
    .chip--action {
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }

    .chip--action {
      appearance: none;
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      min-height: 0;
      height: 22px;
      padding: 0 8px;
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
    }

    .self-center {
      margin-inline: auto;
    }

    .center-row {
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .center-row app-rating-chip {
      display: inline-flex;
      align-items: center;
    }

    .center-row :deep(.rating-chip) {
      box-sizing: border-box;
      align-items: center;
      height: 22px;
      padding-block: 0;
      line-height: 1;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
      gap: var(--space-3);
    }

    .cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .value {
      font-family: var(--font-display);
      font-size: 19px;
      font-weight: 750;
      color: var(--text-strong);
    }

    .medal {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      margin-right: 3px;
      border-radius: 50%;
      font-size: 11.5px;
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

    .history {
      padding: var(--space-2) 0;
      border-top: 1px solid var(--divider);
    }
  `,
})
export class PlayerProfilePage {
  private readonly api = inject(TournamentApi);
  private readonly toast = inject(ToastService);
  private readonly telegram = inject(TelegramService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  protected readonly session = inject(SessionStore);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  protected readonly stagger = consumeFirstVisit('player-profile');

  readonly id = input.required<string>();

  protected readonly profile = resource({
    // Ждём сессию: иначе первый запрос уходит без токена и canManageRole=false.
    params: () => ({
      id: this.id(),
      ready: this.session.ready(),
      accountId: this.session.session()?.accountId ?? null,
    }),
    loader: ({ params }) => this.api.getPlayer(params.id),
  });

  protected readonly rating = signal('');
  protected readonly avatarUrl = signal('');
  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly telegramUsername = signal('');
  protected readonly mergeId = signal('');
  protected readonly saving = signal(false);
  protected readonly inviteUrl = signal<string | null>(null);
  protected readonly inviteExpires = signal<string | null>(null);
  protected readonly clubContact = signal('Katevolchok');

  constructor() {
    void this.api.getHealth().then((health) => {
      if (health.clubContactTelegram) this.clubContact.set(health.clubContactTelegram);
    });

    // Черновики полей заполняются один раз на карточку, чтобы правка не сбрасывалась.
    let filledFor: string | null = null;
    effect(() => {
      const data = this.profile.value();
      if (!data || filledFor === data.player.id) return;
      filledFor = data.player.id;
      this.rating.set(data.player.doublesRating?.toFixed(3) ?? '');
      this.avatarUrl.set(data.player.avatarUrl ?? '');
      this.firstName.set(data.player.firstName);
      this.lastName.set(data.player.lastName);
      this.telegramUsername.set(data.player.telegramUsername ?? '');
      this.inviteUrl.set(null);
      this.inviteExpires.set(null);
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected sanitizeRating(value: string): string {
    return sanitizeRatingInput(value);
  }

  protected diff(pointsFor: number, pointsAgainst: number): string {
    const value = pointsFor - pointsAgainst;
    return value > 0 ? `+${value}` : String(value);
  }

  protected medals(stats: { gold: number; silver: number; bronze: number }): number {
    return stats.gold + stats.silver + stats.bronze;
  }

  protected sourceLabel(source: 'import' | 'moderator' | 'self'): string {
    return this.i18n.translate(
      source === 'import'
        ? 'rating.sourceImport'
        : source === 'moderator'
          ? 'rating.sourceModerator'
          : 'rating.sourceSelf',
    );
  }

  protected openTelegram(username: string): void {
    this.telegram.openExternal(`https://t.me/${username}`);
  }

  protected openDupr(duprId: string): void {
    this.telegram.openExternal(
      `https://dashboard.dupr.com/dashboard/player/${encodeURIComponent(duprId)}`,
    );
  }

  protected copyTelegramHandle(username: string): void {
    void this.copyText(`@${username.replace(/^@+/, '')}`);
  }

  protected copyDuprId(duprId: string): void {
    void this.copyText(duprId);
  }

  private async copyText(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(this.i18n.translate('common.copied'), value);
    } catch {
      this.toast.info(this.i18n.translate('common.copy'), value);
    }
  }

  protected async nudgeContact(): Promise<void> {
    this.saving.set(true);
    try {
      const { contactTelegram } = await this.api.nudgeContact(this.id());
      this.clubContact.set(contactTelegram);
      this.toast.success(this.i18n.translate('player.nudgeContactSent'));
    } catch (error) {
      this.toast.failure(error, () => void this.nudgeContact());
    } finally {
      this.saving.set(false);
    }
  }

  protected selectInput(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected async createInvite(): Promise<void> {
    this.saving.set(true);
    try {
      const { invite } = await this.api.createInvite(this.id());
      this.inviteUrl.set(invite.url);
      this.inviteExpires.set(invite.expiresAt);
      this.toast.success(this.i18n.translate('claim.inviteCreate'));
    } catch (error) {
      this.toast.failure(error, () => void this.createInvite());
    } finally {
      this.saving.set(false);
    }
  }

  protected async copyInvite(): Promise<void> {
    const url = this.inviteUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success(this.i18n.translate('claim.inviteCopied'));
    } catch {
      this.toast.error(this.i18n.translate('errors.network'));
    }
  }

  protected async saveRating(): Promise<void> {
    const parsed = parseRatingInput(this.rating());
    if (parsed !== null && (parsed < 2 || parsed > 8)) {
      this.toast.error(this.i18n.translate('rating.range'));
      return;
    }

    this.saving.set(true);
    try {
      await this.api.setRating(this.id(), parsed);
      this.profile.reload();
      await this.session.refresh();
      this.toast.success(this.i18n.translate('rating.updated'));
    } catch (error) {
      this.toast.failure(error, () => void this.saveRating());
    } finally {
      this.saving.set(false);
    }
  }

  protected async saveProfile(): Promise<void> {
    this.saving.set(true);
    try {
      const telegram = this.telegramUsername().trim().replace(/^@+/, '');
      await this.api.updatePlayer(this.id(), {
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        avatarUrl: this.avatarUrl().trim() || null,
        telegramUsername: telegram === '' ? null : telegram,
      });
      this.profile.reload();
      await this.session.refresh();
      this.toast.success(this.i18n.translate('player.updated'));
    } catch (error) {
      this.toast.failure(error, () => void this.saveProfile());
    } finally {
      this.saving.set(false);
    }
  }

  protected async setRole(event: Event): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as 'admin' | 'moderator' | 'user';
    this.saving.set(true);
    try {
      await this.api.setPlayerRole(this.id(), role);
      this.profile.reload();
      this.toast.success(this.i18n.translate('player.roleUpdated'));
    } catch (error) {
      this.toast.failure(error, () => void this.setRole(event));
      this.profile.reload();
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const data = this.profile.value();
    if (!data) return;
    const confirmed = await this.confirm.ask({
      title: this.i18n.translate('player.delete'),
      message: this.i18n.translate('player.deleteConfirm', { name: data.player.fullName }),
      confirmLabel: this.i18n.translate('common.delete'),
      danger: true,
    });
    if (!confirmed) return;

    this.saving.set(true);
    try {
      await this.api.deletePlayer(data.player.id);
      this.toast.success(this.i18n.translate('player.deleted'));
      await this.router.navigate(['/players']);
    } catch (error) {
      this.toast.failure(error, () => void this.remove());
    } finally {
      this.saving.set(false);
    }
  }

  protected async merge(): Promise<void> {
    this.saving.set(true);
    try {
      const { player } = await this.api.mergeGuest(this.id(), this.mergeId().trim());
      this.toast.success(this.i18n.translate('player.merged'));
      // Гостевая карточка скрыта после слияния — сразу открываем DUPR.
      await this.router.navigate(['/players', player.id]);
    } catch (error) {
      this.toast.failure(error, () => void this.merge());
    } finally {
      this.saving.set(false);
    }
  }
}
