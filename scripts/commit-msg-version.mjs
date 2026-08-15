#!/usr/bin/env node
/**
 * prepare-commit-msg: если в коммите нет новой версии — поднимаем patch,
 * при префиксе feat: / feat(scope): — minor. Файлы добавляются в тот же коммит
 * через индекс (хук срабатывает до снимка дерева).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  applyVersion,
  bumpKindFromMessage,
  bumpSemver,
  currentAppVersion,
  versionAlreadyBumped,
  writeAllVersions,
  stageVersionFiles,
} from './app-version.mjs';

if (process.env.SKIP_VERSION_BUMP === '1') process.exit(0);

const messageFile = process.argv[2];
const source = process.argv[3] ?? '';
if (!messageFile) {
  console.error('prepare-commit-msg: нет файла сообщения');
  process.exit(1);
}

// merge / squash / amend (source=commit) — не бампаем
if (source === 'merge' || source === 'squash' || source === 'commit') process.exit(0);

const message = readFileSync(messageFile, 'utf8');
if (isMergeCommit(message) || isAmendCommit()) process.exit(0);

const existing = versionAlreadyBumped();
if (existing) {
  writeAllVersions(existing);
  stageVersionFiles();
  process.exit(0);
}

const kind = bumpKindFromMessage(message);
const from = currentAppVersion();
const to = bumpSemver(from, kind);
applyVersion(to);
console.error(`app-version: ${from} → ${to} (${kind})`);

function isMergeCommit(text) {
  return /^(Merge( branch| remote-tracking branch| pull request)|Merge tag)\b/.test(
    text.split('\n')[0] ?? '',
  );
}

function isAmendCommit() {
  let pid = process.ppid;
  for (let i = 0; i < 8 && pid > 1; i += 1) {
    try {
      const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
      if (/\bcommit\b/.test(command) && /--amend\b/.test(command)) return true;
      pid = Number(
        execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
      );
    } catch {
      return false;
    }
  }
  return false;
}
