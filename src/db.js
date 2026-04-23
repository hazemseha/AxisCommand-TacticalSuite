/**
 * db.js — IndexedDB wrapper using idb for pin & video storage
 * V6: Sync-Ready Architecture
 *   - Stable UUID v4 IDs (device-independent)
 *   - updatedAt timestamps on every write
 *   - deviceId provenance tracking
 *   - Soft deletes (tombstones) for sync propagation
 *   - Delta queries via getUpdatesSince()
 *   - All sensitive data encrypted with AES-256-GCM
 */
import { openDB } from 'idb';
import { encryptFields, decryptFields, isEncryptionActive } from './crypto.js';

const DB_NAME = 'PinVaultDB';
const DB_VERSION = 6; // V6: Sync-ready schema (updatedAt index, soft deletes)

let dbPromise;

// ===== DEVICE IDENTITY =====
// Persistent device ID generated once on first launch.
// Survives page reloads and app updates. Used for sync provenance tracking.

const DEVICE_ID_KEY = 'pinvault_device_id';

function _generateUUIDv4() {
  // Crypto-strong UUID v4
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let _deviceId = null;

/**
 * Returns the stable device ID for this installation.
 * Generated once, persisted in localStorage forever.
 * @returns {string}
 */
export function getDeviceId() {
  if (_deviceId) return _deviceId;
  _deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!_deviceId) {
    _deviceId = _generateUUIDv4();
    localStorage.setItem(DEVICE_ID_KEY, _deviceId);
    console.log(`[DB] New device ID generated: ${_deviceId}`);
  }
  return _deviceId;
}

// ===== DATABASE SETUP =====

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        // Pins store
        if (!db.objectStoreNames.contains('pins')) {
          const pinStore = db.createObjectStore('pins', { keyPath: 'id' });
          pinStore.createIndex('by-date', 'createdAt');
          pinStore.createIndex('by-name', 'name');
        }
        // Videos store (binary blobs)
        if (!db.objectStoreNames.contains('videos')) {
          const videoStore = db.createObjectStore('videos', { keyPath: 'id' });
          videoStore.createIndex('by-pin', 'pinId');
        }
        // Tiles store (offline map tiles)
        if (!db.objectStoreNames.contains('tiles')) {
          db.createObjectStore('tiles', { keyPath: 'url' });
        }
        // Features (Geoman integration for V3)
        if (!db.objectStoreNames.contains('routes')) {
          const routeStore = db.createObjectStore('routes', { keyPath: 'id' });
          routeStore.createIndex('by-folder', 'folderId');
        }
        if (!db.objectStoreNames.contains('zones')) {
          const zoneStore = db.createObjectStore('zones', { keyPath: 'id' });
          zoneStore.createIndex('by-folder', 'folderId');
        }
        // Hierarchy Structure
        if (!db.objectStoreNames.contains('folders')) {
          const folderStore = db.createObjectStore('folders', { keyPath: 'id' });
          folderStore.createIndex('by-parent', 'parentId');
        }
        // Professional Icon Library (V4)
        if (!db.objectStoreNames.contains('tacticalIcons')) {
          db.createObjectStore('tacticalIcons', { keyPath: 'id' });
        }
        
        // V5: Add userId index for multi-user data isolation
        if (oldVersion < 5) {
          const stores = ['pins', 'routes', 'zones', 'folders'];
          for (const name of stores) {
            if (db.objectStoreNames.contains(name)) {
              const store = transaction.objectStore(name);
              if (!store.indexNames.contains('by-userId')) {
                store.createIndex('by-userId', 'userId');
              }
            }
          }
        }

        // V6: Add updatedAt index for delta sync queries
        if (oldVersion < 6) {
          const syncStores = ['pins', 'routes', 'zones', 'folders'];
          for (const name of syncStores) {
            if (db.objectStoreNames.contains(name)) {
              const store = transaction.objectStore(name);
              if (!store.indexNames.contains('by-updatedAt')) {
                store.createIndex('by-updatedAt', 'updatedAt');
              }
            }
          }
        }
      }
    });
  }
  return dbPromise;
}

