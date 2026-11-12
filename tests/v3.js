// A made-up tablet as the version 3 app left it, and a way to put it into the browser's database
// without running any of the app's code. Used to test the upgrade to version 4.
import { createHash } from 'node:crypto';
import { defaultStages } from '../js/model.js';
import { expect, scorePng, PIN } from './helpers.js';

const DAY = 86400000;

// Two seconds of near silence as a WAV file, written out by hand.
function wavDataUrl() {
  const samples = 4000, rate = 2000;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(3000 * Math.sin(i / 3)), 44 + i * 2);
  return `data:audio/wav;base64,${buf.toString('base64')}`;
}

// Everything on the made-up tablet, in the same form as a backup file.
// Two players share "Paper Boat Waltz", and one of them also learns "Tin Drum March" alone.
export async function madeUpTablet(page) {
  const png = `data:image/png;base64,${(await scorePng(page)).toString('base64')}`;
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const t0 = noon.getTime() - 20 * DAY;
  const dayOf = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const lines = [0.087, 0.294, 0.5, 0.706, 0.911];
  const layoutFor = (prefix, pageId) => [{
    pageId, width: 1654, height: 2340,
    rows: [[0.093, 0.275], [0.339, 0.519], [0.583, 0.765]].map(([top, bottom], r) => ({
      top, bottom, lines,
      bars: [0, 1, 2, 3].map((i) => ({ id: `${prefix}-bar-${String(r * 4 + i + 1).padStart(2, '0')}`, skip: prefix === 'waltz' && r * 4 + i === 6 })),
    })),
  }];
  const bar = (prefix, n) => `${prefix}-bar-${String(n).padStart(2, '0')}`;
  const waltzBars = Array.from({ length: 12 }, (_, i) => bar('waltz', i + 1)).filter((id) => id !== bar('waltz', 7));

  const shared = {
    title: 'Paper Boat Waltz', tempo: 108, beats: 3, keySig: 'b1', cleanTarget: 3, slowPercent: 65, dailyGoal: 10, firstBar: 1,
    stages: defaultStages(), layout: layoutFor('waltz', 'page-waltz'), group: 'piece-waltz-pip',
    recording: { duration: 2, added: t0 + 5 * DAY, marks: { lines: waltzBars.map((id, i) => ({ bar: id, t: i === 0 ? 0.1 : i === 4 ? 0.9 : null })), end: 1.9 } },
  };
  const pieces = [
    { ...shared, id: 'piece-waltz-pip', playerId: 'player-pip', createdAt: t0, runTempo: 84 },
    { ...shared, id: 'piece-waltz-juno', playerId: 'player-juno', createdAt: t0 + DAY },
    {
      id: 'piece-march-juno', playerId: 'player-juno', createdAt: t0 + 2 * DAY, title: 'Tin Drum March', tempo: 96, beats: 4, keySig: 'none',
      cleanTarget: 3, slowPercent: 65, dailyGoal: 15, firstBar: 0, stages: defaultStages(), layout: layoutFor('march', 'page-march'),
    },
  ];

  const progress = (pieceId, barId, more) => ({
    key: `${pieceId}|${barId}`, pieceId, barId, done: {}, flagged: false, notes: [], bestTempo: 0,
    lastCheck: null, clean: 0, slips: 0, lastPractised: 0, runSlip: 0, crowns: {}, ...more,
  });
  const all = (t) => ({ rh: t, lh: t + 1000, melody: t + 2000, slow: t + 3000, full: t + 4000 });

  return {
    app: 'bar-by-bar',
    backupVersion: 1,
    meta: [
      { key: 'muted', value: true },
      { key: 'lastBackup', value: t0 + 3 * DAY },
      { key: 'pinHash', value: createHash('sha256').update(`bar-by-bar:${PIN}`).digest('hex') },
    ],
    players: [
      { id: 'player-pip', name: 'Pip', pen: 'sky', createdAt: t0 - DAY },
      { id: 'player-juno', name: 'Juno', pen: 'gum', createdAt: t0 - DAY + 1000 },
    ],
    pieces,
    pages: [
      { id: 'page-waltz', pieceId: 'piece-waltz-pip', width: 1654, height: 2340, data: png },
      { id: 'page-march', pieceId: 'piece-march-juno', width: 1654, height: 2340, rotate: 0, data: png },
    ],
    progress: [
      progress('piece-waltz-pip', bar('waltz', 1), {
        done: { ...all(t0 + 2 * DAY), next: t0 + 4 * DAY }, crowns: { rh: t0 + 2 * DAY, full: t0 + 3 * DAY }, bestTempo: 108, clean: 31, slips: 6,
        lastPractised: t0 + 9 * DAY, lastCheck: dayOf(t0 + 4 * DAY),
        notes: [{ id: 'note-1', who: 'teacher', text: 'Lift at the end of the slur', at: t0 + 6 * DAY }],
      }),
      progress('piece-waltz-pip', bar('waltz', 2), { done: all(t0 + 3 * DAY), crowns: { lh: t0 + 3 * DAY }, bestTempo: 100, clean: 12, slips: 9, flagged: true, runSlip: t0 + 8 * DAY, lastPractised: t0 + 8 * DAY }),
      progress('piece-waltz-pip', bar('waltz', 3), { done: { rh: t0 + 5 * DAY, lh: t0 + 5 * DAY + 500 }, clean: 6, slips: 1, lastPractised: t0 + 5 * DAY }),
      progress('piece-waltz-pip', bar('waltz', 8), { done: { rh: t0 + 6 * DAY }, clean: 3, slips: 0, lastPractised: t0 + 6 * DAY }),
      progress('piece-waltz-juno', bar('waltz', 1), { done: { rh: t0 + 7 * DAY }, crowns: { rh: t0 + 7 * DAY }, clean: 7, slips: 2, lastPractised: t0 + 7 * DAY }),
      progress('piece-waltz-juno', bar('waltz', 12), { slips: 4, lastPractised: t0 + 7 * DAY, notes: [{ id: 'note-2', who: 'parent', text: 'Count the rests', at: t0 + 7 * DAY }] }),
      progress('piece-march-juno', bar('march', 1), { done: all(t0 + 8 * DAY), crowns: { slow: t0 + 8 * DAY }, bestTempo: 96, clean: 20, slips: 5, lastPractised: t0 + 10 * DAY }),
    ],
    // As version 3 wrote them. The numbers have gaps, as they do after a piece is deleted.
    attempts: [
      { id: 1, pieceId: 'piece-waltz-pip', barIds: [bar('waltz', 1)], stageId: 'rh', tempo: null, result: 'slip', tag: 'note', at: t0 + 2 * DAY },
      { id: 2, pieceId: 'piece-waltz-pip', barIds: [bar('waltz', 1)], stageId: 'rh', tempo: null, result: 'clean', tag: null, at: t0 + 2 * DAY + 20000 },
      { id: 3, pieceId: 'piece-waltz-pip', barIds: [bar('waltz', 1), bar('waltz', 2)], stageId: 'full', tempo: 108, result: 'clean', tag: null, at: t0 + 3 * DAY },
      { id: 5, pieceId: 'piece-waltz-pip', barIds: [bar('waltz', 1)], stageId: 'next', tempo: null, result: 'clean', tag: null, at: t0 + 4 * DAY },
      { id: 6, pieceId: 'piece-waltz-pip', mode: 'piece', barIds: waltzBars, slipBars: [bar('waltz', 2)], stageId: null, tempo: null, result: 'slip', tag: null, at: t0 + 8 * DAY },
      { id: 9, pieceId: 'piece-waltz-juno', barIds: [bar('waltz', 12)], stageId: 'rh', tempo: 70, result: 'slip', tag: 'rhythm', at: t0 + 7 * DAY },
      { id: 10, pieceId: 'piece-march-juno', barIds: [bar('march', 1)], stageId: 'slow', tempo: 62, result: 'clean', tag: null, at: t0 + 8 * DAY },
      { id: 14, pieceId: 'piece-deleted-long-ago', barIds: ['gone-bar'], stageId: 'rh', tempo: null, result: 'clean', tag: null, at: t0 + DAY },
      // Written by the version 3 app after it started saving the extra fields.
      {
        id: 15, pieceId: 'piece-march-juno', playerId: 'player-juno', barIds: [bar('march', 1)], stageId: 'full', result: 'clean', tag: null,
        at: t0 + 10 * DAY, day: dayOf(t0 + 10 * DAY), source: 'trainer', metronomeOn: true, tempoSet: 96, tempo: 96, firstTryToday: true, warmUps: null, runGoal: 7,
      },
    ],
    time: [
      { key: `piece-waltz-pip|${dayOf(t0 + 2 * DAY)}`, pieceId: 'piece-waltz-pip', day: dayOf(t0 + 2 * DAY), modes: { bar: 240, phrase: 0, piece: 0 }, bars: { [bar('waltz', 1)]: [240, 0, 0] } },
      { key: `piece-waltz-pip|${dayOf(t0 + 8 * DAY)}`, pieceId: 'piece-waltz-pip', day: dayOf(t0 + 8 * DAY), modes: { bar: 0, phrase: 90, piece: 110 }, bars: Object.fromEntries(waltzBars.map((id) => [id, [0, 90 / 11, 10]])) },
      { key: `piece-march-juno|${dayOf(t0 + 10 * DAY)}`, pieceId: 'piece-march-juno', day: dayOf(t0 + 10 * DAY), modes: { bar: 300, phrase: 0, piece: 0 }, bars: { [bar('march', 1)]: [300, 0, 0] } },
    ],
    recordings: [{
      pieceId: 'piece-waltz-pip', data: wavDataUrl(), peaks: [0, 40, 200, 180, 90, 30], onsets: [0.1, 0.5, 0.9, 1.3], strengths: [255, 120, 200, 90],
      start: 0.1, end: 1.9, duration: 2, added: t0 + 5 * DAY,
    }],
  };
}

