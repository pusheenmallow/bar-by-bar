import { h, go, icon, sheet, closeSheet, toast } from '../ui.js';
import { all, put, del } from '../store.js';
import { KEYS, defaultStages, newId, rowsToLayoutRows } from '../model.js';
import { findBars, pdfToImages } from '../detect-client.js';
import { pageUrl, forgetPage } from '../images.js';
import { session } from '../session.js';
import { field, stepper, busyPanel } from './common.js';
import { gate } from './parent.js';

export function blankPiece(playerId) {
  return {
    id: newId(), draft: true, playerId, title: '', tempo: 100, beats: 4, keySig: 'none', cleanTarget: 3, slowPercent: 65, dailyGoal: 10,
    firstBar: 1, stages: defaultStages(), layout: [], createdAt: Date.now(),
  };
}

export const goalText = (v) => (v ? `${v} min a day` : 'No goal');

export const barCount = (pg) => pg.rows.reduce((n, r) => n + r.bars.length, 0);

export async function addPiece(_, ctx) {
  if (!session.parent) return gate(() => ctx.rerender());
  const players = (await all('players')).sort((a, b) => a.createdAt - b.createdAt);
  if (!players.length) { go('/parent'); return h('main', {}); }
  const piece = (await all('pieces')).find((p) => p.draft) || blankPiece(players[0].id);

  const save = () => put('pieces', piece);

  const title = h('input', { type: 'text', value: piece.title, autocomplete: 'off', onInput: (e) => { piece.title = e.target.value; if (piece.layout.length) save(); } });
  const player = h('select', { onChange: (e) => { piece.playerId = e.target.value; if (piece.layout.length) save(); } },
    players.map((p) => h('option', { value: p.id, selected: p.id === piece.playerId }, p.name)));
  const key = h('select', { onChange: (e) => { piece.keySig = e.target.value; if (piece.layout.length) save(); } },
    KEYS.map((k) => h('option', { value: k.id, selected: k.id === piece.keySig }, k.label)));

  const listEl = h('div', { class: 'page-list' });

  async function showPages() {
    const rows = [];
    for (const [i, pg] of piece.layout.entries()) {
      const n = barCount(pg);
      rows.push(h('div', { class: 'page-row' },
        h('img', { src: await pageUrl(pg.pageId), alt: `Page ${i + 1}` }),
        h('div', {},
          h('strong', {}, `Page ${i + 1}`),
          h('p', {}, n ? `${n} bars in ${pg.rows.length} rows` : 'No bars found. You can add boxes by hand on the next step.')),
        h('button', {
          class: 'round', 'aria-label': `Remove page ${i + 1}`,
          onClick: async () => {
            forgetPage(pg.pageId);
            await del('pages', pg.pageId);
            piece.layout.splice(i, 1);
            await save();
            showPages();
          },
        }, icon('bin', 24))));
    }
    listEl.replaceChildren(...rows);
    goBtn.disabled = !piece.layout.length;
  }

  async function addFiles(files) {
    const list = [...files];
    if (!list.length) return;
    const status = h('p', {}, 'Reading the music');
    sheet(busyPanel(status), { dismiss: false });
    try {
      for (const file of list) {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        const images = isPdf
          ? await pdfToImages(file, (i, n) => { status.textContent = `Opening PDF page ${i} of ${n}`; })
          : [file];
        for (const image of images) {
          status.textContent = `Finding the bars on page ${piece.layout.length + 1}`;
          let found = await findBars(image);
          let rotate = 0;
          if (!found.rows.length) {                    // a photo taken sideways
            const turned = await findBars(image, { rotate: 90 });
            if (turned.rows.length) { found = turned; rotate = 90; }
          }
          const pageId = newId();
          await put('pages', {
            id: pageId, pieceId: piece.id, blob: found.blob, width: found.width, height: found.height,
            original: image, rotate, corners: found.corners, sourceWidth: found.sourceWidth, sourceHeight: found.sourceHeight,
          });
          piece.layout.push({ pageId, width: found.width, height: found.height, rows: rowsToLayoutRows(found.rows) });
          await save();
        }
      }
    } catch (err) {
      toast(/decode|source image/i.test(err.message) ? 'That file could not be opened. Try a JPG photo or a PDF.' : `That page could not be read: ${err.message}`);
    }
    closeSheet();
    showPages();
  }

  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onChange: (e) => { addFiles(e.target.files); e.target.value = ''; } });
  const picker = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onChange: (e) => { addFiles(e.target.files); e.target.value = ''; } });

  const goBtn = h('button', {
    class: 'btn primary big',
    disabled: true,
    onClick: async () => {
      piece.title = title.value.trim();
      if (!piece.title) { toast('Give the piece a name first.'); title.focus(); return; }
      await save();
      go(`/parent/review/${piece.id}`);
    },
  }, 'Check the boxes');

  ctx.onShow(showPages);

  return h('main', { class: 'screen form' },
    h('header', { class: 'bar-top' },
      h('button', { class: 'round', 'aria-label': 'Back', onClick: () => go('/parent') }, icon('back')),
      h('h1', {}, 'Add a piece')),
    field('Name of the piece', title),
    field('Who is learning it', player),
    h('div', { class: 'two' },
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Full speed'),
        stepper({ label: 'Full speed in beats a minute', value: piece.tempo, min: 30, max: 240, step: 2, format: (v) => `♩ = ${v}`, onChange: (v) => { piece.tempo = v; if (piece.layout.length) save(); } })),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Beats in a bar'),
        stepper({ label: 'Beats in a bar', value: piece.beats, min: 1, max: 12, onChange: (v) => { piece.beats = v; if (piece.layout.length) save(); } }))),
    field('Key signature', key, 'This adds a “forgot the flat or sharp” mistake to the trainer.'),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Practice goal'),
      stepper({ label: 'Practice goal in minutes a day', value: piece.dailyGoal ?? 10, min: 0, max: 60, step: 5, format: goalText, onChange: (v) => { piece.dailyGoal = v; if (piece.layout.length) save(); } })),
    h('section', { class: 'block' },
      h('h2', {}, 'Pages'),
      h('p', { class: 'field-hint' }, 'Use one page per photo. Lay it flat in good light, with the whole page in view. PDF scans work too.'),
      listEl,
      h('div', { class: 'row-buttons left' },
        h('button', { class: 'btn', onClick: () => camera.click() }, 'Take a photo'),
        h('button', { class: 'btn', onClick: () => picker.click() }, 'Choose a photo or PDF')),
      camera, picker),
    h('div', { class: 'form-end' }, goBtn));
}
