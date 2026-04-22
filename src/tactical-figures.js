/**
 * tactical-figures.js — Military Tactical Figures Tool
 * NATO-standard tactical symbols for attack and defense planning.
 * Rotation: rebuilds icon via setIcon() — guaranteed to work.
 * Touch: tap=select, long-press=delete, two-finger=rotate.
 */
import L from 'leaflet';
import { showToast } from './toast.js';
import { t } from './i18n.js';

let map = null;
let isActive = false;
let selectedFigure = null;
let panel = null;
let placedFigures = [];
let undoStack = [];
let activePF = null;
let figIdCounter = 0;

// ===== FIGURE DEFINITIONS =====
const FIGURES = {
  attack: {
    label: '⚔️ هجوم',
    items: [
      { id: 'attack-arrow', name: 'سهم هجوم', nameEn: 'Main Attack', svg: buildAttackArrow, color: '#ff4444' },
      { id: 'support-arrow', name: 'هجوم مساند', nameEn: 'Supporting Attack', svg: buildSupportArrow, color: '#ff8800' },
      { id: 'axis-advance', name: 'محور تقدم', nameEn: 'Axis of Advance', svg: buildAxisAdvance, color: '#ff4444' },
      { id: 'objective', name: 'هدف', nameEn: 'Objective', svg: buildObjective, color: '#ff4444' },
      { id: 'assembly-area', name: 'منطقة تجمع', nameEn: 'Assembly Area', svg: buildAssemblyArea, color: '#44aaff' },
      { id: 'phase-line', name: 'خط مرحلة', nameEn: 'Phase Line', svg: buildPhaseLine, color: '#aa44ff' },
      { id: 'envelopment', name: 'تطويق', nameEn: 'Envelopment', svg: buildEnvelopment, color: '#ff4444' },
      { id: 'penetration', name: 'اختراق', nameEn: 'Penetration', svg: buildPenetration, color: '#ff2200' },
    ]
  },
  defense: {
    label: '🛡️ دفاع',
    items: [
      { id: 'defense-line', name: 'خط دفاع', nameEn: 'Defense Line', svg: buildDefenseLine, color: '#06d6a0' },
      { id: 'battle-position', name: 'موقع قتالي', nameEn: 'Battle Position', svg: buildBattlePosition, color: '#06d6a0' },
      { id: 'engagement-area', name: 'منطقة اشتباك', nameEn: 'Engagement Area', svg: buildEngagementArea, color: '#ffcc00' },
      { id: 'minefield', name: 'حقل ألغام', nameEn: 'Minefield', svg: buildMinefield, color: '#ff4444' },
      { id: 'obstacle', name: 'عائق', nameEn: 'Obstacle', svg: buildObstacle, color: '#ff8800' },
      { id: 'observation-post', name: 'نقطة مراقبة', nameEn: 'Observation Post', svg: buildObservationPost, color: '#44aaff' },
      { id: 'strongpoint', name: 'نقطة حصينة', nameEn: 'Strongpoint', svg: buildStrongpoint, color: '#06d6a0' },
      { id: 'withdrawal', name: 'انسحاب', nameEn: 'Withdrawal Route', svg: buildWithdrawal, color: '#aa44ff' },
    ]
  },
  coordination: {
    label: '📋 تنسيق',
    items: [
      { id: 'boundary', name: 'حد وحدة', nameEn: 'Unit Boundary', svg: buildBoundary, color: '#ffffff' },
      { id: 'fire-support', name: 'منطقة نار', nameEn: 'Fire Support Area', svg: buildFireSupport, color: '#ff4444' },
      { id: 'no-fire-area', name: 'منطقة حظر نار', nameEn: 'No Fire Area', svg: buildNoFireArea, color: '#ffcc00' },
      { id: 'checkpoint', name: 'نقطة تفتيش', nameEn: 'Checkpoint', svg: buildCheckpoint, color: '#44aaff' },
    ]
  }
};

