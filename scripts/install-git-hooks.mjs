#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}

const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
  encoding: 'utf8',
}).trim();
mkdirSync(hooksDir, { recursive: true });

writeFileSync(
  resolve(hooksDir, 'commit-msg'),
  `#!/bin/sh
# Ставится scripts/install-git-hooks.mjs. Логика — scripts/commit-msg-version.mjs
repo=$(git rev-parse --show-toplevel)
exec node "$repo/scripts/commit-msg-version.mjs" "$@"
`,
);
chmodSync(resolve(hooksDir, 'commit-msg'), 0o755);
