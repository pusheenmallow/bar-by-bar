import { newId } from './model.js';
// Everything the app remembers lives in IndexedDB on this device.

const NAME = 'bar-by-bar';
const VERSION = 3;
let opened;

function open() {
  if (opened) return opened;
  opened = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const make = (name, options, index) => {
        if (db.objectStoreNames.contains(name)) return;
        const store = db.createObjectStore(name, options);
        if (index) store.createIndex(index, index);
      };
      make('meta', { keyPath: 'key' });
      make('players', { keyPath: 'id' });
      make('pieces', { keyPath: 'id' }, 'playerId');
      make('pages', { keyPath: 'id' }, 'pieceId');
      make('progress', { keyPath: 'key' }, 'pieceId');
      make('attempts', { keyPath: 'id', autoIncrement: true }, 'pieceId');
      make('time', { keyPath: 'key' }, 'pieceId');              // added in version 2
      make('recordings', { keyPath: 'pieceId' });               // added in version 3
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return opened;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export async function get(store, key) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(key));
}
export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await finished(tx);
  return value;
}
export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await finished(tx);
}
export async function all(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}
export async function byIndex(store, index, value) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export const getMeta = async (key, fallback = null) => (await get('meta', key))?.value ?? fallback;
export const setMeta = (key, value) => put('meta', { key, value });

export async function progressMap(pieceId) {
  const rows = await byIndex('progress', 'pieceId', pieceId);
  return new Map(rows.map((p) => [p.barId, p]));
}

/* ---------- pieces several people learn ---------- */
// Each person learning a piece has their own record, which keeps their progress apart.
// Records in a group share the music: pages, bars, the teacher's recording and the settings.

export const groupOf = (piece) => piece.group || piece.id;
const PERSONAL = ['id', 'playerId', 'createdAt', 'runTempo', 'draft'];

