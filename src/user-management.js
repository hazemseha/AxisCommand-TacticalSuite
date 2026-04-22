/**
 * user-management.js — Unified user data management (DRY extraction from main.js)
 * 
 * Provides:
 *  - requireAdminPin()    — Promise-based admin PIN verification (replaces prompt/alert)
 *  - buildUserListUI()    — Scans IndexedDB + auth registry and renders user list
 *  - deleteUserData()     — Cascading user data deletion
 *  - showTacticalPrompt() — Non-blocking PIN input modal (replaces native prompt)
 *  - showTacticalAlert()  — Non-blocking alert modal (replaces native alert)
 *  - showTacticalConfirm()— Non-blocking confirm modal (replaces native confirm)
 *  - delay()              — Promise-based setTimeout replacement
 */

import { getDB } from './db.js';
import { getAllUsers, removeUserById } from './auth.js';
import { t } from './i18n.js';

// ===== UTILITY: Promise-based delay (replaces raw setTimeout) =====
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== TACTICAL PROMPT — Non-blocking PIN input modal =====
export function showTacticalPrompt(message, inputType = 'password') {
  return new Promise((resolve) => {
    let modal = document.getElementById('tactical-prompt-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tactical-prompt-modal';
      modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:10001; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px);">
          <div style="background:var(--bg-secondary, #1a1a2e); border:1px solid var(--accent-primary, #06d6a0); border-radius:16px; padding:28px; width:340px; max-width:90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.6);">
            <p id="tactical-prompt-msg" style="color:#fff; margin-bottom:16px; font-size:1rem; text-align:center; line-height:1.6;"></p>
            <input id="tactical-prompt-input" type="password" maxlength="4" 
              style="width:100%; padding:12px; text-align:center; font-size:1.5rem; letter-spacing:12px;
                     background:rgba(255,255,255,0.05); color:#fff; border:1px solid rgba(255,255,255,0.2);
                     border-radius:10px; outline:none; font-family:monospace;"
              autocomplete="off" />
            <div style="display:flex; gap:10px; margin-top:16px;">
              <button id="tactical-prompt-ok" style="flex:1; padding:10px; border-radius:10px;
                background:rgba(6,214,160,0.15); border:1px solid rgba(6,214,160,0.5);
                color:#06d6a0; font-weight:bold; cursor:pointer; font-size:0.9rem;">تأكيد</button>
              <button id="tactical-prompt-cancel" style="flex:1; padding:10px; border-radius:10px;
                background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3);
                color:#ef4444; font-weight:bold; cursor:pointer; font-size:0.9rem;">إلغاء</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const msgEl = modal.querySelector('#tactical-prompt-msg');
    const inputEl = modal.querySelector('#tactical-prompt-input');
    const okBtn = modal.querySelector('#tactical-prompt-ok');
    const cancelBtn = modal.querySelector('#tactical-prompt-cancel');

    msgEl.textContent = message;
    inputEl.value = '';
    inputEl.type = inputType;
    modal.style.display = '';

    const cleanup = (result) => {
      modal.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      inputEl.onkeydown = null;
      resolve(result);
    };

    okBtn.onclick = () => cleanup(inputEl.value || null);
    cancelBtn.onclick = () => cleanup(null);
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(inputEl.value || null);
      if (e.key === 'Escape') cleanup(null);
    };

    requestAnimationFrame(() => inputEl.focus());
  });
}

// ===== TACTICAL ALERT — Non-blocking alert modal =====
export function showTacticalAlert(message, type = 'info') {
  return new Promise((resolve) => {
    let modal = document.getElementById('tactical-alert-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tactical-alert-modal';
      modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:10001; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px);">
          <div style="background:var(--bg-secondary, #1a1a2e); border:1px solid var(--accent-primary, #06d6a0); border-radius:16px; padding:28px; width:340px; max-width:90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.6);">
            <p id="tactical-alert-msg" style="color:#fff; margin-bottom:20px; font-size:1rem; text-align:center; line-height:1.6;"></p>
            <button id="tactical-alert-ok" style="width:100%; padding:10px; border-radius:10px;
              background:rgba(6,214,160,0.15); border:1px solid rgba(6,214,160,0.5);
              color:#06d6a0; font-weight:bold; cursor:pointer; font-size:0.9rem;">حسناً</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const msgEl = modal.querySelector('#tactical-alert-msg');
    const okBtn = modal.querySelector('#tactical-alert-ok');
    const borderColor = type === 'error' ? '#ef4444' : type === 'success' ? '#06d6a0' : '#f59e0b';
    modal.querySelector('div > div').style.borderColor = borderColor;

    msgEl.textContent = message;
    modal.style.display = '';

    const cleanup = () => {
      modal.style.display = 'none';
      okBtn.onclick = null;
      resolve();
    };

    okBtn.onclick = cleanup;
    requestAnimationFrame(() => okBtn.focus());
  });
}

