import { createDatabase, type Database } from './index.js';
import { players, venues } from './schema.js';

const SEED_VENUES = [
  {
    name: 'Центр Пиклбола',
    address: 'Красногорск, Советская ул., 14',
    mapUrl: 'https://yandex.ru/maps/-/CTGZFWPy',
  },
  {
    name: 'First Summer Club, ВДНХ',
    address: 'Москва, ВДНХ',
    mapUrl: 'https://yandex.ru/maps/-/CTGNBM4U',
  },
  {
    name: 'Пиклбол Гераклион',
    address: 'Москва, Лодочная ул., 15, стр. 1А',
    mapUrl: 'https://yandex.ru/maps/-/CTGZFGMw',
  },
] as const;

export async function seedVenues(db: Database): Promise<void> {
  // Upsert: адрес и карта иногда правятся в коде — при повторном посеве
  // обновляем уже существующую площадку, а не оставляем старую ссылку.
  for (const venue of SEED_VENUES) {
    await db
      .insert(venues)
      .values(venue)
      .onConflictDoUpdate({
        target: venues.name,
        set: {
          address: venue.address,
          mapUrl: venue.mapUrl,
        },
      });
  }
}

const DEMO_FIRST_NAMES = [
  'Иван',
  'Пётр',
  'Алексей',
  'Дмитрий',
  'Сергей',
  'Никита',
  'Егор',
  'Артём',
  'Мария',
  'Анна',
  'Ольга',
  'Дарья',
];
const DEMO_LAST_NAMES = [
  'Смирнов',
  'Иванов',
  'Кузнецов',
  'Соколов',
  'Попов',
  'Лебедев',
  'Козлов',
  'Новиков',
  'Морозова',
  'Волкова',
  'Зайцева',
  'Павлова',
];

/**
 * Демо-состав на 24 игрока: ровно два параллельных турнира по 12 человек.
 * Нужен, чтобы можно было прогнать полный сценарий локально без реальных данных.
 */
export async function seedDemoPlayers(db: Database): Promise<number> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let created = 0;

  for (let index = 0; index < 24; index += 1) {
    // Детерминированный, но непохожий на настоящие DUPR ID вид: начинается с D.
    const suffix = Array.from({ length: 5 }, (_, position) => {
      const code = (index * 31 + position * 7 + 11) % alphabet.length;
      return alphabet[code] as string;
    }).join('');
    const duprId = `D${suffix}`;

    const advanced = index < 12;
    const base = advanced ? 4.6 : 3.2;
    const rating = Math.round((base + (index % 12) * 0.07) * 1000) / 1000;

    const inserted = await db
      .insert(players)
      .values({
        id: duprId,
        duprId,
        firstName: DEMO_FIRST_NAMES[index % DEMO_FIRST_NAMES.length] as string,
        lastName: DEMO_LAST_NAMES[(index * 5) % DEMO_LAST_NAMES.length] as string,
        doublesRating: rating,
        singlesRating: null,
        ratingUpdatedAt: new Date(),
        ratingSource: 'import',
        nameSource: 'import',
      })
      .onConflictDoNothing({ target: players.id })
      .returning({ id: players.id });

    created += inserted.length;
  }

  return created;
}

async function main(): Promise<void> {
  const withDemo = process.argv.includes('--demo');
  const { client, db } = createDatabase();
  try {
    await seedVenues(db);
    console.log('Площадки готовы');

    if (withDemo) {
      const created = await seedDemoPlayers(db);
      console.log(`Демо-игроков добавлено: ${created} (всего в демо-наборе 24)`);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

const invokedDirectly = process.argv[1]?.includes('seed');
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
