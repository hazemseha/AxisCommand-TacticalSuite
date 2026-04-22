/**
 * mortar-fcs.js — Dedicated Mortar Fire Control System
 * A standalone weapon mode for mortar fire calculations.
 * 
 * DOES NOT conflict with the general azimuth/measurement tools.
 * Self-contained module with its own layer group, UI panel, and event handlers.
 * 
 * Features:
 * - Baseplate placement with min/max range rings
 * - Weapon-locked targeting lines (always from baseplate)
 * - NATO (6400) and Soviet (6000) mil system toggle
 * - Range validation (too close / too far warnings)
 * - Multiple simultaneous targets
 * - Elevation angle estimation
 * - 62mm and 82mm mortar presets
 */
import L from 'leaflet';
import { t } from './i18n.js';
import { showToast } from './toast.js';

// State
let map = null;
let mortarLayer = null;
let mortarActive = false;
let baseplatePos = null;
let baseplateMarker = null;
let minRangeCircle = null;
let maxRangeCircle = null;
let previewLine = null;
let targets = [];
let targetIdCounter = 0;

// Config (defaults to Soviet)
let milSystem = 'soviet'; // 'soviet' | 'nato'
let mortarType = '82mm';  // '62mm' | '82mm'
let minRange = 70;
let maxRange = 6000;

// Charge tables for different mortars
const MORTAR_CONFIGS = {
  '62mm': {
    name: '62mm',
    minRange: 50,
    maxRange: 3500,
    charges: [
      { charge: 0, min: 50,  max: 600 },
      { charge: 1, min: 150, max: 1200 },
      { charge: 2, min: 300, max: 2000 },
      { charge: 3, min: 500, max: 3500 }
    ]
  },
  '82mm': {
    name: '82mm',
    minRange: 70,
    maxRange: 6000,
    charges: [
      { charge: 0, min: 70,  max: 800 },
      { charge: 1, min: 200, max: 1600 },
      { charge: 2, min: 400, max: 2800 },
      { charge: 3, min: 600, max: 4200 },
      { charge: 4, min: 800, max: 6000 }
    ]
  },
  '120mm': {
    name: '120mm',
    minRange: 400,
    maxRange: 9500,
    charges: [
      { charge: 0, min: 400, max: 1500 },
      { charge: 1, min: 800, max: 3000 },
      { charge: 2, min: 1500, max: 5000 },
      { charge: 3, min: 2500, max: 7000 },
      { charge: 4, min: 3500, max: 8500 },
      { charge: 5, min: 4500, max: 9500 }
    ]
  }
};

const DEG_TO_MIL = { nato: 6400 / 360, soviet: 6000 / 360 };

export function initMortarFCS(mapInstance) {
  map = mapInstance;
  mortarLayer = L.layerGroup().addTo(map);
}

export function toggleMortarMode() {
  if (mortarActive) {
    deactivateMortar();
  } else {
    activateMortar();
  }
}

function activateMortar() {
  mortarActive = true;
  baseplatePos = null;

  const btn = document.getElementById('btn-mortar-fcs');
  if (btn) btn.classList.add('active');

  showMortarPanel();
  document.getElementById('map').style.cursor = 'crosshair';
  showToast('💥 ' + (t('mortarHint') || 'انقر لوضع قاعدة الهاون'), 'info');

  map.on('click', onMortarClick);
  map.on('mousemove', onMortarMove);
}

function deactivateMortar() {
  mortarActive = false;

  const btn = document.getElementById('btn-mortar-fcs');
  if (btn) btn.classList.remove('active');

  document.getElementById('map').style.cursor = '';
  if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
  removeMortarPanel();

  map.off('click', onMortarClick);
  map.off('mousemove', onMortarMove);
}

// ===== MAP INTERACTION =====

function onMortarClick(e) {
  if (!mortarActive) return;
  
  // CRITICAL: Ignore clicks that originate from our panel UI
  // Check if the click target is inside the mortar panel
  const panel = document.getElementById('mortar-panel');
  if (panel && panel.contains(e.originalEvent?.target)) return;

  if (!baseplatePos) {
    placeBaseplate(e.latlng);
  } else {
    placeTarget(e.latlng);
  }
}

