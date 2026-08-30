/**
 * Связка партнёров и старт fixed_pairs. Нужен Postgres (как guest-self-join).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../db/index.js';
import { accounts, type AccountRow } from '../db/schema.js';
import { viewerFromAccount } from './accounts.js';
import { classicSixPairBracket } from '@fsp/shared';
import { createPlayer } from './players.js';
import {
  addParticipant,
  createTournament,
  listParticipants,
  setParticipantPaid,
} from './tournaments.js';
import { linkPartner, unlinkPartner } from './partners.js';
import { startTournament } from './schedule.js';

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('fixed pairs partners', () => {
  let db: Database;
  let client: { end: (opts?: { timeout?: number }) => Promise<void> };
  const tag = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();

  beforeAll(() => {
    const bundle = createDatabase(DATABASE_URL);
    db = bundle.db;
    client = bundle.client;
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function adminViewer() {
    const [account] = await db
      .insert(accounts)
      .values({
        telegramId: `fp-admin-${tag}-${randomUUID().slice(0, 6)}`,
        telegramFirstName: 'Орг',
        role: 'admin',
      })
      .returning();
    return viewerFromAccount(account as AccountRow);
  }

  it('линк двусторонний, замок по оплате, старт без сирот', async () => {
    const admin = await adminViewer();
    const tournament = await createTournament(
      db,
      {
        title: `Pairs ${tag}`,
        format: 'fixed_pairs',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        courts: 1,
        maxPlayers: 8,
        pointsToWin: 11,
        bracketConfig: classicSixPairBracket(),
      },
      admin,
    );

    const created = [];
    for (let i = 0; i < 4; i += 1) {
      const player = await createPlayer(
        db,
        {
          firstName: `P${i}`,
          lastName: tag.slice(0, 4),
          duprId: `F${tag.slice(0, 4)}${i}`.slice(0, 6).toUpperCase(),
          doublesRating: 3 + i * 0.1,
        },
        admin,
      );
      created.push(player);
      await addParticipant(db, tournament.id, player.id, admin, { bySelf: false });
    }

    const [a, b, c, d] = created;
    expect(a && b && c && d).toBeTruthy();

    await expect(
      startTournament(db, tournament.id, admin),
    ).rejects.toMatchObject({ code: 'not_all_confirmed' });

    const linked = await linkPartner(db, tournament.id, a!.id, b!.id, admin);
    expect(linked.partnerPlayerId).toBe(b!.id);
    const { participants } = await listParticipants(db, tournament.id);
    const rowB = participants.find((item) => item.player.id === b!.id);
    expect(rowB?.partnerPlayerId).toBe(a!.id);

    await setParticipantPaid(db, tournament.id, a!.id, true, admin);
    await setParticipantPaid(db, tournament.id, b!.id, true, admin);
    const afterPaid = await listParticipants(db, tournament.id);
    expect(afterPaid.participants.find((item) => item.player.id === a!.id)?.partnerLocked).toBe(true);

    await expect(unlinkPartner(db, tournament.id, a!.id, admin)).rejects.toMatchObject({
      code: 'validation_failed',
    });

    await setParticipantPaid(db, tournament.id, a!.id, false, admin);
    await unlinkPartner(db, tournament.id, a!.id, admin);
    await setParticipantPaid(db, tournament.id, b!.id, false, admin);

    await linkPartner(db, tournament.id, a!.id, b!.id, admin);
    await linkPartner(db, tournament.id, c!.id, d!.id, admin);
    await setParticipantPaid(db, tournament.id, a!.id, true, admin);
    await setParticipantPaid(db, tournament.id, c!.id, true, admin);
    await setParticipantPaid(db, tournament.id, d!.id, true, admin);

    await expect(startTournament(db, tournament.id, admin)).rejects.toMatchObject({
      code: 'not_all_confirmed',
    });

    await setParticipantPaid(db, tournament.id, b!.id, true, admin);
    await startTournament(db, tournament.id, admin);

    const { getTournamentRow } = await import('./tournaments.js');
    const { loadRounds } = await import('./state.js');
    const row = await getTournamentRow(db, tournament.id);
    expect(row.status).toBe('running');
    const rounds = await loadRounds(db, row);
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds[0]?.matches[0]?.stage).toBe('group');
    expect(rounds[0]?.matches[0]?.teamA.players).toHaveLength(2);
  });
});
