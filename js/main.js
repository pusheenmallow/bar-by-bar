import { h, closeSheet, noteRoute, softly } from './ui.js';
import './theme.js';
import { home } from './screens/home.js';
import { player } from './screens/player.js';
import { mapScreen } from './screens/map.js';
import { trainer } from './screens/trainer.js';
import { check } from './screens/check.js';
import { whole } from './screens/whole.js';
import { stats } from './screens/stats.js';
import { parentHome } from './screens/parent.js';
import { addPiece } from './screens/add.js';
import { review } from './screens/review.js';
import { settings } from './screens/settings.js';
import { recordingScreen } from './screens/recording.js';
import { assign } from './screens/assign.js';
import { session } from './session.js';
import { setUpgradeGate } from './store.js';
import { upgradeGate, upgradeFailed } from './upgrade.js';

// An older database is backed up before it is upgraded. Every screen waits for that.
setUpgradeGate(upgradeGate);

const routes = [
  [/^\/$/, home],
  [/^\/player\/([^/]+)$/, player],
  [/^\/piece\/([^/]+)$/, mapScreen],
  [/^\/train\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(\d+))?$/, trainer],
  [/^\/check\/([^/]+)$/, check],
  [/^\/whole\/([^/]+)$/, whole],
  [/^\/stats\/([^/]+)$/, stats],
  [/^\/parent$/, parentHome],
  [/^\/parent\/add$/, addPiece],
  [/^\/parent\/review\/([^/]+)$/, review],
  [/^\/parent\/piece\/([^/]+)$/, settings],
  [/^\/parent\/bars\/([^/]+)$/, (args, ctx) => mapScreen(args, ctx, true)],
  [/^\/parent\/stats\/([^/]+)$/, (args, ctx) => stats(args, ctx, true)],
  [/^\/parent\/recording\/([^/]+)$/, recordingScreen],
  [/^\/parent\/assign\/([^/]+)$/, assign],
];

const app = document.getElementById('app');
let leaving = [];
let renderId = 0;
let lastPath = null;
let inGrownUps = false;
let onScreen = null;

// Grown-ups is a separate space: it is open only while on its own screens.
function enter(path) {
  noteRoute(path);
  const grownUps = path.startsWith('/parent');
  if (grownUps && !inGrownUps) session.exitTo = lastPath || '/';
  if (!grownUps) session.parent = false;
  inGrownUps = grownUps;
  lastPath = path;
  document.documentElement.dataset.space = grownUps ? 'grown-ups' : 'players';
}

async function render() {
  const mine = ++renderId;
  closeSheet(true);
  leaving.forEach((fn) => fn());
  leaving = [];
  const path = location.hash.slice(1) || '/';
  enter(path);
  const match = routes.map(([re, fn]) => [path.match(re), fn]).find(([m]) => m);
  const showing = [];
  const ctx = {
    onShow: (fn) => showing.push(fn),
    onLeave: (fn) => leaving.push(fn),
    rerender: render,
  };
  try {
    const el = match
      ? await match[1](match[0].slice(1).map((part) => part && decodeURIComponent(part)), ctx)
      : await home([], ctx);
    if (mine !== renderId) return;
    const view = `${path}|${!!session.parent}`;     // redrawing a screen in place stays instant
    const swap = () => {
      if (mine !== renderId) return;
      app.replaceChildren(el);
      window.scrollTo(0, 0);
      showing.forEach((fn) => fn());
    };
    const moved = onScreen !== null && view !== onScreen;
    onScreen = view;
    if (moved) await softly(swap, () => el); else swap();
  } catch (err) {
    if (mine !== renderId) return;
    if (err.upgradeFailed) { app.replaceChildren(upgradeFailed()); return; }
    console.error(err);
    app.replaceChildren(h('main', { class: 'screen' },
      h('p', { class: 'lead' }, `Something went wrong: ${err.message}`),
      h('button', { class: 'btn', onClick: () => { location.hash = '/'; } }, 'Back to the start')));
  }
}

// Chrome offers installing once it sees the app qualifies. The grown-ups screen shows the button.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); session.installPrompt = e; });
window.addEventListener('appinstalled', () => { session.installPrompt = null; });

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) {
  const updating = !!navigator.serviceWorker.controller;   // false on the very first visit
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) showUpdate(incoming);
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !updating) return;
    reloading = true;
    location.reload();
  });
}

function showUpdate(worker) {
  document.querySelector('.update')?.remove();
  document.getElementById('layer').append(h('div', { class: 'update', role: 'status' },
    h('span', {}, 'A new version is ready.'),
    h('button', { class: 'btn primary', onClick: () => worker.postMessage('update') }, 'Update now')));
}
