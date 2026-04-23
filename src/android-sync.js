/**
 * android-sync.js — WiFi Direct & Bluetooth Sync for Android (V2.0 — Secure)
 * 
 * Uses Capacitor plugins when available, falls back gracefully on Electron.
 * 
 * V2.0 Changes:
 *   - Delta sync via getUpdatesSince() (no more full DB dumps)
 *   - LWW conflict resolution via sync-engine.js
 *   - AES-256-GCM encrypted payloads via crypto.js
 *   - Per-peer lastSyncTime tracking
 * 
 * Requires Capacitor plugins (Android only):
 *   - @nicosabena/capacitor-wifi-direct (WiFi Direct)
 *   - @nicosabena/capacitor-bluetooth-serial (Bluetooth)
 * 
 * On Windows/Electron: this module is a no-op (silently skipped).
 */
import { showToast } from './toast.js';
import {
  getUpdatesSince, getLastSyncTime, setLastSyncTime,
  getDeviceId, applyResolvedRecords
} from './db.js';
import { resolveConflicts, validateSyncPayload, formatSyncSummary } from './sync-engine.js';
import { encrypt, decrypt, isEncryptionActive } from './crypto.js';

let isAndroid = false;
let wifiDirectPlugin = null;
let bluetoothPlugin = null;

// ===== INIT =====

export async function initAndroidSync() {
  // Detect Android/Capacitor
  isAndroid = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform?.();
  
  if (!isAndroid) {
    console.log('[AndroidSync] Not on Android — skipping native sync init');
    return false;
  }
  
  // Try loading plugins from Capacitor's global registry
  try {
    if (window.Capacitor?.Plugins?.WifiDirect) {
      wifiDirectPlugin = window.Capacitor.Plugins.WifiDirect;
      console.log('[AndroidSync] WiFi Direct plugin loaded');
    }
  } catch (e) {
    console.warn('[AndroidSync] WiFi Direct plugin not available:', e.message);
  }
  
  try {
    if (window.Capacitor?.Plugins?.BluetoothSerial) {
      bluetoothPlugin = window.Capacitor.Plugins.BluetoothSerial;
      console.log('[AndroidSync] Bluetooth plugin loaded');
    }
  } catch (e) {
    console.warn('[AndroidSync] Bluetooth plugin not available:', e.message);
  }
  
  return true;
}

// ===== WIFI DIRECT =====

/**
 * Discover nearby devices via WiFi Direct
 */
export async function discoverPeers() {
  if (!wifiDirectPlugin) {
    showToast('❌ WiFi Direct غير متوفر', 'error');
    return [];
  }
  
  try {
    showToast('📡 البحث عن أجهزة قريبة...', 'info');
    const result = await wifiDirectPlugin.discoverPeers();
    
    if (result.peers && result.peers.length > 0) {
      showToast(`📡 تم العثور على ${result.peers.length} جهاز`, 'success');
      return result.peers;
    } else {
      showToast('📡 لم يتم العثور على أجهزة', 'info');
      return [];
    }
  } catch (e) {
    console.error('[WiFiDirect] Discover failed:', e);
    showToast('❌ فشل البحث: ' + e.message, 'error');
    return [];
  }
}

/**
 * Connect to a peer via WiFi Direct
 */
export async function connectWifiDirect(deviceAddress) {
  if (!wifiDirectPlugin) return false;
  
  try {
    await wifiDirectPlugin.connect({ deviceAddress });
    showToast('✅ متصل عبر WiFi Direct', 'success');
    return true;
  } catch (e) {
    console.error('[WiFiDirect] Connect failed:', e);
    showToast('❌ فشل الاتصال: ' + e.message, 'error');
    return false;
  }
}

/**
 * Send data via WiFi Direct — encrypted
 */
async function sendViaWifiDirect(data) {
  if (!wifiDirectPlugin) return false;
  
  try {
    let payload = JSON.stringify(data);
    
    // Encrypt if crypto key is active
    if (isEncryptionActive()) {
      payload = await encrypt(payload);
    }
    
    await wifiDirectPlugin.send({ data: payload });
    return true;
  } catch (e) {
    console.error('[WiFiDirect] Send failed:', e);
    return false;
  }
}

// ===== BLUETOOTH =====

/**
 * List paired Bluetooth devices
 */
export async function listBluetoothDevices() {
  if (!bluetoothPlugin) {
    showToast('❌ Bluetooth غير متوفر', 'error');
    return [];
  }
  
  try {
    const result = await bluetoothPlugin.list();
    return result.devices || [];
  } catch (e) {
    console.error('[Bluetooth] List failed:', e);
    return [];
  }
}

