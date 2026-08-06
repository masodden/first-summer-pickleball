import { inject, Injectable } from '@angular/core';
import type {
  CreateTrainingInput,
  TrainingDto,
  TrainingParticipantDto,
  TrainingStateDto,
  TrainingSummaryDto,
  UpdateTrainingInput,
} from '@fsp/shared';
import { ApiClient } from './api';

@Injectable({ providedIn: 'root' })
export class TrainingApi {
  private readonly api = inject(ApiClient);

  listTrainings(): Promise<{ items: TrainingSummaryDto[] }> {
    return this.api.get('/api/trainings');
  }

  getState(id: string): Promise<TrainingStateDto> {
    return this.api.get(`/api/trainings/${id}/state`);
  }

  createTraining(input: CreateTrainingInput): Promise<{ training: TrainingDto }> {
    return this.api.post('/api/trainings', input, { queueLabel: 'Создание тренировки' });
  }

  updateTraining(id: string, input: UpdateTrainingInput): Promise<{ training: TrainingDto }> {
    return this.api.patch(`/api/trainings/${id}`, input, { queueLabel: 'Изменение тренировки' });
  }

  deleteTraining(id: string): Promise<void> {
    return this.api.delete(`/api/trainings/${id}`);
  }

  addParticipant(id: string, playerId: string): Promise<{ participant: TrainingParticipantDto }> {
    return this.api.post(
      `/api/trainings/${id}/participants`,
      { playerId },
      { queueLabel: 'Добавление игрока' },
    );
  }

  removeParticipant(id: string, playerId: string): Promise<void> {
    return this.api.delete(`/api/trainings/${id}/participants/${playerId}`);
  }

  join(id: string): Promise<{ participant: TrainingParticipantDto; waitlisted: boolean }> {
    return this.api.post(`/api/trainings/${id}/join`, undefined, { queueLabel: 'Запись' });
  }

  leave(id: string): Promise<void> {
    return this.api.post(`/api/trainings/${id}/leave`);
  }

  setPaid(
    id: string,
    playerId: string,
    confirmedAndPaid: boolean,
  ): Promise<{ participant: TrainingParticipantDto }> {
    return this.api.put(`/api/trainings/${id}/participants/${playerId}/paid`, {
      confirmedAndPaid,
    });
  }

  setAmount(
    id: string,
    playerId: string,
    amountDue: number | null,
  ): Promise<{ participant: TrainingParticipantDto }> {
    return this.api.put(`/api/trainings/${id}/participants/${playerId}/amount`, { amountDue });
  }

  promote(id: string, playerId: string): Promise<{ participant: TrainingParticipantDto }> {
    return this.api.post(`/api/trainings/${id}/participants/${playerId}/promote`);
  }

  finish(id: string): Promise<{ training: TrainingDto }> {
    return this.api.post(`/api/trainings/${id}/finish`, undefined, {
      queueLabel: 'Завершение тренировки',
    });
  }
}
