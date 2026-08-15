#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
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

  // Старый commit-msg бампил слишком поздно: git add не попадал в коммит.
  try {
    unlinkSync(resolve(hooksDir, 'commit-msg'));
  } catch {
    /* хука ещё не было */
  }

  const hookPath = resolve(hooksDir, 'prepare-commit-msg');
  writeFileSync(
    hookPath,
    `#!/bin/sh
# Ставится scripts/install-git-hooks.mjs. Логика — scripts/commit-msg-version.mjs
# prepare-commit-msg: git add ещё входит в этот коммит; --no-verify его не отключает.
repo=$(git rev-parse --show-toplevel)

if ! command -v node >/dev/null 2>&1; then
  nvm_dir="\${NVM_DIR:-\$HOME/.nvm}"
  nvm_ver=$(cat "\$nvm_dir/alias/default" 2>/dev/null)
  for candidate in \\
    "\$nvm_dir/versions/node/v\$nvm_ver/bin" \\
    "\$nvm_dir/versions/node/\$nvm_ver/bin"
  do
    if [ -x "\$candidate/node" ]; then
      PATH="\$candidate:\$PATH"
      break
    fi
  done
  if ! command -v node >/dev/null 2>&1; then
    newest=$(ls -1d "\$nvm_dir/versions/node/"*/bin/node 2>/dev/null | tail -1)
    if [ -n "\$newest" ]; then
      PATH="$(dirname "\$newest"):\$PATH"
    fi
  fi
  PATH="\$PATH:/opt/homebrew/bin:/usr/local/bin"
  export PATH
fi

if ! command -v node >/dev/null 2>&1; then
  echo "prepare-commit-msg: node не найден в PATH" >&2
  exit 1
fi

exec node "\$repo/scripts/commit-msg-version.mjs" "\$@"
`,
  );
  chmodSync(hookPath, 0o755);
} catch {
  process.exit(0);
}
