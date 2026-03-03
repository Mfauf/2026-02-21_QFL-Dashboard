/**
 * sync.js — Local device-to-device data sync via PeerJS (WebRTC data channels).
 *
 * Each device has a unique UUID stored in IndexedDB ('meta' store, key 'deviceUID').
 * The PeerJS peer ID equals the device UID so the other device can connect by ID.
 *
 * Sync protocol
 * ─────────────
 *  Initiator (A)  calls connectAndSync(remotePeerId)
 *    → opens DataConnection to B
 *    → sends   { type:'SYNC_REQUEST',  data: { clients, projects, transactions, invoices } }
 *  Responder (B)  receives the request automatically via openPeer listener
 *    → merges A's data with its own (newest createdAt wins for duplicate IDs)
 *    → saves merged result
 *    → sends   { type:'SYNC_RESPONSE', data: mergedData }
 *  Initiator (A)  receives response
 *    → merges response with its current state
 *    → saves final merged result
 *
 *  Both devices now hold the union of all records.
 *  Dispatches window CustomEvent 'qfl:synced' on completion.
 *
 * Requirements
 * ────────────
 *  PeerJS CDN <script> must be loaded before this module runs.
 *  Both devices need internet access for PeerJS signalling (free cloud server).
 */

import { getAllRecords, clearStore, bulkPutRecords, getMetaValue, setMetaValue } from './db.js';
import { getSettings, saveSettings } from './settings-store.js';

const STORES = ['clients', 'projects', 'transactions', 'invoices', 'milestones', 'sessions', 'blueprintFeatures'];

/* ── Module-level singletons ────────────────────────────────────────────── */
let _peer = null;
let _uid  = null;

export function getPeer()  { return _peer; }
export function getUID()   { return _uid;  }

/* ── Device UID ─────────────────────────────────────────────────────────── */

/**
 * Returns the persisted device UID from IndexedDB, creating it on first call.
 * @returns {Promise<string>} UUID v4 string
 */
export async function getOrCreateUID() {
  if (_uid) return _uid;
  let uid = await getMetaValue('deviceUID');
  if (!uid) {
    uid = crypto.randomUUID();
    await setMetaValue('deviceUID', uid);
  }
  _uid = uid;
  return uid;
}

/* ── Data helpers ───────────────────────────────────────────────────────── */

async function exportAll() {
  const results = await Promise.all(STORES.map(s => getAllRecords(s)));
  const data = Object.fromEntries(STORES.map((s, i) => [s, results[i]]));

  // Include settings, stripping anything too large or device-specific
  const settings = getSettings();
  const { avatar: _avatar, ...profileWithoutAvatar } = settings.profile ?? {};
  const settingsToSync = {
    ...settings,
    profile: profileWithoutAvatar,   // avatar omitted — base64 is too large for P2P channel
    sync: { peerUID: '' },           // stripped — each device keeps its own
  };
  data._settings = settingsToSync;

  return data;
}

/**
 * Union-merge two full data snapshots.
 * For records with the same numeric id, the one with the newer createdAt wins.
 */
function mergeSnapshots(local, remote) {
  const merged = {};
  for (const store of STORES) {
    const map = new Map();
    for (const rec of (local[store]  ?? [])) map.set(rec.id, rec);
    for (const rec of (remote[store] ?? [])) {
      const existing = map.get(rec.id);
      if (!existing || (rec.createdAt ?? '') > (existing.createdAt ?? '')) {
        map.set(rec.id, rec);
      }
    }
    merged[store] = Array.from(map.values());
  }
  return merged;
}

/**
 * Apply an incoming snapshot: merge with local data, persist, return merged state.
 */
async function applyMerge(incoming) {
  const local  = await exportAll();
  const merged = mergeSnapshots(local, incoming);

  // Merge settings: incoming wins on profile/invoice/categories,
  // but local keeps its own appearance (theme) and sync (peerUID)
  if (incoming._settings) {
    const localSettings = getSettings();
    saveSettings({
      ...incoming._settings,
      profile:    { ...incoming._settings.profile, avatar: localSettings.profile?.avatar }, // keep local avatar
      appearance: localSettings.appearance,  // keep local theme pref
      sync:       localSettings.sync,        // keep local peerUID
    });
    // Notify any open settings page to re-populate its fields
    window.dispatchEvent(new CustomEvent('qfl:settings-synced'));
  }

  for (const store of STORES) {
    await clearStore(store);
    await bulkPutRecords(store, merged[store]);
  }
  return merged;
}

