/**
 * db.js — IndexedDB layer
 * Opens (or upgrades) the "QFLDashboard" database and exposes
 * generic CRUD helpers used by all modules.
 *
 * Schema
 * ──────
 *  clients      { id, name, company, email, phone, country, city, status, notes, createdAt }
 *  projects     { id, name, clientId, category, startDate, endDate, amount, hours, status, notes, createdAt }
 *  transactions { id, type('income'|'outcome'), projectId?, clientId?, category, amount, date, note, createdAt }
 *  invoices     { id, clientId, projectId?, number, amount, issuedAt, dueAt, status, notes, createdAt }
 *  milestones   { id, projectId, name, completed, createdAt }
 *  sessions     { id, projectId, milestoneId|null, name, durationSeconds, startedAt, endedAt, createdAt }
 *  blueprintFeatures { id, projectId, name, details, price, sortOrder, createdAt }
 */

const DB_NAME    = 'QFLDashboard';
const DB_VERSION = 5;

/** @type {IDBDatabase|null} */
let _db = null;

/* ── Open / init ────────────────────────────────────────────────────────── */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // Create (or upgrade) object stores on first run or version change
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('clients')) {
        const cs = db.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
        cs.createIndex('name',   'name',   { unique: false });
        cs.createIndex('email',  'email',  { unique: false });
        cs.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('clientId', 'clientId', { unique: false });
        ps.createIndex('status',   'status',   { unique: false });
      }

      if (!db.objectStoreNames.contains('transactions')) {
        const ts = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        ts.createIndex('type',      'type',      { unique: false });
        ts.createIndex('projectId', 'projectId', { unique: false });
        ts.createIndex('clientId',  'clientId',  { unique: false });
        ts.createIndex('date',      'date',      { unique: false });
      }

      if (!db.objectStoreNames.contains('invoices')) {
        const is = db.createObjectStore('invoices', { keyPath: 'id', autoIncrement: true });
        is.createIndex('clientId', 'clientId', { unique: false });
        is.createIndex('status',   'status',   { unique: false });
      }

      // v2: key-value meta store (device UID, etc.)
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }

      // v3: project milestones
      if (!db.objectStoreNames.contains('milestones')) {
        const ms = db.createObjectStore('milestones', { keyPath: 'id', autoIncrement: true });
        ms.createIndex('projectId', 'projectId', { unique: false });
      }

      // v4: time-tracking sessions
      if (!db.objectStoreNames.contains('sessions')) {
        const ss = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        ss.createIndex('projectId',   'projectId',   { unique: false });
        ss.createIndex('milestoneId', 'milestoneId', { unique: false });
      }

      // v5: project blueprint features/services
      if (!db.objectStoreNames.contains('blueprintFeatures')) {
        const bf = db.createObjectStore('blueprintFeatures', { keyPath: 'id', autoIncrement: true });
        bf.createIndex('projectId', 'projectId', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => {
      console.error('[DB] Failed to open:', e.target.error);
      reject(e.target.error);
    };
  });
}

/* ── Generic helpers ────────────────────────────────────────────────────── */

/**
 * Wraps an IDBRequest in a Promise.
 * @param {IDBRequest} req
 */
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Returns a read-write transaction + object store for a given store name.
 * @param {string} storeName
 * @param {'readonly'|'readwrite'} mode
 */
function getStore(storeName, mode = 'readonly') {
  const tx = _db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

/* ── CRUD ───────────────────────────────────────────────────────────────── */

/**
 * Insert a new record. Automatically adds `createdAt` timestamp.
 * @param {string} storeName
 * @param {object} data
 * @returns {Promise<number>} new record id
 */
export async function addRecord(storeName, data) {
  const db  = await openDB();
  const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
  const now = new Date().toISOString();
  const record = { ...data, createdAt: now, updatedAt: now, isDeleted: false };
  return promisify(store.add(record));
}

/**
 * Retrieve a single record by primary key.
 * @param {string} storeName
 * @param {number} id
 * @returns {Promise<object|undefined>}
 */
export async function getRecord(storeName, id) {
  const db = await openDB();
  return promisify(db.transaction(storeName).objectStore(storeName).get(id));
}

/**
 * Retrieve all records from a store as an array (newest first by createdAt).
 * @param {string} storeName
 * @returns {Promise<object[]>}
 */
export async function getAllRecords(storeName) {
  const db = await openDB();
  const records = await promisify(db.transaction(storeName).objectStore(storeName).getAll());
  // Filter out soft-deleted records, then sort newest first by createdAt
  return records
    .filter(r => !r.isDeleted)
    .sort((a, b) => {
      if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt);
      return (b.id ?? 0) - (a.id ?? 0);
    });
}

/**
 * Update an existing record (merges partial data with existing record).
 * @param {string} storeName
 * @param {number} id
 * @param {object} updates
 * @returns {Promise<void>}
 */
export async function updateRecord(storeName, id, updates) {
  const db = await openDB();
  const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
  const existing = await promisify(store.get(id));
  if (!existing) throw new Error(`[DB] Record id=${id} not found in "${storeName}"`);
  return promisify(store.put({ ...existing, ...updates, id, updatedAt: new Date().toISOString() }));
}

