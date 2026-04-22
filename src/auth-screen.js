/**
 * auth-screen.js — Authentication Screen Logic
 * Extracted from main.js showAuthScreen()
 * 
 * Handles:
 *  - User selection panel (multi-user support)
 *  - New user registration form
 *  - Login form with brute-force lockout
 *  - Session logout (switch user)
 *  - Delete user from login screen
 *  - Panic wipe
 * 
 * Dependencies injected via `deps` parameter to maintain module independence.
 */

import { hasUser, getUserProfile, registerUser, login, isAuthenticated, logout, getAllUsers, switchToUser, clearActiveUser } from './auth.js';
import { requireAdminPin, buildUserListUI, showTacticalConfirm } from './user-management.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';

/**
 * Shows the authentication screen and handles all auth flows.
 * 
 * @param {Object} deps — Injected dependencies from main.js
 * @param {Function} deps.verifyPin — Admin PIN verification function
 * @param {Function} deps.closeMobileDatabases — SQLite cleanup before reload
 * @returns {Promise<void>} — Resolves when auth screen is dismissed (user authenticated)
 */
export async function showAuthScreen(deps) {
  const { verifyPin, closeMobileDatabases } = deps;

  const authScreen = document.getElementById('auth-screen');
  const setupForm = document.getElementById('auth-setup');
  const loginForm = document.getElementById('auth-login');
  const userSelect = document.getElementById('auth-user-select');
  
  authScreen.classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  // ALWAYS clear ALL input fields and error messages on auth screen show
  const fieldsToClear = ['login-password', 'setup-name', 'setup-rank', 'setup-password', 'setup-confirm'];
  fieldsToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const errorsToClear = ['login-error', 'setup-error'];
  errorsToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  });

  // ===== HELPER: User Select Panel =====
  function showUserSelectPanel() {
    setupForm.classList.add('hidden');
    loginForm.classList.add('hidden');
    userSelect.classList.remove('hidden');
    
    const listEl = document.getElementById('previous-users-list');
    const users = getAllUsers();
    listEl.innerHTML = '';
    
    if (users.length === 0) {
      listEl.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.4); padding:10px;">لا توجد حسابات سابقة</p>';
    } else {
      for (const user of users) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'width:100%; padding:12px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; color:#fff; cursor:pointer; text-align:right; transition:all 0.2s; display:flex; align-items:center; gap:12px;';
        btn.innerHTML = `
          <div style="width:40px; height:40px; border-radius:50%; background:rgba(6,214,160,0.15); border:1px solid rgba(6,214,160,0.3); display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">👤</div>
          <div style="flex:1; text-align:right;">
            <div style="font-weight:bold; font-size:0.95rem;">${user.name}</div>
            <div style="font-size:0.75rem; color:rgba(255,255,255,0.4);">${user.rank || 'مشغل'}</div>
          </div>
        `;
        btn.onclick = () => {
          switchToUser(user);
          showLoginForUser();
        };
        listEl.appendChild(btn);
      }
    }
    
    // Create new user button
    const createBtn = document.getElementById('btn-create-new-user');
    if (createBtn) {
      createBtn.onclick = async () => {
        const authorized = await requireAdminPin(verifyPin);
        if (!authorized) return;
        userSelect.classList.add('hidden');
        setupForm.classList.remove('hidden');
        bindSetupForm();
      };
    }
  }
  
  // ===== HELPER: Setup Form Binding =====
  function bindSetupForm() {
    setupForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('setup-name').value.trim();
      const rank = document.getElementById('setup-rank').value.trim();
      const pw = document.getElementById('setup-password').value;
      const confirmPw = document.getElementById('setup-confirm').value;
      const errEl = document.getElementById('setup-error');
      
      if (pw !== confirmPw) {
        errEl.textContent = t('passwordMismatch') || 'كلمات المرور غير متطابقة';
        errEl.classList.remove('hidden');
        return;
      }
      if (pw.length < 4) {
        errEl.textContent = t('passwordTooShort') || 'كلمة المرور قصيرة (4 أحرف على الأقل)';
        errEl.classList.remove('hidden');
        return;
      }
      
      try {
        await registerUser(name, rank, pw);
        await closeMobileDatabases();
        window.location.reload();
      } catch(regErr) {
        errEl.textContent = '❌ خطأ في التسجيل: ' + regErr.message;
        errEl.classList.remove('hidden');
      }
    };
  }
  
  // ===== HELPER: Login Form for Current User =====
  function showLoginForUser() {
    setupForm.classList.add('hidden');
    userSelect.classList.add('hidden');
    loginForm.classList.remove('hidden');
    
    const profile = getUserProfile();
    document.getElementById('login-greeting').textContent = 
      (t('welcomeBack') || 'مرحباً') + '، ' + (profile?.name || '');
    document.getElementById('login-rank').textContent = profile?.rank || '';
    
    setTimeout(() => document.getElementById('login-password')?.focus(), 100);
    
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const pw = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      
      try {
        const success = await login(pw);
        if (success) {
          await closeMobileDatabases();
          window.location.reload();
        } else {
          errEl.textContent = t('wrongPassword') || 'كلمة المرور خاطئة';
          errEl.classList.remove('hidden');
          document.getElementById('login-password').value = '';
          document.getElementById('login-password').focus();
        }
      } catch (lockErr) {
        if (lockErr.message.startsWith('LOCKED:')) {
          const secs = lockErr.message.split(':')[1];
          errEl.textContent = (t('accountLocked') || 'الحساب مقفل') + ` (${secs}s)`;
          errEl.classList.remove('hidden');
        }
      }
    };
  }

  // ===== ROUTING: Decide which panel to show =====
  if (!hasUser()) {
    const allUsers = getAllUsers();
    if (allUsers.length > 0) {
      showUserSelectPanel();
    } else {
      // FIRST TIME: Show setup form
      setupForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
      if (userSelect) userSelect.classList.add('hidden');
      bindSetupForm();
    }
  } else {
    // RETURNING USER: Show login form
    showLoginForUser();
  }
  
  // ===== LOGIN SCREEN: Session Logout (switch user) =====
  const loginLogoutBtn = document.getElementById('btn-login-logout');
  if (loginLogoutBtn) {
    loginLogoutBtn.onclick = () => {
      clearActiveUser();
      const allUsers = getAllUsers();
      if (allUsers.length > 0) {
        showUserSelectPanel();
      } else {
        loginForm.classList.add('hidden');
        setupForm.classList.remove('hidden');
        if (userSelect) userSelect.classList.add('hidden');
      }
    };
  }
  
  // ===== LOGIN SCREEN: Delete User (requires admin PIN) =====
  const loginDelBtn = document.getElementById('btn-login-delete-user');
  if (loginDelBtn) {
    loginDelBtn.onclick = async () => {
      const authorized = await requireAdminPin(verifyPin);
      if (!authorized) return;
      
      const modal = document.getElementById('delete-user-modal');
      const container = document.getElementById('user-list-container');
      if (!modal || !container) return;
      
      await buildUserListUI(container, verifyPin);
      modal.classList.remove('hidden');
    };
  }
  
  // ===== Panic Wipe (DO NOT MODIFY) =====
  const panicBtn = document.getElementById('btn-panic-wipe');
  if (panicBtn) {
    panicBtn.addEventListener('click', async () => {
      const confirmed = await showTacticalConfirm('⚠️ تحذير: سيتم حذف جميع البيانات نهائياً!\n\nهل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.');
      if (!confirmed) return;
      
      const doubleConfirm = await showTacticalConfirm('🗑️ تأكيد نهائي: مسح كل شيء الآن؟');
      if (!doubleConfirm) return;
      
      try {
        const { panicWipe } = await import('./crypto.js');
        await panicWipe();
      } catch (e) {
        localStorage.clear();
        sessionStorage.clear();
        indexedDB.deleteDatabase('PinVaultDB');
        window.location.reload();
      }
    });
  }
}
