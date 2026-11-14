// A learner's own recordings of a piece. They stay on this tablet. The learner can hear any of
// them, and once there is an early one to compare with, "Then and now" plays the first beside the
// latest. Nothing here is automatic: the learner chooses what to hear. Only a grown-up, behind
// the PIN, can delete one.
import { h, fill, icon, toast, confirmSheet } from '../ui.js';
import { get, del, takesFor } from '../store.js';
import { penVar, thenAndNow, agoText, dayKey } from '../model.js';
import { session } from '../session.js';
import { missing, backTo, sessionHome } from './common.js';
import { gate } from './parent.js';

// `area` is 'parent' when opened from Grown-ups, which is behind the PIN. Otherwise it is the player's own view.
export async function takes([id], ctx, area = null) {
  if (area === 'parent' && !session.parent) return gate(() => ctx.rerender());
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const person = await get('players', piece.playerId);
  const staff = !!area;
  const home = area === 'parent' ? { back: 'Piece settings', path: `/parent/piece/${id}` } : sessionHome(id);
  let list = await takesFor(id);

  // One sound at a time, from whichever recording was tapped.
  const audio = new Audio();
  let url = null, playing = null;
  const buttons = new Map();                         // every play button, by the take it plays
  const showPlaying = () => buttons.forEach((take, btn) => {
    const on = take.id === playing;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  function stop() {
    audio.pause();
    if (url) URL.revokeObjectURL(url);
    url = null;
    playing = null;
    showPlaying();
  }
  async function play(take) {
    const again = playing === take.id;
    stop();
    if (again) return;
    url = URL.createObjectURL(take.blob);
    audio.src = url;
    playing = take.id;
    showPlaying();
    try { await audio.play(); } catch { stop(); toast('That recording couldn’t be played.'); }
  }
  audio.addEventListener('ended', stop);
  ctx.onLeave(stop);

  const today = dayKey(Date.now());
  const what = (take) => (take.whole ? 'Whole piece' : `Bars ${take.bars[0]} to ${take.bars[1]}`);
  const playButton = (take, label, big = false) => {
    const btn = h('button', { class: `btn play-take ${big ? 'big' : ''}`, 'aria-pressed': 'false', onClick: () => play(take) }, icon('play', 20), label);
    buttons.set(btn, take);
    return btn;
  };

  async function remove(take) {
    const yes = await confirmSheet({ title: 'Delete this recording?', body: `${agoText(take.day, today)}, ${what(take).toLowerCase()}. It can’t be brought back.`, yes: 'Delete', danger: true });
    if (!yes) return;
    stop();
    await del('takes', take.id);
    list = await takesFor(id);
    show();
  }

  const body = h('div', { class: 'takes-body' });
  function show() {
    buttons.clear();
    if (!list.length) {
      fill(body, h('p', { class: 'lead' }, staff
        ? 'No recordings yet. The player can tap “Record this play” before playing the whole piece.'
        : 'No recordings yet. Tap “Record this play” before you play the whole piece.'));
      return;
    }
    const pair = thenAndNow(list);
    fill(body,
      pair && h('section', { class: 'then-now', 'aria-label': 'Then and now' },
        h('h2', {}, 'Then and now'),
        h('p', { class: 'lead' }, 'Hear how it sounded at the start, and how it sounds now.'),
        h('div', { class: 'row-buttons left' },
          playButton(pair.then, `Then: ${agoText(pair.then.day, today).toLowerCase()}`, true),
          playButton(pair.now, `Now: ${agoText(pair.now.day, today).toLowerCase()}`, true))),
      h('div', { class: 'take-list' }, list.slice().reverse().map((take) => h('div', { class: 'take-row' },
        h('span', { class: 'take-when' }, agoText(take.day, today)),
        h('span', { class: 'take-what' }, what(take)),
        playButton(take, 'Play'),
        staff && h('button', { class: 'btn danger', onClick: () => remove(take) }, 'Delete')))));
  }
  show();

  return h('main', { class: 'screen takes', vars: { pen: penVar(person?.pen || 'sky') } },
    h('header', { class: 'bar-top' },
      backTo(home.back, home.path),
      h('h1', {}, staff && person ? `${person.name}’s recordings` : 'My recordings')),
    h('p', { class: 'lead' }, piece.title),
    body);
}
