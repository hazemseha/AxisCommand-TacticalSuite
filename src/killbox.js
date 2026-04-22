/**
 * killbox.js — Kill Box & Targeting Grid System
 * Draws numbered tactical grid squares over operational areas
 * for rapid communication between units.
 * Fully offline — all rendering client-side with Leaflet.
 */
import L from 'leaflet';
import { t, getLang } from './i18n.js';
import { showToast } from './toast.js';

let map = null;
let gridLayer = null;
let isDefiningArea = false;
let firstCorner = null;
let previewRect = null;
let activeGrids = [];
let cornerMarkers = [];  // Track temporary corner markers

// Grid alphabet for row labels
const ALPHA_EN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHA_AR = 'أبتثجحخدذرزسشصضطظعغفقكلمنه';

function getAlpha() {
  return getLang() === 'ar' ? ALPHA_AR : ALPHA_EN;
}

export function initKillBox(mapInstance) {
  map = mapInstance;
  gridLayer = L.layerGroup().addTo(map);
}

/**
 * Toggle grid definition mode — user clicks two corners
 */
export function toggleKillBoxMode() {
  const btn = document.getElementById('btn-killbox');
  
  if (isDefiningArea) {
    cancelDefine();
    return;
  }

  isDefiningArea = true;
  firstCorner = null;
  if (btn) btn.classList.add('active');
  
  document.getElementById('map').style.cursor = 'crosshair';
  showToast(t('killboxHint') || '🎯 انقر على الزاوية الأولى لشبكة القتل', 'info');

  map.on('click', onMapClick);
  map.on('mousemove', onMouseMove);
}

function cancelDefine() {
  isDefiningArea = false;
  firstCorner = null;
  if (previewRect) { map.removeLayer(previewRect); previewRect = null; }
  
  const btn = document.getElementById('btn-killbox');
  if (btn) btn.classList.remove('active');
  
  document.getElementById('map').style.cursor = '';
  map.off('click', onMapClick);
  map.off('mousemove', onMouseMove);
}

function onMouseMove(e) {
  if (!firstCorner || !isDefiningArea) return;
  
  // Show preview rectangle
  const bounds = L.latLngBounds(firstCorner, e.latlng);
  if (previewRect) {
    previewRect.setBounds(bounds);
  } else {
    previewRect = L.rectangle(bounds, {
      color: '#f97316',
      weight: 2,
      fillOpacity: 0.1,
      dashArray: '8 4'
    }).addTo(map);
  }
}

function onMapClick(e) {
  if (!isDefiningArea) return;

  if (!firstCorner) {
    // First click — set first corner
    firstCorner = e.latlng;
    showToast(t('killboxSecondCorner') || '📐 انقر على الزاوية الثانية (القطرية)', 'info');
    
    // Add temporary marker — tracked for cleanup
    const cm = L.circleMarker(firstCorner, {
      radius: 6, color: '#f97316', fillColor: '#f97316',
      fillOpacity: 1, weight: 2
    }).addTo(map);
    cornerMarkers.push(cm);
    
  } else {
    // Second click — create the grid
    const bounds = L.latLngBounds(firstCorner, e.latlng);
    
    if (previewRect) { map.removeLayer(previewRect); previewRect = null; }
    
    // Clean up corner markers
    cornerMarkers.forEach(cm => map.removeLayer(cm));
    cornerMarkers = [];
    
    showGridConfigDialog(bounds);
    cancelDefine();
  }
}

/**
 * Show configuration dialog for grid settings
 */
