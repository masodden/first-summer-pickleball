/**
 * Гости без DUPR: автокарточка, самозапись на турнир/тренировку, merge при claim.
 *
 * Нужен Postgres: DATABASE_URL=postgres://fsp:fsp@localhost:5432/fsp
 * Без переменной сюита пропускается (чтобы `pnpm test` не падал офлайн).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../db/index.js';
import {
  accounts,
  players,
  tournamentPlayers,
  trainingPlayers,
  type AccountRow,
} from '../db/schema.js';
import {
  claimDuprId,
  createInvite,
  ensureGuestPlayerForAccount,
  syncPlayerProfileFromTelegram,
  useInvite,
  viewerFromAccount,
} from './accounts.js';
import {
  createPlayer,
  mergeGuestIntoDupr,
  restoreContactsFromMergedGuests,
} from './players.js';
import { createTournament, addParticipant, listParticipants } from './tournaments.js';
import { createTraining, addTrainingParticipant, listTrainingParticipants } from './trainings.js';

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('guest self-join', () => {
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

  async function insertAccount(name: string): Promise<AccountRow> {
    const [row] = await db
      .insert(accounts)
      .values({
        telegramId: `guest-test-${tag}-${name}`,
        telegramFirstName: name,
        telegramLastName: 'Тестов',
        telegramUsername: `g_${tag}_${name}`.slice(0, 32),
        role: 'user',
      })
      .returning();
    return row as AccountRow;
  }

  it('создаёт гостевую карточку и не дублирует её', async () => {
    const account = await insertAccount('Анна');
    const withGuest = await ensureGuestPlayerForAccount(db, account);

    expect(withGuest.playerId).toBeTruthy();
    expect(withGuest.playerId?.startsWith('G-')).toBe(true);

    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.id, withGuest.playerId!))
      .limit(1);
    expect(player?.isGuest).toBe(true);
    expect(player?.duprId).toBeNull();
    expect(player?.firstName).toBe('Анна');

    const again = await ensureGuestPlayerForAccount(db, withGuest);
    expect(again.playerId).toBe(withGuest.playerId);
  });

  it('гость сам записывается на турнир и тренировку; claim переносит заявки на DUPR', async () => {
    const account = await ensureGuestPlayerForAccount(db, await insertAccount('Борис'));
    const guestId = account.playerId!;
    const actor = viewerFromAccount(account);

    const adminAccount = await insertAccount('Админ');
    const [adminRow] = await db
      .update(accounts)
      .set({ role: 'admin' })
      .where(eq(accounts.id, adminAccount.id))
      .returning();
    const admin = viewerFromAccount(adminRow as AccountRow);

    const tournament = await createTournament(
      db,
      {
        title: `Beginner guest ${tag}`,
        format: 'americano',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        courts: 2,
        maxPlayers: 8,
        pointsToWin: 11,
        category: 'Beginner',
      },
      admin,
    );

    const joinedTournament = await addParticipant(db, tournament.id, guestId, actor, {
      bySelf: true,
    });
    expect(joinedTournament.waitlisted).toBe(false);
    expect(joinedTournament.participant.player.isGuest).toBe(true);
    expect(joinedTournament.participant.player.id).toBe(guestId);

    const training = await createTraining(
      db,
      {
        title: `Guest training ${tag}`,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        maxPlayers: 8,
        pricePerCourtHour: 1000,
        courtBlocks: [{ courts: 1, hours: 1 }],
      },
      admin,
    );

    const joinedTraining = await addTrainingParticipant(db, training.id, guestId, actor, {
      bySelf: true,
    });
    expect(joinedTraining.waitlisted).toBe(false);
    expect(joinedTraining.participant.player.isGuest).toBe(true);

    const duprId = `G${tag.slice(0, 5)}`.toUpperCase();
    expect(duprId).toHaveLength(6);

    const session = await claimDuprId(
      db,
      account,
      {
        duprId,
        firstName: 'Борис',
        lastName: 'Тестов',
        doublesRating: 2.5,
      },
      null,
    );

    expect(session.player?.isGuest).toBe(false);
    expect(session.player?.duprId).toBe(duprId);
    expect(session.player?.id).toBe(duprId);
    expect(session.claim?.status).toBe('pending');

    const { participants: tournamentRows } = await listParticipants(db, tournament.id);
    expect(tournamentRows.some((row) => row.player.id === guestId)).toBe(false);
    expect(tournamentRows.some((row) => row.player.id === duprId && !row.player.isGuest)).toBe(
      true,
    );

    const trainingRows = await listTrainingParticipants(db, training.id);
    expect(trainingRows.some((row) => row.player.id === guestId)).toBe(false);
    expect(trainingRows.some((row) => row.player.id === duprId && !row.player.isGuest)).toBe(true);

    const [guestRow] = await db.select().from(players).where(eq(players.id, guestId)).limit(1);
    expect(guestRow?.mergedIntoId).toBe(duprId);

    const [tpClash] = await db
      .select()
      .from(tournamentPlayers)
      .where(
        and(eq(tournamentPlayers.tournamentId, tournament.id), eq(tournamentPlayers.playerId, guestId)),
      )
      .limit(1);
    expect(tpClash).toBeUndefined();

    const [trClash] = await db
      .select()
      .from(trainingPlayers)
      .where(and(eq(trainingPlayers.trainingId, training.id), eq(trainingPlayers.playerId, guestId)))
      .limit(1);
    expect(trClash).toBeUndefined();
  });

  it('invite привязывает Telegram к гостевой карточке и забирает автогостя', async () => {
    const adminAccount = await insertAccount('ИнвайтАдмин');
    const [adminRow] = await db
      .update(accounts)
      .set({ role: 'admin' })
      .where(eq(accounts.id, adminAccount.id))
      .returning();
    const admin = viewerFromAccount(adminRow as AccountRow);

    // Карточка, которую модератор создал вручную и хочет отдать игроку.
    const guestCard = await createPlayer(
      db,
      { firstName: 'Катя', lastName: 'Новикова', duprId: null },
      admin,
    );

    const invite = await createInvite(
      db,
      guestCard.id,
      admin,
      'test_bot',
      'http://localhost:4200',
      'play',
    );
    expect(invite.url).toContain('startapp=invite_');
    expect(invite.url).toContain('t.me/test_bot/play');

    const realUser = await ensureGuestPlayerForAccount(db, await insertAccount('Катя'));
    const orphanGuestId = realUser.playerId!;
    expect(orphanGuestId.startsWith('G-')).toBe(true);
    expect(orphanGuestId).not.toBe(guestCard.id);

    const actor = viewerFromAccount(realUser);
    const tournament = await createTournament(
      db,
      {
        title: `Invite guest ${tag}`,
        format: 'americano',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        courts: 2,
        maxPlayers: 8,
        pointsToWin: 11,
      },
      admin,
    );
    await addParticipant(db, tournament.id, orphanGuestId, actor, { bySelf: true });

    const session = await useInvite(db, invite.token, realUser);
    expect(session.player?.id).toBe(guestCard.id);
    expect(session.claim?.status).toBe('approved');

    // Повтор тем же аккаунтом (клиент добивает после логина) — без ошибки.
    const again = await useInvite(db, invite.token, realUser);
    expect(again.player?.id).toBe(guestCard.id);

    const { participants } = await listParticipants(db, tournament.id);
    expect(participants.some((row) => row.player.id === guestCard.id)).toBe(true);
    expect(participants.some((row) => row.player.id === orphanGuestId)).toBe(false);
  });

  it('invite с DUPR-карточки привязывает Telegram без сироты «Имя Гость»', async () => {
    const adminAccount = await insertAccount('DuprInviteAdmin');
    const [adminRow] = await db
      .update(accounts)
      .set({ role: 'admin' })
      .where(eq(accounts.id, adminAccount.id))
      .returning();
    const admin = viewerFromAccount(adminRow as AccountRow);

    const duprId = `I${tag.slice(0, 5)}`.toUpperCase();
    await db.insert(players).values({
      id: duprId,
      duprId,
      firstName: 'Игорь',
      lastName: 'Дупров',
      isGuest: false,
      nameSource: 'manual',
    });

    const invite = await createInvite(
      db,
      duprId,
      admin,
      'test_bot',
      'http://localhost:4200',
      null,
    );
    expect(invite.url).toContain('start=invite_');

    // Как /api/auth/telegram с inviteToken: аккаунт ещё без карточки.
    const fresh = await insertAccount('Игорь');
    expect(fresh.playerId).toBeNull();

    const session = await useInvite(db, invite.token, fresh);
    expect(session.player?.id).toBe(duprId);
    expect(session.player?.isGuest).toBe(false);
    expect(session.player?.duprId).toBe(duprId);
    expect(session.claim?.status).toBe('approved');

    const [account] = await db.select().from(accounts).where(eq(accounts.id, fresh.id)).limit(1);
    expect(account?.playerId).toBe(duprId);
    expect(account?.playerId?.startsWith('G-')).toBe(false);
  });

  it('invite на DUPR забирает уже созданного автогостя', async () => {
    const adminAccount = await insertAccount('DuprAdoptAdmin');
    const [adminRow] = await db
      .update(accounts)
      .set({ role: 'admin' })
      .where(eq(accounts.id, adminAccount.id))
      .returning();
    const admin = viewerFromAccount(adminRow as AccountRow);

    const duprId = `J${tag.slice(0, 5)}`.toUpperCase();
    await db.insert(players).values({
      id: duprId,
      duprId,
      firstName: 'Юля',
      lastName: 'Рейтинг',
      isGuest: false,
      nameSource: 'manual',
    });

    const invite = await createInvite(db, duprId, admin, undefined, 'http://localhost:4200');

    const withGuest = await ensureGuestPlayerForAccount(db, await insertAccount('Юля'));
    const orphanId = withGuest.playerId!;
    expect(orphanId.startsWith('G-')).toBe(true);

    const session = await useInvite(db, invite.token, withGuest);
    expect(session.player?.id).toBe(duprId);
    expect(session.player?.isGuest).toBe(false);

    const [orphan] = await db.select().from(players).where(eq(players.id, orphanId)).limit(1);
    expect(orphan?.mergedIntoId).toBe(duprId);
  });

  it('аккаунт с уже привязанным DUPR не превращается в гостя', async () => {
    const duprId = `D${tag.slice(0, 5)}`.toUpperCase();
    await db.insert(players).values({
      id: duprId,
      duprId,
      firstName: 'Вера',
      lastName: 'DUPR',
      isGuest: false,
      nameSource: 'manual',
    });

    const [account] = await db
      .insert(accounts)
      .values({
        telegramId: `guest-test-${tag}-vera`,
        telegramFirstName: 'Вера',
        role: 'user',
        playerId: duprId,
      })
      .returning();

    const ensured = await ensureGuestPlayerForAccount(db, account as AccountRow);
    expect(ensured.playerId).toBe(duprId);

    const [player] = await db.select().from(players).where(eq(players.id, duprId)).limit(1);
    expect(player?.isGuest).toBe(false);
  });

  it('merge в уже существующий DUPR переносит Telegram и фото, фамилию DUPR не затирает', async () => {
    const adminAccount = await insertAccount('MergeАдмин');
    const [adminRow] = await db
      .update(accounts)
      .set({ role: 'admin' })
      .where(eq(accounts.id, adminAccount.id))
      .returning();
    const admin = viewerFromAccount(adminRow as AccountRow);

    const duprId = `M${tag.slice(0, 5)}`.toUpperCase();
    await db.insert(players).values({
      id: duprId,
      duprId,
      firstName: 'Андрей',
      lastName: 'Иванов',
      isGuest: false,
      nameSource: 'manual',
    });

    const guest = await createPlayer(
      db,
      { firstName: 'Андрей', lastName: 'Гость', duprId: null },
      admin,
    );
    const avatarUrl = `https://example.com/andrey-${tag}.jpg`;
    await db
      .update(players)
      .set({
        telegramUsername: `andrey_${tag}`.slice(0, 32),
        avatarUrl,
        avatarSource: 'self',
      })
      .where(eq(players.id, guest.id));

    const account = await insertAccount('Андрей');
    await db.update(accounts).set({ playerId: guest.id }).where(eq(accounts.id, account.id));

    const merged = await mergeGuestIntoDupr(db, guest.id, duprId, admin);
    expect(merged.id).toBe(duprId);
    expect(merged.firstName).toBe('Андрей');
    expect(merged.lastName).toBe('Иванов');
    expect(merged.telegramUsername).toBe(`andrey_${tag}`.slice(0, 32));
    expect(merged.avatarUrl).toBe(avatarUrl);

    const [duprRow] = await db.select().from(players).where(eq(players.id, duprId)).limit(1);
    expect(duprRow?.lastName).toBe('Иванов');
    expect(duprRow?.avatarUrl).toBe(avatarUrl);
    expect(duprRow?.avatarSource).toBe('self');

    const [guestRow] = await db.select().from(players).where(eq(players.id, guest.id)).limit(1);
    expect(guestRow?.mergedIntoId).toBe(duprId);

    const [accountRow] = await db.select().from(accounts).where(eq(accounts.id, account.id)).limit(1);
    expect(accountRow?.playerId).toBe(duprId);
  });

  it('merge подтягивает avatarUrl с telegramPhotoUrl аккаунта, если на госте пусто', async () => {
    const adminAccount = await insertAccount('PhotoАдмин');
    const [adminRow] = await db
      .update(accounts)
      .set({ role: 'admin' })
      .where(eq(accounts.id, adminAccount.id))
      .returning();
    const admin = viewerFromAccount(adminRow as AccountRow);

    const duprId = `P${tag.slice(0, 5)}`.toUpperCase();
    await db.insert(players).values({
      id: duprId,
      duprId,
      firstName: 'Павел',
      lastName: 'Сидоров',
      isGuest: false,
      nameSource: 'manual',
    });

    const guest = await createPlayer(
      db,
      { firstName: 'Павел', lastName: 'Гость', duprId: null },
      admin,
    );

    const photoUrl = `https://t.me/i/userpic/320/pavel-${tag}.jpg`;
    const account = await insertAccount('Павел');
    await db
      .update(accounts)
      .set({ playerId: guest.id, telegramPhotoUrl: photoUrl })
      .where(eq(accounts.id, account.id));

    const merged = await mergeGuestIntoDupr(db, guest.id, duprId, admin);
    expect(merged.lastName).toBe('Сидоров');
    expect(merged.avatarUrl).toBe(photoUrl);

    const [duprRow] = await db.select().from(players).where(eq(players.id, duprId)).limit(1);
    expect(duprRow?.avatarUrl).toBe(photoUrl);
  });

  it('syncPlayerProfileFromTelegram копирует фото на карточку и не затирает manual', async () => {
    const duprId = `S${tag.slice(0, 5)}`.toUpperCase();
    await db.insert(players).values({
      id: duprId,
      duprId,
      firstName: 'Саша',
      lastName: 'Тестов',
      isGuest: false,
      nameSource: 'manual',
    });

    const photoUrl = `https://t.me/i/userpic/320/sasha-${tag}.jpg`;
    const [account] = await db
      .insert(accounts)
      .values({
        telegramId: `guest-test-${tag}-sasha`,
        telegramFirstName: 'Саша',
        telegramUsername: `sasha_${tag}`.slice(0, 32),
        telegramPhotoUrl: photoUrl,
        role: 'user',
        playerId: duprId,
      })
      .returning();

    await syncPlayerProfileFromTelegram(db, account as AccountRow);
    const [filled] = await db.select().from(players).where(eq(players.id, duprId)).limit(1);
    expect(filled?.avatarUrl).toBe(photoUrl);
    expect(filled?.avatarSource).toBe('self');
    expect(filled?.telegramUsername).toBe(`sasha_${tag}`.slice(0, 32));

    const manualUrl = `https://example.com/manual-${tag}.jpg`;
    await db
      .update(players)
      .set({ avatarUrl: manualUrl, avatarSource: 'manual' })
      .where(eq(players.id, duprId));

    await db
      .update(accounts)
      .set({ telegramPhotoUrl: `https://t.me/i/userpic/320/new-${tag}.jpg` })
      .where(eq(accounts.id, account!.id));
    const [fresh] = await db.select().from(accounts).where(eq(accounts.id, account!.id)).limit(1);

    await syncPlayerProfileFromTelegram(db, fresh as AccountRow);
    const [kept] = await db.select().from(players).where(eq(players.id, duprId)).limit(1);
    expect(kept?.avatarUrl).toBe(manualUrl);
    expect(kept?.avatarSource).toBe('manual');
  });

  it('restoreContactsFromMergedGuests чинит старое слияние без контактов на DUPR', async () => {
    const duprId = `R${tag.slice(0, 5)}`.toUpperCase();
    await db.insert(players).values({
      id: duprId,
      duprId,
      firstName: 'Олег',
      lastName: 'DUPR',
      isGuest: false,
      nameSource: 'manual',
    });

    const guestId = `G-R${tag.slice(0, 6)}`;
    await db.insert(players).values({
      id: guestId,
      duprId: null,
      firstName: 'Олег',
      lastName: 'Гость',
      isGuest: true,
      telegramUsername: `oleg_${tag}`.slice(0, 32),
      avatarUrl: 'https://example.com/oleg.jpg',
      avatarSource: 'self',
      mergedIntoId: duprId,
      nameSource: 'self',
    });

    const restored = await restoreContactsFromMergedGuests(db, duprId);
    expect(restored.telegramUsername).toBe(`oleg_${tag}`.slice(0, 32));
    expect(restored.avatarUrl).toBe('https://example.com/oleg.jpg');
  });
});
