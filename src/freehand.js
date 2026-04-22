/**
 * freehand.js — Freehand Drawing & Attack Arrows
 * Draw attack arrows, boundaries, and free marks on the tactical map.
 * Fully self-contained module.
 */
import L from 'leaflet';
import { t } from './i18n.js';
import { showToast } from './toast.js';

let map = null;
let freehandLayer = null;
let isDrawing = false;
let freehandActive = false;
let currentPath = [];
let currentPolyline = null;
let drawings = [];
let drawColor = '#ef4444';
let drawWidth = 3;
let drawMode = 'free'; // 'free' | 'arrow'

export function initFreehand(mapInstance) {
  map = mapInstance;
  freehandLayer = L.layerGroup().addTo(map);
}

export function toggleFreehandMode() {
  if (freehandActive) {
    deactivateFreehand();
  } else {
    activateFreehand();
  }
}

function activateFreehand() {
  freehandActive = true;
  const btn = document.getElementById('btn-freehand');
  if (btn) btn.classList.add('active');
  
  showFreehandPanel();
  document.getElementById('map').style.cursor = 'crosshair';
  
  // Disable map drag while drawing
  const mapEl = document.getElementById('map');
  mapEl.addEventListener('mousedown', onMouseDown);
  mapEl.addEventListener('mousemove', onMouseMove);
  mapEl.addEventListener('mouseup', onMouseUp);
  
  showToast('✏️ ' + (t('freehandHint') || 'اضغط واسحب للرسم الحر'), 'info');
}

function deactivateFreehand() {
  freehandActive = false;
  isDrawing = false;
  
  const btn = document.getElementById('btn-freehand');
  if (btn) btn.classList.remove('active');
  
  document.getElementById('map').style.cursor = '';
  removeFreehandPanel();
  
  const mapEl = document.getElementById('map');
  mapEl.removeEventListener('mousedown', onMouseDown);
  mapEl.removeEventListener('mousemove', onMouseMove);
  mapEl.removeEventListener('mouseup', onMouseUp);
  
  map.dragging.enable();
}

function onMouseDown(e) {
  if (!freehandActive || e.button !== 0) return;
  
  // Ignore clicks on the freehand panel
  const panel = document.getElementById('freehand-panel');
  if (panel && panel.contains(e.target)) return;
  
  isDrawing = true;
  currentPath = [];
  map.dragging.disable();
  
  const latlng = map.containerPointToLatLng([e.offsetX, e.offsetY]);
  currentPath.push(latlng);
}

function onMouseMove(e) {
  if (!isDrawing || !freehandActive) return;
  
  const latlng = map.containerPointToLatLng([e.offsetX, e.offsetY]);
  currentPath.push(latlng);
  
  // Update live preview
  if (currentPolyline) freehandLayer.removeLayer(currentPolyline);
  currentPolyline = L.polyline(currentPath, {
    color: drawColor, weight: drawWidth, opacity: 0.8,
    smoothFactor: 0, lineCap: 'round', lineJoin: 'round'
  }).addTo(freehandLayer);
}

function onMouseUp(e) {
  if (!isDrawing || !freehandActive) return;
  
  isDrawing = false;
  map.dragging.enable();
  
  if (currentPath.length < 3) {
    if (currentPolyline) freehandLayer.removeLayer(currentPolyline);
    return;
  }
  
  // Simplify path (reduce points for performance — low tolerance for accuracy)
  const simplified = simplifyPath(currentPath, 0.000005);
  
  if (currentPolyline) freehandLayer.removeLayer(currentPolyline);
  
  // Create final polyline
  const finalLine = L.polyline(simplified, {
    color: drawColor, weight: drawWidth, opacity: 0.9,
    smoothFactor: 0, lineCap: 'round', lineJoin: 'round'
  }).addTo(freehandLayer);
  
  // Add arrowhead if in arrow mode
  let arrowMarker = null;
  if (drawMode === 'arrow' && simplified.length >= 2) {
    const last = simplified[simplified.length - 1];
    const prev = simplified[simplified.length - 2];
    
    // Use SCREEN coordinates for proper rotation (lat/lng distorts angles)
    const lastPx = map.latLngToContainerPoint(last);
    const prevPx = map.latLngToContainerPoint(prev);
    const dx = lastPx.x - prevPx.x;
    const dy = lastPx.y - prevPx.y;
    const rotation = Math.atan2(dy, dx) * 180 / Math.PI;
    
    arrowMarker = L.marker(last, {
      icon: L.divIcon({
        className: 'freehand-arrow',
        html: `<div style="transform:rotate(${rotation}deg); color:${drawColor}; font-size:20px; line-height:1;">▶</div>`,
        iconSize: [20, 20], iconAnchor: [10, 10]
      }),
      interactive: false
    }).addTo(freehandLayer);
  }
  
  const drawingData = {
    id: drawings.length,
    layers: arrowMarker ? [finalLine, arrowMarker] : [finalLine],
    mode: drawMode, color: drawColor
  };
  drawings.push(drawingData);
  
  // Right-click to delete
  finalLine.on('contextmenu', (ev) => {
    L.DomEvent.stopPropagation(ev);
    deleteDrawing(drawingData);
  });
  
  showToast(`✏️ ${drawMode === 'arrow' ? '➡️' : '〰️'} ${t('freehandDrawn') || 'تم الرسم'}`, 'success');
  currentPath = [];
  currentPolyline = null;
}

