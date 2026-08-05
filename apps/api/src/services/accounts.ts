import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  isBootstrapAdminDupr,
  normalizeDuprId,
  resolveLocale,
  type ClaimInput,
  type ClaimRequestDto,
  type InviteDto,
  type Locale,
  type Role,
  type SessionDto,
} from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  accounts,
  claims,
  invites,
  players,
  type AccountRow,
  type PlayerRow,
} from '../db/schema.js';
import { ApiError, forbidden, notFound } from '../lib/errors.js';
import { toPlayerDto } from './mappers.js';
import type { Viewer } from '../auth/context.js';
import { recordAudit } from './audit.js';
import type { VerifiedInitData } from '../auth/telegram.js';
import { getPlayerRow } from './players.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function viewerFromAccount(account: AccountRow): Viewer {
  return {
    accountId: account.id,
    role: account.role,
    playerId: account.playerId,
    locale: account.locale,
    displayName:
      [account.telegramFirstName, account.telegramLastName].filter(Boolean).join(' ') ||
      account.telegramUsername ||
      'Пользователь',
  };
}

/** Роль сессии берётся с карточки DUPR, если она привязана. */
export function effectiveRole(account: AccountRow, player: PlayerRow | null): Role {
  if (!player) return account.role;
  if (isBootstrapAdminDupr(player.duprId)) return 'admin';
  return player.clubRole;
}

export async function buildSession(db: Database, account: AccountRow): Promise<SessionDto> {
  let player: PlayerRow | null = null;
  if (account.playerId) {
    const [row] = await db.select().from(players).where(eq(players.id, account.playerId)).limit(1);
    player = row ?? null;
  }

  const [claim] = await db
    .select({ claim: claims, player: players })
    .from(claims)
    .innerJoin(players, eq(players.id, claims.playerId))
    .where(eq(claims.accountId, account.id))
    .orderBy(desc(claims.createdAt))
    .limit(1);

  const role = effectiveRole(account, player);

  return {
    accountId: account.id,
    role,
    locale: account.locale,
    notificationsEnabled: account.notificationsEnabled,
    reducedMotion: account.reducedMotion,
    telegramUsername: account.telegramUsername,
    player: player ? toPlayerDto(player, { isClaimed: true }) : null,
    claim: claim
      ? { duprId: claim.player.duprId ?? claim.player.id, status: claim.claim.status }
      : null,
    // Аккаунт заявил админский ID, но кода не ввёл: показываем экран с кодом.
    needsBootstrapCode:
      role !== 'admin' &&
      claim !== undefined &&
      claim.claim.status === 'pending' &&
      isBootstrapAdminDupr(claim.player.duprId),
  };
}

/**
 * Вход из Telegram Mini App.
 *
 * Личность подтверждает сам Telegram своей подписью, поэтому паролей нет.
 * DUPR ID — отдельная сущность: его игрок привязывает к аккаунту после входа.
 */
export async function loginWithTelegram(
  db: Database,
  verified: VerifiedInitData,
): Promise<AccountRow> {
  const { user } = verified;
  const locale: Locale = resolveLocale(user.languageCode);

  const [existing] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.telegramId, user.id))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(accounts)
      .set({
        telegramUsername: user.username,
        telegramFirstName: user.firstName,
        telegramLastName: user.lastName,
        telegramPhotoUrl: user.photoUrl,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, existing.id))
      .returning();
    return updated as AccountRow;
  }

  const [created] = await db
    .insert(accounts)
    .values({
      telegramId: user.id,
      telegramUsername: user.username,
      telegramFirstName: user.firstName,
      telegramLastName: user.lastName,
      telegramPhotoUrl: user.photoUrl,
      locale,
    })
    .returning();
  if (!created) throw new ApiError('internal', 'Не удалось создать аккаунт');
  return created;
}

/** Локальный вход без Telegram: включается только переменной ALLOW_DEV_LOGIN. */
export async function devLogin(
  db: Database,
  options: { telegramId: string; name: string; role: Role },
): Promise<AccountRow> {
  const [existing] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.telegramId, options.telegramId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(accounts)
      .set({ role: options.role, lastSeenAt: new Date() })
      .where(eq(accounts.id, existing.id))
      .returning();
    return updated as AccountRow;
  }

  const [created] = await db
    .insert(accounts)
    .values({
      telegramId: options.telegramId,
      telegramFirstName: options.name,
      telegramUsername: options.telegramId,
      role: options.role,
    })
    .returning();
  return created as AccountRow;
}

