import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../env.js';
import * as schema from './schema.js';

export function createDatabase(connectionString = loadEnv().DATABASE_URL) {
  const client = postgres(connectionString, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { client, db };
}

type DatabaseBundle = ReturnType<typeof createDatabase>;
export type Database = DatabaseBundle['db'];

let instance: DatabaseBundle | null = null;

export function getDb(): Database {
  instance ??= createDatabase();
  return instance.db;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.client.end({ timeout: 5 });
    instance = null;
  }
}

export { schema };