// Puts a tablet's data into a database made exactly as an older app made it. `version` 3 is the
// app before this upgrade; 2 had no recordings. `from` is the data itself, or { file } for a
// backup file on disk, which is read by the browser and never by the test's own output.
export async function buildOldDatabase(page, from, { version = 3 } = {}) {
  await page.goto('/tests/blank.html');
  if (from.file) {
    await page.setContent('<input type="file">');
    await page.locator('input').setInputFiles(from.file);
  }
  await page.evaluate(async ({ data, version }) => {
    if (!data) data = JSON.parse(await document.querySelector('input').files[0].text());
    const blobOf = async (url) => (await fetch(url)).blob();
    const pages = [];
    for (const { data: url, ...rest } of data.pages) pages.push({ ...rest, blob: await blobOf(url) });
    const recordings = [];
    for (const { data: url, peaks, onsets, strengths, ...rest } of (version >= 3 && data.recordings) || []) {
      recordings.push({ ...rest, blob: await blobOf(url), peaks: Uint8Array.from(peaks), onsets: Float32Array.from(onsets), strengths: Uint8Array.from(strengths) });
    }
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('bar-by-bar', version);
      req.onupgradeneeded = () => {
        // Copied from the version 3 app's store.js, so this is the database real tablets have.
        const made = req.result;
        const make = (name, options, index) => {
          const store = made.createObjectStore(name, options);
          if (index) store.createIndex(index, index);
        };
        make('meta', { keyPath: 'key' });
        make('players', { keyPath: 'id' });
        make('pieces', { keyPath: 'id' }, 'playerId');
        make('pages', { keyPath: 'id' }, 'pieceId');
        make('progress', { keyPath: 'key' }, 'pieceId');
        make('attempts', { keyPath: 'id', autoIncrement: true }, 'pieceId');
        if (version >= 2) make('time', { keyPath: 'key' }, 'pieceId');
        if (version >= 3) make('recordings', { keyPath: 'pieceId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readwrite');
    const fill = (name, list) => { if (names.includes(name)) (list || []).forEach((row) => tx.objectStore(name).put(row)); };
    fill('meta', data.meta); fill('players', data.players); fill('pieces', data.pieces); fill('pages', pages);
    fill('progress', data.progress); fill('attempts', data.attempts); fill('time', data.time); fill('recordings', recordings);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    db.close();
  }, { data: from.file ? null : from, version });
}

// Goes through the backup step of an upgrade. Returns the backup file that was saved, as an object.
export async function saveUpgradeBackup(page, readFile) {
  await expect(page.getByRole('heading', { name: 'Bar by Bar has an update' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save the backup' }).tap();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^bar-by-bar-backup-before-update-\d{4}-\d\d-\d\d\.json$/);
  await expect(page.locator('.upgrade-status')).toContainText('Saved to Downloads');
  return readFile ? JSON.parse(await readFile(await saved.path(), 'utf8')) : null;
}