async function ensurePlayerForClaim(
  db: Database,
  duprId: string,
  input: ClaimInput,
): Promise<PlayerRow> {
  const [existing] = await db.select().from(players).where(eq(players.id, duprId)).limit(1);
  if (existing) return existing;

  if (!input.firstName || !input.lastName) {
    throw new ApiError(
      'not_found',
      'Такого DUPR ID нет в базе. Укажите имя и фамилию, чтобы создать карточку',
    );
  }

  const rating = input.doublesRating ?? null;
  const [created] = await db
    .insert(players)
    .values({
      id: duprId,
      duprId,
      firstName: input.firstName,
      lastName: input.lastName,
      doublesRating: rating,
      ratingUpdatedAt: rating === null ? null : new Date(),
      ratingSource: rating === null ? null : 'self',
      nameSource: 'self',
    })
    .returning();
  return created as PlayerRow;
}

/**
 * Привязка DUPR ID к аккаунту.
 *
 * Привязка действует сразу, чтобы игрок мог заявиться на турнир, но остаётся
 * помеченной как неподтверждённая: организатор сверяет DUPR при приёме
 * участников и ставит галочку. Так живой турнир не блокируется ожиданием, но и
 * чужой ID тихо забрать нельзя.
 */
export async function claimDuprId(
  db: Database,
  account: AccountRow,
  input: ClaimInput,
  /**
   * `null` — код не спрашиваем. Так работает локальный запуск: там и без того
   * включён вход без Telegram, и требовать секрет из `.env`, которого у
   * разработчика нет, значит просто не дать ему привязать свой DUPR.
   */
  bootstrapCode: string | null,
): Promise<SessionDto> {
  const duprId = normalizeDuprId(input.duprId);

  if (isBootstrapAdminDupr(duprId) && bootstrapCode !== null) {
    if (!input.code || !safeCompare(input.code, bootstrapCode)) {
      throw new ApiError('bootstrap_code_invalid', 'Для этого DUPR ID нужен код администратора');
    }
  }

  const player = await ensurePlayerForClaim(db, duprId, input);

  const [takenBy] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.playerId, player.id), ne(accounts.id, account.id)))
    .limit(1);
  if (takenBy) {
    throw new ApiError('dupr_id_already_claimed', 'Этот DUPR ID уже привязан к другому аккаунту');
  }

  // Роль живёт на карточке DUPR; при входе аккаунт её подхватывает.
  if (isBootstrapAdminDupr(duprId) && player.clubRole !== 'admin') {
    await db
      .update(players)
      .set({ clubRole: 'admin', updatedAt: new Date() })
      .where(eq(players.id, player.id));
  }
  const role: Role = isBootstrapAdminDupr(duprId) ? 'admin' : player.clubRole;

  // Старая карточка не должна выглядеть «привязанной» по залипшему @username.
  if (account.playerId && account.playerId !== player.id && account.telegramUsername) {
    await db
      .update(players)
      .set({ telegramUsername: null, updatedAt: new Date() })
      .where(
        and(
          eq(players.id, account.playerId),
          eq(players.telegramUsername, account.telegramUsername),
        ),
      );
  }

  const [updated] = await db
    .update(accounts)
    .set({
      playerId: player.id,
      role,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, account.id))
    .returning();

  await db
    .delete(claims)
    .where(and(eq(claims.accountId, account.id), eq(claims.status, 'pending')));

  await db.insert(claims).values({
    accountId: account.id,
    playerId: player.id,
    // Администратор подтверждает себя кодом, остальных проверяет организатор.
    status: isBootstrapAdminDupr(duprId) ? 'approved' : 'pending',
    decidedAt: isBootstrapAdminDupr(duprId) ? new Date() : null,
  });

  if (account.telegramUsername) {
    await db
      .update(players)
      .set({ telegramUsername: account.telegramUsername, updatedAt: new Date() })
      .where(eq(players.id, player.id));
  }

  await recordAudit(db, viewerFromAccount(updated as AccountRow), {
    action: 'claim.created',
    entityType: 'claim',
    entityId: player.id,
    payload: {
      duprId,
      autoApproved: isBootstrapAdminDupr(duprId),
      previousPlayerId: account.playerId,
    },
  });

  return buildSession(db, updated as AccountRow);
}

