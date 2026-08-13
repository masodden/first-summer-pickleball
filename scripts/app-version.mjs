/**
 * Единая версия приложения: корневой package.json, пакеты и APP_VERSION.
 * angular.json / drizzle не трогаем — там свои schema-версии.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const VERSION_FILES = [
  { path: 'package.json', kind: 'json' },
  { path: 'apps/web/package.json', kind: 'json' },
  { path: 'apps/api/package.json', kind: 'json' },
  { path: 'packages/shared/package.json', kind: 'json' },
  { path: 'packages/engine/package.json', kind: 'json' },
  { path: 'packages/shared/src/domain.ts', kind: 'ts' },
];

const TS_RE = /export const APP_VERSION = '([^']+)'/;
const JSON_RE = /^(\s*"version":\s*")([^"]+)(")/m;

export function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts,
  }).trim();
}

export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

export function bumpSemver(version, kind) {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Не semver: ${version}`);
  if (kind === 'major') return formatSemver({ major: parsed.major + 1, minor: 0, patch: 0 });
  if (kind === 'minor') {
    return formatSemver({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  }
  return formatSemver({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
}

export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return 0;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function readVersionFromText(text, kind) {
  if (kind === 'ts') return TS_RE.exec(text)?.[1] ?? null;
  return JSON_RE.exec(text)?.[2] ?? null;
}

export function writeVersionToText(text, kind, version) {
  if (kind === 'ts') {
    if (!TS_RE.test(text)) throw new Error('В domain.ts нет APP_VERSION');
    return text.replace(TS_RE, `export const APP_VERSION = '${version}'`);
  }
  if (!JSON_RE.test(text)) throw new Error('В package.json нет version');
  return text.replace(JSON_RE, `$1${version}$3`);
}

export function readFileVersion(relPath, kind) {
  return readVersionFromText(readFileSync(resolve(ROOT, relPath), 'utf8'), kind);
}

export function writeFileVersion(relPath, kind, version) {
  const abs = resolve(ROOT, relPath);
  writeFileSync(abs, writeVersionToText(readFileSync(abs, 'utf8'), kind, version));
}

export function currentAppVersion() {
  const version = readFileVersion('package.json', 'json');
  if (!version) throw new Error('Нет version в package.json');
  return version;
}

/** feat: / feat(scope): → minor, иначе patch. */
export function bumpKindFromMessage(message) {
  const subject = message.split('\n')[0]?.trim() ?? '';
  if (/^feat(\([^)]*\))?!?:/i.test(subject)) return 'minor';
  return 'patch';
}

function showGitFile(spec) {
  try {
    return git(['show', spec], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** Версия, которая уже в индексе (то, что уйдёт в коммит). */
export function indexVersion(relPath, kind) {
  const staged = showGitFile(`:${relPath}`);
  if (staged !== null) return readVersionFromText(staged, kind);
  return readFileVersion(relPath, kind);
}

export function headVersion(relPath, kind) {
  const fromHead = showGitFile(`HEAD:${relPath}`);
  if (fromHead !== null) return readVersionFromText(fromHead, kind);
  return null;
}

export function collectIndexVersions() {
  return VERSION_FILES.map((file) => ({
    ...file,
    version: indexVersion(file.path, file.kind),
  }));
}

/**
 * Если в коммите уже подняли версию — вернуть её (и дописать в файлы, где забыли).
 * Иначе null: нужно bump.
 */
export function versionAlreadyBumped() {
  const head = headVersion('package.json', 'json');
  const indexed = collectIndexVersions();
  const newer = indexed
    .map((file) => file.version)
    .filter((version) => version && head && compareSemver(version, head) > 0);
  if (newer.length === 0) return null;
  return newer.sort(compareSemver).at(-1) ?? null;
}

export function writeAllVersions(version) {
  for (const file of VERSION_FILES) writeFileVersion(file.path, file.kind, version);
  return version;
}

export function stageVersionFiles() {
  git(['add', '--', ...VERSION_FILES.map((file) => file.path)]);
}

export function applyVersion(version) {
  writeAllVersions(version);
  stageVersionFiles();
  return version;
}

const invokedDirectly =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const kindArg = process.argv[2];
  const kind =
    kindArg === 'major' || kindArg === 'minor' || kindArg === 'patch' ? kindArg : 'patch';
  if (kindArg && kindArg !== kind) {
    console.error('usage: node scripts/app-version.mjs [patch|minor|major]');
    process.exit(1);
  }
  const from = currentAppVersion();
  const to = bumpSemver(from, kind);
  applyVersion(to);
  console.log(`${from} → ${to}`);
}