function onMortarMove(e) {
  if (!mortarActive || !baseplatePos) return;

  const dist = map.distance(baseplatePos, e.latlng);
  const bearing = calculateBearing(baseplatePos.lat, baseplatePos.lng, e.latlng.lat, e.latlng.lng);
  const mils = Math.round(bearing * DEG_TO_MIL[milSystem]);

  // Preview line
  if (previewLine) {
    previewLine.setLatLngs([baseplatePos, e.latlng]);
  } else {
    previewLine = L.polyline([baseplatePos, e.latlng], {
      color: '#ef4444', weight: 1.5, dashArray: '6 4', opacity: 0.6
    }).addTo(map);
  }

  // Update live data in panel
  updateLiveData(dist, bearing, mils);
}

// ===== BASEPLATE =====

function placeBaseplate(latlng) {
  // Clear previous
  mortarLayer.clearLayers();
  targets = [];
  targetIdCounter = 0;

  baseplatePos = latlng;
  
  // Apply mortar type config
  const cfg = MORTAR_CONFIGS[mortarType];
  minRange = cfg.minRange;
  maxRange = cfg.maxRange;

  // Baseplate marker — DRAGGABLE
  baseplateMarker = L.marker(baseplatePos, {
    icon: L.divIcon({
      className: 'mortar-baseplate-icon',
      html: `<div class="mortar-bp">💥</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    }),
    zIndexOffset: 1000,
    draggable: true
  }).addTo(mortarLayer);

  baseplateMarker.bindTooltip(`${t('mortarBaseplate') || 'قاعدة الهاون'} (${mortarType}) — ${t('mortarDragHint') || 'اسحب للتحريك'}`, {
    permanent: true, direction: 'bottom', className: 'mortar-tooltip',
    offset: [0, 14]
  });

  // Drag handler — move rings with baseplate
  baseplateMarker.on('drag', (e) => {
    baseplatePos = e.target.getLatLng();
    if (minRangeCircle) minRangeCircle.setLatLng(baseplatePos);
    if (maxRangeCircle) maxRangeCircle.setLatLng(baseplatePos);
  });

  baseplateMarker.on('dragend', (e) => {
    baseplatePos = e.target.getLatLng();
    if (minRangeCircle) minRangeCircle.setLatLng(baseplatePos);
    if (maxRangeCircle) maxRangeCircle.setLatLng(baseplatePos);
    showToast('📍 ' + (t('mortarMoved') || 'تم تحريك قاعدة الهاون'), 'info');
  });

  // Right-click to delete baseplate
  baseplateMarker.on('contextmenu', (ev) => {
    L.DomEvent.stopPropagation(ev);
    mortarLayer.clearLayers();
    targets = [];
    baseplatePos = null;
    baseplateMarker = null;
    minRangeCircle = null;
    maxRangeCircle = null;
    targetIdCounter = 0;
    updateMortarPanel();
    showToast('🗑️ ' + (t('mortarAllCleared') || 'تم مسح قاعدة الهاون'), 'info');
  });

  // Min range ring (RED — danger close)
  minRangeCircle = L.circle(baseplatePos, {
    radius: minRange,
    color: '#ef4444',
    weight: 2,
    dashArray: '8 4',
    fillColor: '#ef4444',
    fillOpacity: 0.08,
    interactive: false
  }).addTo(mortarLayer);

  // Max range ring (GREEN — max effective)
  maxRangeCircle = L.circle(baseplatePos, {
    radius: maxRange,
    color: '#22c55e',
    weight: 2,
    fillColor: '#22c55e',
    fillOpacity: 0.03,
    interactive: false
  }).addTo(mortarLayer);

  showToast(`📍 ${mortarType} — ` + (t('mortarPlaced') || 'قاعدة الهاون موضوعة — انقر الأهداف'), 'success');
  updateMortarPanel();
}

// ===== TARGETING =====

function placeTarget(latlng) {
  const dist = map.distance(baseplatePos, latlng);
  const bearing = calculateBearing(baseplatePos.lat, baseplatePos.lng, latlng.lat, latlng.lng);
  const mils = Math.round(bearing * DEG_TO_MIL[milSystem]);
  const milLabel = milSystem === 'nato' ? 'NATO' : 'RU';

  // Range status
  let rangeStatus, rangeColor, rangeIcon;
  if (dist < minRange) {
    rangeStatus = t('mortarTooClose') || '⚠️ خطر! قريب جداً';
    rangeColor = '#ef4444';
    rangeIcon = '🚫';
  } else if (dist > maxRange) {
    rangeStatus = t('mortarTooFar') || '⚠️ خارج المدى';
    rangeColor = '#fbbf24';
    rangeIcon = '⚠️';
  } else {
    rangeStatus = t('mortarInRange') || '✅ في المدى';
    rangeColor = '#22c55e';
    rangeIcon = '🎯';
  }

  const charge = getOptimalCharge(dist);

  // Targeting line
  const lineColor = dist < minRange ? '#ef4444' : dist > maxRange ? '#fbbf24' : '#22c55e';
  const line = L.polyline([baseplatePos, latlng], {
    color: lineColor, weight: 2.5, dashArray: '10 5', opacity: 0.85
  }).addTo(mortarLayer);

  // Target marker
  targetIdCounter++;
  const tgtId = `T${targetIdCounter}`;

  const tgtMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'mortar-target-icon',
      html: `<div class="mortar-tgt" style="border-color:${lineColor};">${rangeIcon}<span>${tgtId}</span></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    })
  }).addTo(mortarLayer);

  // Target info popup
  const popupContent = `
    <div class="mortar-popup">
      <div class="mortar-popup-header" style="color:${lineColor};">${rangeIcon} ${tgtId} — ${rangeStatus}</div>
      <table class="mortar-table">
        <tr><td>${t('distance') || 'المسافة'}</td><td><strong>${Math.round(dist)}m</strong></td></tr>
        <tr><td>${t('azimuthTitle') || 'الاتجاه'}</td><td><strong>${bearing.toFixed(1)}°</strong></td></tr>
        <tr><td>Mils (${milLabel})</td><td><strong>${mils}</strong></td></tr>
        <tr><td>${t('mortarCharge') || 'الشحنة'}</td><td><strong>${charge !== null ? charge : '—'}</strong></td></tr>
        <tr><td>${t('mortarElevation') || 'زاوية الرمي'}</td><td><strong>${estimateElevation(dist)}°</strong></td></tr>
      </table>
      <button class="mortar-delete-btn" onclick="document.dispatchEvent(new CustomEvent('mortar-delete-target', {detail:'${tgtId}'}))">🗑️ ${t('delete') || 'حذف'} ${tgtId}</button>
    </div>
  `;

  tgtMarker.bindPopup(popupContent, { className: 'mortar-popup-container', maxWidth: 250 });

  // Bearing label on line
  const midLat = (baseplatePos.lat + latlng.lat) / 2;
  const midLng = (baseplatePos.lng + latlng.lng) / 2;
  const label = L.marker([midLat, midLng], {
    icon: L.divIcon({
      className: 'mortar-line-label',
      html: `<span style="color:${lineColor};">${mils} ${milLabel} | ${Math.round(dist)}m</span>`,
      iconSize: [130, 18], iconAnchor: [65, 9]
    }),
    interactive: false
  }).addTo(mortarLayer);

  // Store target
  const targetData = { id: tgtId, latlng, dist, bearing, mils, rangeStatus, layers: [line, tgtMarker, label] };
  targets.push(targetData);

  // Right-click to delete
  tgtMarker.on('contextmenu', (ev) => {
    L.DomEvent.stopPropagation(ev);
    deleteTarget(tgtId);
  });

  // Global delete event
  const deleteHandler = (e) => {
    if (e.detail === tgtId) {
      deleteTarget(tgtId);
      document.removeEventListener('mortar-delete-target', deleteHandler);
    }
  };
  document.addEventListener('mortar-delete-target', deleteHandler);

  // Toast
  if (dist < minRange) {
    showToast(`🚫 ${tgtId}: ${Math.round(dist)}m — ${t('mortarTooClose') || 'خطر! قريب جداً!'}`, 'error');
  } else if (dist > maxRange) {
    showToast(`⚠️ ${tgtId}: ${Math.round(dist)}m — ${t('mortarTooFar') || 'خارج المدى!'}`, 'warning');
  } else {
    showToast(`🎯 ${tgtId}: ${mils} ${milLabel} | ${Math.round(dist)}m | ${t('mortarCharge') || 'شحنة'} ${charge}`, 'success');
  }

  if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
  updateTargetList();
}

