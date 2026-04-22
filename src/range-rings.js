/**
 * range-rings.js — Range Rings System
 * Draw precise range rings around anchor points with custom radii.
 * Useful for weapon systems, engagement zones, and patrol boundaries.
 */
import L from 'leaflet';
import { t } from './i18n.js';
import { showToast } from './toast.js';

let map = null;
let ringLayer = null;
let ringActive = false;
let ringGroups = [];
let activePresetIdx = 0;

// Preset range ring configurations
const PRESETS = [
  { name: 'AK-47', ranges: [100, 300, 600], color: '#ef4444' },
  { name: 'PKM', ranges: [200, 500, 1000], color: '#f97316' },
  { name: 'SPG-9', ranges: [300, 800, 1300], color: '#fbbf24' },
  { name: 'Konkurs', ranges: [75, 2500, 4000], color: '#a855f7' },
  { name: 'Kornet', ranges: [100, 3000, 5500], color: '#ec4899' },
  { name: '82mm', ranges: [70, 3000, 6000], color: '#22c55e' },
  { name: '120mm', ranges: [400, 5000, 9500], color: '#06d6a0' },
  { name: 'H-155', ranges: [3000, 18000, 30000], color: '#14b8a6' },
  { name: 'T-72', ranges: [200, 2000, 4000], color: '#78716c' },
  { name: 'T-62', ranges: [200, 1600, 3000], color: '#a8a29e' },
  { name: 'custom', ranges: [500, 1000, 2000], color: '#22d3ee' }
];
const CUSTOM_IDX = PRESETS.length - 1;

export function initRangeRings(mapInstance) {
  map = mapInstance;
  ringLayer = L.layerGroup().addTo(map);
}

export function toggleRangeRings() {
  if (ringActive) {
    deactivateRings();
  } else {
    activateRings();
  }
}

function activateRings() {
  ringActive = true;
  activePresetIdx = 0;
  const btn = document.getElementById('btn-range-rings');
  if (btn) btn.classList.add('active');
  
  showRingPanel();
  document.getElementById('map').style.cursor = 'crosshair';
  showToast('⭕ ' + (t('ringHint') || 'انقر لوضع مركز النطاقات'), 'info');
  
  map.on('click', onRingClick);
}

function deactivateRings() {
  ringActive = false;
  const btn = document.getElementById('btn-range-rings');
  if (btn) btn.classList.remove('active');
  
  document.getElementById('map').style.cursor = '';
  removeRingPanel();
  map.off('click', onRingClick);
}

function onRingClick(e) {
  if (!ringActive) return;
  const preset = getCurrentPreset();
  placeRings(e.latlng, preset.ranges, preset.color, preset.name);
}

function getCurrentPreset() {
  const preset = PRESETS[activePresetIdx] || PRESETS[0];
  
  if (activePresetIdx === CUSTOM_IDX) {
    // Custom — read from inputs
    const r1 = parseInt(document.getElementById('ring-r1')?.value) || 500;
    const r2 = parseInt(document.getElementById('ring-r2')?.value) || 1000;
    const r3 = parseInt(document.getElementById('ring-r3')?.value) || 2000;
    const color = document.getElementById('ring-color')?.value || '#22d3ee';
    return { name: 'Custom', ranges: [r1, r2, r3].sort((a, b) => a - b), color };
  }
  return preset;
}

function placeRings(center, ranges, color, name) {
  const group = L.layerGroup();
  
  const sorted = [...ranges].sort((a, b) => b - a);
  sorted.forEach((radius, i) => {
    const opacity = 0.3 + (i * 0.15);
    const dashArray = i === 0 ? null : (i === 1 ? '10 5' : '4 4');
    
    L.circle(center, {
      radius, color, weight: 2, fillOpacity: 0.02,
      opacity, dashArray, interactive: false
    }).addTo(group);
    
    const labelPos = L.latLng(center.lat + (radius / 111320), center.lng);
    L.marker(labelPos, {
      icon: L.divIcon({
        className: 'ring-label',
        html: `<span style="color:${color};">${radius >= 1000 ? (radius/1000).toFixed(1) + 'km' : radius + 'm'}</span>`,
        iconSize: [60, 14], iconAnchor: [30, 7]
      }),
      interactive: false
    }).addTo(group);
  });
  
  L.circleMarker(center, {
    radius: 5, color, fillColor: color, fillOpacity: 1, weight: 1
  }).addTo(group);
  
  L.marker(center, {
    icon: L.divIcon({
      className: 'ring-name-label',
      html: `<span style="color:${color};">⭕ ${name}</span>`,
      iconSize: [80, 16], iconAnchor: [40, -10]
    }),
    interactive: false
  }).addTo(group);
  
  const closeMarker = L.marker(center, {
    icon: L.divIcon({
      className: 'killbox-close-marker',
      html: `<button class="killbox-remove-btn" title="${t('delete') || 'حذف'}">✕</button>`,
      iconSize: [20, 20], iconAnchor: [10, 24]
    })
  }).addTo(group);
  
  closeMarker.on('click', () => {
    ringLayer.removeLayer(group);
    ringGroups = ringGroups.filter(g => g.group !== group);
    showToast('🗑️ ' + (t('ringDeleted') || 'تم حذف النطاقات'), 'info');
  });
  
  group.addTo(ringLayer);
  ringGroups.push({ group, center, ranges, color, name });
  
  const rangeStr = sorted.map(r => r >= 1000 ? (r/1000).toFixed(1) + 'km' : r + 'm').join(' / ');
  showToast(`⭕ ${name}: ${rangeStr}`, 'success');
}

