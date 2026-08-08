import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  STANDINGS_SORT_KEYS,
  addParticipantSchema,
  createTournamentSchema,
  generateScheduleSchema,
  reshuffleSchema,
  setPaidSchema,
  updateTournamentSchema,
  type StandingsSortKey,
} from '@fsp/shared';
import { parse } from '../lib/validate.js';
import { requireRole, requireViewer } from '../auth/context.js';
import {
  addParticipant,
  createTournament,
  deleteTournament,
  finishTournament,
  getTournamentDto,
  getTournamentRow,
  listParticipants,
  promoteFromWaitlist,
  removeParticipant,
  reopenTournament,
  setParticipantPaid,
  setRegistrationOpen,
  unstartTournament,
  updateTournament,
} from '../services/tournaments.js';
import { appendRound, reshuffleSchedule, startTournament } from '../services/schedule.js';
import { applyRoundAction } from '../services/matches.js';
import { computeTournamentStandings, getTournamentState, loadRounds } from '../services/state.js';
import {
  broadcastParticipants,
  broadcastSchedule,
  broadcastTournamentChanged,
  broadcastTournamentDeleted,
} from '../realtime/broadcast.js';
import { buildResultsCsv } from '../services/export.js';
import { ApiError } from '../lib/errors.js';
import type { AppContext } from './context.js';

const sortQuerySchema = z.object({
  sort: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? (value
            .split(',')
            .map((key) => key.trim())
            .filter((key): key is StandingsSortKey =>
              (STANDINGS_SORT_KEYS as readonly string[]).includes(key),
            ) as StandingsSortKey[])
        : undefined,
    ),
});

