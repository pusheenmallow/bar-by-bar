import { newId, makeAttempt, withAttemptDefaults, dayKey } from './model.js';
// Everything the app remembers lives in IndexedDB on this device.

const NAME = 'bar-by-bar';
const VERSION = 5;
let opened;

/* ---------- the shape of the database ---------- */
// Version 2 added `time`, version 3 `recordings`. Version 4 re-keyed `attempts`: see rekeyAttempts.
// Version 5 added `schedule` (when each bar is next due, for each learner) and `assignments`
// (what a teacher or parent set for the week). Both start empty: nothing already saved is changed.

function createAttempts(db) {
  const store = db.createObjectStore('attempts', { keyPath: 'id' });
  store.createIndex('pieceId', 'pieceId');
  store.createIndex('day', 'day');
  return store;
}

// Runs inside the upgrade. Anything thrown here, or any failed request, undoes the whole
// upgrade and leaves the database exactly as it was.
function upgrade(db, tx) {
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
  make('time', { keyPath: 'key' }, 'pieceId');
  make('recordings', { keyPath: 'pieceId' });
  make('schedule', { keyPath: 'key' }, 'pieceId');
  make('assignments', { keyPath: 'id' }, 'pieceId');
  if (!db.objectStoreNames.contains('attempts')) createAttempts(db);
  else rekeyAttempts(db, tx);
}

// Version 4. Attempts used to be numbered by the database, 1, 2, 3 and so on, which two
// devices could never agree on. Now each new attempt brings its own random id. The store has to
// be made again for that, so every old attempt is copied across. Old attempts keep the number
// they had, and gain a day, their player and the source 'legacy'. No other store is touched.
function rekeyAttempts(db, tx) {
  const old = tx.objectStore('attempts');
  if (!old.autoIncrement) {                              // already done: only make sure of the indexes
    for (const name of ['pieceId', 'day']) if (!old.indexNames.contains(name)) old.createIndex(name, name);
    return;
  }
  const safely = (work) => () => {
    try { work(); } catch (err) { console.warn('The attempts could not be moved, so the update was undone.', err); tx.abort(); }
  };
  const pieces = tx.objectStore('pieces').getAll();
  pieces.onsuccess = safely(() => {
    const playerOf = new Map(pieces.result.map((p) => [p.id, p.playerId]));
    const rows = old.getAll();
    rows.onsuccess = safely(() => {
      const moved = rows.result.map((a) => withAttemptDefaults(a, (pieceId) => playerOf.get(pieceId)));
      db.deleteObjectStore('attempts');
      const fresh = createAttempts(db);
      moved.forEach((a) => fresh.add(a));               // add, not put: two attempts can never share an id
    });
  });
}

function openAt(version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, version);
    req.onupgradeneeded = () => {
      try { upgrade(req.result, req.transaction); } catch (err) { console.warn(err); req.transaction.abort(); }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

// The database as it stands, without upgrading it. Null when this device has none yet.
function peek() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME);
    let none = false;
    req.onupgradeneeded = () => { none = true; req.transaction.abort(); };      // don't create an empty one here
    req.onsuccess = () => resolve(req.result);
    req.onerror = (event) => {
      if (!none) { reject(req.error); return; }
      event.preventDefault();
      resolve(null);
    };
  });
}

/* ---------- a backup before any upgrade ---------- */
// An upgrade can't be undone once it has finished. So when an older database is found, the app
// shell first has a backup file saved, and only then is the database opened at the new version.

let upgradeGate = null;
export function setUpgradeGate(gate) { upgradeGate = gate; }

async function backupBeforeUpgrade() {
  const db = await peek();
  if (!db) return false;
  try {
    if (db.version >= VERSION) return false;
    if (!upgradeGate) throw new Error('This data is from an older version of Bar by Bar. Open the app to update it.');
    await upgradeGate({
      from: db.version,
      makeBackup: async () => {
        const blob = await exportFrom(db);
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key: 'lastBackup', value: Date.now() });
        await finished(tx);
        return blob;
      },
    });
    return true;
  } finally {
    db.close();
  }
}