// ===== UI =====

function showRingPanel() {
  removeRingPanel();
  const panel = document.createElement('div');
  panel.id = 'ring-panel';
  panel.className = 'mortar-panel';
  panel.style.borderColor = 'rgba(34,211,238,0.4)';
  // Position it fixed in bottom-right, OUTSIDE the map container
  panel.style.position = 'fixed';
  panel.style.bottom = '60px';
  panel.style.right = '10px';
  panel.style.zIndex = '10000';
  
  panel.innerHTML = `
    <div class="mortar-panel-header" style="color:#22d3ee;">
      <span>⭕ ${t('ringTitle') || 'دوائر النطاق'}</span>
      <button id="ring-close" class="los-close-btn">✕</button>
    </div>
    <div class="mortar-range-config">
      <div style="display:flex; flex-wrap:wrap; gap:4px; margin:4px 0;">
        ${PRESETS.map((p, i) => `<button class="ring-preset-btn" data-idx="${i}" style="
          padding:4px 10px; font-size:11px; border-radius:4px; cursor:pointer;
          background:${i === 0 ? p.color + '33' : 'rgba(255,255,255,0.08)'};
          border:1px solid ${i === 0 ? p.color : 'rgba(255,255,255,0.2)'};
          color:${i === 0 ? p.color : '#aaa'};
          font-weight:${i === 0 ? 'bold' : 'normal'};
        ">${p.name}</button>`).join('')}
      </div>
    </div>
    <div id="ring-custom-config" class="mortar-range-config" style="display:none;">
      <div class="mortar-range-row"><label>R1</label><input type="number" id="ring-r1" value="500" min="10" max="50000" /><span>m</span></div>
      <div class="mortar-range-row"><label>R2</label><input type="number" id="ring-r2" value="1000" min="10" max="50000" /><span>m</span></div>
      <div class="mortar-range-row"><label>R3</label><input type="number" id="ring-r3" value="2000" min="10" max="50000" /><span>m</span></div>
      <div class="mortar-range-row"><label>🎨</label><input type="color" id="ring-color" value="#22d3ee" style="width:32px;height:24px;border:none;background:none;cursor:pointer;"/></div>
    </div>
    <div class="mortar-actions">
      <button id="ring-clear" class="los-action-btn">${t('mortarClearAll') || 'مسح الكل'}</button>
      <button id="ring-done" class="los-action-btn" style="color:#06d6a0; border-color:rgba(6,214,160,0.3);">${t('azimuthDone') || 'إنهاء'}</button>
    </div>
  `;
  
  // Append to BODY — completely outside Leaflet's event system
  document.body.appendChild(panel);
  
  // Preset button click handlers
  panel.querySelectorAll('.ring-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      activePresetIdx = idx;
      const preset = PRESETS[idx];
      
      // Update all button styles
      panel.querySelectorAll('.ring-preset-btn').forEach((b, i) => {
        const p = PRESETS[i];
        if (i === idx) {
          b.style.background = p.color + '33';
          b.style.borderColor = p.color;
          b.style.color = p.color;
          b.style.fontWeight = 'bold';
        } else {
          b.style.background = 'rgba(255,255,255,0.08)';
          b.style.borderColor = 'rgba(255,255,255,0.2)';
          b.style.color = '#aaa';
          b.style.fontWeight = 'normal';
        }
      });
      
      // Show/hide custom inputs
      const customSection = document.getElementById('ring-custom-config');
      if (customSection) {
        customSection.style.display = idx === CUSTOM_IDX ? '' : 'none';
      }
      
      showToast(`⭕ ${preset.name}: ${preset.ranges.join(' / ')}m`, 'info');
    });
  });
  
  document.getElementById('ring-close').addEventListener('click', () => deactivateRings());
  document.getElementById('ring-done').addEventListener('click', () => deactivateRings());
  document.getElementById('ring-clear').addEventListener('click', () => {
    ringLayer.clearLayers(); ringGroups = [];
    showToast('🗑️ ' + (t('ringAllCleared') || 'تم مسح كل النطاقات'), 'info');
  });
}

function removeRingPanel() {
  const panel = document.getElementById('ring-panel');
  if (panel) panel.remove();
}
