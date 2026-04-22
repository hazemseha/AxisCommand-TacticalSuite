/**
 * auth.js — PinVault Tactical Authentication Module
 * Offline-first SHA-256 hashed credential storage.
 * V3.1: Multi-user support with migration-safe auth gating.
 */

const STORAGE_KEY = 'pinvault_auth';
const LOCKOUT_KEY = 'pinvault_lockout';
const SESSION_KEY = 'pinvault_session';
const ALL_USERS_KEY = 'pinvault_all_users';

/** SHA-256 hash using browser's built-in SubtleCrypto */
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Check if a user account exists */
export function hasUser() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/** Get stored user profile (name, rank — not password) */
export function getUserProfile() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    return { name: parsed.name, rank: parsed.rank, createdAt: parsed.createdAt };
  } catch(e) {
    return null;
  }
}

/** Get the unique userId string for the current active user */
export function getActiveUserId() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    return parsed.name + '_' + (parsed.createdAt || '0');
  } catch(e) {
    return null;
  }
}

/** Get list of ALL previously registered users */
export function getAllUsers() {
  try {
    const data = localStorage.getItem(ALL_USERS_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch(e) {
    return [];
  }
}

/** Add user to the all-users list (if not already there) */
function addToAllUsers(userData) {
  const users = getAllUsers();
  const uid = userData.name + '_' + (userData.createdAt || '0');
  const exists = users.find(u => (u.name + '_' + (u.createdAt || '0')) === uid);
  if (!exists) {
    users.push({
      name: userData.name,
      rank: userData.rank,
      hash: userData.hash,
      createdAt: userData.createdAt
    });
    localStorage.setItem(ALL_USERS_KEY, JSON.stringify(users));
  }
}

/** Switch to a previously registered user (sets them as active) */
export function switchToUser(user) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  localStorage.removeItem(LOCKOUT_KEY);
  return true;
}

/** Remove a specific user from the all-users list by userId string */
export function removeUserById(userId) {
  const users = getAllUsers();
  const filtered = users.filter(u => {
    const uId = u.name + '_' + (u.createdAt || '0');
    return uId !== userId;
  });
  localStorage.setItem(ALL_USERS_KEY, JSON.stringify(filtered));
  
  // If the deleted user is currently active, clear active user
  const activeId = getActiveUserId();
  if (activeId === userId) {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  }
}

/** Remove a specific user from the all-users list (legacy compat) */
export function removeUserFromList(userName, createdAt) {
  const userId = userName + '_' + (createdAt || '0');
  removeUserById(userId);
}

/** Clear active user (logout without deleting from all-users list) */
export function clearActiveUser() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LOCKOUT_KEY);
  try {
    import('./crypto.js').then(m => m.clearCryptoKey());
  } catch (e) { /* ignore */ }
}

/** Register a new user (first-time setup) */
export async function registerUser(name, rank, password) {
  const hash = await sha256(password);
  const userData = {
    name,
    rank,
    hash,
    createdAt: Date.now()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
  sessionStorage.setItem(SESSION_KEY, 'authenticated');
  
  // Add to all-users list
  addToAllUsers(userData);
  
  // Derive encryption key from password (lazy import)
  try {
    const { deriveKey } = await import('./crypto.js');
    await deriveKey(password);
  } catch (e) { console.warn('Crypto init skipped:', e); }
  
  return true;
}

/** Verify password and login */
export async function login(password) {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return false;
  
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch(e) {
    return false;
  }
  
  // MIGRATION: If user exists in pinvault_auth but NOT in all-users list,
  // auto-add them (V7→V8 upgrade path). Do NOT wipe them.
  const allUsers = getAllUsers();
  const userExists = allUsers.find(u => u.name === parsed.name && u.createdAt === parsed.createdAt);
  if (!userExists) {
    // This is a legacy user — migrate them into the all-users list
    addToAllUsers(parsed);
  }
  
  // Check lockout
  const lockout = localStorage.getItem(LOCKOUT_KEY);
  if (lockout) {
    try {
      const lockData = JSON.parse(lockout);
      if (Date.now() < lockData.until) {
        const remaining = Math.ceil((lockData.until - Date.now()) / 1000);
        throw new Error(`LOCKED:${remaining}`);
      } else {
        localStorage.removeItem(LOCKOUT_KEY);
      }
    } catch(e) {
      if (e.message && e.message.startsWith('LOCKED:')) throw e;
      localStorage.removeItem(LOCKOUT_KEY);
    }
  }

  const hash = await sha256(password);
  
  if (hash === parsed.hash) {
    localStorage.removeItem(LOCKOUT_KEY);
    sessionStorage.setItem(SESSION_KEY, 'authenticated');
    
    // Derive encryption key from password (lazy import)
    try {
      const { deriveKey } = await import('./crypto.js');
      await deriveKey(password);
    } catch (e) { console.warn('Crypto init skipped:', e); }
    
    return true;
  } else {
    // Track failed attempts
    let lockData = { attempts: 0 };
    try {
      if (lockout) lockData = JSON.parse(lockout);
    } catch(e) { /* ignore parse error */ }
    lockData.attempts = (lockData.attempts || 0) + 1;
    
    if (lockData.attempts >= 3) {
      lockData.until = Date.now() + 30000; // 30 second lockout
      lockData.attempts = 0;
    }
    
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(lockData));
    return false;
  }
}

/** Check if current session is authenticated */
export function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === 'authenticated';
}

/** Logout (clear session + encryption key) */
export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  try {
    import('./crypto.js').then(m => m.clearCryptoKey());
  } catch (e) { /* ignore */ }
}