/* ── Responder: handle incoming connections ─────────────────────────────── */

function handleIncomingConnection(conn) {
  conn.on('data', async (msg) => {
    if (msg?.type !== 'SYNC_REQUEST') return;
    try {
      const merged = await applyMerge(msg.data);
      conn.send({ type: 'SYNC_RESPONSE', data: merged });
      window.dispatchEvent(new CustomEvent('qfl:synced', {
        detail: { role: 'responder', counts: STORES.map(s => merged[s].length) },
      }));
    } catch (err) {
      conn.send({ type: 'SYNC_ERROR', message: err.message });
    }
  });
  conn.on('error', (err) => console.error('[Sync] Incoming connection error:', err));
}

/* ── Peer lifecycle ─────────────────────────────────────────────────────── */

/**
 * Open (or reuse) a PeerJS peer registered with the device UID.
 * Also sets up the listener for incoming sync requests.
 *
 * @param {string}   uid        Device UID to register as the Peer ID
 * @param {function} onStatus   (message: string, type: 'ready'|'syncing'|'success'|'error') => void
 * @returns {Promise<Peer|null>}
 */
export function openPeer(uid, onStatus = () => {}) {
  return new Promise((resolve) => {
    // Reuse existing open peer
    if (_peer && !_peer.destroyed) {
      onStatus('Ready — waiting for connections', 'ready');
      resolve(_peer);
      return;
    }

    if (typeof window.Peer === 'undefined') {
      onStatus('PeerJS not loaded — check your internet connection', 'error');
      resolve(null);
      return;
    }

    _peer = new window.Peer(uid, { debug: 0 });

    _peer.on('open', () => {
      onStatus('Ready — waiting for connections', 'ready');
      resolve(_peer);
    });

    // Accept incoming sync requests from other devices
    _peer.on('connection', (conn) => handleIncomingConnection(conn));

    _peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Peer already registered (another tab). Still functional for outbound.
        onStatus('Ready (already open in another tab)', 'ready');
        resolve(null);
      } else {
        onStatus(`Peer error: ${err.message}`, 'error');
        resolve(null);
      }
    });

    _peer.on('disconnected', () => {
      // Auto-reconnect to signalling server
      if (_peer && !_peer.destroyed) _peer.reconnect();
    });
  });
}

export function destroyPeer() {
  if (_peer && !_peer.destroyed) _peer.destroy();
  _peer = null;
}

/* ── Initiator: connect and sync ────────────────────────────────────────── */

/**
 * Connect to a remote peer by ID and perform a full bidirectional sync.
 *
 * @param {string}   remotePeerId  The other device's UID
 * @param {function} onStatus      Status callback (message, type)
 * @returns {Promise<void>}
 */
export function connectAndSync(remotePeerId, onStatus = () => {}) {
  return new Promise((resolve, reject) => {
    if (!_peer || _peer.destroyed) {
      return reject(new Error('Peer not initialised. Open Settings and wait for "Ready".'));
    }

    onStatus('Connecting to peer…', 'syncing');

    const conn  = _peer.connect(remotePeerId.trim(), { reliable: true, serialization: 'json' });
    const timer = setTimeout(() => {
      conn.close();
      reject(new Error('Timed out. Make sure the other device has Settings open and is online.'));
    }, 25_000);

    conn.on('open', async () => {
      try {
        onStatus('Connected — sending local data…', 'syncing');
        const data = await exportAll();
        conn.send({ type: 'SYNC_REQUEST', data });
      } catch (err) {
        clearTimeout(timer);
        conn.close();
        reject(err);
      }
    });

    conn.on('data', async (msg) => {
      clearTimeout(timer);
      if (msg?.type === 'SYNC_ERROR') return reject(new Error(msg.message));
      if (msg?.type !== 'SYNC_RESPONSE') return;
      try {
        onStatus('Applying merged data…', 'syncing');
        await applyMerge(msg.data);
        conn.close();
        window.dispatchEvent(new CustomEvent('qfl:synced', {
          detail: { role: 'initiator' },
        }));
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    conn.on('error', (err) => { clearTimeout(timer); reject(err); });
    _peer.once('error',  (err) => { clearTimeout(timer); reject(err); });
  });
}
