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
  const db = await openDB();
  const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
  const record = { ...data, createdAt: new Date().toISOString() };
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
  // Sort newest first by createdAt (falls back to id desc)
  return records.sort((a, b) => {
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
  return promisify(store.put({ ...existing, ...updates, id }));
}

/**
 * Delete a record by primary key.
 * @param {string} storeName
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteRecord(storeName, id) {
  const db = await openDB();
  const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
  return promisify(store.delete(id));
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
  return promisify(index.getAll(value));
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
