#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// pnpm prepare не должен ломать Docker/CI: там нет git и часто нет этого файла.
if (process.env.CI === 'true') process.exit(0);

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}

try {
  const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    encoding: 'utf8',
  }).trim();
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = resolve(hooksDir, 'commit-msg');
  writeFileSync(
    hookPath,
    `#!/bin/sh
# Ставится scripts/install-git-hooks.mjs. Логика — scripts/commit-msg-version.mjs
repo=$(git rev-parse --show-toplevel)
exec node "$repo/scripts/commit-msg-version.mjs" "$@"
`,
  );
  chmodSync(hookPath, 0o755);
} catch {
  process.exit(0);
}
