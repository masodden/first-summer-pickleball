import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { tournaments } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { parseBracketConfig } from '@fsp/shared';
import { computeTournamentStandings, computeTournamentTeamStandings, loadRounds } from '../services/state.js';
import { listParticipants, loadCounts, toSummaryDto } from '../services/tournaments.js';
import type { AppContext } from './context.js';

/**
 * Публичное табло по короткой ссылке: смотреть турнир можно без входа,
 * а ссылку удобно кинуть в чат клуба.
 */
export function registerPublicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get<{ Params: { slug: string } }>('/api/public/:slug', async (request) => {
    const [row] = await db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.publicSlug, request.params.slug), isNull(tournaments.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Турнир не найден');

    const [counts, rounds, standings, teamStandings, participants] = await Promise.all([
      loadCounts(db, row.id),
      loadRounds(db, row),
      computeTournamentStandings(db, row),
      computeTournamentTeamStandings(db, row),
      listParticipants(db, row.id),
    ]);

    return {
      tournament: toSummaryDto(row, counts),
      venue: {
        name: row.venueName,
        address: row.venueAddress,
        mapUrl: row.venueMapUrl,
      },
      description: row.description,
      rounds,
      standings,
      teamStandings,
      participants: participants.participants,
      bracketConfig: parseBracketConfig(row.format, row.bracketConfig, row.pointsToWin),
    };
  });
}
