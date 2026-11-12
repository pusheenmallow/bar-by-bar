// The stamp names the offline cache. Test files must never be part of it or of the cache list.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the stamp passes with the tests present', () => {
  const out = execFileSync('node', ['scripts/stamp.mjs', '--dry'], { cwd: root, encoding: 'utf8' });
  expect(out).toMatch(/sw\.js version would be [0-9a-f]{10}/);
});

test('no test or tooling file is in the offline cache list', () => {
  const sw = readFileSync(`${root}/sw.js`, 'utf8');
  const list = sw.slice(sw.indexOf('const FILES'), sw.indexOf('];', sw.indexOf('const FILES')));
  const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(files.length).toBeGreaterThan(20);
  expect(files.filter((f) => /^(tests|node_modules|scripts|test-results)\/|package(-lock)?\.json|playwright\.config/.test(f))).toEqual([]);
});