// ===== TACTICAL CONFIRM — Non-blocking confirm modal =====
export function showTacticalConfirm(message) {
  return new Promise((resolve) => {
    let modal = document.getElementById('tactical-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tactical-confirm-modal';
      modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:10001; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px);">
          <div style="background:var(--bg-secondary, #1a1a2e); border:1px solid #f59e0b; border-radius:16px; padding:28px; width:380px; max-width:90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.6);">
            <p id="tactical-confirm-msg" style="color:#fff; margin-bottom:20px; font-size:1rem; text-align:center; line-height:1.6; white-space:pre-line;"></p>
            <div style="display:flex; gap:10px;">
              <button id="tactical-confirm-yes" style="flex:1; padding:10px; border-radius:10px;
                background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.5);
                color:#ef4444; font-weight:bold; cursor:pointer; font-size:0.9rem;">تأكيد</button>
              <button id="tactical-confirm-no" style="flex:1; padding:10px; border-radius:10px;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.2);
                color:#fff; font-weight:bold; cursor:pointer; font-size:0.9rem;">إلغاء</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const msgEl = modal.querySelector('#tactical-confirm-msg');
    const yesBtn = modal.querySelector('#tactical-confirm-yes');
    const noBtn = modal.querySelector('#tactical-confirm-no');

    msgEl.textContent = message;
    modal.style.display = '';

    const cleanup = (result) => {
      modal.style.display = 'none';
      yesBtn.onclick = null;
      noBtn.onclick = null;
      resolve(result);
    };

    yesBtn.onclick = () => cleanup(true);
    noBtn.onclick = () => cleanup(false);
    requestAnimationFrame(() => noBtn.focus());
  });
}

// ===== REQUIRE ADMIN PIN — Unified admin verification =====
export async function requireAdminPin(verifyPinFn) {
  const pin = await showTacticalPrompt('🔑 أدخل رمز المسؤول (4 أرقام):');
  if (!pin) return false;
  const valid = await verifyPinFn(pin);
  if (!valid) {
    await showTacticalAlert('❌ رمز خاطئ — تم إلغاء العملية', 'error');
    return false;
  }
  return true;
}

// ===== BUILD USER LIST UI =====
export async function buildUserListUI(container, verifyPinFn) {
  container.innerHTML = '';

  try {
    const db = await getDB();
    const userMap = new Map();

    const allPins = await db.getAll('pins');
    const allRoutes = await db.getAll('routes');
    const allZones = await db.getAll('zones');

    for (const item of [...allPins, ...allRoutes, ...allZones]) {
      const uid = item.userId || 'default';
      if (!userMap.has(uid)) userMap.set(uid, { pins: 0, routes: 0, zones: 0 });
      const counts = userMap.get(uid);
      if (allPins.includes(item)) counts.pins++;
      else if (allRoutes.includes(item)) counts.routes++;
      else counts.zones++;
    }

    const authUsers = getAllUsers();
    for (const u of authUsers) {
      const uid = u.name + '_' + (u.createdAt || '0');
      if (!userMap.has(uid)) userMap.set(uid, { pins: 0, routes: 0, zones: 0 });
    }

    if (userMap.size === 0) {
      container.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.4); padding:20px;">' +
        (t('noUserData') || 'لا يوجد بيانات مستخدمين') + '</p>';
      return;
    }

    for (const [userId, counts] of userMap) {
      const displayName = userId === 'default'
        ? (t('legacyUser') || 'مستخدم قديم (بدون تعريف)')
        : userId.split('_')[0];

      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; margin-bottom:8px;';
      row.innerHTML = `
        <div>
          <div style="font-weight:bold; font-size:0.95rem;">👤 ${displayName}</div>
          <div style="font-size:0.75rem; color:rgba(255,255,255,0.4); margin-top:4px;">
            📌 ${counts.pins} | 🛣️ ${counts.routes} | 📐 ${counts.zones}
          </div>
        </div>
        <button class="delete-user-btn" data-userid="${userId}" data-username="${displayName}" style="
          padding:8px 14px; border-radius:8px;
          background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.5);
          color:#ef4444; font-weight:bold; font-size:0.8rem;
          cursor:pointer; white-space:nowrap;
        ">${t('delete') || 'حذف'}</button>
      `;
      container.appendChild(row);
    }

    container.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.onclick = async () => {
        const targetUserId = btn.dataset.userid;
        const targetName = btn.dataset.username || targetUserId.split('_')[0];
        await deleteUserData(targetUserId, targetName, btn, container);
      };
    });

  } catch (e) {
    container.innerHTML = `<p style="text-align:center; color:#ef4444; padding:20px;">${t('error') || 'خطأ'}: ${e.message}</p>`;
  }
}

// ===== DELETE USER DATA =====
async function deleteUserData(userId, displayName, triggerBtn, container) {
  const confirmed = await showTacticalConfirm(
    `⚠️ حذف جميع بيانات "${displayName}"?\n\nلا يمكن التراجع!`
  );
  if (!confirmed) return;

  try {
    const db = await getDB();
    const tx = db.transaction(['pins', 'routes', 'zones', 'folders'], 'readwrite');

    for (const store of ['pins', 'routes', 'zones', 'folders']) {
      const s = tx.objectStore(store);
      const all = await s.getAll();
      for (const item of all) {
        if ((item.userId || 'default') === userId) await s.delete(item.id);
      }
    }
    await tx.done;

    removeUserById(userId);

    if (triggerBtn) {
      const row = triggerBtn.closest('div[style]');
      if (row) row.remove();
    }

    await showTacticalAlert(`✅ تم حذف بيانات "${displayName}"`, 'success');

    if (container && container.children.length === 0) {
      container.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.4); padding:20px;">' +
        (t('allDataDeleted') || 'تم حذف جميع البيانات') + '</p>';
    }
  } catch (e) {
    await showTacticalAlert(`❌ فشل الحذف: ${e.message}`, 'error');
  }
}