/**
 * Connect to a Bluetooth device
 */
export async function connectBluetooth(address) {
  if (!bluetoothPlugin) return false;
  
  try {
    await bluetoothPlugin.connect({ address });
    showToast('✅ متصل عبر Bluetooth', 'success');
    
    // Listen for incoming data
    bluetoothPlugin.addListener('dataReceived', async (data) => {
      try {
        let payload = data.data;
        
        // Decrypt if encrypted
        if (typeof payload === 'string' && payload.startsWith('ENC:')) {
          payload = await decrypt(payload);
        }
        
        const parsed = JSON.parse(payload);
        await handleReceivedData(parsed);
      } catch (e) {
        console.warn('[Bluetooth] Bad data received:', e);
      }
    });
    
    return true;
  } catch (e) {
    console.error('[Bluetooth] Connect failed:', e);
    showToast('❌ فشل الاتصال: ' + e.message, 'error');
    return false;
  }
}

/**
 * Send data via Bluetooth — encrypted
 */
async function sendViaBluetooth(data) {
  if (!bluetoothPlugin) return false;
  
  try {
    let payload = JSON.stringify(data);
    
    if (isEncryptionActive()) {
      payload = await encrypt(payload);
    }
    
    await bluetoothPlugin.write({ data: payload });
    return true;
  } catch (e) {
    console.error('[Bluetooth] Write failed:', e);
    return false;
  }
}

// ===== SYNC OPERATIONS (V2.0 — Delta + LWW) =====

/**
 * Sync data with connected device using delta + LWW.
 * @param {string} method — 'wifi' or 'bluetooth'
 * @param {string} [peerDeviceId] — remote device ID for delta tracking
 */
export async function syncAllData(method = 'wifi', peerDeviceId = 'android-peer') {
  try {
    // Step 1: Get delta since last sync with this peer
    const lastSync = getLastSyncTime(peerDeviceId);
    const delta = await getUpdatesSince(lastSync);
    
    const payload = {
      type: 'sync',
      delta: delta,
      deviceId: getDeviceId(),
      lastSyncTime: lastSync,
      app: 'PinVault',
      version: '2.0',
      timestamp: Date.now()
    };
    
    let success = false;
    if (method === 'wifi') {
      success = await sendViaWifiDirect(payload);
    } else if (method === 'bluetooth') {
      success = await sendViaBluetooth(payload);
    }
    
    if (success) {
      const total = (delta.pins?.length || 0) + (delta.routes?.length || 0) + (delta.zones?.length || 0);
      showToast(`🔄 مزامنة مشفرة: ${total} تحديث مرسل`, 'success');
    }
    
    return success;
  } catch (e) {
    console.error('[Sync] Failed:', e);
    showToast('❌ فشل المزامنة', 'error');
    return false;
  }
}

/**
 * Handle incoming sync data — V2.0 with conflict resolution
 */
async function handleReceivedData(payload) {
  if (payload.type !== 'sync' || payload.app !== 'PinVault') return;
  
  // Validate incoming payload
  const validation = validateSyncPayload(payload.delta);
  if (!validation.valid) {
    console.error('[AndroidSync] Invalid sync payload:', validation.error);
    showToast('❌ بيانات مزامنة غير صالحة', 'error');
    return;
  }
  
  try {
    const remoteDeviceId = payload.deviceId || 'android-peer';
    
    // Step 1: Get our local state for comparison
    const localData = await getUpdatesSince(0); // Full state for resolution
    
    // Step 2: Resolve conflicts using LWW
    const { toApplyLocally, stats } = resolveConflicts(localData, payload.delta);
    
    // Step 3: Apply remote wins to local DB
    if ((toApplyLocally.pins?.length || 0) + (toApplyLocally.routes?.length || 0) +
        (toApplyLocally.zones?.length || 0) + (toApplyLocally.folders?.length || 0) > 0) {
      const counts = await applyResolvedRecords(toApplyLocally);
      console.log('[AndroidSync] Applied:', counts);
    }
    
    // Step 4: Update sync timestamp for this peer
    setLastSyncTime(remoteDeviceId, Date.now());
    
    const summary = formatSyncSummary(stats);
    showToast(`✅ ${summary}`, 'success');
    
  } catch (e) {
    console.error('[AndroidSync] Sync import failed:', e);
    showToast('❌ فشل استيراد بيانات المزامنة', 'error');
  }
}

// ===== STATUS =====

export function isAndroidPlatform() {
  return isAndroid;
}

export function hasWifiDirect() {
  return wifiDirectPlugin !== null;
}

export function hasBluetooth() {
  return bluetoothPlugin !== null;
}