function deleteTarget(tgtId) {
  const idx = targets.findIndex(t => t.id === tgtId);
  if (idx === -1) return;
  targets[idx].layers.forEach(l => { if (mortarLayer.hasLayer(l)) mortarLayer.removeLayer(l); });
  targets.splice(idx, 1);
  showToast(`🗑️ ${tgtId} ${t('deleted') || 'محذوف'}`, 'info');
  updateTargetList();
}

function getOptimalCharge(dist) {
  const cfg = MORTAR_CONFIGS[mortarType];
  for (const c of cfg.charges) {
    if (dist >= c.min && dist <= c.max) return c.charge;
  }
  return null;
}

function estimateElevation(dist) {
  if (dist <= 0) return 0;
  const ratio = Math.min(dist / maxRange, 1);
  const elev = 85 - (ratio * 40);
  return elev.toFixed(1);
}

// ===== MATH =====

function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

// ===== UI PANEL =====

function showMortarPanel() {
  removeMortarPanel();
  
  const panel = document.createElement('div');
  panel.id = 'mortar-panel';
  panel.className = 'mortar-panel';
  panel.innerHTML = buildPanelHTML();
  document.getElementById('map').appendChild(panel);
  
  // CRITICAL: Stop all clicks inside the panel from reaching the map
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  panel.addEventListener('dblclick', (e) => e.stopPropagation());
  
  wirePanelEvents();
}

