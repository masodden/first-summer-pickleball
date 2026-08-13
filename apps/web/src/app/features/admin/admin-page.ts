import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import type { ClaimRequestDto, ImportReportDto, Role } from '@fsp/shared';
import { I18nService } from '../../core/i18n';
import { ToastService } from '../../core/toast';
import { TournamentApi, type AccountRowDto } from '../../core/tournament-api';
import { PlayerLine } from '../../ui/player-line';

/**
 * Администрирование.
 *
 * Заявки на DUPR, список аккаунтов (модератор/игрок) и импорт справочника.
 * Admin только у PZQZKM и P5ML0M — назначить его здесь нельзя.
 */
@Component({
  selector: 'app-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerLine],
  template: `
    <div class="stack stack--5">
      <h1>{{ t()('admin.title') }}</h1>

      <section class="stack stack--3">
        <div class="row row--between">
          <h2>{{ t()('claim.requests') }}</h2>
          <span class="chip">{{ claimsList().length }}</span>
        </div>

        @if (claims.isLoading()) {
          <div class="stack stack--2">
            @for (item of [1, 2]; track item) {
              <div class="skeleton" style="height: 96px"></div>
            }
          </div>
        } @else if (claims.error()) {
          <div class="glass card center stack stack--3">
            <p class="muted">{{ t()('errors.network') }}</p>
            <button type="button" class="btn btn--glass" (click)="claims.reload()">
              {{ t()('common.retry') }}
            </button>
          </div>
        } @else if (claimsList().length === 0) {
          <div class="glass glass--subtle card--tight center small muted">
            {{ t()('claim.noRequests') }}
          </div>
        } @else {
          @for (claim of claimsList(); track claim.id) {
            <div class="glass card--tight stack stack--3">
              <app-player-line [player]="claim.player" />
              <div class="row small muted">
                <span class="grow truncate">
                  {{ claim.telegramName }}
                  @if (claim.telegramUsername) {
                    · &#64;{{ claim.telegramUsername }}
                  }
                </span>
                <span class="tiny faint">{{ i18n.formatDay(claim.createdAt) }}</span>
              </div>
              <div class="row">
                <button
                  type="button"
                  class="btn btn--sm btn--glass grow"
                  [disabled]="busy() === claim.id"
                  (click)="decide(claim, false)"
                >
                  {{ t()('claim.reject') }}
                </button>
                <button
                  type="button"
                  class="btn btn--sm btn--primary grow"
                  [disabled]="busy() === claim.id"
                  (click)="decide(claim, true)"
                >
                  {{ t()('claim.approve') }}
                </button>
              </div>
            </div>
          }
        }
      </section>

      <section class="stack stack--3">
        <h2>{{ t()('admin.accounts') }}</h2>
        <p class="tiny faint">{{ t()('admin.bootstrapHint') }}</p>

        @if (accounts.isLoading()) {
          <div class="stack stack--2">
            @for (item of [1, 2, 3]; track item) {
              <div class="skeleton" style="height: 64px"></div>
            }
          </div>
        } @else if (accounts.error()) {
          <div class="glass card center stack stack--3">
            <p class="muted">{{ t()('errors.network') }}</p>
            <button type="button" class="btn btn--glass" (click)="accounts.reload()">
              {{ t()('common.retry') }}
            </button>
          </div>
        } @else {
          @for (account of accountsList(); track account.id) {
            <div class="glass card--tight row">
              <div class="grow stack stack--1">
                <span class="strong truncate">
                  {{ account.playerName ?? account.displayName }}
                </span>
                <span class="tiny faint truncate">
                  {{ roleLabel(account.role) }}
                  @if (account.telegramUsername) {
                    · &#64;{{ account.telegramUsername }}
                  }
                  @if (account.duprId) {
                    · {{ account.duprId }}
                  }
                </span>
              </div>

              @if (account.isBootstrapAdmin) {
                <span class="chip chip--accent">{{ t()('player.roleClubAdmin') }}</span>
              } @else {
                <select
                  class="select compact"
                  [value]="account.role"
                  [attr.aria-label]="t()('role.change')"
                  (change)="setRole(account, $event)"
                >
                  <option value="user">{{ t()('role.user') }}</option>
                  <option value="organizer">{{ t()('role.organizer') }}</option>
                  <option value="moderator">{{ t()('role.moderator') }}</option>
                  <option value="admin">{{ t()('role.admin') }}</option>
                </select>
              }
            </div>
          }
        }
      </section>

      <section class="glass card--tight stack stack--3">
        <h2>{{ t()('import.title') }}</h2>
        <p class="small muted">{{ t()('import.hint') }}</p>

        <!--
          В Telegram iOS/Android узкий accept часто серит нужные файлы
          (players.js, csv без расширения и т.п.). Тип проверяем после выбора.
        -->
        <input class="input" type="file" accept="*/*" (change)="pickFile($event)" />

        @if (fileName()) {
          <span class="tiny faint truncate">{{ fileName() }}</span>
        }

        <button
          type="button"
          class="btn btn--primary btn--block"
          [disabled]="!content() || importing()"
          (click)="runImport()"
        >
          {{ t()('import.run') }}
        </button>

        @if (report(); as result) {
          <div class="glass glass--subtle card--tight small">
            {{
              t()('import.report', {
                created: result.created,
                updated: result.updated,
                conflicts: result.conflicts,
              })
            }}
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    .compact {
      width: auto;
      min-height: 34px;
      padding: 2px var(--space-5) 2px var(--space-3);
      font-size: 13px;
    }
  `,
})
export class AdminPage {
  private readonly api = inject(TournamentApi);
  private readonly toast = inject(ToastService);

  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly claims = resource({
    loader: () => this.api.listClaims().then((response) => response.claims),
  });

