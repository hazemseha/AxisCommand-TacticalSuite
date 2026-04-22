/**
 * crypto.js — PinVault AES-256-GCM Encryption Engine
 * Uses Web Crypto API (built into browser/Electron).
 * 
 * Key derivation: PBKDF2 (SHA-256, 100K iterations) from password
 * Encryption: AES-256-GCM with random 12-byte IV per operation
 * 
 * The derived key is persisted in sessionStorage as JWK for reload survival.
 * It is cleared on logout/session end.
 */

const SALT_KEY = 'pinvault_crypto_salt';
const SESSION_CRYPTO_KEY = 'pinvault_crypto_jwk';
const PBKDF2_ITERATIONS = 100000;

let _cryptoKey = null; // In-memory CryptoKey object

// ===== KEY MANAGEMENT =====

/**
 * Derive AES-256 key from password using PBKDF2
 * Key is exported to sessionStorage so it survives page reloads.
 */
export async function deriveKey(password) {
  // Get or create salt
  let saltHex = localStorage.getItem(SALT_KEY);
  let salt;
  
  if (!saltHex) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    saltHex = arrayToHex(salt);
    localStorage.setItem(SALT_KEY, saltHex);
  } else {
    salt = hexToArray(saltHex);
  }

  // Import password as raw key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES-256 key (extractable: true so we can persist to sessionStorage)
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,  // extractable — needed for JWK export to sessionStorage
    ['encrypt', 'decrypt']
  );

  _cryptoKey = key;
  
  // Persist key as JWK in sessionStorage (survives reload, cleared on tab close)
  try {
    const jwk = await crypto.subtle.exportKey('jwk', key);
    sessionStorage.setItem(SESSION_CRYPTO_KEY, JSON.stringify(jwk));
  } catch(e) {
    console.warn('[Crypto] Failed to persist key:', e);
  }
  
  return key;
}

/**
 * Restore crypto key from sessionStorage (called on page reload)
 * Returns true if key was restored successfully
 */
export async function restoreKey() {
  if (_cryptoKey) return true; // Already loaded
  
  try {
    const jwkStr = sessionStorage.getItem(SESSION_CRYPTO_KEY);
    if (!jwkStr) return false;
    
    const jwk = JSON.parse(jwkStr);
    _cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    return true;
  } catch(e) {
    console.warn('[Crypto] Failed to restore key:', e);
    return false;
  }
}

/**
 * Get the current in-memory key
 */
export function getCryptoKey() {
  return _cryptoKey;
}

/**
 * Clear the key from memory AND sessionStorage (on logout)
 */
export function clearCryptoKey() {
  _cryptoKey = null;
  sessionStorage.removeItem(SESSION_CRYPTO_KEY);
}

/**
 * Check if encryption is active (key available)
 */
export function isEncryptionActive() {
  return _cryptoKey !== null;
}

// ===== ENCRYPT / DECRYPT =====

/**
 * Encrypt a string or object using AES-256-GCM
 */
export async function encrypt(data, key) {
  const k = key || _cryptoKey;
  if (!k) return data; // No encryption if no key (backward compat)

  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    k,
    new TextEncoder().encode(plaintext)
  );

  // Pack as: iv(24 hex chars) + ':' + ciphertext(base64)
  const ivHex = arrayToHex(iv);
  const cipherB64 = arrayBufferToBase64(cipherBuffer);
  
  return `ENC:${ivHex}:${cipherB64}`;
}

/**
 * Decrypt an encrypted payload
 */
export async function decrypt(encData, key) {
  const k = key || _cryptoKey;
  
  // Not encrypted — return as-is (backward compat with unencrypted data)
  if (!encData || typeof encData !== 'string' || !encData.startsWith('ENC:')) {
    return encData;
  }

  if (!k) {
    console.warn('[Crypto] No key available for decryption');
    return encData;
  }

  const parts = encData.split(':');
  if (parts.length !== 3) return encData;

  const iv = hexToArray(parts[1]);
  const cipherBuffer = base64ToArrayBuffer(parts[2]);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      k,
      cipherBuffer
    );
    return new TextDecoder().decode(plainBuffer);
  } catch (e) {
    console.error('[Crypto] Decryption failed:', e.message);
    return encData; // Return encrypted data if decryption fails
  }
}

/**
 * Encrypt specific fields of an object
 */
export async function encryptFields(obj, fields) {
  if (!_cryptoKey) return obj;
  
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = await encrypt(result[field]);
    }
  }
  return result;
}

/**
 * Decrypt specific fields of an object
 */
export async function decryptFields(obj, fields) {
  if (!_cryptoKey) return obj;
  
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      const decrypted = await decrypt(result[field]);
      // Try to parse JSON if possible
      try {
        result[field] = JSON.parse(decrypted);
      } catch {
        result[field] = decrypted;
      }
    }
  }
  return result;
}

// ===== PANIC WIPE =====

/**
 * Emergency data wipe — destroys ALL application data
 */
export async function panicWipe() {
  // 1. Clear all localStorage
  localStorage.clear();
  
  // 2. Clear all sessionStorage
  sessionStorage.clear();
  
  // 3. Delete IndexedDB
  const databases = ['PinVaultDB'];
  for (const dbName of databases) {
    try {
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = resolve;
        req.onerror = reject;
        req.onblocked = resolve;
      });
    } catch (e) {
      console.warn(`[PanicWipe] Failed to delete ${dbName}:`, e);
    }
  }
  
  // 4. Clear crypto key
  clearCryptoKey();
  
  // 5. Reload app
  window.location.reload();
}

// ===== HELPERS =====

function arrayToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToArray(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