function updateMortarPanel() {
  const panel = document.getElementById('mortar-panel');
  if (!panel) return;
  panel.innerHTML = buildPanelHTML();
  wirePanelEvents();
}

function buildPanelHTML() {
  const milLabel = milSystem === 'nato' ? 'NATO 6400' : 'RU 6000';
  const isNato = milSystem === 'nato';
  const cfg = MORTAR_CONFIGS[mortarType];
  
  return `
    <div class="mortar-panel-header">
      <span>💥 ${t('mortarTitle') || 'نظام إدارة نار الهاون'}</span>
      <button id="mortar-close" class="los-close-btn">✕</button>
    </div>
    
    <div class="mortar-mil-toggle" style="margin-bottom:6px;">
      <button class="mortar-mil-btn ${mortarType === '62mm' ? 'active' : ''}" data-type="62mm">
        62mm
      </button>
      <button class="mortar-mil-btn ${mortarType === '82mm' ? 'active' : ''}" data-type="82mm">
        82mm
      </button>
      <button class="mortar-mil-btn ${mortarType === '120mm' ? 'active' : ''}" data-type="120mm">
        120mm
      </button>
    </div>

    <div class="mortar-mil-toggle">
      <button class="mortar-mil-btn ${!isNato ? 'active' : ''}" data-mil="soviet">
        🔴 RU 6000
      </button>
      <button class="mortar-mil-btn ${isNato ? 'active' : ''}" data-mil="nato">
        🔵 NATO 6400
      </button>
    </div>

    <div class="mortar-range-config">
      <div class="mortar-range-row">
        <label>🔴 ${t('mortarMinRange') || 'الحد الأدنى'}:</label>
        <input type="number" id="mortar-min" value="${minRange}" min="10" max="500" step="10" />
        <span>m</span>
      </div>
      <div class="mortar-range-row">
        <label>🟢 ${t('mortarMaxRange') || 'المدى الأقصى'}:</label>
        <input type="number" id="mortar-max" value="${maxRange}" min="500" max="15000" step="100" />
        <span>m</span>
      </div>
    </div>

    <div id="mortar-live-data" class="mortar-live-data hidden">
      <div class="mortar-live-bearing">---°</div>
      <div class="mortar-live-mils">--- <span>${milLabel}</span></div>
      <div class="mortar-live-dist">--- m</div>
    </div>

    <div id="mortar-target-list" class="mortar-target-list">
      ${targets.length === 0 ? `<div class="mortar-no-targets">${baseplatePos ? (t('mortarClickTarget') || 'انقر على الخريطة لتحديد الأهداف') : (t('mortarHint') || 'انقر لوضع قاعدة الهاون')}</div>` : ''}
      ${targets.map(tgt => {
        const statusIcon = tgt.dist < minRange ? '🚫' : tgt.dist > maxRange ? '⚠️' : '🎯';
        const charge = getOptimalCharge(tgt.dist);
        return `<div class="mortar-tgt-item">
          <span class="mortar-tgt-id">${statusIcon} ${tgt.id}</span>
          <span class="mortar-tgt-info">${tgt.mils} mil | ${Math.round(tgt.dist)}m${charge !== null ? ' | C' + charge : ''}</span>
          <button class="mortar-tgt-delete" data-tgt="${tgt.id}">✕</button>
        </div>`;
      }).join('')}
    </div>

    <div class="mortar-actions">
      <button id="mortar-clear-all" class="los-action-btn">${t('mortarClearAll') || 'مسح الكل'}</button>
      <button id="mortar-done" class="los-action-btn" style="color:#06d6a0; border-color:rgba(6,214,160,0.3);">${t('azimuthDone') || 'إنهاء'}</button>
    </div>
  `;
}

