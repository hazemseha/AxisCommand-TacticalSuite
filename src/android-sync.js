/**
 * android-sync.js — WiFi Direct & Bluetooth Sync for Android
 * Uses Capacitor plugins when available, falls back gracefully on Electron.
 * 
 * Requires Capacitor plugins (Android only):
 * - @nicosabena/capacitor-wifi-direct (WiFi Direct)
 * - @nicosabena/capacitor-bluetooth-serial (Bluetooth)
 * 
 * On Windows/Electron: this module is a no-op (silently skipped).
 */
import { showToast } from './toast.js';
import { getAllPins, getAllRoutes, getAllZones, savePin, saveRoute, saveZone, generateId } from './db.js';

let isAndroid = false;
let wifiDirectPlugin = null;
let bluetoothPlugin = null;
let onDataReceived = null;

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
 * Send data via WiFi Direct
 */
export async function sendViaWifiDirect(data) {
  if (!wifiDirectPlugin) return false;
  
  try {
    const payload = JSON.stringify(data);
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
    bluetoothPlugin.addListener('dataReceived', (data) => {
      try {
        const parsed = JSON.parse(data.data);
        handleReceivedData(parsed);
      } catch (e) {
        console.warn('[Bluetooth] Bad data:', e);
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
 * Send data via Bluetooth
 */
export async function sendViaBluetooth(data) {
  if (!bluetoothPlugin) return false;
  
  try {
    const payload = JSON.stringify(data);
    await bluetoothPlugin.write({ data: payload });
    return true;
  } catch (e) {
    console.error('[Bluetooth] Write failed:', e);
    return false;
  }
}

// ===== SYNC OPERATIONS =====

/**
 * Send all points to connected device (works with both WiFi Direct & Bluetooth)
 */
export async function syncAllData(method = 'wifi') {
  try {
    const pins = await getAllPins();
    const routes = await getAllRoutes();
    const zones = await getAllZones();
    
    const payload = {
      type: 'sync',
      data: { pins, routes, zones },
      timestamp: Date.now(),
      app: 'PinVault',
      version: '7.0'
    };
    
    let success = false;
    if (method === 'wifi') {
      success = await sendViaWifiDirect(payload);
    } else if (method === 'bluetooth') {
      success = await sendViaBluetooth(payload);
    }
    
    if (success) {
      showToast(`🔄 مزامنة: ${pins.length} نقطة + ${routes.length} مسار + ${zones.length} منطقة`, 'success');
    }
    
    return success;
  } catch (e) {
    console.error('[Sync] Failed:', e);
    showToast('❌ فشل المزامنة', 'error');
    return false;
  }
}

/**
 * Handle incoming sync data
 */
async function handleReceivedData(payload) {
  if (payload.type !== 'sync' || payload.app !== 'PinVault') return;
  
  let imported = { pins: 0, routes: 0, zones: 0 };
  
  try {
    if (payload.data.pins) {
      for (const pin of payload.data.pins) {
        pin.id = generateId();
        pin.syncedAt = Date.now();
        await savePin(pin);
        imported.pins++;
      }
    }
    if (payload.data.routes) {
      for (const route of payload.data.routes) {
        route.id = generateId();
        await saveRoute(route);
        imported.routes++;
      }
    }
    if (payload.data.zones) {
      for (const zone of payload.data.zones) {
        zone.id = generateId();
        await saveZone(zone);
        imported.zones++;
      }
    }
    
    showToast(`✅ استلام: ${imported.pins} نقطة + ${imported.routes} مسار + ${imported.zones} منطقة`, 'success');
  } catch (e) {
    console.error('[Sync] Import failed:', e);
    showToast('❌ فشل استيراد البيانات', 'error');
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
