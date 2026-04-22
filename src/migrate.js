/**
 * migrate.js — Data Migration Tool
 * Encrypts existing unencrypted data with AES-256.
 * Safe: only processes unencrypted fields, skips already-encrypted ones.
 */
import { getDB } from './db.js';
import { encrypt, isEncryptionActive } from './crypto.js';
import { showToast } from './toast.js';

const PIN_FIELDS = ['name', 'notes', 'description', 'iconUrl'];
const ROUTE_FIELDS = ['name', 'notes'];
const ZONE_FIELDS = ['name', 'notes'];

/**
 * Migrate all existing data to encrypted format
 * @returns {object} stats { pins, routes, zones }
 */
export async function migrateToEncrypted() {
  if (!isEncryptionActive()) {
    showToast('⚠️ يجب تسجيل الدخول أولاً لتفعيل التشفير', 'error');
    return null;
  }
  
  const stats = { pins: 0, routes: 0, zones: 0 };
  
  try {
    const db = await getDB();
    
    // Migrate Pins
    const pins = await db.getAll('pins');
    for (const pin of pins) {
      let changed = false;
      for (const field of PIN_FIELDS) {
        if (pin[field] && typeof pin[field] === 'string' && !pin[field].startsWith('ENC:')) {
          pin[field] = await encrypt(pin[field]);
          changed = true;
        }
      }
      if (changed) {
        await db.put('pins', pin);
        stats.pins++;
      }
    }
    
    // Migrate Routes
    const routes = await db.getAll('routes');
    for (const route of routes) {
      let changed = false;
      for (const field of ROUTE_FIELDS) {
        if (route[field] && typeof route[field] === 'string' && !route[field].startsWith('ENC:')) {
          route[field] = await encrypt(route[field]);
          changed = true;
        }
      }
      if (changed) {
        await db.put('routes', route);
        stats.routes++;
      }
    }
    
    // Migrate Zones
    const zones = await db.getAll('zones');
    for (const zone of zones) {
      let changed = false;
      for (const field of ZONE_FIELDS) {
        if (zone[field] && typeof zone[field] === 'string' && !zone[field].startsWith('ENC:')) {
          zone[field] = await encrypt(zone[field]);
          changed = true;
        }
      }
      if (changed) {
        await db.put('zones', zone);
        stats.zones++;
      }
    }
    
    showToast(`🔐 تم تشفير: ${stats.pins} نقطة + ${stats.routes} مسار + ${stats.zones} منطقة`, 'success');
    return stats;
    
  } catch (e) {
    console.error('[Migrate] Failed:', e);
    showToast('❌ فشل ترحيل البيانات: ' + e.message, 'error');
    return null;
  }
}