/**
 * Delete a record by primary key.
 * @param {string} storeName
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteRecord(storeName, id) {
  const db    = await openDB();
  const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
  const existing = await promisify(store.get(id));
  if (!existing) return;   // already gone — nothing to do
  // Soft delete: keep the record so the tombstone propagates during sync
  return promisify(store.put({ ...existing, id, isDeleted: true, updatedAt: new Date().toISOString() }));
}

/**
 * Count total records in a store.
 * @param {string} storeName
 * @returns {Promise<number>}
 */
export async function countRecords(storeName) {
  const db = await openDB();
  return promisify(db.transaction(storeName).objectStore(storeName).count());
}

/**
 * Retrieve all records matching a specific index value.
 * @param {string} storeName
 * @param {string} indexName
 * @param {IDBValidKey} value
 * @returns {Promise<object[]>}
 */
export async function getByIndex(storeName, indexName, value) {
  const db = await openDB();
  const store = db.transaction(storeName).objectStore(storeName);
  const index = store.index(indexName);
  const all = await promisify(index.getAll(value));
  return all.filter(r => !r.isDeleted);
}

/**
 * Retrieve ALL records from a store with NO isDeleted filter.
 * Used by the sync layer so soft-deleted tombstones propagate to peers.
 * @param {string} storeName
 * @returns {Promise<object[]>}
 */
export async function getAllRecordsRaw(storeName) {
  const db = await openDB();
  const records = await promisify(db.transaction(storeName).objectStore(storeName).getAll());
  return records.sort((a, b) => {
    if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return (b.id ?? 0) - (a.id ?? 0);
  });
}

/**
 * Physically remove a record from IndexedDB (no tombstone left behind).
 * Called only by garbageCollect after tombstones have aged out.
 * @param {string} storeName
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function hardDeleteRecord(storeName, id) {
  const db    = await openDB();
  const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
  return promisify(store.delete(id));
}

/**
 * Garbage-collect old soft-deleted records (runs at most once per month).
 *
 * Any record with isDeleted=true whose updatedAt is older than 30 days is
 * assumed to have already propagated to all peers and is physically removed.
 * The last-run timestamp is persisted in the meta store under 'lastGCAt'.
 *
 * @returns {Promise<void>}
 */
export async function garbageCollect() {
  const GC_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const GC_AGE_MS      = 30 * 24 * 60 * 60 * 1000; // purge tombstones older than 30 days

  const lastGCAt = await getMetaValue('lastGCAt');
  const now      = Date.now();

  if (lastGCAt && now - new Date(lastGCAt).getTime() < GC_INTERVAL_MS) {
    return; // not due yet
  }

  const cutoff  = new Date(now - GC_AGE_MS).toISOString();
  const STORES  = ['clients', 'projects', 'transactions', 'invoices', 'milestones', 'sessions', 'blueprintFeatures'];
  let   purged  = 0;

  for (const storeName of STORES) {
    const all = await getAllRecordsRaw(storeName);
    for (const rec of all) {
      if (rec.isDeleted && (rec.updatedAt ?? rec.createdAt ?? '') < cutoff) {
        await hardDeleteRecord(storeName, rec.id);
        purged++;
      }
    }
  }

  await setMetaValue('lastGCAt', new Date().toISOString());
  if (purged > 0) console.log(`[DB] garbageCollect: purged ${purged} stale tombstone(s).`);
}

/**
 * Clear ALL records from a store (keeps the store itself and its indexes).
 * @param {string} storeName
 * @returns {Promise<void>}
 */
export async function clearStore(storeName) {
  const db = await openDB();
  return promisify(db.transaction(storeName, 'readwrite').objectStore(storeName).clear());
}

/**
 * Insert an array of records into a store in a single transaction.
 * Each record has its `id` stripped so auto-increment assigns new IDs.
 * @param {string} storeName
 * @param {object[]} records
 * @returns {Promise<void>}
 */
export async function bulkAddRecords(storeName, records) {
  if (!records?.length) return;
  const db  = await openDB();
  const tx  = db.transaction(storeName, 'readwrite');
  const st  = tx.objectStore(storeName);
  for (const rec of records) {
    const { id, ...rest } = rec;   // drop old id; let auto-increment assign new one
    st.add(rest);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}

/**
 * Insert/replace an array of records preserving their original IDs.
 * Used by sync to restore records without losing cross-store foreign-key references.
 * @param {string} storeName
 * @param {object[]} records
 * @returns {Promise<void>}
 */
export async function bulkPutRecords(storeName, records) {
  if (!records?.length) return;
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const st = tx.objectStore(storeName);
  for (const rec of records) st.put(rec);  // put preserves id
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}

/**
 * Read a value from the meta key-value store.
 * @param {string} key
 * @returns {Promise<any|undefined>}
 */
export async function getMetaValue(key) {
  const db  = await openDB();
  const row = await promisify(db.transaction('meta').objectStore('meta').get(key));
  return row?.value;
}

/**
 * Write a value to the meta key-value store.
 * @param {string} key
 * @param {any}    value
 * @returns {Promise<void>}
 */
export async function setMetaValue(key, value) {
  const db = await openDB();
  await promisify(db.transaction('meta', 'readwrite').objectStore('meta').put({ key, value }));
}