// ===== TACTICAL ICON OPERATIONS =====

export async function getAllTacticalIcons() {
  const db = await getDB();
  return db.getAll('tacticalIcons');
}

export async function saveTacticalIcon(icon) {
  const db = await getDB();
  return db.put('tacticalIcons', icon);
}

export async function deleteTacticalIcon(id) {
  const db = await getDB();
  return db.delete('tacticalIcons', id);
}

// ===== CURRENT USER ID =====
// Get userId from current logged-in user (hash of username for uniqueness)
export function getCurrentUserId() {
  try {
    const authData = localStorage.getItem('pinvault_auth');
    if (!authData) return 'default';
    const parsed = JSON.parse(authData);
    // Use name + createdAt as unique user identifier
    return parsed.name + '_' + (parsed.createdAt || '0');
  } catch(e) {
    return 'default';
  }
}

// Sensitive fields to encrypt per store type
const PIN_ENCRYPTED_FIELDS = ['name', 'notes', 'description', 'iconUrl'];
const ROUTE_ENCRYPTED_FIELDS = ['name', 'notes'];
const ZONE_ENCRYPTED_FIELDS = ['name', 'notes'];

// ===== SYNC METADATA INJECTION =====
// Every write operation stamps records with provenance data.

/**
 * Injects sync metadata into a record before saving.
 * - updatedAt: current Unix timestamp (ms)
 * - deviceId: this installation's unique ID
 * - createdAt: set only on first creation
 * @param {Object} record
 * @returns {Object} record with metadata injected (mutated in place)
 */
function stampRecord(record) {
  const now = Date.now();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;
  record.deviceId = record.deviceId || getDeviceId();
  return record;
}

// ===== PIN OPERATIONS =====

export async function getAllPins() {
  const db = await getDB();
  const allPins = await db.getAll('pins');
  const userId = getCurrentUserId();
  
  // Auto-tag any untagged legacy pins with current user (one-time migration)
  const untagged = allPins.filter(p => !p.userId);
  if (untagged.length > 0) {
    const tx = db.transaction('pins', 'readwrite');
    for (const p of untagged) {
      p.userId = userId;
      tx.objectStore('pins').put(p);
    }
    await tx.done;
  }
  
  // STRICT: Only show this user's LIVE data (filter tombstones)
  const userPins = allPins.filter(p => (p.userId || userId) === userId && !p.deleted);
  if (!isEncryptionActive()) return userPins;
  return Promise.all(userPins.map(p => decryptFields(p, PIN_ENCRYPTED_FIELDS)));
}

export async function getPin(id) {
  const db = await getDB();
  const pin = await db.get('pins', id);
  if (!pin || !isEncryptionActive()) return pin;
  return decryptFields(pin, PIN_ENCRYPTED_FIELDS);
}

export async function savePin(pin) {
  const db = await getDB();
  // Tag with current userId + sync metadata
  pin.userId = pin.userId || getCurrentUserId();
  stampRecord(pin);
  const toSave = isEncryptionActive()
    ? await encryptFields(pin, PIN_ENCRYPTED_FIELDS)
    : pin;
  return db.put('pins', toSave);
}

/**
 * Soft-delete a pin: sets deleted=true, updates timestamp.
 * Record remains in IndexedDB for sync tombstone propagation.
 * Associated videos are hard-deleted (binary blobs not synced).
 */
export async function deletePin(id) {
  const db = await getDB();
  const pin = await db.get('pins', id);
  if (pin) {
    pin.deleted = true;
    pin.updatedAt = Date.now();
    pin.deviceId = getDeviceId();
    await db.put('pins', pin);
  }
  // Hard-delete videos (binary data, not synced)
  const videos = await getVideosByPin(id);
  if (videos.length > 0) {
    const tx = db.transaction('videos', 'readwrite');
    for (const video of videos) {
      tx.objectStore('videos').delete(video.id);
    }
    await tx.done;
  }
}