function deleteDrawing(drawingData) {
  drawingData.layers.forEach(l => {
    if (freehandLayer.hasLayer(l)) freehandLayer.removeLayer(l);
  });
  drawings = drawings.filter(d => d !== drawingData);
  showToast('🗑️ ' + (t('freehandDeleted') || 'تم حذف الرسم'), 'info');
}

function simplifyPath(points, tolerance) {
  if (points.length <= 2) return points;
  // Douglas-Peucker simplification
  let maxDist = 0, maxIdx = 0;
  const first = points[0], last = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpDist(points[i], first, last);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  
  if (maxDist > tolerance) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPath(points.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function perpDist(point, lineStart, lineEnd) {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const norm = Math.sqrt(dx * dx + dy * dy);
  if (norm === 0) return Math.sqrt((point.lng - lineStart.lng) ** 2 + (point.lat - lineStart.lat) ** 2);
  return Math.abs(dy * point.lng - dx * point.lat + lineEnd.lng * lineStart.lat - lineEnd.lat * lineStart.lng) / norm;
}

// ===== UI PANEL =====

function showFreehandPanel() {
  removeFreehandPanel();
  const panel = document.createElement('div');
  panel.id = 'freehand-panel';
  panel.className = 'mortar-panel'; // Reuse mortar panel style
  panel.style.borderColor = 'rgba(168, 85, 247, 0.4)';
  panel.innerHTML = `
    <div class="mortar-panel-header" style="color:#a855f7;">
      <span>✏️ ${t('freehandTitle') || 'الرسم الحر'}</span>
      <button id="freehand-close" class="los-close-btn">✕</button>
    </div>
    <div class="mortar-mil-toggle">
      <button class="mortar-mil-btn ${drawMode === 'free' ? 'active' : ''}" data-mode="free" style="${drawMode === 'free' ? 'border-color:rgba(168,85,247,0.5); color:#a855f7; background:rgba(168,85,247,0.2);' : ''}">
        〰️ ${t('freehandFree') || 'حر'}
      </button>
      <button class="mortar-mil-btn ${drawMode === 'arrow' ? 'active' : ''}" data-mode="arrow" style="${drawMode === 'arrow' ? 'border-color:rgba(168,85,247,0.5); color:#a855f7; background:rgba(168,85,247,0.2);' : ''}">
        ➡️ ${t('freehandArrow') || 'سهم هجوم'}
      </button>
    </div>
    <div class="mortar-range-config">
      <div class="mortar-range-row">
        <label>🎨 ${t('color') || 'اللون'}</label>
        <input type="color" id="freehand-color" value="${drawColor}" style="width:32px;height:24px;border:none;background:none;cursor:pointer;"/>
      </div>
      <div class="mortar-range-row">
        <label>📏 ${t('freehandWidth') || 'السمك'}</label>
        <input type="range" id="freehand-width" min="1" max="8" value="${drawWidth}" style="width:80px;"/>
        <span style="color:#a855f7;">${drawWidth}px</span>
      </div>
    </div>
    <div class="mortar-actions">
      <button id="freehand-clear" class="los-action-btn">${t('freehandClearAll') || 'مسح الكل'}</button>
      <button id="freehand-done" class="los-action-btn" style="color:#06d6a0; border-color:rgba(6,214,160,0.3);">${t('azimuthDone') || 'إنهاء'}</button>
    </div>
    <div style="font-size:0.6rem; color:rgba(255,255,255,0.3); text-align:center; margin-top:6px;">
      ${t('freehandDeleteHint') || 'كليك يمين على رسم لحذفه'}
    </div>
  `;
  document.getElementById('map').appendChild(panel);
  
  // Stop clicks from propagating to map (prevent accidental drawing)
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  panel.addEventListener('click', (e) => e.stopPropagation());
  
  // Wire events
  document.getElementById('freehand-close').onclick = () => deactivateFreehand();
  document.getElementById('freehand-done').onclick = () => deactivateFreehand();
  document.getElementById('freehand-clear').onclick = () => {
    freehandLayer.clearLayers();
    drawings = [];
    showToast('🗑️ ' + (t('freehandAllCleared') || 'تم مسح كل الرسومات'), 'info');
  };
  
  document.querySelectorAll('#freehand-panel .mortar-mil-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      drawMode = btn.dataset.mode;
      showFreehandPanel(); // Refresh
    });
  });
  
  document.getElementById('freehand-color').addEventListener('input', e => { drawColor = e.target.value; });
  document.getElementById('freehand-width').addEventListener('input', e => {
    drawWidth = parseInt(e.target.value);
    e.target.nextElementSibling.textContent = drawWidth + 'px';
  });
}

function removeFreehandPanel() {
  const panel = document.getElementById('freehand-panel');
  if (panel) panel.remove();
}
