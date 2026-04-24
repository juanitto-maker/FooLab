// IndexedDB wrapper. Storage-agnostic interface — swap to Supabase in v2
// by rewriting this file only; callers stay identical.
//
// Record shape:
// { id, timestamp, photos: [Blob], thumbnail: Blob, result: {}, userNote: "" }

const DB_NAME = 'foolab';
const DB_VERSION = 1;
const STORE = 'scans';
const CAP = 50;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      return reject(new Error('IndexedDB is disabled in this browser. Archive will not work.'));
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open archive.'));
  });
  return dbPromise;
}

function tx(mode) {
  return openDB().then((db) => {
    const t = db.transaction(STORE, mode);
    return { store: t.objectStore(STORE), done: txDone(t) };
  });
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function save(record) {
  if (!record.id) record.id = cryptoId();
  if (!record.timestamp) record.timestamp = Date.now();

  const { store, done } = await tx('readwrite');
  store.put(record);
  await done;

  await trimToCap();
  return record;
}

export async function get(id) {
  const { store } = await tx('readonly');
  return reqPromise(store.get(id));
}

export async function list({ limit = CAP, offset = 0 } = {}) {
  const { store } = await tx('readonly');
  const index = store.index('timestamp');
  const results = [];
  return new Promise((resolve, reject) => {
    const req = index.openCursor(null, 'prev');
    let skipped = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || results.length >= limit) return resolve(results);
      if (skipped < offset) { skipped++; cursor.continue(); return; }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function remove(id) {
  const { store, done } = await tx('readwrite');
  store.delete(id);
  return done;
}

export async function clear() {
  const { store, done } = await tx('readwrite');
  store.clear();
  return done;
}

export async function count() {
  const { store } = await tx('readonly');
  return reqPromise(store.count());
}

async function trimToCap() {
  const total = await count();
  if (total <= CAP) return;

  const { store, done } = await tx('readwrite');
  const index = store.index('timestamp');
  const excess = total - CAP;
  let removed = 0;
  await new Promise((resolve, reject) => {
    const req = index.openCursor(null, 'next');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || removed >= excess) return resolve();
      cursor.delete();
      removed++;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  await done;
}

function cryptoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}