function open() {
  if (opened) return opened;
  const opening = (async () => {
    const upgrading = await backupBeforeUpgrade();
    try {
      return await openAt(VERSION);
    } catch (err) {
      if (!upgrading) throw err;
      const failure = new Error('The update could not finish, so nothing was changed.');
      failure.upgradeFailed = true;
      failure.cause = err;
      throw failure;
    }
  })();
  opened = opening;
  opening.catch(() => { if (opened === opening) opened = null; });       // the next call tries again
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

export async function scheduleMap(pieceId) {
  const rows = await byIndex('schedule', 'pieceId', pieceId);
  return new Map(rows.map((s) => [s.barId, s]));
}

// The assignment in force for one learner's piece, or null. Older ones are kept, marked done.
export async function currentAssignment(pieceId) {
  const list = (await byIndex('assignments', 'pieceId', pieceId)).filter((a) => a.status === 'current');
  return list.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

// Saves this week's assignment, and marks any earlier one for the same learner's piece as done.
export async function saveAssignment(assignment) {
  const db = await open();
  const tx = db.transaction('assignments', 'readwrite');
  const os = tx.objectStore('assignments');
  const others = await done(os.index('pieceId').getAll(assignment.pieceId));
  others.filter((a) => a.id !== assignment.id && a.status === 'current').forEach((a) => os.put({ ...a, status: 'done' }));
  os.put(assignment);
  await finished(tx);
  return assignment;
}

export const getMeta = async (key, fallback = null) => (await get('meta', key))?.value ?? fallback;
export const setMeta = (key, value) => put('meta', { key, value });

export async function progressMap(pieceId) {
  const rows = await byIndex('progress', 'pieceId', pieceId);
  return new Map(rows.map((p) => [p.barId, p]));
}

/* ---------- attempts ---------- */

// Saves one marked play. Saves wait their turn, so each one sees the plays before it.
let attemptQueue = Promise.resolve();

export function addAttempt(piece, details) {
  const job = attemptQueue.then(async () => {
    const earlier = await byIndex('attempts', 'pieceId', piece.id);
    return put('attempts', makeAttempt({ piece, ...details, earlier }));
  });
  attemptQueue = job.catch((err) => console.error(err));
  return job;
}

// Adds a grown-up's verdict to a saved attempt.
export function gradeAttempt(id, shadow) {
  const job = attemptQueue.then(async () => {
    const attempt = await get('attempts', id);
    if (attempt) await put('attempts', { ...attempt, shadow });
  });
  attemptQueue = job.catch((err) => console.error(err));
  return job;
}

export const attemptsSaved = () => attemptQueue;

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
  const tx = db.transaction(['pieces', 'progress', 'attempts', 'time', 'schedule', 'assignments'], 'readwrite');
  tx.objectStore('pieces').delete(pieceId);
  for (const store of ['progress', 'attempts', 'time', 'schedule', 'assignments']) {
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
  const tx = db.transaction(['pieces', 'pages', 'progress', 'attempts', 'time', 'recordings', 'schedule', 'assignments'], 'readwrite');
  tx.objectStore('recordings').delete(group);
  for (const id of ids) {
    tx.objectStore('pieces').delete(id);
    for (const store of ['pages', 'progress', 'attempts', 'time', 'schedule', 'assignments']) {
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

// What one player did on each day, over all their pieces: seconds practised, plays marked, and
// whether they finished that day's stops (a next-day check played to its end).
// Worked out from the time records and the attempts each time, so nothing extra is stored.
export async function playerDays(playerId) {
  await timeQueue;
  await attemptQueue;
  const days = new Map();
  const on = (day) => {
    if (!days.has(day)) days.set(day, { seconds: 0, plays: 0, stops: false });
    return days.get(day);
  };
  for (const piece of await byIndex('pieces', 'playerId', playerId)) {
    if (piece.draft) continue;
    for (const doc of await timeDocs(piece.id)) on(doc.day).seconds += dayTotal(doc);
    for (const a of await byIndex('attempts', 'pieceId', piece.id)) {
      const entry = on(a.day || dayKey(a.at));
      entry.plays += 1;
      if (a.stopsDone) entry.stops = true;
    }
  }
  return days;
}

/* ---------- backup ---------- */

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const fromDataUrl = async (url) => (await fetch(url)).blob();

// Version 2 added the extra fields on attempts. Version 3 added the schedule and the assignments.
// Older files still restore: version 1 with the attempt fields filled in, and both with no schedule.
const BACKUP_VERSION = 3;

export async function exportAll() {
  return exportFrom(await open());
}

// Reads whatever stores the database has, so it also works on an older one before its upgrade.
async function exportFrom(db) {
  const read = (name) => (db.objectStoreNames.contains(name) ? done(db.transaction(name).objectStore(name).getAll()) : []);
  const pages = await read('pages');
  const out = {
    app: 'bar-by-bar',
    backupVersion: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    meta: await read('meta'),
    players: await read('players'),
    pieces: await read('pieces'),
    progress: await read('progress'),
    attempts: await read('attempts'),
    time: await read('time'),
    schedule: await read('schedule'),
    assignments: await read('assignments'),
    pages: [],
  };
  for (const p of pages) {
    const { blob, original, ...rest } = p;
    out.pages.push({ ...rest, data: await toDataUrl(blob) });
  }
  out.recordings = [];
  for (const r of await read('recordings')) {
    const { blob, peaks, onsets, strengths, ...rest } = r;
    out.recordings.push({ ...rest, data: await toDataUrl(blob), peaks: Array.from(peaks), onsets: Array.from(onsets), strengths: Array.from(strengths) });
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('This file is not a Bar by Bar backup.'); }
  if (data?.app !== 'bar-by-bar' || !Number.isInteger(data.backupVersion) || data.backupVersion < 1) throw new Error('This file is not a Bar by Bar backup.');
  if (data.backupVersion > BACKUP_VERSION) throw new Error('This backup is from a newer version of Bar by Bar. Update the app, then restore it.');
  const playerOf = new Map(data.pieces.map((p) => [p.id, p.playerId]));
  const attempts = data.attempts.map((a) => withAttemptDefaults(a, (pieceId) => playerOf.get(pieceId)));
  const pages = [];
  for (const { data: url, ...rest } of data.pages) pages.push({ ...rest, blob: await fromDataUrl(url) });
  const recordings = [];
  for (const { data: url, peaks, onsets, strengths, ...rest } of data.recordings || []) {      // older backups have none
    recordings.push({
      ...rest, blob: await fromDataUrl(url), peaks: Uint8Array.from(peaks), onsets: Float32Array.from(onsets), strengths: Uint8Array.from(strengths),
    });
  }

  const db = await open();
  const stores = ['meta', 'players', 'pieces', 'pages', 'progress', 'attempts', 'time', 'recordings', 'schedule', 'assignments'];
  const tx = db.transaction(stores, 'readwrite');
  stores.forEach((s) => tx.objectStore(s).clear());
  data.meta.forEach((v) => tx.objectStore('meta').put(v));
  data.players.forEach((v) => tx.objectStore('players').put(v));
  data.pieces.forEach((v) => tx.objectStore('pieces').put(v));
  pages.forEach((v) => tx.objectStore('pages').put(v));
  data.progress.forEach((v) => tx.objectStore('progress').put(v));
  attempts.forEach((v) => tx.objectStore('attempts').put(v));
  (data.time || []).forEach((v) => tx.objectStore('time').put(v));     // older backups have none
  recordings.forEach((v) => tx.objectStore('recordings').put(v));
  (data.schedule || []).forEach((v) => tx.objectStore('schedule').put(v));          // files before version 3 have neither
  (data.assignments || []).forEach((v) => tx.objectStore('assignments').put(v));
  await finished(tx);
}
