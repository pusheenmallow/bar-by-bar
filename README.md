# Bar by Bar

A piano practice app. Upload a score, and it finds every bar. Practise bar by bar, and the page gets coloured in as each stage is learned.

It runs in the browser and installs to a tablet's home screen. There is no server and no login: pages, notes and progress stay on the device, with a backup file for safety. This repository holds only the app's code.

## Running the tests

The app has no build step and no dependencies. The tests need Node 20 or later and Playwright:

```
npm install
npx playwright install chromium
npm test
```

They run the real app in Chromium at a tablet size, with touch and a pretend microphone, served from this folder by `tests/server.mjs`. `npx playwright test migration` runs one file, and `-g "words from a test name"` runs matching tests.

Everything the tests use is made up in code: invented names, a drawn page of music and generated sound. Never add a real name, a photo of a score or a backup file. `node scripts/check-private.mjs` checks what is staged, and `CLAUDE.md` has the full rule.

One test is skipped unless you point it at a backup file from your own tablet. It puts the file into an old-style database, upgrades it, and prints row counts only:

```
REAL_BACKUP_PATH=/somewhere/outside/this/repo/backup.json npx playwright test migration -g "real backup"
```

## Publishing a change

Run `npm test`, then `node scripts/stamp.mjs`, then commit and push. Installed copies will offer the update.

When a change alters the database, the app saves a backup file on each tablet before upgrading it. See `js/store.js` and `js/upgrade.js`.

## Third-party files

- [PDF.js](https://mozilla.github.io/pdf.js/) in `vendor/`, Apache License 2.0
- [Lexend](https://fonts.google.com/specimen/Lexend) in `fonts/`, SIL Open Font License 1.1
- Noto Music (music signs only) in `fonts/`, SIL Open Font License 1.1