export async function listPendingClaims(db: Database): Promise<ClaimRequestDto[]> {
  const rows = await db
    .select({ claim: claims, player: players, account: accounts })
    .from(claims)
    .innerJoin(players, eq(players.id, claims.playerId))
    .innerJoin(accounts, eq(accounts.id, claims.accountId))
    .where(eq(claims.status, 'pending'))
    .orderBy(desc(claims.createdAt));

  return rows.map((row) => ({
    id: row.claim.id,
    player: toPlayerDto(row.player, { isClaimed: true }),
    telegramUsername: row.account.telegramUsername,
    telegramName:
      [row.account.telegramFirstName, row.account.telegramLastName].filter(Boolean).join(' ') ||
      row.account.telegramUsername ||
      'Пользователь',
    status: row.claim.status,
    createdAt: row.claim.createdAt.toISOString(),
  }));
}

export async function decideClaim(
  db: Database,
  claimId: string,
  approve: boolean,
  actor: Viewer,
): Promise<void> {
  const [row] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  if (!row) throw notFound('Заявка не найдена');

  await db
    .update(claims)
    .set({
      status: approve ? 'approved' : 'rejected',
      decidedByAccountId: actor.accountId,
      decidedAt: new Date(),
    })
    .where(eq(claims.id, claimId));

  if (!approve) {
    // Отклонили — снимаем привязку, чтобы ID освободился.
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, row.accountId))
      .limit(1);
    await db
      .update(accounts)
      .set({ playerId: null, updatedAt: new Date() })
      .where(and(eq(accounts.id, row.accountId), eq(accounts.playerId, row.playerId)));
    if (account?.telegramUsername) {
      await db
        .update(players)
        .set({ telegramUsername: null, updatedAt: new Date() })
        .where(
          and(
            eq(players.id, row.playerId),
            eq(players.telegramUsername, account.telegramUsername),
          ),
        );
    }
  }

  await recordAudit(db, actor, {
    action: approve ? 'claim.approved' : 'claim.rejected',
    entityType: 'claim',
    entityId: claimId,
    payload: { playerId: row.playerId },
  });
}

/**
 * Ссылка-приглашение.
 *
 * Организатор отправляет её игроку, и тот привязывает свой Telegram к карточке
 * без ручной проверки: доверие уже подтверждено тем, кто выдал ссылку.
 */
export async function createInvite(
  db: Database,
  playerId: string,
  actor: Viewer,
  botUsername: string | undefined,
  webUrl: string,
): Promise<InviteDto> {
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) throw notFound('Игрок не найден');

  const token = randomBytes(16).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await db.insert(invites).values({
    token,
    playerId,
    createdByAccountId: actor.accountId,
    expiresAt,
  });

  // start= надёжнее startapp: не требует Main Mini App в BotFather.
  const url = botUsername
    ? `https://t.me/${botUsername}?start=invite_${token}`
    : `${webUrl.replace(/\/$/, '')}/invite/${token}`;

  await recordAudit(db, actor, {
    action: 'invite.created',
    entityType: 'invite',
    entityId: playerId,
  });

  return { token, url, player: toPlayerDto(player), expiresAt: expiresAt.toISOString() };
}

export async function useInvite(
  db: Database,
  token: string,
  account: AccountRow,
): Promise<SessionDto> {
  const [invite] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.token, token), isNull(invites.usedAt)))
    .limit(1);
  if (!invite) throw new ApiError('invite_invalid', 'Ссылка недействительна или уже использована');
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new ApiError('invite_invalid', 'Срок действия ссылки истёк');
  }

  const [takenBy] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.playerId, invite.playerId), ne(accounts.id, account.id)))
    .limit(1);
  if (takenBy) {
    throw new ApiError('dupr_id_already_claimed', 'Эта карточка уже привязана к другому аккаунту');
  }

  const player = await getPlayerRow(db, invite.playerId);
  const role = effectiveRole(account, player);

  const [updated] = await db
    .update(accounts)
    .set({ playerId: invite.playerId, role, updatedAt: new Date() })
    .where(eq(accounts.id, account.id))
    .returning();

  await db
    .update(invites)
    .set({ usedAt: new Date(), usedByAccountId: account.id })
    .where(eq(invites.token, token));

  await db
    .delete(claims)
    .where(and(eq(claims.accountId, account.id), eq(claims.status, 'pending')));
  await db.insert(claims).values({
    accountId: account.id,
    playerId: invite.playerId,
    status: 'approved',
    decidedAt: new Date(),
  });

  return buildSession(db, updated as AccountRow);
}

