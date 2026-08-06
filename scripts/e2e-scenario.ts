/**
 * Сквозной прогон целевого сценария по живому API.
 *
 * Проверяется именно тот вечер, ради которого написано приложение: две
 * категории по 12 человек, шесть кортов, 11 игр americano, оплата на входе,
 * счёт по ходу и медали в конце. Дополнительно прогоняется mexicano и
 * несколько ошибочных путей — их обработка на площадке важнее, чем счастливый
 * сценарий.
 *
 * Запуск: pnpm e2e:scenario (нужны поднятая база и API с ALLOW_DEV_LOGIN=true)
 */

// Скрипт лежит вне рабочих пакетов, поэтому берём общий контракт по пути, а не по имени.
import {
  WS_PATH,
  type MatchDto,
  type RoundDto,
  type StandingRowDto,
} from '../packages/shared/src/index.js';

const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:3010';

let failures = 0;
let checks = 0;

function check(condition: boolean, description: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${description}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? `${method} ${path} → ${response.status}`,
    );
  }
  return payload as T;
}

async function expectError(
  code: string,
  description: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
    check(false, `${description} (ожидали ошибку ${code}, запрос прошёл)`);
  } catch (error) {
    if (error instanceof ApiError) {
      check(error.code === code, `${description} → ${error.code}`);
    } else {
      check(false, `${description} (неожиданная ошибка: ${String(error)})`);
    }
  }
}

interface Session {
  token: string;
  session: { accountId: string; role: string; player: { id: string } | null };
}

const login = (role: 'admin' | 'moderator' | 'user', telegramId: string, name: string) =>
  request<Session>('POST', '/api/auth/dev', { body: { role, telegramId, name } });

const RU_NAMES: [string, string][] = [
  ['Артём', 'Соколов'],
  ['Мария', 'Иванова'],
  ['Дмитрий', 'Петров'],
  ['Анна', 'Кузнецова'],
  ['Сергей', 'Смирнов'],
  ['Ольга', 'Попова'],
  ['Иван', 'Волков'],
  ['Екатерина', 'Морозова'],
  ['Павел', 'Новиков'],
  ['Наталья', 'Фёдорова'],
  ['Никита', 'Егоров'],
  ['Юлия', 'Зайцева'],
];

interface PlayerRef {
  id: string;
  duprId: string;
  fullName: string;
  rating: number | null;
}

/**
 * Метка прогона: DUPR ID уникален в базе, поэтому сценарий должен каждый раз брать новые.
 * Так его можно гонять по одной и той же базе сколько угодно раз.
 */
const RUN_TAG = Math.floor(Math.random() * 36 ** 2)
  .toString(36)
  .padStart(2, '0')
  .toUpperCase();

async function createPlayers(
  token: string,
  prefix: string,
  ratingBase: number,
): Promise<PlayerRef[]> {
  const players: PlayerRef[] = [];
  for (const [index, [firstName, lastName]] of RU_NAMES.entries()) {
    // DUPR ID — ровно шесть символов: две буквы категории, метка прогона и номер игрока.
    const duprId = `${prefix}${RUN_TAG}${String(index + 10).padStart(2, '0')}`.toUpperCase();
    const rating = Number((ratingBase + index * 0.08).toFixed(3));
    const { player } = await request<{ player: { id: string; fullName: string } }>(
      'POST',
      '/api/players',
      { token, body: { firstName, lastName: `${lastName}`, duprId, doublesRating: rating } },
    );
    players.push({ id: player.id, duprId, fullName: player.fullName, rating });
  }
  return players;
}

interface TournamentRef {
  id: string;
  publicSlug: string;
  title: string;
}

async function createTournament(
  token: string,
  input: Record<string, unknown>,
): Promise<TournamentRef> {
  const { tournament } = await request<{ tournament: TournamentRef }>('POST', '/api/tournaments', {
    token,
    body: input,
  });
  return tournament;
}

const state = (id: string, token?: string) =>
  request<{
    tournament: {
      status: string;
      roundsGenerated: number;
      courts: number;
      courtNames: string[] | null;
    };
    participants: { player: { id: string }; confirmedAndPaid: boolean; status: string }[];
    rounds: RoundDto[];
    standings: StandingRowDto[];
  }>('GET', `/api/tournaments/${id}/state`, token ? { token } : {});

