// Blocks private files from the public repo. Run before every commit (the pre-commit hook does).
// Checks what is staged: backup exports, and photos or scans of scores.
import { execFileSync } from 'node:child_process';
import { basename, extname } from 'node:path';

const IMAGES = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

// Added, copied, modified or renamed files. A deletion can't leak anything.
let staged;
try {
  staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);
} catch (err) {
  console.error(`Could not read the staged files, so nothing is allowed through: ${err.message}`);
  process.exit(1);
}

const blocked = [];
for (const file of staged) {
  const name = basename(file).toLowerCase();
  const ext = extname(name);
  if (ext === '.json' && /backup/.test(name)) {
    blocked.push([file, 'its name looks like a backup export (backup*.json)']);
  } else if (ext === '.json') {
    let text = '';
    try { text = git('show', `:${file}`); } catch { /* unreadable: leave it to the name checks */ }
    if (text.includes('backupVersion')) blocked.push([file, 'it contains "backupVersion", so it is a backup export']);
  } else if (IMAGES.has(ext) && !file.startsWith('icons/')) {
    blocked.push([file, `${ext.slice(1)} images are only allowed in icons/ (photos of scores must stay on the tablet)`]);
  }
}

if (blocked.length) {
  console.error('Blocked: this repo is public and these staged files may be private.\n');
  for (const [file, why] of blocked) console.error(`  ${file}\n    ${why}`);
  console.error('\nUnstage them with: git restore --staged <file>');
  process.exit(1);
}
console.log(`check-private: ${staged.length} staged file${staged.length === 1 ? '' : 's'} OK`);
