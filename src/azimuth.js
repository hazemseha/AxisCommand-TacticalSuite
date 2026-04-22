/**
 * azimuth.js — Tactical Compass & Protractor (Azimuth Tool)
 * Measures bearings in degrees (0-360), NATO mils (0-6400),
 * and Soviet/Russian mils (0-6000) for directing units or
 * determining firing directions.
 * 
 * Usage:
 * 1. Click the center point (observer/unit position)
 * 2. Move mouse to aim the azimuth line
 * 3. Click to lock the bearing and draw a permanent line
 * 4. Multiple lines can be drawn from the same or different points
 * 5. Right-click any locked line to delete it
 */
import L from 'leaflet';
import { t } from './i18n.js';
import { showToast } from './toast.js';

let map = null;
let azimuthActive = false;
let centerPoint = null;
let azimuthLayer = null;
let compassOverlay = null;
let previewLine = null;
let lockedLines = [];
let centerMarker = null;

// Constants
const DEG_TO_MIL_NATO = 6400 / 360;   // NATO: 6400 mils
const DEG_TO_MIL_SOVIET = 6000 / 360; // Soviet/Russian: 6000 mils

const COMPASS_DIRS = [
  { deg: 0, label: 'N', labelAr: 'ش' },
  { deg: 45, label: 'NE', labelAr: 'شر' },
  { deg: 90, label: 'E', labelAr: 'شر' },
  { deg: 135, label: 'SE', labelAr: 'جش' },
  { deg: 180, label: 'S', labelAr: 'ج' },
  { deg: 225, label: 'SW', labelAr: 'جغ' },
  { deg: 270, label: 'W', labelAr: 'غ' },
  { deg: 315, label: 'NW', labelAr: 'شغ' }
];

export function initAzimuth(mapInstance) {
  map = mapInstance;
  azimuthLayer = L.layerGroup().addTo(map);
}

export function toggleAzimuthMode() {
  const btn = document.getElementById('btn-azimuth');
  
  if (azimuthActive) {
    deactivateAzimuth();
    return;
  }

  azimuthActive = true;
  centerPoint = null;
  if (btn) btn.classList.add('active');
  
  document.getElementById('map').style.cursor = 'crosshair';
  showToast('🧭 ' + (t('azimuthHint') || 'انقر لتحديد موقع المراقب'), 'info');

  map.on('click', onAzimuthClick);
  map.on('mousemove', onAzimuthMove);
}

function deactivateAzimuth() {
  azimuthActive = false;
  centerPoint = null;
  
  const btn = document.getElementById('btn-azimuth');
  if (btn) btn.classList.remove('active');
  
  document.getElementById('map').style.cursor = '';
  
  if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
  removeCompassOverlay();
  removeInfoPanel();
  
  map.off('click', onAzimuthClick);
  map.off('mousemove', onAzimuthMove);
}

