// Run before publishing: gives the offline cache a new name whenever any app file changes,
// which is how installed copies learn there is an update.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const skip = new Set(['.git', 'scripts', 'README.md', 'sw.js']);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    if (skip.has(name) || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
};
walk('.');
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(f));
const sw = readFileSync('sw.js', 'utf8');
const listed = [...sw.matchAll(/'([^']+\.(?:js|mjs|css|html|woff2|png|webmanifest))'/g)].map((m) => m[1]);
const appFiles = files.filter((f) => /\.(js|mjs|css|html|woff2|png|webmanifest)$/.test(f));
const missing = appFiles.filter((f) => !listed.includes(f));
if (missing.length) { console.error('Add these to sw.js:', missing.join(', ')); process.exit(1); }
const version = hash.digest('hex').slice(0, 10);
writeFileSync('sw.js', sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
console.log('sw.js version', version, `(${files.length} files)`);
