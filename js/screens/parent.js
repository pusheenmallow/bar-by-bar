import { h, go, icon, sheet, closeSheet, toast, confirmSheet } from '../ui.js';
import { all, put, del, byIndex, getMeta, setMeta, exportAll, importAll, progressMap, groupOf, learnersOf, removeLearner, deletePiece } from '../store.js';
import { penVar, PLAYER_PENS, newId, playableBars, topStage, nameList } from '../model.js';
import { themeChoice, setTheme } from '../theme.js';
import { session } from '../session.js';
import { isMuted, setMuted } from '../sound.js';
import { field, busyPanel, doneButton, leaveGrownUps } from './common.js';
import { shadowOn, setShadow } from '../shadow.js';

const hash = async (pin) => {
  const bytes = new TextEncoder().encode(`bar-by-bar:${pin}`);
  const out = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(out)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export async function gate(next) {
  const saved = await getMeta('pinHash');
  let first = null;
  let entry = '';
  const title = h('h1', {}, saved ? 'Enter the grown-up PIN' : 'Choose a 4-digit PIN');
  const sub = h('p', { class: 'lead' }, saved ? 'This keeps pieces and settings safe.' : 'Grown-ups use this to add pieces and notes.');
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => h('i', {})));
  const show = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < entry.length));

  async function complete() {
    if (saved) {
      if ((await hash(entry)) === saved) { session.parent = true; next(); return; }
      entry = ''; show(); toast('That PIN is not right.');
      return;
    }
    if (first === null) {
      first = entry; entry = ''; show();
      title.textContent = 'Enter it once more';
      return;
    }
    if (first !== entry) {
      first = null; entry = ''; show();
      title.textContent = 'Choose a 4-digit PIN';
      toast('Those PINs did not match. Try again.');
      return;
    }
    await setMeta('pinHash', await hash(entry));
    session.parent = true;
    next();
  }

  const press = (d) => { if (entry.length < 4) { entry += d; show(); if (entry.length === 4) complete(); } };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  function forgot() {
    const a = 23 + Math.floor(Math.random() * 60), b = 17 + Math.floor(Math.random() * 60);
    const input = h('input', { type: 'number', inputmode: 'numeric', 'aria-label': `${a} times ${b}` });
    sheet([
      h('h2', {}, 'Choose a new PIN'),
      h('p', {}, `What is ${a} × ${b}?`),
      input,
      h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', onClick: () => closeSheet() }, 'Cancel'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (Number(input.value) !== a * b) { toast('That answer is not right.'); return; }
            await setMeta('pinHash', null);
            closeSheet();
            location.reload();
          },
        }, 'Reset PIN')),
    ]);
  }

  return h('main', { class: 'screen gate' },
    h('header', { class: 'bar-top' }, h('button', { class: 'back', onClick: leaveGrownUps }, icon('back', 22), h('span', {}, 'Back'))),
    title, sub, dots,
    h('div', { class: 'keypad' }, keys.map((k) => (k === ''
      ? h('span', {})
      : h('button', {
        class: 'key',
        'aria-label': k === 'del' ? 'Delete last digit' : k,
        onClick: () => {
          if (k === 'del') { entry = entry.slice(0, -1); show(); } else press(k);
        },
      }, k === 'del' ? icon('back') : k)))),
    saved && h('button', { class: 'quiet-link', onClick: forgot }, 'Forgot the PIN'));
}

function playerSheet(existing, done) {
  let chosen = existing?.pen || PLAYER_PENS[0];
  const name = h('input', { type: 'text', value: existing?.name || '', autocomplete: 'off', maxlength: 24 });
  const row = h('div', { class: 'pen-pick', role: 'radiogroup', 'aria-label': 'Pen colour' });
  const paint = () => row.replaceChildren(...PLAYER_PENS.map((p) => h('button', {
    class: `pen-dot ${p === chosen ? 'on' : ''}`,
    role: 'radio',
    'aria-checked': String(p === chosen),
    'aria-label': p,
    style: { background: penVar(p) },
    onClick: () => { chosen = p; paint(); },
  })));
  paint();
  sheet([
    h('h2', {}, existing ? 'Change player' : 'Add a player'),
    field('Name', name),
    h('span', { class: 'field-label' }, 'Their pen'),
    row,
    h('div', { class: 'row-buttons' },
      existing && h('button', {
        class: 'btn danger',
        onClick: async () => {
          const theirs = (await byIndex('pieces', 'playerId', existing.id)).filter((p) => !p.draft);
          if (theirs.length) {
            const alone = [];
            for (const p of theirs) if ((await learnersOf(p)).length === 1) alone.push(p);
            const shared = theirs.filter((p) => !alone.includes(p));
            const quote = (list) => nameList(list.map((p) => `“${p.title}”`));
            const body = [
              shared.length && `Their progress on ${quote(shared)} will be deleted. Everyone else keeps theirs.`,
              alone.length && `${quote(alone)} will be deleted${shared.length ? ' too' : ''}, since nobody else is learning ${alone.length === 1 ? 'it' : 'them'}.`,
            ].filter(Boolean).join(' ');
            const yes = await confirmSheet({ title: `Remove ${existing.name}?`, body, yes: `Remove ${existing.name}`, danger: true });
            if (!yes) return;
            for (const p of theirs) {
              if (alone.includes(p)) await deletePiece(p.id);
              else await removeLearner(p.id);
            }
            if ([existing.id, ...theirs.map((p) => p.id)].some((pid) => session.exitTo.includes(pid))) session.exitTo = '/';
          }
          await del('players', existing.id);
          closeSheet();
          done();
        },
      }, 'Remove player'),
      h('button', { class: 'btn', onClick: () => closeSheet() }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onClick: async () => {
          const text = name.value.trim();
          if (!text) { name.focus(); return; }
          await put('players', { id: existing?.id || newId(), name: text, pen: chosen, createdAt: existing?.createdAt || Date.now() });
          closeSheet();
          done();
        },
      }, existing ? 'Save player' : 'Add player')),
  ]);
}