export interface AccountSummary {
  id: string;
  role: Role;
  displayName: string;
  telegramUsername: string | null;
  playerName: string | null;
  duprId: string | null;
  isBootstrapAdmin: boolean;
  lastSeenAt: string;
}

/** В списке админки — только админы и модераторы; обычные игроки скрыты. */
export async function listAccounts(db: Database): Promise<AccountSummary[]> {
  const rows = await db
    .select({ account: accounts, player: players })
    .from(accounts)
    .leftJoin(players, eq(players.id, accounts.playerId))
    .where(inArray(accounts.role, ['admin', 'moderator']))
    .orderBy(desc(accounts.lastSeenAt));

  return rows.map((row) => {
    const role = effectiveRole(row.account, row.player);
    return {
      id: row.account.id,
      role,
      displayName:
        [row.account.telegramFirstName, row.account.telegramLastName].filter(Boolean).join(' ') ||
        row.account.telegramUsername ||
        'Пользователь',
      telegramUsername: row.account.telegramUsername,
      playerName: row.player ? `${row.player.firstName} ${row.player.lastName}`.trim() : null,
      duprId: row.player?.duprId ?? null,
      isBootstrapAdmin: isBootstrapAdminDupr(row.player?.duprId ?? null),
      lastSeenAt: row.account.lastSeenAt.toISOString(),
    };
  });
}

/**
 * Роль клуба на карточке игрока (DUPR ID).
 * Telegram не нужен: привязанный аккаунт, если есть, синхронизируется.
 */
export async function setPlayerClubRole(
  db: Database,
  playerId: string,
  role: Role,
  actor: Viewer,
): Promise<void> {
  const player = await getPlayerRow(db, playerId);

  if (isBootstrapAdminDupr(player.duprId) && role !== 'admin') {
    throw forbidden('Администраторы клуба заданы в конфигурации и не могут быть понижены');
  }
  if (actor.playerId === playerId && role === 'user') {
    throw forbidden('Нельзя снять права с самого себя');
  }

  await db
    .update(players)
    .set({ clubRole: role, updatedAt: new Date() })
    .where(eq(players.id, playerId));

  // Синхронизируем вошедший аккаунт, чтобы права и список админки совпали сразу.
  await db
    .update(accounts)
    .set({ role, updatedAt: new Date() })
    .where(eq(accounts.playerId, playerId));

  await recordAudit(db, actor, {
    action: 'player.role_changed',
    entityType: 'player',
    entityId: playerId,
    payload: { role, duprId: player.duprId },
  });
}

/** Смена роли из списка аккаунтов: если есть карточка — пишем на DUPR. */
export async function setAccountRole(
  db: Database,
  accountId: string,
  role: Role,
  actor: Viewer,
): Promise<void> {
  const [row] = await db
    .select({ account: accounts, player: players })
    .from(accounts)
    .leftJoin(players, eq(players.id, accounts.playerId))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) throw notFound('Аккаунт не найден');

  if (row.account.id === actor.accountId && role === 'user') {
    throw forbidden('Нельзя снять права с самого себя');
  }

  if (row.player) {
    await setPlayerClubRole(db, row.player.id, role, actor);
    return;
  }

  await db.update(accounts).set({ role, updatedAt: new Date() }).where(eq(accounts.id, accountId));
  await recordAudit(db, actor, {
    action: 'account.role_changed',
    entityType: 'account',
    entityId: accountId,
    payload: { role },
  });
}

export async function updateAccountSettings(
  db: Database,
  accountId: string,
  patch: { locale?: Locale; notificationsEnabled?: boolean; reducedMotion?: boolean },
): Promise<AccountRow> {
  const [updated] = await db
    .update(accounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(accounts.id, accountId))
    .returning();
  if (!updated) throw notFound('Аккаунт не найден');
  return updated;
}

export async function getAccount(db: Database, accountId: string): Promise<AccountRow> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!row) throw notFound('Аккаунт не найден');
  return row;
}
