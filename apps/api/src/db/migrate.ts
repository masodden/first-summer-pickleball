import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDatabase } from './index.js';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

export async function runMigrations(): Promise<void> {
  const { client, db } = createDatabase();
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isEntrypoint = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isEntrypoint) {
  runMigrations()
    .then(() => {
      console.log('Миграции применены');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Не удалось применить миграции:', error);
      process.exit(1);
    });
}