const roundAction = (
  token: string,
  tournamentId: string,
  index: number,
  action: 'start' | 'pause' | 'finish' | 'skip' | 'unskip',
) =>
  request<{ rounds: RoundDto[] }>(
    'POST',
    `/api/tournaments/${tournamentId}/rounds/${index}/${action}`,
    { token, body: {} },
  ).then((response) => response.rounds);

/**
 * Разыгрывает раунд так, как это делает организатор: один старт на все корты,
 * при необходимости пауза, затем счёт по каждому корту отдельно.
 */
async function playRound(
  token: string,
  tournamentId: string,
  round: RoundDto,
  scoreFor: (index: number) => [number, number],
  options: { withPause?: boolean } = {},
): Promise<RoundDto[]> {
  let rounds = await roundAction(token, tournamentId, round.index, 'start');
  const started = rounds.find((item) => item.index === round.index);
  check(
    started?.matches.every((match) => match.status === 'running') ?? false,
    `раунд ${round.index + 1}: все корты стартовали одной кнопкой`,
  );

  if (options.withPause) {
    rounds = await roundAction(token, tournamentId, round.index, 'pause');
    check(
      rounds
        .find((item) => item.index === round.index)
        ?.matches.every((match) => match.status === 'paused') ?? false,
      'пауза остановила все корты раунда',
    );
    rounds = await roundAction(token, tournamentId, round.index, 'start');
  }

  const live = rounds.find((item) => item.index === round.index)?.matches ?? [];
  for (const [index, match] of live.entries()) {
    const score = scoreFor(index);
    await request<{ match: MatchDto }>('PUT', `/api/matches/${match.id}/score`, {
      token,
      body: { scoreA: score[0], scoreB: score[1], version: match.version },
    });
  }

  return roundAction(token, tournamentId, round.index, 'finish');
}

function partnerKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** Сколько игр каждый провёл на каждом корте: ключ — игрок, индекс — позиция корта. */
function courtUsage(rounds: readonly RoundDto[], courts: number): Map<string, number[]> {
  const usage = new Map<string, number[]>();
  for (const round of rounds) {
    for (const match of round.matches) {
      for (const player of [...match.teamA.players, ...match.teamB.players]) {
        const row = usage.get(player.id) ?? Array.from({ length: courts }, () => 0);
        row[match.court - 1] = (row[match.court - 1] ?? 0) + 1;
        usage.set(player.id, row);
      }
    }
  }
  return usage;
}

