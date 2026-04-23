/**
 * sync-engine.js — AxisCommand Tactical Sync Engine
 * 
 * Pure conflict resolution logic for LWW (Last-Write-Wins) sync.
 * This module contains ZERO I/O — it is a pure function library.
 * All database reads/writes are handled by the caller (mesh.js, etc.).
 * 
 * ALGORITHM: Timestamp-based LWW with Tombstone Propagation
 * 
 * For each record pair (local vs remote) matched by ID:
 *   1. If only one side has it → accept that side (new record or new tombstone)
 *   2. If both sides have it → keep the one with higher updatedAt
 *   3. If timestamps are equal → tiebreak by deviceId (lexicographic, deterministic)
 *   4. Tombstones (deleted: true) are treated as normal records — they win if newer
 * 
 * OUTPUT: Two sets:
 *   - toApplyLocally:  Records the local DB must upsert (remote wins)
 *   - toSendToRemote:  Records the remote device is missing (local wins)
 */

const SYNC_LOG = '[SyncEngine]';

/**
 * Resolve conflicts between local and remote record sets.
 * Pure function — no side effects, no I/O.
 * 
 * @param {Object} localData  — { pins: [], routes: [], zones: [], folders: [], deviceId, timestamp }
 * @param {Object} remoteData — { pins: [], routes: [], zones: [], folders: [], deviceId, timestamp }
 * @returns {{
 *   toApplyLocally: { pins: [], routes: [], zones: [], folders: [] },
 *   toSendToRemote: { pins: [], routes: [], zones: [], folders: [] },
 *   stats: { localWins: number, remoteWins: number, identical: number, newLocal: number, newRemote: number }
 * }}
 */
export function resolveConflicts(localData, remoteData) {
  const stats = { localWins: 0, remoteWins: 0, identical: 0, newLocal: 0, newRemote: 0 };
  const toApplyLocally = { pins: [], routes: [], zones: [], folders: [] };
  const toSendToRemote = { pins: [], routes: [], zones: [], folders: [] };

  const collections = ['pins', 'routes', 'zones', 'folders'];

  for (const coll of collections) {
    const localRecords = localData[coll] || [];
    const remoteRecords = remoteData[coll] || [];

    // Build lookup maps by ID
    const localMap = new Map();
    for (const rec of localRecords) {
      localMap.set(rec.id, rec);
    }

    const remoteMap = new Map();
    for (const rec of remoteRecords) {
      remoteMap.set(rec.id, rec);
    }

    // Collect all unique IDs from both sides
    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

    for (const id of allIds) {
      const local = localMap.get(id);
      const remote = remoteMap.get(id);

      if (local && !remote) {
        // Only exists locally → remote needs it
        toSendToRemote[coll].push(local);
        stats.newLocal++;
      } else if (!local && remote) {
        // Only exists remotely → local needs it
        toApplyLocally[coll].push(remote);
        stats.newRemote++;
      } else if (local && remote) {
        // Both exist → LWW comparison
        const result = _lwwCompare(local, remote);
        
        if (result === 0) {
          // Identical — no action needed
          stats.identical++;
        } else if (result > 0) {
          // Local wins → remote needs our version
          toSendToRemote[coll].push(local);
          stats.localWins++;
        } else {
          // Remote wins → we need their version
          toApplyLocally[coll].push(remote);
          stats.remoteWins++;
        }
      }
    }
  }

  console.log(
    `${SYNC_LOG} Resolution complete: ` +
    `localWins=${stats.localWins} remoteWins=${stats.remoteWins} ` +
    `identical=${stats.identical} newLocal=${stats.newLocal} newRemote=${stats.newRemote}`
  );

  return { toApplyLocally, toSendToRemote, stats };
}

/**
 * LWW comparison of two records with the same ID.
 * 
 * @param {Object} a — record A
 * @param {Object} b — record B
 * @returns {number}
 *   > 0  if A wins (A has higher timestamp)
 *   < 0  if B wins (B has higher timestamp)
 *   0    if records are identical (same timestamp + same device)
 */
function _lwwCompare(a, b) {
  const tsA = a.updatedAt || a.createdAt || 0;
  const tsB = b.updatedAt || b.createdAt || 0;

  if (tsA !== tsB) {
    return tsA - tsB; // Higher timestamp wins
  }

  // Tiebreak: deterministic by deviceId (lexicographic order)
  // This ensures both devices arrive at the same resolution independently.
  const devA = a.deviceId || '';
  const devB = b.deviceId || '';

  if (devA !== devB) {
    return devA > devB ? 1 : -1;
  }

  // Truly identical record (same timestamp, same device) — no action needed
  return 0;
}

/**
 * Validate a sync payload before processing.
 * Guards against malformed, tampered, or incompatible data.
 * 
 * @param {Object} payload
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSyncPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload is null or not an object' };
  }

  if (!payload.deviceId || typeof payload.deviceId !== 'string') {
    return { valid: false, error: 'Missing or invalid deviceId' };
  }

  if (!payload.timestamp || typeof payload.timestamp !== 'number') {
    return { valid: false, error: 'Missing or invalid timestamp' };
  }

  const collections = ['pins', 'routes', 'zones', 'folders'];
  for (const coll of collections) {
    if (payload[coll] && !Array.isArray(payload[coll])) {
      return { valid: false, error: `${coll} must be an array` };
    }

    // Validate each record has an id and updatedAt
    if (payload[coll]) {
      for (const rec of payload[coll]) {
        if (!rec.id) {
          return { valid: false, error: `Record in ${coll} missing 'id'` };
        }
        if (!rec.updatedAt && !rec.createdAt) {
          return { valid: false, error: `Record ${rec.id} in ${coll} missing timestamp` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Create a sync summary for UI display.
 * 
 * @param {Object} stats — from resolveConflicts()
 * @returns {string} Human-readable summary (Arabic)
 */
export function formatSyncSummary(stats) {
  const parts = [];
  
  if (stats.remoteWins > 0) {
    parts.push(`📥 ${stats.remoteWins} تحديث مستلم`);
  }
  if (stats.localWins > 0) {
    parts.push(`📤 ${stats.localWins} تحديث مرسل`);
  }
  if (stats.newRemote > 0) {
    parts.push(`🆕 ${stats.newRemote} عنصر جديد مستلم`);
  }
  if (stats.newLocal > 0) {
    parts.push(`🆕 ${stats.newLocal} عنصر جديد مرسل`);
  }
  if (stats.identical > 0) {
    parts.push(`✅ ${stats.identical} متطابق`);
  }

  if (parts.length === 0) {
    return '✅ كل شيء متزامن — لا توجد تغييرات';
  }

  return parts.join(' | ');
}

/**
 * Compute a lightweight fingerprint of a record set for quick equality check.
 * Used to skip full resolution if fingerprints match.
 * 
 * @param {Object} data — { pins: [], routes: [], zones: [], folders: [] }
 * @returns {string} fingerprint string
 */
export function computeFingerprint(data) {
  const collections = ['pins', 'routes', 'zones', 'folders'];
  const parts = [];

  for (const coll of collections) {
    const records = data[coll] || [];
    // Sort by ID for deterministic ordering
    const sorted = [...records].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
    // Fingerprint: count + sum of updatedAt timestamps
    const sum = sorted.reduce((acc, r) => acc + (r.updatedAt || r.createdAt || 0), 0);
    parts.push(`${coll}:${sorted.length}:${sum}`);
  }

  return parts.join('|');
}
