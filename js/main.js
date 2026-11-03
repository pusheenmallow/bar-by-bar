import { h, closeSheet, toast } from './ui.js';
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
import { session } from './session.js';

const routes = [
  [/^\/$/, home],
  [/^\/player\/([^/]+)$/, player],
  [/^\/piece\/([^/]+)$/, mapScreen],
  [/^\/train\/([^/]+)\/([^/]+)\/([^/]+)$/, trainer],
  [/^\/check\/([^/]+)$/, check],
  [/^\/whole\/([^/]+)$/, whole],
  [/^\/stats\/([^/]+)$/, stats],
  [/^\/parent$/, parentHome],
  [/^\/parent\/add$/, addPiece],
  [/^\/parent\/review\/([^/]+)$/, review],
  [/^\/parent\/piece\/([^/]+)$/, settings],
];

const app = document.getElementById('app');
let leaving = [];
let renderId = 0;

async function render() {
  const mine = ++renderId;
  closeSheet(true);
  leaving.forEach((fn) => fn());
  leaving = [];
  const path = location.hash.slice(1) || '/';
  const match = routes.map(([re, fn]) => [path.match(re), fn]).find(([m]) => m);
  const showing = [];
  const ctx = {
    onShow: (fn) => showing.push(fn),
    onLeave: (fn) => leaving.push(fn),
    rerender: render,
  };
  try {
    const el = match
      ? await match[1](match[0].slice(1).map(decodeURIComponent), ctx)
      : await home([], ctx);
    if (mine !== renderId) return;
    app.replaceChildren(el);
    window.scrollTo(0, 0);
    showing.forEach((fn) => fn());
  } catch (err) {
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