function onAzimuthClick(e) {
  if (!azimuthActive) return;

  if (!centerPoint) {
    // First click — set observer position
    centerPoint = e.latlng;
    
    // Place observer marker
    centerMarker = L.circleMarker(centerPoint, {
      radius: 8, color: '#06d6a0', fillColor: '#06d6a0',
      fillOpacity: 1, weight: 2, className: 'azimuth-center-marker'
    }).addTo(azimuthLayer);

    // Show compass rose overlay
    showCompassOverlay(centerPoint);
    showToast('📐 ' + (t('azimuthAim') || 'حرك الماوس لتحديد الاتجاه ثم انقر لتثبيت'), 'info');

  } else {
    // Second click — lock the bearing line
    const bearing = calculateBearing(centerPoint.lat, centerPoint.lng, e.latlng.lat, e.latlng.lng);
    const distance = map.distance(centerPoint, e.latlng);
    const milsNATO = Math.round(bearing * DEG_TO_MIL_NATO);
    const milsSoviet = Math.round(bearing * DEG_TO_MIL_SOVIET);

    // Draw permanent azimuth line
    const line = L.polyline([centerPoint, e.latlng], {
      color: '#f97316',
      weight: 2.5,
      dashArray: '10 5',
      opacity: 0.9
    }).addTo(azimuthLayer);

    // Add bearing label at midpoint
    const midLat = (centerPoint.lat + e.latlng.lat) / 2;
    const midLng = (centerPoint.lng + e.latlng.lng) / 2;
    
    const label = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: 'azimuth-label',
        html: `<span>${bearing.toFixed(1)}° | ${milsNATO}N / ${milsSoviet}S</span>`,
        iconSize: [140, 20],
        iconAnchor: [70, 10]
      }),
      interactive: false
    }).addTo(azimuthLayer);

    // Add arrowhead at target
    const arrowAngle = bearing;
    const arrow = L.marker(e.latlng, {
      icon: L.divIcon({
        className: 'azimuth-arrow',
        html: `<div style="transform: rotate(${arrowAngle}deg);">▲</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      }),
      interactive: false
    }).addTo(azimuthLayer);

    // Store line data with all its layers for deletion
    const lineIndex = lockedLines.length;
    const lineData = {
      center: centerPoint, target: e.latlng,
      bearing, milsNATO, milsSoviet,
      layers: [line, label, arrow]
    };
    lockedLines.push(lineData);

    // Right-click on line to delete
    line.on('contextmenu', (ev) => {
      L.DomEvent.stopPropagation(ev);
      deleteLine(lineData);
    });

    // Make line clickable for delete
    line.on('click', (ev) => {
      if (ev.originalEvent.shiftKey) {
        L.DomEvent.stopPropagation(ev);
        deleteLine(lineData);
      }
    });

    showToast(`🎯 ${bearing.toFixed(1)}° (NATO: ${milsNATO} | RU: ${milsSoviet}) — ${formatDist(distance)}`, 'success');
    
    // Ready for next line from same point
    if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
  }
}

function deleteLine(lineData) {
  // Remove all layers for this line
  lineData.layers.forEach(layer => {
    if (azimuthLayer.hasLayer(layer)) azimuthLayer.removeLayer(layer);
  });
  // Remove from array
  lockedLines = lockedLines.filter(l => l !== lineData);
  showToast('🗑️ ' + (t('azimuthLineDeleted') || 'تم حذف الخط'), 'info');
}

function onAzimuthMove(e) {
  if (!azimuthActive || !centerPoint) return;

  const bearing = calculateBearing(centerPoint.lat, centerPoint.lng, e.latlng.lat, e.latlng.lng);
  const distance = map.distance(centerPoint, e.latlng);
  const milsNATO = Math.round(bearing * DEG_TO_MIL_NATO);
  const milsSoviet = Math.round(bearing * DEG_TO_MIL_SOVIET);
  const compassDir = getCompassDirection(bearing);

  // Update preview line
  if (previewLine) {
    previewLine.setLatLngs([centerPoint, e.latlng]);
  } else {
    previewLine = L.polyline([centerPoint, e.latlng], {
      color: '#22d3ee',
      weight: 2,
      dashArray: '6 4',
      opacity: 0.7
    }).addTo(map);
  }

  // Update compass overlay rotation
  updateCompassOverlay(bearing);

  // Update info panel
  showInfoPanel(bearing, milsNATO, milsSoviet, distance, compassDir);
}

/**
 * Calculate bearing between two coordinates
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function getCompassDirection(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function formatDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}

/**
 * Show compass rose overlay at the center point
 */
function showCompassOverlay(latlng) {
  removeCompassOverlay();

  const container = document.getElementById('map');
  compassOverlay = document.createElement('div');
  compassOverlay.id = 'azimuth-compass';
  compassOverlay.className = 'azimuth-compass';

  // Build compass rose SVG
  const size = 220;
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 15;

  let svgParts = [];
  
  // Outer circle
  svgParts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(34,211,238,0.4)" stroke-width="1.5"/>`);
  svgParts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.7}" fill="none" stroke="rgba(34,211,238,0.2)" stroke-width="0.8"/>`);
  svgParts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.35}" fill="none" stroke="rgba(34,211,238,0.15)" stroke-width="0.5"/>`);
  svgParts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="#06d6a0"/>`);

  // Tick marks every 10 degrees, labels every 30
  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg - 90) * Math.PI / 180;
    const isMajor = deg % 30 === 0;
    const tickIn = isMajor ? r - 14 : r - 8;
    const x1 = cx + tickIn * Math.cos(rad);
    const y1 = cy + tickIn * Math.sin(rad);
    const x2 = cx + r * Math.cos(rad);
    const y2 = cy + r * Math.sin(rad);

    const color = isMajor ? 'rgba(34,211,238,0.7)' : 'rgba(34,211,238,0.3)';
    const w = isMajor ? '1.5' : '0.8';
    svgParts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`);

    if (deg % 90 === 0) {
      const labelR = r + 12;
      const lx = cx + labelR * Math.cos(rad);
      const ly = cy + labelR * Math.sin(rad);
      const dirLabel = COMPASS_DIRS.find(d => d.deg === deg);
      if (dirLabel) {
        svgParts.push(`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" fill="#22d3ee" font-size="12" font-weight="900" font-family="monospace">${dirLabel.label}</text>`);
      }
    } else if (isMajor) {
      const labelR = r + 11;
      const lx = cx + labelR * Math.cos(rad);
      const ly = cy + labelR * Math.sin(rad);
      svgParts.push(`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" fill="rgba(34,211,238,0.5)" font-size="8" font-family="monospace">${deg}</text>`);
    }
  }

  compassOverlay.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="compass-svg">
      <g id="compass-static">${svgParts.join('')}</g>
      <g id="compass-needle" transform-origin="${cx} ${cy}">
        <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 5}" stroke="#f97316" stroke-width="2.5" stroke-linecap="round"/>
        <polygon points="${cx},${cy - r + 2} ${cx - 5},${cy - r + 15} ${cx + 5},${cy - r + 15}" fill="#f97316" opacity="0.8"/>
      </g>
    </svg>
  `;

  container.appendChild(compassOverlay);
  updateCompassPosition();
  map.on('move zoom', updateCompassPosition);
}

function updateCompassPosition() {
  if (!compassOverlay || !centerPoint) return;
  const point = map.latLngToContainerPoint(centerPoint);
  compassOverlay.style.left = point.x + 'px';
  compassOverlay.style.top = point.y + 'px';
}

function updateCompassOverlay(bearing) {
  const needle = document.getElementById('compass-needle');
  if (needle) {
    needle.setAttribute('transform', `rotate(${bearing}, 110, 110)`);
  }
}

function removeCompassOverlay() {
  if (compassOverlay) {
    compassOverlay.remove();
    compassOverlay = null;
  }
  map.off('move zoom', updateCompassPosition);
}

/**
 * Show live azimuth info panel with NATO + Soviet mils
 */
function showInfoPanel(bearing, milsNATO, milsSoviet, distance, compassDir) {
  let panel = document.getElementById('azimuth-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'azimuth-panel';
    panel.className = 'azimuth-panel';
    document.getElementById('map').appendChild(panel);
    ['click', 'mousedown', 'dblclick'].forEach(evt => {
      panel.addEventListener(evt, (e) => e.stopPropagation());
    });
  }

  const backAzimuth = ((bearing + 180) % 360).toFixed(1);
  const backMilsNATO = Math.round(((bearing + 180) % 360) * DEG_TO_MIL_NATO);
  const backMilsSoviet = Math.round(((bearing + 180) % 360) * DEG_TO_MIL_SOVIET);

  panel.innerHTML = `
    <div class="azimuth-panel-header">
      <span>🧭 ${t('azimuthTitle') || 'البوصلة التكتيكية'}</span>
      <button id="azimuth-close" class="los-close-btn" title="إغلاق">✕</button>
    </div>
    <div class="azimuth-data">
      <div class="azimuth-big">${bearing.toFixed(1)}°</div>
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div class="azimuth-mils" style="color:#22d3ee;">${milsNATO} <span style="font-size:0.65em;">NATO</span></div>
        <div class="azimuth-mils" style="color:#ef4444;">${milsSoviet} <span style="font-size:0.65em;">RU</span></div>
      </div>
    </div>
    <div class="azimuth-details">
      <div><strong>${t('compass') || 'البوصلة'}:</strong> ${compassDir}</div>
      <div><strong>${t('distance') || 'المسافة'}:</strong> ${formatDist(distance)}</div>
      <div><strong>${t('backAzimuth') || 'الاتجاه العكسي'}:</strong> ${backAzimuth}° (N:${backMilsNATO} / R:${backMilsSoviet})</div>
    </div>
    <div class="azimuth-hint" style="font-size:0.65rem; color:rgba(255,255,255,0.35); margin-bottom:8px;">
      ${t('azimuthDeleteHint') || 'كليك يمين على خط لحذفه | Shift+كليك'}
    </div>
    <div class="azimuth-actions">
      <button id="azimuth-clear" class="los-action-btn">${t('azimuthClearAll') || 'مسح الكل'}</button>
      <button id="azimuth-reset" class="los-action-btn" style="color:#fbbf24; border-color:rgba(251,191,36,0.3);">${t('azimuthReset') || 'نقل المركز'}</button>
      <button id="azimuth-done" class="los-action-btn" style="color:#06d6a0; border-color:rgba(6,214,160,0.3);">${t('azimuthDone') || 'إنهاء'}</button>
    </div>
  `;

  panel.classList.remove('hidden');

  // Wire buttons
  document.getElementById('azimuth-close').onclick = () => deactivateAzimuth();
  
  document.getElementById('azimuth-clear').onclick = () => {
    azimuthLayer.clearLayers();
    lockedLines = [];
    centerMarker = null;
    centerPoint = null;
    removeCompassOverlay();
    showToast('🗑️ ' + (t('azimuthAllCleared') || 'تم مسح كل الخطوط والمركز'), 'info');
    showToast('🧭 ' + (t('azimuthHint') || 'انقر لتحديد موقع المراقب'), 'info');
  };

  document.getElementById('azimuth-reset').onclick = () => {
    // Keep lines but reset center for new position
    centerPoint = null;
    if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
    removeCompassOverlay();
    showToast('📍 ' + (t('azimuthResetHint') || 'انقر لتحديد موقع مراقب جديد'), 'info');
  };

  document.getElementById('azimuth-done').onclick = () => deactivateAzimuth();
}

function removeInfoPanel() {
  const panel = document.getElementById('azimuth-panel');
  if (panel) panel.remove();
}

/**
 * Clear all azimuth markers
 */
export function clearAzimuth() {
  azimuthLayer.clearLayers();
  lockedLines = [];
  centerMarker = null;
}
