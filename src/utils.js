/**
 * utils.js — Shared utilities to break circular dependencies
 */

let pendingConfirmAction = null;

export function confirmAction(title, desc, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  if (!modal) {
    // Fallback to native confirm if modal isn't ready or missing
    if (confirm(`${title}\n\n${desc}`)) {
      onConfirm();
    }
    return;
  }
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-desc').textContent = desc;
  
  pendingConfirmAction = onConfirm;
  modal.classList.remove('hidden');
}

export function closeConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.add('hidden');
  pendingConfirmAction = null;
}

// Global initialization for confirm modal buttons
export function initConfirmModal() {
  const proceed = document.getElementById('btn-confirm-proceed');
  const cancel = document.getElementById('btn-confirm-cancel');
  
  if (proceed) {
    proceed.onclick = async () => {
      if (pendingConfirmAction) await pendingConfirmAction();
      closeConfirmModal();
    };
  }
  
  if (cancel) {
    cancel.onclick = closeConfirmModal;
  }
}
