import type { FastifyInstance } from 'fastify';
import { matchActionSchema, matchScoreSchema } from '@fsp/shared/schemas';
import { parse } from '../lib/validate.js';
import { requireRole } from '../auth/context.js';
import {
  clearMatchScore,
  finishMatch,
  getMatchTournamentId,
  loadMatchDto,
  pauseMatch,
  reopenMatch,
  setMatchScore,
  startMatch,
} from '../services/matches.js';
import { broadcastMatch, broadcastRound, broadcastSchedule, broadcastStandings } from '../realtime/broadcast.js';
import type { AppContext } from './context.js';

export function registerMatchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  app.get<{ Params: { id: string } }>('/api/matches/:id', async (request) => {
    return { match: await loadMatchDto(db, request.params.id) };
  });

  const actions = {
    start: startMatch,
    pause: pauseMatch,
    finish: finishMatch,
    reopen: reopenMatch,
  } as const;

  for (const [name, handler] of Object.entries(actions)) {
    app.post<{ Params: { id: string } }>(`/api/matches/:id/${name}`, async (request) => {
      const viewer = requireRole(request, 'moderator');
      const body = parse(matchActionSchema.partial(), request.body ?? {});
      const match = await handler(db, request.params.id, {
        actor: viewer,
        ...(body.version !== undefined ? { version: body.version } : {}),
      });
      const tournamentId = await getMatchTournamentId(db, request.params.id);
      broadcastMatch(hub, tournamentId, match);
      await broadcastRound(db, hub, tournamentId, match.roundIndex);
      // Завершение матча меняет таблицу, поэтому её тоже рассылаем.
      if (name === 'finish' || name === 'reopen') {
        await broadcastStandings(db, hub, tournamentId);
      }
      return { match };
    });
  }

  app.put<{ Params: { id: string } }>('/api/matches/:id/score', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(matchScoreSchema, request.body);
    const match = await setMatchScore(db, request.params.id, body, viewer);
    const tournamentId = await getMatchTournamentId(db, request.params.id);
    broadcastMatch(hub, tournamentId, match);
    await broadcastRound(db, hub, tournamentId, match.roundIndex);
    if (match.stage) {
      await broadcastSchedule(db, hub, tournamentId);
    } else {
      await broadcastStandings(db, hub, tournamentId);
    }
    return { match };
  });

  app.delete<{ Params: { id: string } }>('/api/matches/:id/score', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(matchActionSchema.partial(), request.body ?? {});
    const match = await clearMatchScore(db, request.params.id, {
      actor: viewer,
      ...(body.version !== undefined ? { version: body.version } : {}),
    });
    const tournamentId = await getMatchTournamentId(db, request.params.id);
    broadcastMatch(hub, tournamentId, match);
    await broadcastRound(db, hub, tournamentId, match.roundIndex);
    await broadcastStandings(db, hub, tournamentId);
    return { match };
  });
}
