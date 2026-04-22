/**
 * quickmenu.js — Quick Actions Radial Menu
 * Long-press (600ms) on map opens a circular menu.
 * Slide finger to an icon and release to activate.
 * Also supports: long-press → release → tap icon.
 */
import { showToast } from './toast.js';

let map = null;
let menuEl = null;
let longPressTimer = null;
let menuVisible = false;
let startX = 0, startY = 0;
let menuItems = [];  // Track item positions for hit testing

const LONG_PRESS_MS = 600;
const MOVE_THRESHOLD = 10;
const ITEM_HIT_RADIUS = 30; // px — how close pointer must be to item center

// Quick action items
const QUICK_ACTIONS = [
  { icon: '📌', label: 'دبوس', action: 'pin' },
  { icon: '📏', label: 'قياس', action: 'measure' },
  { icon: '🔷', label: 'منطقة', action: 'zone' },
  { icon: '⭕', label: 'دائرة', action: 'circle' },
  { icon: '🎯', label: 'هاون', action: 'mortar' },
  { icon: '🔵', label: 'GPS', action: 'bft' },
  { icon: '📍', label: 'مسار', action: 'route' },
  { icon: '🔍', label: 'عدسة', action: 'spyglass' },
];

export function initQuickMenu(mapInstance) {
  map = mapInstance;
  
  menuEl = document.createElement('div');
  menuEl.id = 'quick-radial-menu';
  menuEl.className = 'quick-radial-menu hidden';
  document.getElementById('map').appendChild(menuEl);
  
  const container = map.getContainer();
  
  // Pointer events on the MAP CONTAINER
  container.addEventListener('pointerdown', onPointerDown, { passive: false });
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointercancel', onPointerCancel);
  
  // Global pointerup — catches release ANYWHERE (even on menu items)
  document.addEventListener('pointerup', onGlobalPointerUp);
  
  // Close when map drag starts
  map.on('movestart', () => { if (!menuVisible) return; hideMenu(); });
  
  menuEl.addEventListener('contextmenu', e => e.preventDefault());
  
  // Also support TAP on items after menu is shown
  menuEl.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.qm-item');
    if (itemEl && itemEl.dataset.action) {
      e.stopPropagation();
      e.preventDefault();
      activateAction(itemEl.dataset.action);
      hideMenu();
    }
  });
  
  // Prevent menu from propagating events that would close it
  ['mousedown', 'pointerdown', 'touchstart'].forEach(evt => {
    menuEl.addEventListener(evt, e => e.stopPropagation());
  });
}

function onPointerDown(e) {
  // Skip UI elements
  if (e.target.closest('.sidebar, .toolbar, .modal, .bft-panel, .killbox-dialog, .tactical-tool-btn, button, input, select, .quick-radial-menu')) return;
  if (menuVisible) { hideMenu(); return; }
  
  startX = e.clientX;
  startY = e.clientY;
  
  longPressTimer = setTimeout(() => {
    const rect = map.getContainer().getBoundingClientRect();
    const x = startX - rect.left;
    const y = startY - rect.top;
    
    map.dragging.disable();
    showMenu(x, y);
  }, LONG_PRESS_MS);
}

function onPointerMove(e) {
  if (!longPressTimer && !menuVisible) return;
  
  if (longPressTimer) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
      cancelTimer();
    }
    return;
  }
  
  // Menu is visible — highlight item under pointer
  if (menuVisible) {
    highlightItemUnderPointer(e.clientX, e.clientY);
  }
}

function onPointerCancel() {
  cancelTimer();
}

function onGlobalPointerUp(e) {
  cancelTimer();
  
  if (!menuVisible) {
    map.dragging.enable();
    return;
  }
  
  // Check if pointer is over a menu item
  const hitAction = getItemUnderPointer(e.clientX, e.clientY);
  
  if (hitAction) {
    activateAction(hitAction);
    hideMenu();
  }
  
  // Re-enable map dragging
  map.dragging.enable();
  
  // Don't hide menu if no item hit — user can still tap
}