function showGridConfigDialog(bounds) {
  // Remove existing dialog if any
  let dialog = document.getElementById('killbox-dialog');
  if (dialog) dialog.remove();

  dialog = document.createElement('div');
  dialog.id = 'killbox-dialog';
  dialog.className = 'killbox-dialog';
  dialog.innerHTML = `
    <div class="killbox-dialog-content">
      <h3>🎯 ${t('killboxTitle') || 'إعدادات شبكة الكيل بوكس'}</h3>
      
      <div class="killbox-field">
        <label>${t('killboxGridName') || 'اسم الشبكة'}</label>
        <input type="text" id="kb-name" value="GRID-${activeGrids.length + 1}" maxlength="20" />
      </div>
      
      <div class="killbox-field">
        <label>${t('killboxCols') || 'أعمدة (أرقام)'}</label>
        <input type="range" id="kb-cols" min="2" max="26" value="6" />
        <span id="kb-cols-val">6</span>
      </div>
      
      <div class="killbox-field">
        <label>${t('killboxRows') || 'صفوف (أحرف)'}</label>
        <input type="range" id="kb-rows" min="2" max="26" value="6" />
        <span id="kb-rows-val">6</span>
      </div>
      
      <div class="killbox-field">
        <label>${t('killboxColor') || 'اللون'}</label>
        <div class="killbox-colors">
          <button class="kb-color-btn active" data-color="#f97316" style="background:#f97316;"></button>
          <button class="kb-color-btn" data-color="#ef4444" style="background:#ef4444;"></button>
          <button class="kb-color-btn" data-color="#22d3ee" style="background:#22d3ee;"></button>
          <button class="kb-color-btn" data-color="#06d6a0" style="background:#06d6a0;"></button>
          <button class="kb-color-btn" data-color="#a78bfa" style="background:#a78bfa;"></button>
          <button class="kb-color-btn" data-color="#fbbf24" style="background:#fbbf24;"></button>
        </div>
      </div>
      
      <div class="killbox-field">
        <label>${t('killboxOpacity') || 'الشفافية'}</label>
        <input type="range" id="kb-opacity" min="10" max="100" value="60" step="5" />
        <span id="kb-opacity-val">60%</span>
      </div>
      
      <div class="killbox-actions">
        <button id="kb-cancel" class="btn btn-danger">${t('cancel') || 'إلغاء'}</button>
        <button id="kb-create" class="btn btn-primary">🎯 ${t('killboxCreate') || 'إنشاء الشبكة'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  // Wire up sliders
  const colsSlider = document.getElementById('kb-cols');
  const rowsSlider = document.getElementById('kb-rows');
  const opacitySlider = document.getElementById('kb-opacity');
  
  colsSlider.addEventListener('input', () => {
    document.getElementById('kb-cols-val').textContent = colsSlider.value;
  });
  rowsSlider.addEventListener('input', () => {
    document.getElementById('kb-rows-val').textContent = rowsSlider.value;
  });
  opacitySlider.addEventListener('input', () => {
    document.getElementById('kb-opacity-val').textContent = opacitySlider.value + '%';
  });

  // Color picker
  let selectedColor = '#f97316';
  dialog.querySelectorAll('.kb-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      dialog.querySelectorAll('.kb-color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedColor = btn.dataset.color;
    });
  });

  // Cancel
  document.getElementById('kb-cancel').addEventListener('click', () => dialog.remove());

  // Create
  document.getElementById('kb-create').addEventListener('click', () => {
    const name = document.getElementById('kb-name').value || `GRID-${activeGrids.length + 1}`;
    const cols = parseInt(colsSlider.value);
    const rows = parseInt(rowsSlider.value);
    const opacity = parseInt(opacitySlider.value) / 100;
    
    createGrid(bounds, name, cols, rows, selectedColor, opacity);
    dialog.remove();
  });
}

/**
 * Create a numbered tactical grid
 */
function createGrid(bounds, name, cols, rows, color, opacity) {
  const gridGroup = L.layerGroup();
  
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  
  const cellH = (north - south) / rows;
  const cellW = (east - west) / cols;

  // Outer border (thicker — visible in print)
  L.rectangle(bounds, {
    color: color,
    weight: 3,
    fillOpacity: 0,
    opacity: Math.max(opacity, 0.8)
  }).addTo(gridGroup);

  // Draw grid lines and labels
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellS = south + r * cellH;
      const cellN = south + (r + 1) * cellH;
      const cellW_pos = west + c * cellW;
      const cellE = west + (c + 1) * cellW;
      
      const cellBounds = L.latLngBounds(
        [cellS, cellW_pos],
        [cellN, cellE]
      );
      
      // Cell rectangle — increased opacity for print
      L.rectangle(cellBounds, {
        color: color,
        weight: 1.5,
        fillOpacity: 0.02,
        opacity: Math.max(opacity * 0.7, 0.5)
      }).addTo(gridGroup);
      
      // Cell label (e.g., A1, B3, etc.)
      const rowLabel = getAlpha()[rows - 1 - r]; // A/أ at top
      const colLabel = c + 1;
      const cellCode = `${rowLabel}${colLabel}`;
      
      const centerLat = (cellS + cellN) / 2;
      const centerLon = (cellW_pos + cellE) / 2;
      
      // Create label with divIcon
      const labelSize = Math.min(
        map.getSize().x / cols / 3,
        24
      );
      
      const label = L.marker([centerLat, centerLon], {
        icon: L.divIcon({
          className: 'killbox-label',
          html: `<span style="color:${color}; font-size:${Math.max(10, labelSize)}px; opacity:${opacity};">${cellCode}</span>`,
          iconSize: [40, 20],
          iconAnchor: [20, 10]
        }),
        interactive: false,
        pane: 'tooltipPane'
      }).addTo(gridGroup);
    }
  }

  // Grid title label at top-center
  const titleLat = north + cellH * 0.15;
  const titleLon = (west + east) / 2;
  
  L.marker([titleLat, titleLon], {
    icon: L.divIcon({
      className: 'killbox-title',
      html: `<span style="color:${color};">🎯 ${name} <span style="font-size:0.7em;">(${cols}×${rows})</span></span>`,
      iconSize: [200, 24],
      iconAnchor: [100, 12]
    }),
    interactive: false,
    pane: 'tooltipPane'
  }).addTo(gridGroup);

  // Add close button at top-right
  const closeLat = north + cellH * 0.15;
  const closeLon = east;
  
  const closeBtn = L.marker([closeLat, closeLon], {
    icon: L.divIcon({
      className: 'killbox-close-marker',
      html: `<button class="killbox-remove-btn" title="${t('killboxRemove') || 'حذف الشبكة'}">✕</button>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    }),
    pane: 'tooltipPane'
  }).addTo(gridGroup);

  closeBtn.on('click', () => {
    gridLayer.removeLayer(gridGroup);
    activeGrids = activeGrids.filter(g => g.group !== gridGroup);
    showToast(`🗑️ ${name} ${t('killboxRemoved') || 'تم حذف الشبكة'}`, 'info');
  });

  // Add to global layer
  gridGroup.addTo(gridLayer);

  activeGrids.push({
    name, bounds, cols, rows, color, opacity,
    group: gridGroup
  });

  showToast(`🎯 ${name} — ${cols}×${rows} = ${cols * rows} ${t('killboxCells') || 'خلية'}`, 'success');
  
  // Fit map to the grid
  map.fitBounds(bounds, { padding: [30, 30] });
}

/**
 * Remove all grids
 */
export function clearAllGrids() {
  gridLayer.clearLayers();
  activeGrids = [];
  showToast(t('killboxAllCleared') || '🗑️ تم مسح جميع الشبكات', 'info');
}
