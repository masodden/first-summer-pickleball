import type { FastifyInstance } from 'fastify';
import {
  addParticipantSchema,
  createTrainingSchema,
  setPaidSchema,
  setTrainingAmountSchema,
  updateTrainingSchema,
} from '@fsp/shared/schemas';
import { parse } from '../lib/validate.js';
import { requireRole, requireViewer } from '../auth/context.js';
import { ApiError } from '../lib/errors.js';
import { ensureGuestPlayerForAccount, getAccount } from '../services/accounts.js';
import {
  addTrainingParticipant,
  createTraining,
  deleteTraining,
  finishTraining,
  getTrainingDto,
  getTrainingState,
  listTrainingParticipants,
  listTrainings,
  promoteTrainingFromWaitlist,
  removeTrainingParticipant,
  setTrainingParticipantAmount,
  setTrainingParticipantPaid,
  updateTraining,
} from '../services/trainings.js';
import type { AppContext } from './context.js';

export function registerTrainingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/trainings', async (request) => {
    const items = await listTrainings(db, request.viewer);
    return { items, total: items.length };
  });

  app.post('/api/trainings', async (request, reply) => {
    const viewer = requireRole(request, 'organizer');
    const body = parse(createTrainingSchema, request.body);
    const training = await createTraining(db, body, viewer);
    reply.code(201);
    return { training };
  });

  app.get<{ Params: { id: string } }>('/api/trainings/:id', async (request) => {
    return { training: await getTrainingDto(db, request.params.id, request.viewer) };
  });

  app.get<{ Params: { id: string } }>('/api/trainings/:id/state', async (request) => {
    return getTrainingState(db, request.params.id, request.viewer);
  });

  app.patch<{ Params: { id: string } }>('/api/trainings/:id', async (request) => {
    const viewer = requireRole(request, 'organizer');
    const body = parse(updateTrainingSchema, request.body ?? {});
    const training = await updateTraining(db, request.params.id, body, viewer);
    return { training };
  });

  app.delete<{ Params: { id: string } }>('/api/trainings/:id', async (request) => {
    const viewer = requireRole(request, 'admin');
    await deleteTraining(db, request.params.id, viewer);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/trainings/:id/participants', async (request) => {
    const participants = await listTrainingParticipants(db, request.params.id);
    return { participants };
  });

  app.post<{ Params: { id: string } }>('/api/trainings/:id/participants', async (request) => {
    const viewer = requireRole(request, 'organizer');
    const body = parse(addParticipantSchema, request.body);
    return addTrainingParticipant(db, request.params.id, body.playerId, viewer, {
      bySelf: false,
    });
  });

  app.delete<{ Params: { id: string; playerId: string } }>(
    '/api/trainings/:id/participants/:playerId',
    async (request) => {
      const viewer = requireRole(request, 'organizer');
      await removeTrainingParticipant(db, request.params.id, request.params.playerId, viewer, {
        bySelf: false,
      });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>('/api/trainings/:id/join', async (request) => {
    const viewer = requireViewer(request);
    const account = await ensureGuestPlayerForAccount(
      db,
      await getAccount(db, viewer.accountId),
    );
    if (!account.playerId) {
      throw new ApiError('forbidden', 'Не удалось создать карточку игрока');
    }
    const actor = { ...viewer, playerId: account.playerId };
    return addTrainingParticipant(db, request.params.id, account.playerId, actor, {
      bySelf: true,
    });
  });

  app.post<{ Params: { id: string } }>('/api/trainings/:id/leave', async (request) => {
    const viewer = requireViewer(request);
    if (!viewer.playerId) {
      throw new ApiError('forbidden', 'Заявки нет');
    }
    await removeTrainingParticipant(db, request.params.id, viewer.playerId, viewer, {
      bySelf: true,
    });
    return { ok: true };
  });

  app.put<{ Params: { id: string; playerId: string } }>(
    '/api/trainings/:id/participants/:playerId/paid',
    async (request) => {
      const viewer = requireRole(request, 'organizer');
      const body = parse(setPaidSchema, request.body);
      const participant = await setTrainingParticipantPaid(
        db,
        request.params.id,
        request.params.playerId,
        body.confirmedAndPaid,
        viewer,
      );
      return { participant };
    },
  );

  app.put<{ Params: { id: string; playerId: string } }>(
    '/api/trainings/:id/participants/:playerId/amount',
    async (request) => {
      const viewer = requireRole(request, 'organizer');
      const body = parse(setTrainingAmountSchema, request.body);
      const participant = await setTrainingParticipantAmount(
        db,
        request.params.id,
        request.params.playerId,
        body.amountDue,
        viewer,
      );
      return { participant };
    },
  );

  app.post<{ Params: { id: string; playerId: string } }>(
    '/api/trainings/:id/participants/:playerId/promote',
    async (request) => {
      const viewer = requireRole(request, 'organizer');
      const participant = await promoteTrainingFromWaitlist(
        db,
        request.params.id,
        request.params.playerId,
        viewer,
      );
      return { participant };
    },
  );

  app.post<{ Params: { id: string } }>('/api/trainings/:id/finish', async (request) => {
    const viewer = requireRole(request, 'organizer');
    const training = await finishTraining(db, request.params.id, viewer);
    return { training };
  });
}
