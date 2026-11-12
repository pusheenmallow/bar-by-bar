# Bar by Bar

This repo is PUBLIC. Never commit children's names, score images/photos, backup JSON exports, PIN hashes, or any file from the user's tablet. Test fixtures must use invented names and synthetic data. Before every commit run: `git diff --cached --name-only` and confirm no .json backups or images outside icons/.

## Private-file check

`scripts/check-private.mjs` blocks staged backup JSON files (backup*.json, or any .json containing "backupVersion") and images (jpg, jpeg, png, heic, webp) outside icons/. It exits 1 and says which file was blocked and why.

- A pre-commit hook at `.git/hooks/pre-commit` runs it automatically, but **hooks are not pushed**, so a fresh clone or a new session does not have it. Sessions must run `node scripts/check-private.mjs` manually after staging and before every commit.
- To reinstall the hook:
  ```
  printf '#!/bin/sh\ncd "$(git rev-parse --show-toplevel)" || exit 1\nexec node scripts/check-private.mjs\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
  ```
- `.gitignore` is a second layer, not a substitute: it does not stop files that are already tracked or that are added with `git add -f`.

## Tests

`npm test` runs the Playwright tests in `tests/` (see the README). Run them before every commit that touches `js/`. Tests build their data in code. A backup needed by a test is made as an object in a `.js` file, never saved as `.json`.