async function main(): Promise<void> {
  section('Вход организаторов');
  const admin = await login('admin', 'e2e-admin', 'Организатор клуба');
  const moderator = await login('moderator', 'e2e-moderator', 'Второй судья');
  check(admin.session.role === 'admin', 'администратор вошёл');
  check(moderator.session.role === 'moderator', 'модератор вошёл');

  section('Первый вход администратора клуба');
  // Карточки админов не сидим заранее. Если прошлый прогон оставил привязку —
  // снимаем её удалением карточки (аккаунт отвяжется, ID снова свободен).
  for (const id of ['PZQZKM', 'P5ML0M'] as const) {
    try {
      await request('DELETE', `/api/players/${id}`, { token: admin.token });
    } catch {
      // карточки ещё не было — нормально
    }
  }

  // Локально кода из .env нет: ALLOW_DEV_LOGIN снимает проверку BOOTSTRAP_ADMIN_CODE.
  const clubAdmin = await login('user', 'e2e-club-admin', 'Админ клуба');
  const bootstrapClaim = await request<{ session: { role: string; accountId: string } }>(
    'POST',
    '/api/auth/claim',
    {
      token: clubAdmin.token,
      body: { duprId: 'PZQZKM', firstName: 'Club', lastName: 'AdminOne' },
    },
  );
  check(
    bootstrapClaim.session.role === 'admin',
    'админский DUPR PZQZKM привязывается без кода при ALLOW_DEV_LOGIN',
  );

  await expectError('forbidden', 'зашитого админа нельзя понизить', () =>
    request('PUT', `/api/players/PZQZKM/role`, {
      token: admin.token,
      body: { role: 'user' },
    }),
  );

  const secondBootstrap = await login('user', 'e2e-club-admin-2', 'Второй админ клуба');
  const secondClaim = await request<{ session: { role: string } }>('POST', '/api/auth/claim', {
    token: secondBootstrap.token,
    body: { duprId: 'P5ML0M', firstName: 'Club', lastName: 'AdminTwo' },
  });
  check(secondClaim.session.role === 'admin', 'второй зашитый DUPR P5ML0M тоже становится admin');

  // Роль на DUPR без Telegram: навесили модератора, потом вошёл — подхватил.
  const staffPlayer = await request<{ player: { id: string; duprId: string; clubRole: string } }>(
    'POST',
    '/api/players',
    {
      token: admin.token,
      body: {
        firstName: 'Судья',
        lastName: 'Смены',
        duprId: `MD${RUN_TAG}99`,
        doublesRating: 3.5,
      },
    },
  );
  await request('PUT', `/api/players/${staffPlayer.player.id}/role`, {
    token: admin.token,
    body: { role: 'moderator' },
  });
  const staffCard = await request<{
    canManageRole: boolean;
    isBootstrapAdmin: boolean;
    player: { clubRole: string };
  }>('GET', `/api/players/${staffPlayer.player.id}`, { token: admin.token });
  check(staffCard.canManageRole === true, 'роль на карточке можно менять без Telegram');
  check(staffCard.player.clubRole === 'moderator', 'роль модератора записана на DUPR');
  check(staffCard.isBootstrapAdmin === false, 'обычный игрок не помечен как bootstrap-admin');

  await request('PUT', `/api/players/${staffPlayer.player.id}/role`, {
    token: admin.token,
    body: { role: 'admin' },
  });
  const promoted = await request<{ player: { clubRole: string } }>(
    'GET',
    `/api/players/${staffPlayer.player.id}`,
    { token: admin.token },
  );
  check(promoted.player.clubRole === 'admin', 'из модератора можно сделать администратора');

  const staffUser = await login('user', 'e2e-staff-role', 'Будущий модератор');
  const staffClaim = await request<{ session: { role: string } }>('POST', '/api/auth/claim', {
    token: staffUser.token,
    body: { duprId: staffPlayer.player.duprId },
  });
  check(
    staffClaim.session.role === 'admin',
    'при входе аккаунт подхватывает роль с карточки DUPR',
  );

  await request('PUT', `/api/players/${staffPlayer.player.id}/role`, {
    token: admin.token,
    body: { role: 'moderator' },
  });
  const staffAccounts = await request<{ accounts: { id: string; role: string }[] }>(
    'GET',
    '/api/admin/accounts',
    { token: admin.token },
  );
  check(
    staffAccounts.accounts.some((row) => row.id === staffUser.session.accountId),
    'модератор виден в таблице админки',
  );

  await request('PUT', `/api/players/${staffPlayer.player.id}/role`, {
    token: admin.token,
    body: { role: 'user' },
  });
  const afterDemote = await request<{ accounts: { id: string }[] }>(
    'GET',
    '/api/admin/accounts',
    { token: admin.token },
  );
  check(
    !afterDemote.accounts.some((row) => row.id === staffUser.session.accountId),
    'после понижения до игрока строка пропадает из таблицы админки',
  );

  // Возвращаем ID клубу: в этой же базе потом заходит живой администратор.
  await request('POST', '/api/auth/claim', {
    token: clubAdmin.token,
    body: { duprId: `ZZ${RUN_TAG}01`, firstName: 'Тест', lastName: 'Прогонов' },
  });
  await request('POST', '/api/auth/claim', {
    token: secondBootstrap.token,
    body: { duprId: `ZZ${RUN_TAG}02`, firstName: 'Тест', lastName: 'Второй' },
  });

  section('Справочник игроков');
  const advancedPlayers = await createPlayers(admin.token, 'AD', 4.2);
  const intermediatePlayers = await createPlayers(admin.token, 'IN', 3.1);
  check(advancedPlayers.length === 12, 'создано 12 игроков категории advanced');
  check(intermediatePlayers.length === 12, 'создано 12 игроков категории intermediate');

  await expectError('duplicate_dupr_id', 'повторный DUPR ID отклоняется', () =>
    request('POST', '/api/players', {
      token: admin.token,
      body: { firstName: 'Дубль', lastName: 'Дублёв', duprId: advancedPlayers[0]!.duprId },
    }),
  );

  section('Два параллельных турнира на шести кортах');
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const shared = {
    format: 'americano',
    startsAt,
    courts: 3,
    // В клубе этот вечер занимает корты 4, 5 и 6 — так они и подписаны.
    courtNames: ['4', '5', '6'],
    maxPlayers: 12,
    pointsToWin: 11,
    matchDurationMin: 15,
    roundsPlanned: 11,
    tieRule: 'draw',
    standingsSort: ['points', 'diff'],
    ratingBalance: true,
    entryFee: 1000,
    venueName: 'First Summer Club',
    venueAddress: 'Корты клуба, 6 кортов',
  };

  const advanced = await createTournament(admin.token, {
    ...shared,
    title: 'Вечер пиклбола — Advanced',
    category: 'advanced',
  });
  const intermediate = await createTournament(moderator.token, {
    ...shared,
    title: 'Вечер пиклбола — Intermediate',
    category: 'intermediate',
    // Вторая половина клуба играет на кортах без подписей: там обычная нумерация.
    courtNames: null,
  });
  check(advanced.id !== intermediate.id, 'два турнира созданы независимо');

  section('Названия кортов');
  const advancedInfo = await state(advanced.id, admin.token);
  check(
    JSON.stringify(advancedInfo.tournament.courtNames) === JSON.stringify(['4', '5', '6']),
    'названия кортов сохранены в том порядке, в котором их задали',
  );
  check(
    (await state(intermediate.id, moderator.token)).tournament.courtNames === null,
    'без названий турнир остаётся с обычной нумерацией',
  );

  await request('PATCH', `/api/tournaments/${intermediate.id}`, {
    token: moderator.token,
    body: { courtNames: ['1', '2', 'Дальний'] },
  });
  check(
    JSON.stringify((await state(intermediate.id, moderator.token)).tournament.courtNames) ===
      JSON.stringify(['1', '2', 'Дальний']),
    'названия можно задать и после создания турнира',
  );

  // Урезали площадку до двух кортов — лишняя подпись уходит вместе с кортом.
  await request('PATCH', `/api/tournaments/${intermediate.id}`, {
    token: moderator.token,
    body: { courts: 2 },
  });
  check(
    JSON.stringify((await state(intermediate.id, moderator.token)).tournament.courtNames) ===
      JSON.stringify(['1', '2']),
    'при уменьшении числа кортов лишние названия отбрасываются',
  );
  await request('PATCH', `/api/tournaments/${intermediate.id}`, {
    token: moderator.token,
    body: { courts: 3, courtNames: null },
  });

  const list = await request<{ items: { id: string }[] }>('GET', '/api/tournaments');
  check(
    list.items.some((item) => item.id === advanced.id) &&
      list.items.some((item) => item.id === intermediate.id),
    'оба турнира видны в общем списке без авторизации',
  );

  section('Заявки: организатор добавляет, игрок заявляется сам');
  for (const player of advancedPlayers.slice(0, 11)) {
    await request('POST', `/api/tournaments/${advanced.id}/participants`, {
      token: admin.token,
      body: { playerId: player.id },
    });
  }
  for (const player of intermediatePlayers) {
    await request('POST', `/api/tournaments/${intermediate.id}/participants`, {
      token: moderator.token,
      body: { playerId: player.id },
    });
  }

  // Двенадцатый участник заявляется сам: Telegram-аккаунт + привязка DUPR.
  const selfPlayer = advancedPlayers[11]!;
  const guest = await login('user', `e2e-self-${RUN_TAG}`, 'Игрок с телефона');
  await expectError('forbidden', 'без привязки DUPR заявиться нельзя', () =>
    request('POST', `/api/tournaments/${advanced.id}/join`, { token: guest.token }),
  );

  const claimed = await request<{ session: { claim: { status: string } | null } }>(
    'POST',
    '/api/auth/claim',
    { token: guest.token, body: { duprId: selfPlayer.duprId } },
  );
  check(claimed.session.claim?.status === 'pending', 'заявка на привязку DUPR ждёт организатора');

  const pending = await request<{ claims: { id: string; player: { id: string } }[] }>(
    'GET',
    '/api/claims',
    { token: admin.token },
  );
  const ourClaim = pending.claims.find((claim) => claim.player.id === selfPlayer.id);
  check(ourClaim !== undefined, 'организатор видит заявку на привязку');
  await request('POST', `/api/claims/${ourClaim!.id}/decision`, {
    token: admin.token,
    body: { approve: true },
  });

  const joined = await request<{ waitlisted: boolean }>(
    'POST',
    `/api/tournaments/${advanced.id}/join`,
    { token: guest.token },
  );
  check(!joined.waitlisted, 'игрок заявился сам и попал в основной состав');

  const afterJoin = await state(advanced.id, admin.token);
  check(afterJoin.participants.length === 12, 'в advanced 12 участников');
  check(
    afterJoin.participants.some((item) => item.player.id === selfPlayer.id),
    'самостоятельная заявка привязана к карточке игрока с этим DUPR ID',
  );

  section('Приём участников и оплата');
  await expectError('not_all_confirmed', 'без подтверждения оплаты турнир не стартует', () =>
    request('POST', `/api/tournaments/${advanced.id}/start`, { token: admin.token, body: {} }),
  );

  for (const participant of afterJoin.participants) {
    await request(
      'PUT',
      `/api/tournaments/${advanced.id}/participants/${participant.player.id}/paid`,
      {
        token: admin.token,
        body: { confirmedAndPaid: true },
      },
    );
  }
  const confirmed = await state(advanced.id, admin.token);
  check(
    confirmed.participants.every((item) => item.confirmedAndPaid),
    'все 12 участников подтверждены и оплатили',
  );

  section('Расписание americano на 11 игр');
  const events: string[] = [];
  const socket = new WebSocket(`${BASE.replace('http', 'ws')}${WS_PATH}`);
  await new Promise<void>((resolve) => {
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', tournamentId: advanced.id }));
      resolve();
    });
  });
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    events.push((JSON.parse(event.data) as { type: string }).type);
  });

  await request('POST', `/api/tournaments/${advanced.id}/start`, {
    token: admin.token,
    body: { seed: 7 },
  });
  const started = await state(advanced.id, admin.token);
  check(started.tournament.status === 'running', 'турнир перешёл в статус «идёт»');
  check(started.rounds.length === 11, 'создано 11 раундов сразу после старта');
  check(
    started.rounds.every((round) => round.matches.length === 3),
    'в каждом раунде три корта — по три матча',
  );
  check(
    started.rounds.every((round) => round.sittingOut.length === 0),
    '12 игроков на 3 кортах играют без отдыхающих',
  );
  check(
    started.rounds.every((round) =>
      round.matches.every((match) => match.courtName === ['4', '5', '6'][match.court - 1]),
    ),
    'у каждого матча стоит подпись корта: 4, 5 и 6',
  );

  // Корты неравноценны, поэтому за вечер каждый должен побывать на всех трёх.
  const usage = courtUsage(started.rounds, 3);
  check(usage.size === 12, 'статистика по кортам собрана по всем игрокам');
  check(
    [...usage.values()].every((row) => row.every((games) => games > 0)),
    'никто не застревает на одном корте: каждый играет на 4, 5 и 6',
  );
  check(
    [...usage.values()].every((row) => Math.max(...row) - Math.min(...row) <= 3),
    'игры распределены по кортам примерно ровно',
  );

  const partners = new Set<string>();
  let duplicatePartners = 0;
  for (const round of started.rounds) {
    for (const match of round.matches) {
      for (const team of [match.teamA, match.teamB]) {
        const key = partnerKey(team.players[0]!.id, team.players[1]!.id);
        if (partners.has(key)) duplicatePartners += 1;
        partners.add(key);
      }
    }
  }
  check(duplicatePartners === 0, 'каждый играет в паре с каждым ровно один раз');
  check(partners.size === 66, 'всего 66 уникальных пар — полный круг');

  // Перемешивание до первого матча: расписание пересобирается.
  const reshuffled = await request<{ rounds: RoundDto[] }>(
    'POST',
    `/api/tournaments/${advanced.id}/reshuffle`,
    { token: admin.token, body: { seed: 21 } },
  );
  check(reshuffled.rounds.length === 11, 'после перемешивания снова 11 раундов');

  section('Игры: старт раунда, пауза, счёт');
  let played = 0;
  let current = await state(advanced.id, admin.token);
  for (const round of current.rounds) {
    await playRound(
      admin.token,
      advanced.id,
      round,
      (index) => (index === 0 ? [11, 6] : index === 1 ? [11, 9] : [8, 11]),
      { withPause: round.index === 0 },
    );
    played += round.matches.length;

    if (round.index === 0) {
      const afterFirst = await state(advanced.id, admin.token);
      check(afterFirst.rounds[0]!.allScored, 'первый раунд закрыт со счётом');
      check(afterFirst.standings.length === 12, 'таблица считается в прямом эфире');
      check(
        afterFirst.standings[0]!.pointsFor >= afterFirst.standings[11]!.pointsFor,
        'таблица отсортирована по очкам',
      );

      await expectError('conflict_version', 'устаревшая версия счёта отклоняется', () =>
        request('PUT', `/api/matches/${round.matches[0]!.id}/score`, {
          token: admin.token,
          body: { scoreA: 5, scoreB: 5, version: 0 },
        }),
      );
    }
  }
  check(played === 33, 'разыграно 33 матча: 11 раундов по три корта');

  section('Правка счёта и завершение');
  const beforeEdit = await state(advanced.id, admin.token);
  const lastMatch = beforeEdit.rounds[10]!.matches[0]!;
  const edited = await request<{ match: MatchDto }>('PUT', `/api/matches/${lastMatch.id}/score`, {
    token: admin.token,
    body: { scoreA: 11, scoreB: 2, version: lastMatch.version },
  });
  check(
    edited.match.teamA.score === 11 && edited.match.teamB.score === 2,
    'счёт исправлен до завершения турнира',
  );

  await request('POST', `/api/tournaments/${advanced.id}/finish`, { token: admin.token });
  const finished = await state(advanced.id, admin.token);
  check(finished.tournament.status === 'finished', 'турнир завершён');

  const medals = finished.standings.filter((row) => row.medal);
  check(medals.length === 3, 'медали получили трое');
  check(
    medals[0]!.medal === 'gold' && medals[1]!.medal === 'silver' && medals[2]!.medal === 'bronze',
    'медали распределены по порядку',
  );

  // Каждое очко матча достаётся двум игрокам команды, поэтому сумма таблицы — двойная.
  const scoredPoints = finished.rounds.reduce(
    (sum, round) =>
      sum +
      round.matches.reduce(
        (matchSum, match) => matchSum + 2 * ((match.teamA.score ?? 0) + (match.teamB.score ?? 0)),
        0,
      ),
    0,
  );
  const totalPoints = finished.standings.reduce((sum, row) => sum + row.pointsFor, 0);
  check(totalPoints === scoredPoints, 'сумма очков в таблице совпадает со счётом матчей');
  check(
    finished.standings.every((row) => row.played === 11),
    'каждый игрок провёл 11 игр',
  );

  await expectError('tournament_wrong_status', 'после завершения счёт не меняется', () =>
    request('PUT', `/api/matches/${lastMatch.id}/score`, {
      token: admin.token,
      body: { scoreA: 1, scoreB: 0, version: edited.match.version },
    }),
  );

  section('Сортировка таблицы по любому столбцу');
  const byWins = await request<{ standings: StandingRowDto[] }>(
    'GET',
    `/api/tournaments/${advanced.id}/standings?sort=wins,diff`,
  );
  check(
    byWins.standings.every(
      (row, index) => index === 0 || byWins.standings[index - 1]!.wins >= row.wins,
    ),
    'сортировка по победам работает',
  );

  section('Публичное табло и экспорт');
  const board = await request<{ standings: StandingRowDto[]; participants: unknown[] }>(
    'GET',
    `/api/public/${advanced.publicSlug}`,
  );
  check(board.standings.length === 12, 'табло доступно без авторизации');

  const csv = await fetch(`${BASE}/api/tournaments/${advanced.id}/export.csv`, {
    headers: { authorization: `Bearer ${admin.token}` },
  });
  const csvText = await csv.text();
  check(csv.ok && csvText.split('\n').length > 12, 'CSV с результатами выгружается');
  const firstDuprId = finished.standings[0]!.player.duprId;
  check(
    firstDuprId !== null && csvText.includes(firstDuprId),
    'в CSV есть DUPR ID: по именам игроков не различить',
  );
  check(
    csvText.includes(`${finished.standings[0]!.player.fullName} (${firstDuprId})`),
    'в списке матчей DUPR ID стоит рядом с именем',
  );

  section('Живые обновления');
  await new Promise((resolve) => setTimeout(resolve, 300));
  check(events.includes('subscribed'), 'клиент подписался на комнату турнира');
  check(events.includes('match.updated'), 'обновления матчей приходят по WebSocket');
  check(events.includes('standings.updated'), 'таблица приходит по WebSocket');
  socket.close();

  section('Mexicano: раунды по ходу игры');
  const mexicano = await createTournament(admin.token, {
    title: 'Вечер пиклбола — Mexicano',
    category: 'mexicano',
    format: 'mexicano',
    startsAt,
    courts: 2,
    // Названия могут быть и словами: позиция корта от подписи не зависит.
    courtNames: ['Центральный', 'Дальний'],
    maxPlayers: 8,
    pointsToWin: 11,
    roundsPlanned: null,
    tieRule: 'draw',
    standingsSort: ['points'],
    ratingBalance: true,
  });

  for (const player of intermediatePlayers.slice(0, 8)) {
    await request('POST', `/api/tournaments/${mexicano.id}/participants`, {
      token: admin.token,
      body: { playerId: player.id },
    });
    await request('PUT', `/api/tournaments/${mexicano.id}/participants/${player.id}/paid`, {
      token: admin.token,
      body: { confirmedAndPaid: true },
    });
  }

  await request('POST', `/api/tournaments/${mexicano.id}/start`, {
    token: admin.token,
    body: { seed: 3 },
  });
  let mex = await state(mexicano.id, admin.token);
  check(mex.rounds.length === 1, 'mexicano начинается с одного раунда');
  await expectError(
    'tournament_wrong_status',
    'в mexicano раунд нельзя пропустить — следующий строится по таблице',
    () => roundAction(admin.token, mexicano.id, 0, 'skip'),
  );
  check(mex.rounds[0]!.matches.length === 2, 'два корта — два матча');

  await expectError('round_not_finished', 'следующий раунд ждёт счёт предыдущего', () =>
    request('POST', `/api/tournaments/${mexicano.id}/rounds`, { token: admin.token }),
  );

  for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
    mex = await state(mexicano.id, admin.token);
    const round = mex.rounds[roundIndex]!;
    await playRound(admin.token, mexicano.id, round, (index) =>
      index === 0 ? [11, 7] : [9, 11],
    );
    if (roundIndex < 2) {
      const next = await request<{ roundIndex: number }>(
        'POST',
        `/api/tournaments/${mexicano.id}/rounds`,
        { token: admin.token },
      );
      check(next.roundIndex === roundIndex + 1, `создан раунд ${roundIndex + 2} по ходу турнира`);
    }
  }

  mex = await state(mexicano.id, admin.token);
  check(mex.rounds.length === 3, 'в mexicano три сыгранных раунда');
  const leader = mex.standings[0]!;
  const topCourt = mex.rounds[2]!.matches[0]!;
  check(
    topCourt.teamA.players
      .concat(topCourt.teamB.players)
      .some((player) => player.id === leader.player.id),
    'лидер таблицы играет на первом корте',
  );
  check(
    topCourt.court === 1 && topCourt.courtName === 'Центральный',
    'первый корт mexicano подписан своим названием, а позиция осталась первой',
  );
  check(
    mex.rounds.every((round) =>
      round.matches.every(
        (match) => match.courtName === ['Центральный', 'Дальний'][match.court - 1],
      ),
    ),
    'подписи кортов в mexicano не перемешиваются между раундами',
  );

  // Создаём ещё один раунд и сразу завершаем турнир — незаигранные матчи
  // не должны блокировать финиш и медали.
  await request('POST', `/api/tournaments/${mexicano.id}/rounds`, { token: admin.token });
  mex = await state(mexicano.id, admin.token);
  check(mex.rounds.length === 4, 'в mexicano можно создать следующий раунд после трёх');
  check(
    mex.rounds[3]!.matches.every((match) => match.status === 'scheduled'),
    'четвёртый раунд ещё не сыгран',
  );

  await request('POST', `/api/tournaments/${mexicano.id}/finish`, { token: admin.token });
  const mexFinished = await state(mexicano.id, admin.token);
  check(mexFinished.tournament.status === 'finished', 'mexicano можно завершить в любой момент');
  check(
    mexFinished.standings.some((row) => row.medal === 'gold'),
    'после финиша mexicano в таблице есть золотая медаль',
  );
  check(
    mexFinished.rounds[3]!.matches.every((match) => match.status === 'skipped'),
    'несыгранный раунд при финише mexicano помечается skipped',
  );

  section('Корты без названий');
  const plain = await createTournament(admin.token, {
    title: 'Вечер пиклбола — один корт',
    format: 'americano',
    startsAt,
    courts: 1,
    maxPlayers: 4,
    pointsToWin: 11,
    roundsPlanned: 3,
    ratingBalance: true,
  });
  for (const player of intermediatePlayers.slice(8, 12)) {
    await request('POST', `/api/tournaments/${plain.id}/participants`, {
      token: admin.token,
      body: { playerId: player.id },
    });
    await request('PUT', `/api/tournaments/${plain.id}/participants/${player.id}/paid`, {
      token: admin.token,
      body: { confirmedAndPaid: true },
    });
  }
  await request('POST', `/api/tournaments/${plain.id}/start`, {
    token: admin.token,
    body: { seed: 5 },
  });
  const plainState = await state(plain.id, admin.token);
  check(plainState.tournament.courtNames === null, 'названий у турнира нет');
  check(
    plainState.rounds.every((round) => round.matches.every((match) => match.courtName === '1')),
    'без названий корт подписан своим номером',
  );

  section('Пропуск раунда и возврат (americano)');
  // R0 сыграли → R1 пропустили → R2 стартовали → R1 нельзя, пока R2 живой →
  // R2 завершили → R1 вернули и запустили.
  await playRound(admin.token, plain.id, plainState.rounds[0]!, () => [11, 5]);
  let skipFlow = await roundAction(admin.token, plain.id, 1, 'skip');
  check(skipFlow[1]?.skipped === true, 'раунд 2 помечен skipped');
  check(skipFlow[1]?.closed === true, 'skipped раунд считается закрытым для следующего');

  skipFlow = await roundAction(admin.token, plain.id, 2, 'start');
  check(
    skipFlow[2]?.matches.every((match) => match.status === 'running') ?? false,
    'следующий раунд стартует, пока предыдущий пропущен',
  );
  await expectError(
    'tournament_wrong_status',
    'пропущенный нельзя запустить, пока другой раунд на кортах',
    () => roundAction(admin.token, plain.id, 1, 'start'),
  );

  skipFlow = await roundAction(admin.token, plain.id, 2, 'finish');

  skipFlow = await roundAction(admin.token, plain.id, 1, 'unskip');
  check(skipFlow[1]?.skipped === false, 'unskip возвращает раунд в scheduled');
  skipFlow = await roundAction(admin.token, plain.id, 1, 'skip');
  check(skipFlow[1]?.skipped === true, 'раунд снова можно пропустить');

  // Play на skipped: сразу в running, без отдельного unskip.
  skipFlow = await roundAction(admin.token, plain.id, 1, 'start');
  check(
    skipFlow[1]?.matches.every((match) => match.status === 'running') ?? false,
    'пропущенный раунд можно запустить напрямую',
  );
  await roundAction(admin.token, plain.id, 1, 'finish');

  await request('DELETE', `/api/tournaments/${plain.id}`, { token: admin.token });

  section('Права и удаление');
  await expectError('forbidden', 'модератор не удаляет турниры', () =>
    request('DELETE', `/api/tournaments/${mexicano.id}`, { token: moderator.token }),
  );
  await expectError('unauthorized', 'наблюдатель не может править счёт', () =>
    request('PUT', `/api/matches/${lastMatch.id}/score`, {
      body: { scoreA: 1, scoreB: 2, version: 0 },
    }),
  );
  await request('DELETE', `/api/tournaments/${mexicano.id}`, { token: admin.token });
  await expectError('not_found', 'удалённый турнир недоступен', () =>
    request('GET', `/api/tournaments/${mexicano.id}`),
  );

  await request('DELETE', `/api/tournaments/${advanced.id}`, { token: admin.token });
  await request('DELETE', `/api/tournaments/${intermediate.id}`, { token: admin.token });

  console.log(`\nПроверок: ${checks}, ошибок: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('\nСценарий упал:', error);
  process.exitCode = 1;
});