// ===== ROUTES & ZONES OPERATIONS =====

export async function getAllRoutes() {
  const db = await getDB();
  const allRoutes = await db.getAll('routes');
  const userId = getCurrentUserId();
  
  const untagged = allRoutes.filter(r => !r.userId);
  if (untagged.length > 0) {
    const tx = db.transaction('routes', 'readwrite');
    for (const r of untagged) { r.userId = userId; tx.objectStore('routes').put(r); }
    await tx.done;
  }
  
  // Filter tombstones from UI-facing queries
  const userRoutes = allRoutes.filter(r => (r.userId || userId) === userId && !r.deleted);
  if (!isEncryptionActive()) return userRoutes;
  return Promise.all(userRoutes.map(r => decryptFields(r, ROUTE_ENCRYPTED_FIELDS)));
}

export async function saveRoute(route) {
  const db = await getDB();
  route.userId = route.userId || getCurrentUserId();
  stampRecord(route);
  const toSave = isEncryptionActive()
    ? await encryptFields(route, ROUTE_ENCRYPTED_FIELDS)
    : route;
  return db.put('routes', toSave);
}

export async function deleteRoute(id) {
  const db = await getDB();
  const route = await db.get('routes', id);
  if (route) {
    route.deleted = true;
    route.updatedAt = Date.now();
    route.deviceId = getDeviceId();
    await db.put('routes', route);
  } else {
    // Record doesn't exist locally — create tombstone
    await db.put('routes', {
      id, deleted: true, updatedAt: Date.now(),
      deviceId: getDeviceId(), userId: getCurrentUserId()
    });
  }
}

export async function getAllZones() {
  const db = await getDB();
  const allZones = await db.getAll('zones');
  const userId = getCurrentUserId();
  
  const untagged = allZones.filter(z => !z.userId);
  if (untagged.length > 0) {
    const tx = db.transaction('zones', 'readwrite');
    for (const z of untagged) { z.userId = userId; tx.objectStore('zones').put(z); }
    await tx.done;
  }
  
  const userZones = allZones.filter(z => (z.userId || userId) === userId && !z.deleted);
  if (!isEncryptionActive()) return userZones;
  return Promise.all(userZones.map(z => decryptFields(z, ZONE_ENCRYPTED_FIELDS)));
}

export async function saveZone(zone) {
  const db = await getDB();
  zone.userId = zone.userId || getCurrentUserId();
  stampRecord(zone);
  const toSave = isEncryptionActive()
    ? await encryptFields(zone, ZONE_ENCRYPTED_FIELDS)
    : zone;
  return db.put('zones', toSave);
}

export async function deleteZone(id) {
  const db = await getDB();
  const zone = await db.get('zones', id);
  if (zone) {
    zone.deleted = true;
    zone.updatedAt = Date.now();
    zone.deviceId = getDeviceId();
    await db.put('zones', zone);
  } else {
    await db.put('zones', {
      id, deleted: true, updatedAt: Date.now(),
      deviceId: getDeviceId(), userId: getCurrentUserId()
    });
  }
}

// ===== FOLDERS OPERATIONS =====

export async function getAllFolders() {
  const db = await getDB();
  const allFolders = await db.getAll('folders');
  const userId = getCurrentUserId();
  
  const untagged = allFolders.filter(f => !f.userId);
  if (untagged.length > 0) {
    const tx = db.transaction('folders', 'readwrite');
    for (const f of untagged) { f.userId = userId; tx.objectStore('folders').put(f); }
    await tx.done;
  }
  
  // Filter tombstones
  return allFolders.filter(f => (f.userId || userId) === userId && !f.deleted);
}

export async function saveFolder(folder) {
  const db = await getDB();
  folder.userId = folder.userId || getCurrentUserId();
  stampRecord(folder);
  return db.put('folders', folder);
}

