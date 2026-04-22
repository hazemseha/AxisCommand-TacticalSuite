/**
 * db.js — IndexedDB wrapper using idb for pin & video storage
 * All sensitive data is encrypted with AES-256-GCM before storage.
 */
import { openDB } from 'idb';
import { encryptFields, decryptFields, isEncryptionActive } from './crypto.js';

const DB_NAME = 'PinVaultDB';
const DB_VERSION = 5; // V5: Added userId index for multi-user isolation

let dbPromise;

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
  
  // STRICT: Only show this user's data
  const userPins = allPins.filter(p => (p.userId || userId) === userId);
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
  // Tag with current userId
  pin.userId = pin.userId || getCurrentUserId();
  const toSave = isEncryptionActive()
    ? await encryptFields(pin, PIN_ENCRYPTED_FIELDS)
    : pin;
  return db.put('pins', toSave);
}

export async function deletePin(id) {
  const db = await getDB();
  // Delete all videos for this pin
  const videos = await getVideosByPin(id);
  const tx = db.transaction(['pins', 'videos'], 'readwrite');
  tx.objectStore('pins').delete(id);
  for (const video of videos) {
    tx.objectStore('videos').delete(video.id);
  }
  await tx.done;
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
  
  const userRoutes = allRoutes.filter(r => (r.userId || userId) === userId);
  if (!isEncryptionActive()) return userRoutes;
  return Promise.all(userRoutes.map(r => decryptFields(r, ROUTE_ENCRYPTED_FIELDS)));
}
export async function saveRoute(route) {
  const db = await getDB();
  route.userId = route.userId || getCurrentUserId();
  const toSave = isEncryptionActive()
    ? await encryptFields(route, ROUTE_ENCRYPTED_FIELDS)
    : route;
  return db.put('routes', toSave);
}
export async function deleteRoute(id) {
  const db = await getDB();
  return db.delete('routes', id);
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
  
  const userZones = allZones.filter(z => (z.userId || userId) === userId);
  if (!isEncryptionActive()) return userZones;
  return Promise.all(userZones.map(z => decryptFields(z, ZONE_ENCRYPTED_FIELDS)));
}
export async function saveZone(zone) {
  const db = await getDB();
  zone.userId = zone.userId || getCurrentUserId();
  const toSave = isEncryptionActive()
    ? await encryptFields(zone, ZONE_ENCRYPTED_FIELDS)
    : zone;
  return db.put('zones', toSave);
}
export async function deleteZone(id) {
  const db = await getDB();
  return db.delete('zones', id);
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
  
  return allFolders.filter(f => (f.userId || userId) === userId);
}
export async function saveFolder(folder) {
  const db = await getDB();
  folder.userId = folder.userId || getCurrentUserId();
  return db.put('folders', folder);
}
export async function deleteFolder(id) {
  const db = await getDB();
  return db.delete('folders', id);
}

// ===== VIDEO OPERATIONS =====

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

export function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
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

export async function cascadeBatchDelete(folderIds, pinIds, routeIds, zoneIds) {
  const db = await getDB();
  const tx = db.transaction(['folders', 'pins', 'routes', 'zones', 'videos'], 'readwrite');
  
  for (const id of folderIds) tx.objectStore('folders').delete(id);
  
  const videoIndex = tx.objectStore('videos').index('by-pin');
  for (const id of pinIds) {
     tx.objectStore('pins').delete(id);
     let vKeys = await videoIndex.getAllKeys(id);
     for(const vk of vKeys) tx.objectStore('videos').delete(vk);
  }
  
  for (const id of routeIds) tx.objectStore('routes').delete(id);
  for (const id of zoneIds) tx.objectStore('zones').delete(id);

  await tx.done;
}

// Persist storage
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}
