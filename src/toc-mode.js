/**
 * toc-mode.js — Tactical Operations Center Secure Casting
 * 
 * Full lifecycle:
 *   1. Detect external display via ScreenSecurity Capacitor plugin
 *   2. Show branded lockdown overlay
 *   3. Demand re-authentication (password verification)
 *   4. On success: enter TOC mode (full-screen map only)
 *   5. On disconnect: auto-exit TOC mode
 *   6. Manual enter/exit via UI buttons
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { login, getUserProfile } from './auth.js';
import { showToast } from './toast.js';

let map = null;
let isTocActive = false;

/**
 * Initialize TOC mode system
 * @param {L.Map} mapInstance 
 */
export function initTocMode(mapInstance) {
  map = mapInstance;

  // Wire manual TOC controls
  wireManualControls();

  // Wire lockdown auth form
  wireLockdownAuth();

  // Listen for native display events (Android only)
  if (Capacitor.isNativePlatform()) {
    try {
      const ScreenSecurity = registerPlugin('ScreenSecurity');
      
      ScreenSecurity.addListener('externalDisplayConnected', () => {
        console.log('[TOC] 📺 External display connected — triggering lockdown');
        showLockdown();
      });

      ScreenSecurity.addListener('externalDisplayDisconnected', () => {
        console.log('[TOC] 📺 External display disconnected');
        hideLockdown();
        exitTocMode();
      });

      // Check initial state
      ScreenSecurity.getDisplayCount().then(result => {
        if (result.hasExternal) {
          console.log('[TOC] External display already connected on startup');
          showLockdown();
        }
      }).catch(() => {});
    } catch (e) {
      console.warn('[TOC] ScreenSecurity plugin not available:', e);
    }
  }
}

// ===== LOCKDOWN =====

function showLockdown() {
  const lockdown = document.getElementById('mirror-lockdown');
  if (!lockdown) return;
  lockdown.classList.add('active');
  
  // Focus password field
  setTimeout(() => {
    const input = document.getElementById('mirror-auth-password');
    if (input) input.focus();
  }, 300);
}

function hideLockdown() {
  const lockdown = document.getElementById('mirror-lockdown');
  if (!lockdown) return;
  lockdown.classList.remove('active');
  
  // Clear password
  const input = document.getElementById('mirror-auth-password');
  if (input) input.value = '';
  
  const error = document.getElementById('mirror-auth-error');
  if (error) error.style.display = 'none';
}

// ===== AUTH FLOW =====

function wireLockdownAuth() {
  const submitBtn = document.getElementById('mirror-auth-submit');
  const passwordInput = document.getElementById('mirror-auth-password');
  
  if (submitBtn) {
    submitBtn.addEventListener('click', handleLockdownAuth);
  }
  
  if (passwordInput) {
    passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLockdownAuth();
      }
    });
  }
}

async function handleLockdownAuth() {
  const passwordInput = document.getElementById('mirror-auth-password');
  const errorEl = document.getElementById('mirror-auth-error');
  
  if (!passwordInput) return;
  
  const password = passwordInput.value.trim();
  if (!password) {
    showAuthError(errorEl, 'أدخل كلمة المرور');
    return;
  }

  try {
    const result = await login(password);
    
    if (result) {
      // Auth success — unlock and enter TOC mode
      hideLockdown();
      enterTocMode();
      
      const profile = getUserProfile();
      showToast(`📺 TOC Mode — مرحباً ${profile?.name || ''}`, 'success');
    } else {
      showAuthError(errorEl, '❌ كلمة المرور خاطئة');
      passwordInput.value = '';
      passwordInput.focus();
    }
  } catch (err) {
    if (err.message?.startsWith('LOCKED:')) {
      const sec = err.message.split(':')[1];
      showAuthError(errorEl, `🔒 الحساب مقفل — ${sec} ثانية`);
    } else {
      showAuthError(errorEl, '⚠️ خطأ في التحقق');
    }
  }
}

function showAuthError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ===== TOC MODE =====

function enterTocMode() {
  document.body.classList.add('toc-mode');
  isTocActive = true;
  
  // Force map to recalculate size after UI changes
  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
  
  console.log('[TOC] ✅ Entered TOC presentation mode');
}

function exitTocMode() {
  document.body.classList.remove('toc-mode');
  isTocActive = false;
  
  // Force map to recalculate size
  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
  
  showToast('📺 تم إنهاء وضع العرض', 'info');
  console.log('[TOC] ❌ Exited TOC mode');
}

// ===== MANUAL CONTROLS =====

function wireManualControls() {
  // Exit TOC button (floating red button in toc-mode)
  const exitBtn = document.getElementById('btn-exit-toc');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      exitTocMode();
    });
  }

  // Enter TOC button (from toolbar/quick menu)
  const enterBtn = document.getElementById('btn-enter-toc');
  if (enterBtn) {
    enterBtn.addEventListener('click', () => {
      enterTocMode();
      showToast('📺 وضع العرض — اضغط ❌ للخروج', 'info');
    });
  }
}

export function isTocModeActive() {
  return isTocActive;
}
