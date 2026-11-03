import { h, go, icon, sheet, closeSheet, replaceSheet, sticker } from '../ui.js';
import { get, put, progressMap } from '../store.js';
import { checkGroups, checkStage, barsLabel, dayKey, mistakeList, blankProgress } from '../model.js';
import { drawBars } from '../images.js';
import { stickOn, fanfare } from '../sound.js';
import { missing } from './common.js';

export async function check([id], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const progress = await progressMap(id);
  const stage = checkStage(piece);
  const groups = checkGroups(piece, progress);
  if (!stage || !groups.length) {
    return h('main', { class: 'screen' },
      h('p', { class: 'lead' }, 'Nothing is ready for a next-day check yet.'),
      h('button', { class: 'btn', onClick: () => go(`/piece/${id}`) }, 'Back to my piece'));
  }

  let index = 0, passed = 0;
  const again = [];
  const crop = h('canvas', {});
  const cropBox = h('div', { class: 'train-crop' }, crop);
  const title = h('h1', {});
  let spots = [];

  async function paint() {
    const box = { width: cropBox.clientWidth - 8, height: cropBox.clientHeight - 8 };
    if (box.width < 40 || box.height < 40) return;
    spots = (await drawBars(crop, groups[index], box)).spots;
  }

  const save = async (bar, ok) => {
    const p = progress.get(bar.id) || blankProgress(id, bar.id);
    p.lastCheck = dayKey(Date.now());
    if (ok) p.done[stage.id] = Date.now();
    await put('progress', p);
    progress.set(bar.id, p);
    if (ok) passed += 1; else again.push(bar);
  };

  const advance = () => {
    index += 1;
    if (index < groups.length) { title.textContent = barsLabel(groups[index]); paint(); } else finish();
  };

  async function clean() {
    stickOn();
    for (const b of groups[index]) await save(b, true);
    await put('attempts', { pieceId: id, barIds: groups[index].map((b) => b.id), stageId: stage.id, tempo: null, result: 'clean', tag: null, at: Date.now() });
    advance();
  }

  const recordSlip = async (bar, tag) => {
    for (const b of groups[index]) await save(b, b.id !== bar.id);
    await put('attempts', { pieceId: id, barIds: [bar.id], stageId: stage.id, tempo: null, result: 'slip', tag, at: Date.now() });
  };

  function slip() {
    const group = groups[index];
    const tags = (bar) => {
      let saved = false;
      const finish = async (tag) => { if (saved) return; saved = true; await recordSlip(bar, tag); };
      replaceSheet([
        h('h2', {}, 'What happened?'),
        h('div', { class: 'chips' }, mistakeList(piece, stage).map((m) => h('button', {
          class: 'chip',
          onClick: async () => { await finish(m.id); closeSheet(); advance(); },
        }, m.label))),
      ]);
    };
    if (group.length === 1) {
      sheet([h('div', {})], { dismiss: false });
      tags(group[0]);
      return;
    }
    sheet([
      h('h2', {}, 'Which bar slipped?'),
      h('div', { class: 'chips' }, group.map((b) => h('button', { class: 'chip', onClick: () => tags(b) }, `Bar ${b.n}`))),
    ], { dismiss: false });
  }

  function finish() {
    fanfare();
    const backStage = piece.stages[piece.stages.findIndex((s) => s.id === stage.id) - 1]?.id || stage.id;
    root.className = 'screen finish';
    root.replaceChildren(h('div', { class: 'finish-body' },
      h('div', { class: 'cheer' }, sticker(120)),
      h('h1', { class: 'center' }, passed === 1 ? '1 bar stuck' : `${passed} bars stuck`),
      again.length ? h('p', { class: 'center lead' }, `${again.length === 1 ? `Bar ${again[0].n} needs` : `Bars ${again.map((b) => b.n).join(', ')} need`} a bit more. Try again tomorrow.`) : null,
      h('div', { class: 'row-buttons narrow' },
        again.length ? h('button', { class: 'btn', onClick: () => go(`/train/${id}/${again[0].id}/${backStage}`) }, `Practise bar ${again[0].n}`) : null,
        h('button', { class: 'btn primary', onClick: () => go(`/piece/${id}`) }, 'Back to my piece'))));
  }

  const ro = new ResizeObserver(() => paint());
  ctx.onShow(() => { title.textContent = barsLabel(groups[0]); ro.observe(cropBox); });
  ctx.onLeave(() => ro.disconnect());

  const root = h('main', { class: 'trainer check', vars: { pen: '#FFC02E' } },
    h('header', { class: 'train-top' },
      h('button', { class: 'round', 'aria-label': 'Back to the bar map', onClick: () => go(`/piece/${id}`) }, icon('back')),
      title,
      h('span', { class: 'stage-tag' }, stage.name)),
    cropBox,
    h('section', { class: 'train-side' },
      h('p', { class: 'goal' }, 'One go, first try. No warm-up.'),
      h('div', { class: 'answers' },
        h('button', { class: 'answer slip', onClick: slip }, 'Slip'),
        h('button', { class: 'answer clean', onClick: clean }, 'Clean'))));
  return root;
}