export async function parentHome(_, ctx) {
  if (!session.parent) return gate(() => ctx.rerender());

  const players = (await all('players')).sort((a, b) => a.createdAt - b.createdAt);
  const pieces = (await all('pieces')).filter((p) => !p.draft).sort((a, b) => a.createdAt - b.createdAt);
  const lastBackup = await getMeta('lastBackup');
  const safe = await navigator.storage?.persisted?.();
  const shadowing = await shadowOn();
  const nameOf = (id) => players.find((p) => p.id === id)?.name || 'Nobody';

  // One row for each piece, naming everyone learning it.
  const groups = new Map();
  for (const piece of pieces) {
    const key = groupOf(piece);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(piece);
  }
  const pieceRows = [];
  for (const learners of groups.values()) {
    const first = learners[0];
    const bars = playableBars(first);
    const started = [];
    for (const piece of learners) {
      const progress = await progressMap(piece.id);
      started.push(bars.filter((b) => topStage(piece, progress.get(b.id))).length);
    }
    const sub = learners.length === 1
      ? `${nameOf(first.playerId)}, ${started[0]} of ${bars.length} bars started`
      : `${nameList(learners.map((p, i) => `${nameOf(p.playerId)} ${started[i]}`))} of ${bars.length} bars started`;
    pieceRows.push(h('button', { class: 'list-row', onClick: () => go(`/parent/piece/${first.id}`) },
      h('span', { class: 'row-main' }, first.title),
      h('span', { class: 'row-sub' }, sub)));
  }

  async function saveBackup() {
    sheet(busyPanel('Making the backup file'), { dismiss: false });
    const blob = await exportAll();
    const name = `bar-by-bar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    await setMeta('lastBackup', Date.now());
    closeSheet();
    toast('Backup saved to Downloads.');
    ctx.rerender();
  }

  async function restore(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const yes = await confirmSheet({
      title: 'Replace everything on this tablet?',
      body: 'All players, pieces and progress here will be replaced by the backup.',
      yes: 'Restore backup',
      danger: true,
    });
    if (!yes) return;
    try {
      await importAll(file);
      location.hash = '/';
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  }

  const restoreInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onChange: restore });

  const backupText = lastBackup
    ? `Last backup: ${new Date(lastBackup).toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}.`
    : 'No backup yet. Everything lives only on this tablet, so save one after adding a piece.';

  return h('main', { class: 'screen parent' },
    h('header', { class: 'bar-top' },
      h('h1', {}, 'Grown-ups'),
      doneButton()),

    session.installPrompt && h('section', { class: 'block' },
      h('h2', {}, 'Install'),
      h('p', {}, 'Put Bar by Bar on the home screen. It opens like an app and works with no internet.'),
      h('button', {
        class: 'btn primary',
        onClick: async () => {
          const offer = session.installPrompt;
          session.installPrompt = null;
          await offer.prompt();
          await offer.userChoice;
          ctx.rerender();
        },
      }, 'Install on this tablet')),

    h('section', { class: 'block' },
      h('h2', {}, 'Players'),
      players.map((p) => h('button', {
        class: 'list-row', onClick: () => playerSheet(p, () => ctx.rerender()),
      }, h('span', { class: 'swatch', style: { background: penVar(p.pen) } }), h('span', { class: 'row-main' }, p.name))),
      h('button', { class: 'btn', onClick: () => playerSheet(null, () => ctx.rerender()) }, 'Add a player')),

    h('section', { class: 'block' },
      h('h2', {}, 'Pieces'),
      pieceRows,
      players.length
        ? h('button', { class: 'btn primary', onClick: () => go('/parent/add') }, 'Add a piece')
        : h('p', { class: 'field-hint' }, 'Add a player first.')),

    h('section', { class: 'block' },
      h('h2', {}, 'Backup'),
      h('p', {}, backupText),
      h('div', { class: 'row-buttons left' },
        h('button', { class: 'btn', onClick: saveBackup }, 'Save a backup file'),
        h('button', { class: 'btn', onClick: () => restoreInput.click() }, 'Restore from a file'),
        restoreInput),
      safe === false ? h('p', { class: 'field-hint' }, 'Install the app on the home screen so the browser keeps this data safe.') : null),

    h('section', { class: 'block' },
      h('h2', {}, 'Appearance'),
      h('div', { class: 'mode-row', role: 'group', 'aria-label': 'Theme' },
        [['auto', 'Match this tablet'], ['light', 'Light'], ['dark', 'Dark']].map(([id, label]) => h('button', {
          class: `seg ${themeChoice() === id ? 'on' : ''}`,
          'aria-pressed': String(themeChoice() === id),
          onClick: () => { setTheme(id); ctx.rerender(); },
        }, label)))),

    h('section', { class: 'block' },
      h('h2', {}, 'Sounds'),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: !isMuted(), onChange: (e) => setMuted(!e.target.checked) }),
        h('span', {}, 'Play sticker and celebration sounds'))),

    h('section', { class: 'block' },
      h('h2', {}, 'Shadow grade'),
      h('p', { class: 'field-hint' }, 'A check on how well “clean” and “slip” are being judged. While this is on, sit beside the player. After each of their taps a small prompt asks for your own answer. It changes nothing they see or earn. After 20 plays, each piece’s Stats shows how often you agreed.'),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: shadowing, onChange: (e) => setShadow(e.target.checked) }),
        h('span', {}, 'Ask for my answer after each play on this tablet'))));
}