export async function learnersOf(piece) {
  const group = groupOf(piece);
  return (await all('pieces'))
    .filter((p) => !p.draft && groupOf(p) === group)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function shared(from, to) {
  const out = {};
  for (const [k, v] of Object.entries(from)) if (!PERSONAL.includes(k)) out[k] = v;
  for (const k of PERSONAL) if (to[k] !== undefined) out[k] = to[k];
  return out;
}

// Saves a piece, and its shared parts for everyone else learning it.
export async function savePiece(piece) {
  const others = piece.draft ? [] : (await learnersOf(piece)).filter((p) => p.id !== piece.id);
  const db = await open();
  const tx = db.transaction('pieces', 'readwrite');
  const os = tx.objectStore('pieces');
  os.put(piece);
  others.forEach((other) => os.put(shared(piece, other)));
  await finished(tx);
}

export async function addLearner(piece, playerId) {
  const already = (await learnersOf(piece)).find((p) => p.playerId === playerId);
  if (already) return already;
  piece.group = groupOf(piece);
  const copy = shared(piece, { id: newId(), playerId, createdAt: Date.now() });
  await savePiece(piece);
  await put('pieces', copy);
  return copy;
}

// One person stops learning a piece. Their progress, tries and time go. The music stays for the others.
export async function removeLearner(pieceId) {
  const db = await open();
  const tx = db.transaction(['pieces', 'progress', 'attempts', 'time'], 'readwrite');
  tx.objectStore('pieces').delete(pieceId);
  for (const store of ['progress', 'attempts', 'time']) {
    const os = tx.objectStore(store);
    const keys = await done(os.index('pieceId').getAllKeys(pieceId));
    keys.forEach((k) => os.delete(k));
  }
  await finished(tx);
}

// The piece goes for everyone: every learner's progress, the pages and the recording.
export async function deletePiece(pieceId) {
  const piece = await get('pieces', pieceId);
  const group = piece ? groupOf(piece) : pieceId;
  const ids = new Set([pieceId, group, ...(piece ? (await learnersOf(piece)).map((p) => p.id) : [])]);
  const db = await open();
  const tx = db.transaction(['pieces', 'pages', 'progress', 'attempts', 'time', 'recordings'], 'readwrite');
  tx.objectStore('recordings').delete(group);
  for (const id of ids) {
    tx.objectStore('pieces').delete(id);
    for (const store of ['pages', 'progress', 'attempts', 'time']) {
      const os = tx.objectStore(store);
      const keys = await done(os.index('pieceId').getAllKeys(id));
      keys.forEach((k) => os.delete(k));
    }
  }
  await finished(tx);
}

/* ---------- practice time ---------- */

// One record per piece per day. Each bar holds [single-bar, phrase, whole-piece] seconds,
// so the bar times always add up to the day's total.
const SLOT = { bar: 0, phrase: 1, piece: 2 };
let timeQueue = Promise.resolve();

export function addTime(pieceId, day, mode, barIds, seconds) {
  timeQueue = timeQueue.then(async () => {
    const key = `${pieceId}|${day}`;
    const doc = (await get('time', key)) || { key, pieceId, day, modes: { bar: 0, phrase: 0, piece: 0 }, bars: {} };
    doc.modes[mode] += seconds;
    const share = seconds / barIds.length;
    for (const id of barIds) {
      const row = doc.bars[id] || [0, 0, 0];
      row[SLOT[mode]] += share;
      doc.bars[id] = row;
    }
    await put('time', doc);
  }).catch((err) => console.error(err));
  return timeQueue;
}

export const timeSaved = () => timeQueue;
export const timeDocs = (pieceId) => byIndex('time', 'pieceId', pieceId);
export const dayTotal = (doc) => (doc ? doc.modes.bar + doc.modes.phrase + doc.modes.piece : 0);
export async function secondsOn(pieceId, day) {
  await timeQueue;
  return dayTotal(await get('time', `${pieceId}|${day}`));
}

/* ---------- backup ---------- */

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const fromDataUrl = async (url) => (await fetch(url)).blob();

export async function exportAll() {
  const pages = await all('pages');
  const out = {
    app: 'bar-by-bar',
    backupVersion: 1,
    savedAt: new Date().toISOString(),
    meta: await all('meta'),
    players: await all('players'),
    pieces: await all('pieces'),
    progress: await all('progress'),
    attempts: await all('attempts'),
    time: await all('time'),
    pages: [],
  };
  for (const p of pages) {
    const { blob, original, ...rest } = p;
    out.pages.push({ ...rest, data: await toDataUrl(blob) });
  }
  out.recordings = [];
  for (const r of await all('recordings')) {
    const { blob, peaks, onsets, strengths, ...rest } = r;
    out.recordings.push({ ...rest, data: await toDataUrl(blob), peaks: Array.from(peaks), onsets: Array.from(onsets), strengths: Array.from(strengths) });
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('This file is not a Bar by Bar backup.'); }
  if (data.app !== 'bar-by-bar' || data.backupVersion !== 1) throw new Error('This file is not a Bar by Bar backup.');
  const pages = [];
  for (const { data: url, ...rest } of data.pages) pages.push({ ...rest, blob: await fromDataUrl(url) });
  const recordings = [];
  for (const { data: url, peaks, onsets, strengths, ...rest } of data.recordings || []) {      // older backups have none
    recordings.push({
      ...rest, blob: await fromDataUrl(url), peaks: Uint8Array.from(peaks), onsets: Float32Array.from(onsets), strengths: Uint8Array.from(strengths),
    });
  }

  const db = await open();
  const stores = ['meta', 'players', 'pieces', 'pages', 'progress', 'attempts', 'time', 'recordings'];
  const tx = db.transaction(stores, 'readwrite');
  stores.forEach((s) => tx.objectStore(s).clear());
  data.meta.forEach((v) => tx.objectStore('meta').put(v));
  data.players.forEach((v) => tx.objectStore('players').put(v));
  data.pieces.forEach((v) => tx.objectStore('pieces').put(v));
  pages.forEach((v) => tx.objectStore('pages').put(v));
  data.progress.forEach((v) => tx.objectStore('progress').put(v));
  data.attempts.forEach((v) => tx.objectStore('attempts').put(v));
  (data.time || []).forEach((v) => tx.objectStore('time').put(v));     // older backups have none
  recordings.forEach((v) => tx.objectStore('recordings').put(v));
  await finished(tx);
}