export async function deleteFolder(id) {
  const db = await getDB();
  const folder = await db.get('folders', id);
  if (folder) {
    folder.deleted = true;
    folder.updatedAt = Date.now();
    folder.deviceId = getDeviceId();
    await db.put('folders', folder);
  } else {
    await db.put('folders', {
      id, deleted: true, updatedAt: Date.now(),
      deviceId: getDeviceId(), userId: getCurrentUserId()
    });
  }
}

// ===== VIDEO OPERATIONS =====
// Videos are binary blobs — NOT synced, always hard-deleted.

export async function getVideosByPin(pinId) {
  const db = await getDB();
  return db.getAllFromIndex('videos', 'by-pin', pinId);
}

export async function getVideo(id) {
  const db = await getDB();
  return db.get('videos', id);
}

export async function saveVideo(videoRecord) {
  const db = await getDB();
  return db.put('videos', videoRecord);
}

export async function deleteVideo(id) {
  const db = await getDB();
  return db.delete('videos', id);
}

export async function getAllVideos() {
  const db = await getDB();
  return db.getAll('videos');
}

// ===== UTILITY =====

/**
 * Generate a stable UUID v4 identifier.
 * Unlike the old Date.now()-based ID, this is device-independent
 * and will not collide across devices during sync.
 */
export function generateId() {
  return _generateUUIDv4();
}

// ===== DELTA SYNC QUERIES =====

/**
 * Returns all records (including tombstones) modified after the given timestamp.
 * This is the core primitive for delta/incremental sync.
 * 
 * @param {number} sinceTimestamp — Unix timestamp (ms). Pass 0 for full dump.
 * @param {string} [userId] — optional user filter (defaults to current user)
 * @returns {Promise<{pins: Array, routes: Array, zones: Array, folders: Array, deviceId: string, timestamp: number}>}
 */
export async function getUpdatesSince(sinceTimestamp, userId) {
  const db = await getDB();
  const uid = userId || getCurrentUserId();
  
  // Use IDBKeyRange.lowerBound to query only records with updatedAt > sinceTimestamp
  const range = sinceTimestamp > 0
    ? IDBKeyRange.lowerBound(sinceTimestamp, true) // exclusive lower bound
    : undefined; // no range = get everything
  
  const stores = ['pins', 'routes', 'zones', 'folders'];
  const result = { pins: [], routes: [], zones: [], folders: [] };
  
  for (const storeName of stores) {
    let records;
    if (range) {
      records = await db.getAllFromIndex(storeName, 'by-updatedAt', range);
    } else {
      records = await db.getAll(storeName);
    }
    
    // Filter by user — include tombstones (deleted: true) for sync propagation
    result[storeName] = records.filter(r => (r.userId || uid) === uid);
  }
  
  return {
    ...result,
    deviceId: getDeviceId(),
    timestamp: Date.now()
  };
}

/**
 * Returns the last sync timestamp for a given peer device.
 * Stored in localStorage to survive IndexedDB clears.
 * @param {string} peerDeviceId
 * @returns {number} Unix timestamp (ms), or 0 if never synced
 */
export function getLastSyncTime(peerDeviceId) {
  try {
    return parseInt(localStorage.getItem(`pinvault_sync_${peerDeviceId}`) || '0', 10);
  } catch (e) {
    return 0;
  }
}

/**
 * Records the sync completion time for a peer device.
 * @param {string} peerDeviceId
 * @param {number} [timestamp] — defaults to now
 */
export function setLastSyncTime(peerDeviceId, timestamp) {
  localStorage.setItem(`pinvault_sync_${peerDeviceId}`, String(timestamp || Date.now()));
}

/**
 * Applies a batch of resolved records to the local database.
 * Used by the sync engine after conflict resolution.
 * Writes records directly — no stampRecord() applied (remote provenance preserved).
 * 
 * @param {Object} resolved — { pins: [], routes: [], zones: [], folders: [] }
 * @returns {Promise<{pins: number, routes: number, zones: number, folders: number}>}
 */
