import { computed, inject, Injectable, signal } from '@angular/core';
import { isTrainingActive, type TrainingDto, type TrainingParticipantDto } from '@fsp/shared';
import { ApiFailure } from './api';
import { I18nService } from './i18n';
import { SessionStore } from './session';
import { ToastService } from './toast';
import { TrainingApi } from './training-api';

@Injectable()
export class TrainingStore {
  private readonly api = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  private readonly i18n = inject(I18nService);

  private readonly idSignal = signal<string | null>(null);
  private readonly trainingSignal = signal<TrainingDto | null>(null);
  private readonly participantsSignal = signal<TrainingParticipantDto[]>([]);
  private readonly loadingSignal = signal(true);
  private readonly errorSignal = signal<ApiFailure | null>(null);
  private readonly busySignal = signal<Set<string>>(new Set());

  readonly id = this.idSignal.asReadonly();
  readonly training = this.trainingSignal.asReadonly();
  readonly participants = this.participantsSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly loadError = this.errorSignal.asReadonly();

  readonly registered = computed(() =>
    this.participantsSignal().filter((item) => item.status === 'registered'),
  );
  readonly waitlisted = computed(() =>
    this.participantsSignal()
      .filter((item) => item.status === 'waitlisted')
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0)),
  );
  readonly confirmedCount = computed(
    () => this.registered().filter((item) => item.confirmedAndPaid).length,
  );
  readonly allConfirmed = computed(
    () => this.registered().length > 0 && this.confirmedCount() === this.registered().length,
  );
  readonly canManage = computed(() => this.trainingSignal()?.canManage ?? false);
  readonly isActive = computed(() => {
    const status = this.trainingSignal()?.status;
    return status ? isTrainingActive(status) : false;
  });
  /** Суммы после полного подтверждения состава. */
  readonly showAmounts = computed(() => this.allConfirmed());
  readonly canFinish = computed(
    () => this.canManage() && this.isActive() && this.allConfirmed(),
  );
  readonly canEditAmounts = computed(() => this.canManage() && this.isActive() && this.allConfirmed());

  /** Сумма долей у записавшихся — для блока «распределено / остаток». */
  readonly distributedAmount = computed(() =>
    this.registered().reduce((sum, row) => sum + row.amount, 0),
  );

  readonly undistributedAmount = computed(() => {
    const total = this.trainingSignal()?.totalCost ?? 0;
    return total - this.distributedAmount();
  });

  async load(id: string): Promise<void> {
    this.idSignal.set(id);
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    try {
      const state = await this.api.getState(id);
      this.trainingSignal.set(state.training);
      this.participantsSignal.set(state.participants);
    } catch (error) {
      this.errorSignal.set(error instanceof ApiFailure ? error : null);
      this.trainingSignal.set(null);
      this.participantsSignal.set([]);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  isBusy(key: string): boolean {
    return this.busySignal().has(key);
  }

  private async run<T>(key: string, action: () => Promise<T>): Promise<T | undefined> {
    if (this.busySignal().has(key)) return undefined;
    this.busySignal.update((set) => new Set(set).add(key));
    try {
      return await action();
    } catch (error) {
      this.toast.failure(error);
      return undefined;
    } finally {
      this.busySignal.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }
  }

  private requireId(): string {
    const id = this.idSignal();
    if (!id) throw new Error('training id missing');
    return id;
  }

  async refresh(): Promise<void> {
    const id = this.idSignal();
    if (id) await this.load(id);
  }

  join(): Promise<void> {
    return this.run('join', async () => {
      const result = await this.api.join(this.requireId());
      // Join мог только что завести гостевую карточку — подтянем playerId в сессию.
      await this.session.refresh();
      this.toast.success(
        this.i18n.translate(result.waitlisted ? 'waitlist.joined' : 'training.joined'),
      );
      await this.refresh();
    }).then(() => undefined);
  }

  leave(): Promise<void> {
    return this.run('leave', async () => {
      await this.api.leave(this.requireId());
      this.toast.success(this.i18n.translate('training.left'));
      await this.refresh();
    }).then(() => undefined);
  }

  addParticipant(playerId: string): Promise<void> {
    return this.run('add', async () => {
      await this.api.addParticipant(this.requireId(), playerId);
      this.toast.success(this.i18n.translate('participant.added'));
      await this.refresh();
    }).then(() => undefined);
  }

  removeParticipant(playerId: string): Promise<void> {
    return this.run(`remove:${playerId}`, async () => {
      await this.api.removeParticipant(this.requireId(), playerId);
      this.toast.success(this.i18n.translate('participant.removed'));
      await this.refresh();
    }).then(() => undefined);
  }

  setPaid(playerId: string, confirmedAndPaid: boolean): Promise<void> {
    return this.run(`paid:${playerId}`, async () => {
      await this.api.setPaid(this.requireId(), playerId, confirmedAndPaid);
      await this.refresh();
    }).then(() => undefined);
  }

  setAmount(playerId: string, amountDue: number | null): Promise<void> {
    return this.run(`amount:${playerId}`, async () => {
      await this.api.setAmount(this.requireId(), playerId, amountDue);
      await this.refresh();
    }).then(() => undefined);
  }

  promote(playerId: string): Promise<void> {
    return this.run(`promote:${playerId}`, async () => {
      await this.api.promote(this.requireId(), playerId);
      this.toast.success(this.i18n.translate('waitlist.promoted'));
      await this.refresh();
    }).then(() => undefined);
  }

  finish(): Promise<void> {
    return this.run('finish', async () => {
      const { training } = await this.api.finish(this.requireId());
      this.trainingSignal.set(training);
      this.toast.success(this.i18n.translate('training.finished'));
      await this.refresh();
    }).then(() => undefined);
  }

  isFull(): boolean {
    const item = this.trainingSignal();
    if (!item || item.maxPlayers === null) return false;
    return this.registered().length >= item.maxPlayers;
  }

  canLeave(): boolean {
    const mine = this.trainingSignal()?.myParticipation;
    if (!mine || !this.session.isAuthenticated()) return false;
    if (!this.isActive()) return false;
    return !mine.confirmedAndPaid;
  }
}
