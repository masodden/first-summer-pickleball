import { readFile } from 'node:fs/promises';
import { createDatabase } from './index.js';
import { importDirectory, parseDirectory } from '../services/directory-import.js';
import { appMeta } from './schema.js';

/**
 * Заливает справочник игроков DUPR из файла или по ссылке.
 *
 * Примеры:
 *   pnpm db:import --url https://bilinaspol.github.io/dupru/players.js
 *   pnpm db:import --file ./players.csv
 */
async function readSource(): Promise<{ content: string; origin: string }> {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const urlIndex = args.indexOf('--url');

  if (fileIndex >= 0 && args[fileIndex + 1]) {
    const file = args[fileIndex + 1] as string;
    return { content: await readFile(file, 'utf8'), origin: file };
  }
  if (urlIndex >= 0 && args[urlIndex + 1]) {
    const url = args[urlIndex + 1] as string;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Не удалось скачать ${url}: HTTP ${response.status}`);
    }
    return { content: await response.text(), origin: url };
  }

  throw new Error(
    'Укажите источник: --file <путь> или --url <ссылка>\n' +
      'Например: pnpm db:import --url https://bilinaspol.github.io/dupru/players.js',
  );
}

async function main(): Promise<void> {
  const { content, origin } = await readSource();
  const entries = parseDirectory(content);
  if (entries.length === 0) {
    throw new Error('В источнике не нашлось ни одного игрока с корректным DUPR ID');
  }
  console.log(`Разобрано игроков: ${entries.length}`);

  const { client, db } = createDatabase();
  try {
    const report = await importDirectory(db, entries, { actorName: 'Импорт справочника' });
    await db
      .insert(appMeta)
      .values({ key: 'directory:last_import', value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: new Date().toISOString(), updatedAt: new Date() },
      });
    await db
      .insert(appMeta)
      .values({ key: 'directory:last_source', value: origin })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: origin, updatedAt: new Date() },
      });

    console.log(
      `Готово. Добавлено: ${report.created}, обновлено: ${report.updated}, ` +
        `расхождений рейтинга: ${report.conflicts}, без изменений: ${report.skipped}`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