export function registerTournamentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, notify } = ctx;

  app.get('/api/tournaments', async (request) => {
    const { listTournaments } = await import('../services/tournaments.js');
    const items = await listTournaments(db, request.viewer);
    return { items, total: items.length };
  });

  app.post('/api/tournaments', async (request, reply) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(createTournamentSchema, request.body);
    const tournament = await createTournament(db, body, viewer);
    reply.code(201);
    return { tournament };
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (request) => {
    return { tournament: await getTournamentDto(db, request.params.id, request.viewer) };
  });

  /** Полное состояние турнира одним запросом: экран открывается без «мигания». */
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/state', async (request) => {
    return getTournamentState(db, request.params.id, request.viewer);
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id/standings', async (request) => {
    const query = parse(sortQuerySchema, request.query ?? {});
    const row = await getTournamentRow(db, request.params.id);
    return { standings: await computeTournamentStandings(db, row, query.sort) };
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id/rounds', async (request) => {
    const row = await getTournamentRow(db, request.params.id);
    return { rounds: await loadRounds(db, row) };
  });

  app.patch<{ Params: { id: string } }>('/api/tournaments/:id', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(updateTournamentSchema, request.body ?? {});
    const tournament = await updateTournament(db, request.params.id, body, viewer);
    broadcastTournamentChanged(hub, request.params.id);
    return { tournament };
  });

  app.delete<{ Params: { id: string } }>('/api/tournaments/:id', async (request) => {
    const viewer = requireRole(request, 'admin');
    await deleteTournament(db, request.params.id, viewer);
    broadcastTournamentDeleted(hub, request.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id/participants', async (request) => {
    const { participants } = await listParticipants(db, request.params.id);
    return { participants };
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/participants', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(addParticipantSchema, request.body);
    const result = await addParticipant(db, request.params.id, body.playerId, viewer, {
      bySelf: false,
    });
    await broadcastParticipants(db, hub, request.params.id);
    return result;
  });

  app.delete<{ Params: { id: string; playerId: string } }>(
    '/api/tournaments/:id/participants/:playerId',
    async (request) => {
      const viewer = requireRole(request, 'moderator');
      const tournament = await getTournamentRow(db, request.params.id);
      await removeParticipant(db, request.params.id, request.params.playerId, viewer, {
        bySelf: false,
      });
      await broadcastParticipants(db, hub, request.params.id);
      await notify.sendToPlayers(
        [request.params.playerId],
        `Вас исключили из турнира «${escapeHtml(tournament.title)}».`,
      );
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/join', async (request) => {
    const viewer = requireViewer(request);
    if (!viewer.playerId) {
      throw new ApiError('forbidden', 'Сначала привяжите свой DUPR');
    }
    const result = await addParticipant(db, request.params.id, viewer.playerId, viewer, {
      bySelf: true,
    });
    await broadcastParticipants(db, hub, request.params.id);
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/leave', async (request) => {
    const viewer = requireViewer(request);
    if (!viewer.playerId) throw new ApiError('forbidden', 'Заявки нет');
    await removeParticipant(db, request.params.id, viewer.playerId, viewer, { bySelf: true });
    await broadcastParticipants(db, hub, request.params.id);
    return { ok: true };
  });

  /** Галочка «пришёл и оплатил» — то, чем модератор ведёт приём участников. */
  app.put<{ Params: { id: string; playerId: string } }>(
    '/api/tournaments/:id/participants/:playerId/paid',
    async (request) => {
      const viewer = requireRole(request, 'moderator');
      const body = parse(setPaidSchema, request.body);
      const participant = await setParticipantPaid(
        db,
        request.params.id,
        request.params.playerId,
        body.confirmedAndPaid,
        viewer,
      );
      await broadcastParticipants(db, hub, request.params.id);
      if (body.confirmedAndPaid) {
        const tournament = await getTournamentRow(db, request.params.id);
        await notify.sendToPlayers(
          [request.params.playerId],
          `Ваше участие в турнире «${escapeHtml(tournament.title)}» подтверждено, битва будет эпичной!`,
        );
      }
      return { participant };
    },
  );

  app.post<{ Params: { id: string; playerId: string } }>(
    '/api/tournaments/:id/participants/:playerId/promote',
    async (request) => {
      const viewer = requireRole(request, 'moderator');
      const participant = await promoteFromWaitlist(
        db,
        request.params.id,
        request.params.playerId,
        viewer,
      );
      await broadcastParticipants(db, hub, request.params.id);
      await notify.sendToPlayers(
        [request.params.playerId],
        'Вас перевели из листа ожидания в основной состав турнира.',
      );
      return { participant };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/registration/close',
    async (request) => {
      const viewer = requireRole(request, 'moderator');
      const tournament = await setRegistrationOpen(db, request.params.id, false, viewer);
      broadcastTournamentChanged(hub, request.params.id);
      return { tournament };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/registration/open',
    async (request) => {
      const viewer = requireRole(request, 'moderator');
      const tournament = await setRegistrationOpen(db, request.params.id, true, viewer);
      broadcastTournamentChanged(hub, request.params.id);
      return { tournament };
    },
  );

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/start', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(generateScheduleSchema, request.body ?? {});
    await startTournament(db, request.params.id, viewer, {
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    });
    await broadcastSchedule(db, hub, request.params.id);

    const tournament = await getTournamentRow(db, request.params.id);
    // Только тем, кто стоит в только что собранном расписании — не всему клубу.
    await notify.sendToSchedule(
      request.params.id,
      `Турнир «${escapeHtml(tournament.title)}» скоро начнётся. Откройте приложение, чтобы посмотреть свои игры.`,
    );
    return { tournament: await getTournamentDto(db, request.params.id, viewer) };
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/reshuffle', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(reshuffleSchema, request.body ?? {});
    await reshuffleSchedule(db, request.params.id, viewer, {
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    });
    await broadcastSchedule(db, hub, request.params.id);
    return { rounds: await loadRounds(db, await getTournamentRow(db, request.params.id)) };
  });

  /** Следующий раунд: для mexicano — основной шаг, для americano — «до остановки». */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/rounds', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const index = await appendRound(db, request.params.id, viewer);
    await broadcastSchedule(db, hub, request.params.id);
    return { roundIndex: index };
  });

  /**
   * Старт, пауза и завершение сразу всего раунда: корты на площадке начинают
   * играть одновременно, поэтому и кнопка одна.
   */
  for (const action of ['start', 'pause', 'finish', 'skip', 'unskip'] as const) {
    app.post<{ Params: { id: string; index: string } }>(
      `/api/tournaments/:id/rounds/:index/${action}`,
      async (request) => {
        const viewer = requireRole(request, 'moderator');
        const index = Number.parseInt(request.params.index, 10);
        if (!Number.isInteger(index) || index < 0) {
          throw new ApiError('validation_failed', 'Некорректный номер раунда');
        }
        await applyRoundAction(db, request.params.id, index, action, viewer);
        await broadcastSchedule(db, hub, request.params.id);
        return { rounds: await loadRounds(db, await getTournamentRow(db, request.params.id)) };
      },
    );
  }

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/unstart', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const tournament = await unstartTournament(db, request.params.id, viewer);
    // Пустое расписание + смена статуса — клиенты сбрасывают раунды.
    await broadcastSchedule(db, hub, request.params.id);
    return { tournament };
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/finish', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const tournament = await finishTournament(db, request.params.id, viewer);
    broadcastTournamentChanged(hub, request.params.id);

    const standings = await computeTournamentStandings(
      db,
      await getTournamentRow(db, request.params.id),
    );
    const podium = standings
      .slice(0, 3)
      .filter((row) => row.played > 0)
      .map((row, index) => `${index + 1}. ${row.player.fullName} — ${row.pointsFor}`)
      .join('\n');
    await notify.sendToTournament(
      request.params.id,
      podium
        ? `Турнир «${escapeHtml(tournament.title)}» завершён.\n${escapeHtml(podium)}`
        : `Турнир «${escapeHtml(tournament.title)}» завершён.`,
    );
    return { tournament };
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/reopen', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const tournament = await reopenTournament(db, request.params.id, viewer);
    broadcastTournamentChanged(hub, request.params.id);
    return { tournament };
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id/export.csv', async (request, reply) => {
    requireRole(request, 'moderator');
    const row = await getTournamentRow(db, request.params.id);
    const csv = await buildResultsCsv(db, row);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="tournament-${row.publicSlug}.csv"`);
    // Telegram downloadFile на web.telegram.org требует этот origin в CORS.
    reply.header('access-control-allow-origin', 'https://web.telegram.org');
    // BOM нужен, чтобы Excel открыл русские имена без кракозябр.
    return `\uFEFF${csv}`;
  });
}

/** Telegram HTML: иначе кавычки и имена с `<` ломают parse_mode. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