function cancelTimer() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function showMenu(x, y) {
  if (!menuEl) return;
  
  const items = QUICK_ACTIONS;
  const count = items.length;
  const radius = 75;
  
  menuItems = [];
  menuEl.innerHTML = `
    <div class="qm-center-ring"></div>
    <div class="qm-center-dot"></div>
  `;
  
  // Ensure menu stays within map bounds
  const mapRect = map.getContainer().getBoundingClientRect();
  const menuRadius = radius + 30;
  const clampedX = Math.max(menuRadius, Math.min(x, mapRect.width - menuRadius));
  const clampedY = Math.max(menuRadius, Math.min(y, mapRect.height - menuRadius));
  
  items.forEach((item, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    const ix = Math.cos(angle) * radius;
    const iy = Math.sin(angle) * radius;
    
    const btn = document.createElement('div');
    btn.className = 'qm-item';
    btn.dataset.action = item.action;
    btn.innerHTML = `<span class="qm-icon">${item.icon}</span><span class="qm-label">${item.label}</span>`;
    btn.style.left = `${ix}px`;
    btn.style.top = `${iy}px`;
    btn.style.animationDelay = `${i * 35}ms`;
    
    menuEl.appendChild(btn);
    
    // Store absolute position for hit testing
    menuItems.push({
      action: item.action,
      absX: mapRect.left + clampedX + ix,
      absY: mapRect.top + clampedY + iy,
      element: btn
    });
  });
  
  menuEl.style.left = `${clampedX}px`;
  menuEl.style.top = `${clampedY}px`;
  menuEl.classList.remove('hidden');
  menuVisible = true;
  
  if (navigator.vibrate) navigator.vibrate(30);
}

function getItemUnderPointer(px, py) {
  let closest = null;
  let closestDist = Infinity;
  
  for (const item of menuItems) {
    const dx = px - item.absX;
    const dy = py - item.absY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < ITEM_HIT_RADIUS && dist < closestDist) {
      closestDist = dist;
      closest = item.action;
    }
  }
  
  return closest;
}

function highlightItemUnderPointer(px, py) {
  const hitAction = getItemUnderPointer(px, py);
  
  for (const item of menuItems) {
    if (item.action === hitAction) {
      item.element.classList.add('qm-hover');
    } else {
      item.element.classList.remove('qm-hover');
    }
  }
}

function hideMenu() {
  if (menuEl) {
    menuEl.classList.add('hidden');
  }
  menuVisible = false;
  menuItems = [];
  cancelTimer();
  map.dragging.enable();
}

function activateAction(action) {
  const buttonMap = {
    'pin': 'btn-add-marker',
    'measure': 'btn-measure-tool',
    'zone': 'btn-add-zone',
    'circle': 'btn-draw-circle',
    'mortar': 'btn-mortar-fcs',
    'bft': 'btn-bft',
    'route': 'btn-add-route',
    'spyglass': 'btn-spyglass',
  };
  
  // Tactical tools that need the sidebar open
  const tacticalTools = ['measure', 'circle', 'mortar', 'bft'];
  
  const btnId = buttonMap[action];
  if (btnId) {
    setTimeout(() => {
      // Force open tactical sidebar for tactical tools
      if (tacticalTools.includes(action)) {
        const sidebar = document.getElementById('tactical-sidebar');
        if (sidebar && sidebar.classList.contains('tactical-sidebar-closed')) {
          sidebar.classList.remove('tactical-sidebar-closed');
          sidebar.classList.add('tactical-sidebar-open');
        }
      }
      
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.click();
        showToast(`⚡ ${QUICK_ACTIONS.find(a => a.action === action)?.label || action}`, 'info');
      }
    }, 50);
  }
}

export function isQuickMenuVisible() {
  return menuVisible;
}