  protected readonly accounts = resource({
    loader: () => this.api.listAccounts().then((response) => response.accounts),
  });

  protected readonly claimsList = computed(() => this.claims.value() ?? []);
  protected readonly accountsList = computed(() => this.accounts.value() ?? []);

  protected readonly busy = signal<string | null>(null);
  protected readonly content = signal('');
  protected readonly fileName = signal('');
  protected readonly importing = signal(false);
  protected readonly report = signal<ImportReportDto | null>(null);

  protected roleLabel(role: Role): string {
    const key =
      role === 'admin'
        ? 'role.admin'
        : role === 'moderator'
          ? 'role.moderator'
          : role === 'organizer'
            ? 'role.organizer'
            : 'role.user';
    return this.i18n.translate(key);
  }

  protected async decide(claim: ClaimRequestDto, approve: boolean): Promise<void> {
    this.busy.set(claim.id);
    try {
      await this.api.decideClaim(claim.id, approve);
      this.claims.reload();
      this.toast.success(this.i18n.translate(approve ? 'claim.approved' : 'claim.rejected'));
    } catch (error) {
      this.toast.failure(error, () => void this.decide(claim, approve));
    } finally {
      this.busy.set(null);
    }
  }

  protected async setRole(account: AccountRowDto, event: Event): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as Role;
    try {
      await this.api.setAccountRole(account.id, role);
      this.accounts.reload();
      this.toast.success(this.i18n.translate('role.changed'));
    } catch (error) {
      this.toast.failure(error, () => void this.setRole(account, event));
      this.accounts.reload();
    }
  }

  protected async pickFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) {
        this.toast.error(this.i18n.translate('import.badFile'));
        return;
      }
      this.fileName.set(file.name);
      this.content.set(text);
    } catch {
      this.toast.error(this.i18n.translate('import.badFile'));
    } finally {
      // Чтобы тот же файл можно было выбрать снова после ошибки.
      input.value = '';
    }
  }

  protected async runImport(): Promise<void> {
    if (!this.content()) return;
    this.importing.set(true);
    try {
      const { report } = await this.api.importPlayers(this.content());
      this.report.set(report);
      this.toast.success(this.i18n.translate('import.done'));
    } catch (error) {
      this.toast.failure(error, () => void this.runImport());
    } finally {
      this.importing.set(false);
    }
  }
}
