// Everything the app remembers lives in IndexedDB on this device.

const NAME = 'bar-by-bar';
const VERSION = 1;
let opened;

function open() {
  if (opened) return opened;
  opened = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('players', { keyPath: 'id' });
      db.createObjectStore('pieces', { keyPath: 'id' }).createIndex('playerId', 'playerId');
      db.createObjectStore('pages', { keyPath: 'id' }).createIndex('pieceId', 'pieceId');
      db.createObjectStore('progress', { keyPath: 'key' }).createIndex('pieceId', 'pieceId');
      db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true }).createIndex('pieceId', 'pieceId');
    };
    req.onsuccess = () => resolve(req.result);
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

export async function deletePiece(pieceId) {
  const db = await open();
  const tx = db.transaction(['pieces', 'pages', 'progress', 'attempts'], 'readwrite');
  tx.objectStore('pieces').delete(pieceId);
  for (const [store, index] of [['pages', 'pieceId'], ['progress', 'pieceId'], ['attempts', 'pieceId']]) {
    const os = tx.objectStore(store);
    const keys = await done(os.index(index).getAllKeys(pieceId));
    keys.forEach((k) => os.delete(k));
  }
  await finished(tx);
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
    pages: [],
  };
  for (const p of pages) {
    const { blob, original, ...rest } = p;
    out.pages.push({ ...rest, data: await toDataUrl(blob) });
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('This file is not a Bar by Bar backup.'); }
  if (data.app !== 'bar-by-bar' || data.backupVersion !== 1) throw new Error('This file is not a Bar by Bar backup.');
  const pages = [];
  for (const { data: url, ...rest } of data.pages) pages.push({ ...rest, blob: await fromDataUrl(url) });

  const db = await open();
  const stores = ['meta', 'players', 'pieces', 'pages', 'progress', 'attempts'];
  const tx = db.transaction(stores, 'readwrite');
  stores.forEach((s) => tx.objectStore(s).clear());
  data.meta.forEach((v) => tx.objectStore('meta').put(v));
  data.players.forEach((v) => tx.objectStore('players').put(v));
  data.pieces.forEach((v) => tx.objectStore('pieces').put(v));
  pages.forEach((v) => tx.objectStore('pages').put(v));
  data.progress.forEach((v) => tx.objectStore('progress').put(v));
  data.attempts.forEach((v) => tx.objectStore('attempts').put(v));
  await finished(tx);
}