function wirePanelEvents() {
  // Close
  const closeBtn = document.getElementById('mortar-close');
  if (closeBtn) closeBtn.onclick = () => deactivateMortar();

  // Mortar type toggle (62mm / 82mm)
  document.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      mortarType = btn.dataset.type;
      const cfg = MORTAR_CONFIGS[mortarType];
      minRange = cfg.minRange;
      maxRange = cfg.maxRange;
      if (minRangeCircle) minRangeCircle.setRadius(minRange);
      if (maxRangeCircle) maxRangeCircle.setRadius(maxRange);
      updateMortarPanel();
      showToast(`💥 ${mortarType} — ${cfg.minRange}m-${cfg.maxRange}m`, 'info');
    });
  });

  // Mil system toggle
  document.querySelectorAll('[data-mil]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      milSystem = btn.dataset.mil;
      targets.forEach(tgt => {
        tgt.mils = Math.round(tgt.bearing * DEG_TO_MIL[milSystem]);
      });
      updateMortarPanel();
      showToast(`${milSystem === 'nato' ? '🔵 NATO 6400' : '🔴 RU 6000'} ${t('mortarMilChanged') || 'نظام المل محدث'}`, 'info');
    });
  });

  // Range inputs
  const minInput = document.getElementById('mortar-min');
  const maxInput = document.getElementById('mortar-max');
  if (minInput) minInput.addEventListener('change', () => {
    minRange = parseInt(minInput.value) || 70;
    if (minRangeCircle) minRangeCircle.setRadius(minRange);
    updateTargetList();
  });
  if (maxInput) maxInput.addEventListener('change', () => {
    maxRange = parseInt(maxInput.value) || 6000;
    if (maxRangeCircle) maxRangeCircle.setRadius(maxRange);
    updateTargetList();
  });

  // Target delete buttons — with stopPropagation
  document.querySelectorAll('.mortar-tgt-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTarget(btn.dataset.tgt);
    });
  });

  // Clear all
  const clearBtn = document.getElementById('mortar-clear-all');
  if (clearBtn) clearBtn.onclick = (e) => {
    e.stopPropagation();
    mortarLayer.clearLayers();
    targets = [];
    baseplatePos = null;
    baseplateMarker = null;
    minRangeCircle = null;
    maxRangeCircle = null;
    targetIdCounter = 0;
    updateMortarPanel();
    showToast('🗑️ ' + (t('mortarAllCleared') || 'تم مسح كل البيانات'), 'info');
  };

  // Done
  const doneBtn = document.getElementById('mortar-done');
  if (doneBtn) doneBtn.onclick = (e) => {
    e.stopPropagation();
    deactivateMortar();
  };
}

function updateLiveData(dist, bearing, mils) {
  const liveEl = document.getElementById('mortar-live-data');
  if (!liveEl) return;
  liveEl.classList.remove('hidden');
  
  const milLabel = milSystem === 'nato' ? 'NATO' : 'RU';
  let distColor = '#22c55e';
  if (dist < minRange) distColor = '#ef4444';
  else if (dist > maxRange) distColor = '#fbbf24';
  
  liveEl.innerHTML = `
    <div class="mortar-live-bearing">${bearing.toFixed(1)}°</div>
    <div class="mortar-live-mils">${mils} <span>${milLabel}</span></div>
    <div class="mortar-live-dist" style="color:${distColor};">${Math.round(dist)} m</div>
  `;
}

function updateTargetList() {
  targets.forEach(tgt => {
    tgt.dist = map.distance(baseplatePos, tgt.latlng);
    tgt.mils = Math.round(tgt.bearing * DEG_TO_MIL[milSystem]);
  });
  updateMortarPanel();
}

function removeMortarPanel() {
  const panel = document.getElementById('mortar-panel');
  if (panel) panel.remove();
}

export function clearMortarFCS() {
  mortarLayer.clearLayers();
  targets = [];
  baseplatePos = null;
  targetIdCounter = 0;
}
