# Bar by Bar

A piano practice app. Upload a score, and it finds every bar. Practise bar by bar, and the page gets coloured in as each stage is learned.

It runs in the browser and installs to a tablet's home screen. There is no server and no login: pages, notes and progress stay on the device, with a backup file for safety. This repository holds only the app's code.

## Publishing a change

Run `node scripts/stamp.mjs`, then commit and push. Installed copies will offer the update.

## Third-party files

- [PDF.js](https://mozilla.github.io/pdf.js/) in `vendor/`, Apache License 2.0
- [Lexend](https://fonts.google.com/specimen/Lexend) in `fonts/`, SIL Open Font License 1.1
- Noto Music (music signs only) in `fonts/`, SIL Open Font License 1.1