export async function applyResolvedRecords(resolved) {
  const db = await getDB();
  const counts = { pins: 0, routes: 0, zones: 0, folders: 0 };
  
  const tx = db.transaction(['pins', 'routes', 'zones', 'folders'], 'readwrite');
  
  for (const pin of (resolved.pins || [])) {
    tx.objectStore('pins').put(pin);
    counts.pins++;
  }
  for (const route of (resolved.routes || [])) {
    tx.objectStore('routes').put(route);
    counts.routes++;
  }
  for (const zone of (resolved.zones || [])) {
    tx.objectStore('zones').put(zone);
    counts.zones++;
  }
  for (const folder of (resolved.folders || [])) {
    tx.objectStore('folders').put(folder);
    counts.folders++;
  }
  
  await tx.done;
  return counts;
}

/**
 * Purge tombstones older than the given age.
 * Call periodically (e.g., on app boot) to prevent unbounded growth.
 * @param {number} [maxAgeMs=604800000] — default 7 days
 */
export async function purgeTombstones(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const db = await getDB();
  const cutoff = Date.now() - maxAgeMs;
  const stores = ['pins', 'routes', 'zones', 'folders'];
  
  let purged = 0;
  for (const storeName of stores) {
    const tx = db.transaction(storeName, 'readwrite');
    const all = await tx.objectStore(storeName).getAll();
    for (const rec of all) {
      if (rec.deleted && rec.updatedAt && rec.updatedAt < cutoff) {
        tx.objectStore(storeName).delete(rec.id);
        purged++;
      }
    }
    await tx.done;
  }
  
  if (purged > 0) {
    console.log(`[DB] Purged ${purged} tombstones older than ${Math.round(maxAgeMs / 86400000)}d`);
  }
  return purged;
}

// ===== TILE OPERATIONS =====

export async function saveTile(tileRecord) {
  const db = await getDB();
  return db.put('tiles', tileRecord);
}

export async function getTile(url) {
  const db = await getDB();
  return db.get('tiles', url);
}

export async function getTileCount() {
  const db = await getDB();
  return db.count('tiles');
}

export async function clearAllTiles() {
  const db = await getDB();
  return db.clear('tiles');
}

/**
 * Cascade batch delete — now uses soft deletes for syncable stores.
 * Videos are still hard-deleted (binary, not synced).
 */
export async function cascadeBatchDelete(folderIds, pinIds, routeIds, zoneIds) {
  const db = await getDB();
  const now = Date.now();
  const devId = getDeviceId();
  
  const tx = db.transaction(['folders', 'pins', 'routes', 'zones', 'videos'], 'readwrite');
  
  // Soft-delete folders
  for (const id of folderIds) {
    const rec = await tx.objectStore('folders').get(id);
    if (rec) {
      rec.deleted = true;
      rec.updatedAt = now;
      rec.deviceId = devId;
      tx.objectStore('folders').put(rec);
    }
  }
  
  // Soft-delete pins + hard-delete their videos
  const videoIndex = tx.objectStore('videos').index('by-pin');
  for (const id of pinIds) {
    const rec = await tx.objectStore('pins').get(id);
    if (rec) {
      rec.deleted = true;
      rec.updatedAt = now;
      rec.deviceId = devId;
      tx.objectStore('pins').put(rec);
    }
    let vKeys = await videoIndex.getAllKeys(id);
    for (const vk of vKeys) tx.objectStore('videos').delete(vk);
  }
  
  // Soft-delete routes
  for (const id of routeIds) {
    const rec = await tx.objectStore('routes').get(id);
    if (rec) {
      rec.deleted = true;
      rec.updatedAt = now;
      rec.deviceId = devId;
      tx.objectStore('routes').put(rec);
    }
  }
  
  // Soft-delete zones
  for (const id of zoneIds) {
    const rec = await tx.objectStore('zones').get(id);
    if (rec) {
      rec.deleted = true;
      rec.updatedAt = now;
      rec.deviceId = devId;
      tx.objectStore('zones').put(rec);
    }
  }
  
  await tx.done;
}

// Persist storage
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}