// ===== SVG BUILDERS =====
function buildAttackArrow(c){return `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="30" x2="60" y2="30" stroke="${c}" stroke-width="6"/><polygon points="55,15 75,30 55,45" fill="${c}"/></svg>`;}
function buildSupportArrow(c){return `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="30" x2="65" y2="30" stroke="${c}" stroke-width="4" stroke-dasharray="8 4"/><polygon points="60,15 78,30 60,45" fill="${c}" opacity="0.7"/></svg>`;}
function buildAxisAdvance(c){return `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg"><path d="M5,30 Q25,10 40,30 Q55,50 75,30" stroke="${c}" stroke-width="5" fill="none"/><polygon points="70,20 80,30 70,40" fill="${c}"/></svg>`;}
function buildObjective(c){return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="25" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.15"/><line x1="30" y1="5" x2="30" y2="55" stroke="${c}" stroke-width="2" opacity="0.5"/><line x1="5" y1="30" x2="55" y2="30" stroke="${c}" stroke-width="2" opacity="0.5"/><text x="30" y="34" text-anchor="middle" fill="${c}" font-size="14" font-weight="bold">OBJ</text></svg>`;}
function buildAssemblyArea(c){return `<svg viewBox="0 0 70 60" xmlns="http://www.w3.org/2000/svg"><ellipse cx="35" cy="30" rx="30" ry="22" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.1" stroke-dasharray="6 3"/><text x="35" y="34" text-anchor="middle" fill="${c}" font-size="12" font-weight="bold">AA</text></svg>`;}
function buildPhaseLine(c){return `<svg viewBox="0 0 80 30" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="15" x2="80" y2="15" stroke="${c}" stroke-width="3" stroke-dasharray="10 5"/><text x="40" y="12" text-anchor="middle" fill="${c}" font-size="10" font-weight="bold">PL</text></svg>`;}
function buildEnvelopment(c){return `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg"><path d="M10,50 Q10,10 40,10 Q70,10 70,50" stroke="${c}" stroke-width="4" fill="none"/><polygon points="67,45 75,55 63,55" fill="${c}"/><polygon points="13,45 5,55 17,55" fill="${c}"/></svg>`;}
function buildPenetration(c){return `<svg viewBox="0 0 60 70" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="40" width="50" height="6" fill="${c}" opacity="0.4" rx="2"/><line x1="30" y1="65" x2="30" y2="20" stroke="${c}" stroke-width="5"/><polygon points="20,25 30,5 40,25" fill="${c}"/></svg>`;}
function buildDefenseLine(c){return `<svg viewBox="0 0 80 30" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="15" x2="80" y2="15" stroke="${c}" stroke-width="4"/><line x1="15" y1="15" x2="10" y2="5" stroke="${c}" stroke-width="3"/><line x1="30" y1="15" x2="25" y2="5" stroke="${c}" stroke-width="3"/><line x1="45" y1="15" x2="40" y2="5" stroke="${c}" stroke-width="3"/><line x1="60" y1="15" x2="55" y2="5" stroke="${c}" stroke-width="3"/></svg>`;}
function buildBattlePosition(c){return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg"><path d="M5,45 L5,15 L35,5 L65,15 L65,45 Z" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.12"/><text x="35" y="34" text-anchor="middle" fill="${c}" font-size="13" font-weight="bold">BP</text></svg>`;}
function buildEngagementArea(c){return `<svg viewBox="0 0 70 60" xmlns="http://www.w3.org/2000/svg"><polygon points="35,5 65,25 55,55 15,55 5,25" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.1" stroke-dasharray="5 3"/><text x="35" y="38" text-anchor="middle" fill="${c}" font-size="11" font-weight="bold">EA</text></svg>`;}
function buildMinefield(c){return `<svg viewBox="0 0 70 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="66" height="36" stroke="${c}" stroke-width="2" fill="${c}" fill-opacity="0.08" rx="3"/><line x1="2" y1="2" x2="68" y2="38" stroke="${c}" stroke-width="2"/><line x1="68" y1="2" x2="2" y2="38" stroke="${c}" stroke-width="2"/><text x="35" y="24" text-anchor="middle" fill="${c}" font-size="10" font-weight="bold">M</text></svg>`;}
function buildObstacle(c){return `<svg viewBox="0 0 80 30" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="15" x2="80" y2="15" stroke="${c}" stroke-width="3"/><line x1="15" y1="5" x2="25" y2="25" stroke="${c}" stroke-width="2"/><line x1="25" y1="25" x2="35" y2="5" stroke="${c}" stroke-width="2"/><line x1="35" y1="5" x2="45" y2="25" stroke="${c}" stroke-width="2"/><line x1="45" y1="25" x2="55" y2="5" stroke="${c}" stroke-width="2"/><line x1="55" y1="5" x2="65" y2="25" stroke="${c}" stroke-width="2"/></svg>`;}
function buildObservationPost(c){return `<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg"><circle cx="25" cy="25" r="18" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.1"/><circle cx="25" cy="25" r="5" fill="${c}"/><text x="25" y="46" text-anchor="middle" fill="${c}" font-size="9" font-weight="bold">OP</text></svg>`;}
function buildStrongpoint(c){return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><polygon points="30,5 55,20 55,45 30,55 5,45 5,20" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.15"/><polygon points="30,15 45,25 45,40 30,47 15,40 15,25" stroke="${c}" stroke-width="2" fill="${c}" fill-opacity="0.1"/><text x="30" y="34" text-anchor="middle" fill="${c}" font-size="10" font-weight="bold">SP</text></svg>`;}
function buildWithdrawal(c){return `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg"><path d="M75,30 Q55,10 40,30 Q25,50 5,30" stroke="${c}" stroke-width="4" fill="none" stroke-dasharray="8 4"/><polygon points="10,20 0,30 10,40" fill="${c}" opacity="0.8"/></svg>`;}
function buildBoundary(c){return `<svg viewBox="0 0 80 30" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="15" x2="80" y2="15" stroke="${c}" stroke-width="2" stroke-dasharray="12 4 4 4"/><circle cx="10" cy="15" r="4" fill="${c}"/><circle cx="70" cy="15" r="4" fill="${c}"/></svg>`;}
function buildFireSupport(c){return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="25" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.15"/><line x1="15" y1="15" x2="45" y2="45" stroke="${c}" stroke-width="2"/><line x1="45" y1="15" x2="15" y2="45" stroke="${c}" stroke-width="2"/><text x="30" y="34" text-anchor="middle" fill="${c}" font-size="10" font-weight="bold">FSA</text></svg>`;}
function buildNoFireArea(c){return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="25" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.1" stroke-dasharray="6 3"/><line x1="10" y1="10" x2="50" y2="50" stroke="${c}" stroke-width="3"/><text x="30" y="26" text-anchor="middle" fill="${c}" font-size="9" font-weight="bold">NFA</text></svg>`;}
function buildCheckpoint(c){return `<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="34" height="34" stroke="${c}" stroke-width="3" fill="${c}" fill-opacity="0.12" rx="4"/><text x="25" y="30" text-anchor="middle" fill="${c}" font-size="14" font-weight="bold">CP</text></svg>`;}

// ===== HELPER: build icon with rotation + inline controls when selected =====
function buildIcon(figure, rotation, isSelected) {
  const svgHtml = figure.svg(figure.color);
  const isWide = ['attack-arrow','support-arrow','axis-advance','defense-line',
                  'phase-line','obstacle','boundary','envelopment','withdrawal'].includes(figure.id);
  const w = isWide ? 120 : 70;
  const h = isWide ? 70 : 70;
  const selClass = isSelected ? ' tac-fig-selected' : '';
  
  // Floating rotation toolbar (only when selected)
  const controls = isSelected ? `
    <div class="tac-inline-controls">
      <button class="tac-ic-btn" data-rot="-45">↶45</button>
      <button class="tac-ic-btn" data-rot="-15">↶</button>
      <button class="tac-ic-btn tac-ic-reset" data-rot="reset">⟳</button>
      <button class="tac-ic-btn" data-rot="15">↷</button>
      <button class="tac-ic-btn" data-rot="45">45↷</button>
      <button class="tac-ic-btn tac-ic-del" data-rot="delete">✕</button>
    </div>` : '';
  
  const totalH = isSelected ? h + 16 + 32 : h + 16;
  const anchorY = isSelected ? h/2 + 32 : h/2;
  
  return {
    icon: L.divIcon({
      className: 'tactical-figure-marker',
      html: `${controls}
      <div class="tac-fig-placed${selClass}" style="width:${w}px;height:${h}px;opacity:0.85;transform:rotate(${rotation}deg);">
        ${svgHtml}
        <div class="tac-fig-label">${figure.name} ${rotation !== 0 ? rotation + '°' : ''}</div>
      </div>`,
      iconSize: [Math.max(w, 200), totalH],
      iconAnchor: [Math.max(w, 200)/2, anchorY]
    }),
    w, h
  };
}

// ===== APPLY ROTATION by rebuilding icon (guaranteed to work) =====
function applyRotation(pf) {
  const isSel = (activePF === pf);
  const { icon } = buildIcon(pf.figure, pf.rotation || 0, isSel);
  pf.marker.setIcon(icon);
  // Re-attach click/touch handlers since setIcon replaces DOM
  requestAnimationFrame(() => {
    attachTouchHandlers(pf);
    wireInlineControls(pf);
  });
}

// ===== WIRE INLINE ROTATION BUTTONS =====
function wireInlineControls(pf) {
  const el = pf.marker.getElement();
  if (!el) return;
  
  el.querySelectorAll('.tac-ic-btn').forEach(btn => {
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const action = btn.dataset.rot;
      if (action === 'delete') {
        deleteSingleFigure(pf);
        return;
      }
      if (action === 'reset') {
        pf.rotation = 0;
      } else {
        pf.rotation = (pf.rotation || 0) + parseInt(action);
      }
      applyRotation(pf);
      updateEditBar();
    };
    
    btn.addEventListener('click', handler);
    btn.addEventListener('touchend', handler, { passive: false });
  });
}

// ===== INIT =====
export function initTacticalFigures(mapInstance) {
  map = mapInstance;
  createPanel();
}

// ===== PANEL =====
function createPanel() {
  panel = document.createElement('div');
  panel.id = 'tactical-figures-panel';
  panel.className = 'tac-fig-panel hidden';
  
  let html = `<div class="tac-fig-header">
    <span>🎖️ رموز تكتيكية</span>
    <div class="tac-fig-header-actions">
      <button id="tac-fig-undo" class="tac-fig-action-btn" title="تراجع">↩️</button>
      <button id="tac-fig-delete-all" class="tac-fig-action-btn tac-fig-del-btn" title="حذف الكل">🗑️</button>
      <button id="tac-fig-close" class="tac-fig-close-btn">✕</button>
    </div>
  </div>
  <div class="tac-fig-body">`;
  
  for (const [, group] of Object.entries(FIGURES)) {
    html += `<div class="tac-fig-group">
      <div class="tac-fig-group-label">${group.label}</div>
      <div class="tac-fig-grid">`;
    for (const item of group.items) {
      html += `<button class="tac-fig-item" data-figure="${item.id}" title="${item.name} — ${item.nameEn}">
        <div class="tac-fig-icon">${item.svg(item.color)}</div>
        <span class="tac-fig-name">${item.name}</span>
      </button>`;
    }
    html += `</div></div>`;
  }
  
  html += `</div>
  <div class="tac-fig-edit-bar" id="tac-fig-edit-bar">
    <div class="tac-fig-edit-info" id="tac-fig-edit-info">انقر على رمز موضوع لتحريره</div>
    <div class="tac-fig-edit-controls">
      <button class="tac-rot-btn" id="tac-rot-n45">↶45</button>
      <button class="tac-rot-btn" id="tac-rot-n15">↶15</button>
      <button class="tac-rot-btn tac-rot-reset" id="tac-rot-0">⟳ 0°</button>
      <button class="tac-rot-btn" id="tac-rot-p15">15↷</button>
      <button class="tac-rot-btn" id="tac-rot-p45">45↷</button>
    </div>
    <div class="tac-fig-edit-controls" style="margin-top:4px;">
      <button class="tac-rot-btn tac-rot-del" id="tac-rot-delete">🗑️ حذف</button>
      <button class="tac-rot-btn" id="tac-rot-deselect">✔ تم</button>
    </div>
  </div>
  <div class="tac-fig-footer">
    <div class="tac-fig-footer-row">
      <span class="tac-fig-hint">📱 إصبعين على الرمز = تدوير</span>
      <span class="tac-fig-count" id="tac-fig-counter">0</span>
    </div>
  </div>`;
  
  panel.innerHTML = html;
  document.body.appendChild(panel);
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
  
  // Wire buttons
  document.getElementById('tac-fig-close').addEventListener('click', () => deactivateTacticalFigures());
  document.getElementById('tac-fig-undo').addEventListener('click', undoDelete);
  document.getElementById('tac-fig-delete-all').addEventListener('click', deleteAllFigures);
  document.getElementById('tac-rot-n45').addEventListener('click', () => rotateCurrent(-45));
  document.getElementById('tac-rot-n15').addEventListener('click', () => rotateCurrent(-15));
  document.getElementById('tac-rot-0').addEventListener('click',  () => rotateCurrent(0, true));
  document.getElementById('tac-rot-p15').addEventListener('click', () => rotateCurrent(15));
  document.getElementById('tac-rot-p45').addEventListener('click', () => rotateCurrent(45));
  document.getElementById('tac-rot-delete').addEventListener('click', () => {
    if (activePF) { deleteSingleFigure(activePF); deselectFigure(); }
  });
  document.getElementById('tac-rot-deselect').addEventListener('click', deselectFigure);
  
  panel.querySelectorAll('.tac-fig-item').forEach(btn => {
    btn.addEventListener('click', () => {
      selectFigureFromPalette(btn.dataset.figure);
      panel.querySelectorAll('.tac-fig-item').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  
  updateEditBar();
}

function updateCounter() {
  const el = document.getElementById('tac-fig-counter');
  if (el) el.textContent = placedFigures.length;
}

function updateEditBar() {
  const info = document.getElementById('tac-fig-edit-info');
  const bar = document.getElementById('tac-fig-edit-bar');
  if (!info || !bar) return;
  if (activePF) {
    bar.classList.add('tac-fig-edit-active');
    info.innerHTML = `<strong style="color:#06d6a0">✎ ${activePF.figure.name}</strong> — <span style="color:#44aaff;font-size:1rem;">${activePF.rotation || 0}°</span>`;
  } else {
    bar.classList.remove('tac-fig-edit-active');
    info.textContent = 'انقر على رمز موضوع لتحريره';
  }
}

// ===== PALETTE SELECTION =====
function selectFigureFromPalette(figId) {
  deselectFigure();
  for (const group of Object.values(FIGURES)) {
    const item = group.items.find(i => i.id === figId);
    if (item) {
      selectedFigure = item;
      showToast(`✅ انقر على الخريطة لوضع: ${item.name}`, 'info');
      document.getElementById('map').style.cursor = 'crosshair';
      return;
    }
  }
}

// ===== FIGURE SELECTION =====
function selectPlacedFigure(pf) {
  if (activePF && activePF !== pf) applyRotation(activePF); // deselect old (remove glow)
  selectedFigure = null;
  document.getElementById('map').style.cursor = '';
  panel?.querySelectorAll('.tac-fig-item').forEach(b => b.classList.remove('selected'));
  activePF = pf;
  applyRotation(pf); // rebuild icon with glow
  updateEditBar();
  showToast(`🎖️ ${pf.figure.name} — ${pf.rotation || 0}°`, 'info');
}

function deselectFigure() {
  if (activePF) applyRotation(activePF); // rebuild without glow
  activePF = null;
  updateEditBar();
}

// ===== ROTATION =====
function rotateCurrent(deg, reset = false) {
  if (!activePF) { showToast('اختر رمزاً أولاً بالنقر عليه', 'info'); return; }
  if (reset) {
    activePF.rotation = 0;
  } else {
    activePF.rotation = (activePF.rotation || 0) + deg;
  }
  applyRotation(activePF);
  updateEditBar();
}

// ===== TOUCH HANDLERS (tap, long-press, two-finger rotate) =====
function attachTouchHandlers(pf) {
  const el = pf.marker.getElement();
  if (!el) return;
  
  let tapStart = 0;
  let tapPos = null;
  let longTimer = null;
  let didDrag = false;
  
  // --- Two-finger rotation state ---
  let rotateStartAngle = 0;
  let rotateStartRot = 0;
  let isRotating = false;
  
  function getAngle(t1, t2) {
    return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);
  }
  
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      // TWO-FINGER: start rotation
      e.preventDefault();
      e.stopPropagation();
      isRotating = true;
      rotateStartAngle = getAngle(e.touches[0], e.touches[1]);
      rotateStartRot = pf.rotation || 0;
      if (activePF !== pf) selectPlacedFigure(pf);
      map.dragging.disable();
      try { map.touchZoom.disable(); } catch(x){}
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
    } else if (e.touches.length === 1) {
      // ONE-FINGER: start tap/long-press detection
      tapStart = Date.now();
      tapPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      didDrag = false;
      longTimer = setTimeout(() => {
        longTimer = null;
        deleteSingleFigure(pf);
      }, 800);
    }
  }, { passive: false });
  
  el.addEventListener('touchmove', (e) => {
    if (isRotating && e.touches.length === 2) {
      e.preventDefault();
      e.stopPropagation();
      const cur = getAngle(e.touches[0], e.touches[1]);
      pf.rotation = Math.round(rotateStartRot + (cur - rotateStartAngle));
      // Live update: directly set transform on current element
      const inner = el.querySelector('.tac-fig-placed');
      if (inner) inner.style.transform = `rotate(${pf.rotation}deg)`;
      updateEditBar();
    } else if (e.touches.length === 1 && tapPos) {
      const dx = e.touches[0].clientX - tapPos.x;
      const dy = e.touches[0].clientY - tapPos.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        didDrag = true;
        if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      }
    }
  }, { passive: false });
  
  const onEnd = (e) => {
    if (longTimer) { clearTimeout(longTimer); longTimer = null; }
    if (isRotating) {
      isRotating = false;
      map.dragging.enable();
      try { map.touchZoom.enable(); } catch(x){}
      // Finalize rotation with setIcon
      applyRotation(pf);
      return;
    }
    // Quick tap = select
    if (!didDrag && tapStart && (Date.now() - tapStart < 400)) {
      if (selectedFigure) return;
      e.preventDefault();
      e.stopPropagation();
      if (activePF === pf) deselectFigure(); else selectPlacedFigure(pf);
    }
    tapStart = 0;
    tapPos = null;
  };
  
  el.addEventListener('touchend', onEnd, { passive: false });
  el.addEventListener('touchcancel', onEnd, { passive: false });
}

// ===== DELETE & UNDO =====
function deleteAllFigures() {
  if (placedFigures.length === 0) { showToast('لا يوجد رموز', 'info'); return; }
  if (!confirm(`🗑️ حذف جميع الرموز (${placedFigures.length})؟`)) return;
  deselectFigure();
  placedFigures.forEach(pf => {
    undoStack.push({ figure: pf.figure, latlng: pf.marker.getLatLng(), rotation: pf.rotation || 0 });
    map.removeLayer(pf.marker);
  });
  placedFigures = [];
  updateCounter();
  showToast('🗑️ تم حذف الكل', 'info');
}

function deleteSingleFigure(pf) {
  undoStack.push({ figure: pf.figure, latlng: pf.marker.getLatLng(), rotation: pf.rotation || 0 });
  map.removeLayer(pf.marker);
  placedFigures = placedFigures.filter(f => f !== pf);
  if (activePF === pf) { activePF = null; updateEditBar(); }
  updateCounter();
  showToast(`🗑️ حذف: ${pf.figure.name}`, 'info');
}

function undoDelete() {
  if (undoStack.length === 0) { showToast('لا يوجد شيء للتراجع', 'info'); return; }
  const r = undoStack.pop();
  placeFigureAt(r.figure, r.latlng, r.rotation || 0);
  showToast(`↩️ استعادة: ${r.figure.name}`, 'success');
}

// ===== TOGGLE =====
export function toggleTacticalFigures() {
  isActive ? deactivateTacticalFigures() : activateTacticalFigures();
}

function activateTacticalFigures() {
  isActive = true;
  if (panel) panel.classList.remove('hidden');
  map.on('click', onMapClick);
  updateCounter();
  updateEditBar();
  const btn = document.getElementById('btn-freehand');
  if (btn) btn.classList.add('active');
}

export function deactivateTacticalFigures() {
  isActive = false;
  selectedFigure = null;
  deselectFigure();
  if (panel) panel.classList.add('hidden');
  map.off('click', onMapClick);
  document.getElementById('map').style.cursor = '';
  panel?.querySelectorAll('.tac-fig-item').forEach(b => b.classList.remove('selected'));
  const btn = document.getElementById('btn-freehand');
  if (btn) btn.classList.remove('active');
}

function onMapClick(e) {
  if (e.originalEvent?.target?.closest?.('#tactical-figures-panel')) return;
  if (selectedFigure && isActive) { placeFigureAt(selectedFigure, e.latlng, 0); return; }
  if (activePF) deselectFigure();
}

// ===== PLACE FIGURE =====
function placeFigureAt(figure, latlng, rotation = 0) {
  const fid = ++figIdCounter;
  const { icon } = buildIcon(figure, rotation, false);
  
  const marker = L.marker(latlng, { icon, draggable: true, zIndexOffset: 500 }).addTo(map);
  const pf = { marker, figure, latlng, rotation, id: fid };
  
  // Leaflet events (Windows)
  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    if (selectedFigure) return;
    if (activePF === pf) deselectFigure(); else selectPlacedFigure(pf);
  });
  marker.on('contextmenu', (e) => {
    L.DomEvent.stopPropagation(e);
    deleteSingleFigure(pf);
  });
  
  placedFigures.push(pf);
  updateCounter();
  
  // Touch handlers (Android)
  requestAnimationFrame(() => attachTouchHandlers(pf));
  
  showToast(`🎖️ ${figure.name}`, 'success');
}

// ===== EXPORTS =====
export function isTacticalFiguresActive() { return isActive; }
