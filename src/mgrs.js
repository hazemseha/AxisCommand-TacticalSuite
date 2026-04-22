/**
 * mgrs.js — Military Grid Reference System (MGRS/UTM) Coordinates
 * Displays and converts between Lat/Lon, UTM, and MGRS coordinates.
 * Fully offline — all calculations done client-side.
 */
import L from 'leaflet';
import { t } from './i18n.js';
import { showToast } from './toast.js';

let map = null;
let mgrsActive = false;
let coordOverlay = null;
let clickMarkers = [];
let mgrsLayer = null;

export function initMGRS(mapInstance) {
  map = mapInstance;
  mgrsLayer = L.layerGroup().addTo(map);
}

export function toggleMGRS() {
  if (mgrsActive) {
    deactivateMGRS();
  } else {
    activateMGRS();
  }
}

function activateMGRS() {
  mgrsActive = true;
  const btn = document.getElementById('btn-mgrs');
  if (btn) btn.classList.add('active');
  
  showCoordOverlay();
  map.on('mousemove', onMGRSMove);
  map.on('click', onMGRSClick);
  
  showToast('📍 ' + (t('mgrsHint') || 'حرك المؤشر لعرض الإحداثيات — انقر لتثبيت'), 'info');
}

function deactivateMGRS() {
  mgrsActive = false;
  const btn = document.getElementById('btn-mgrs');
  if (btn) btn.classList.remove('active');
  
  removeCoordOverlay();
  map.off('mousemove', onMGRSMove);
  map.off('click', onMGRSClick);
}

function onMGRSMove(e) {
  updateCoordDisplay(e.latlng);
}

function onMGRSClick(e) {
  const latlng = e.latlng;
  const mgrs = latLonToMGRS(latlng.lat, latlng.lng);
  const utm = latLonToUTM(latlng.lat, latlng.lng);
  
  // Pin coordinate marker
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'mgrs-pin',
      html: `<div class="mgrs-pin-content"><span>${mgrs}</span></div>`,
      iconSize: [120, 28], iconAnchor: [60, 14]
    })
  }).addTo(mgrsLayer);
  
  marker.bindPopup(`
    <div class="mortar-popup">
      <div class="mortar-popup-header" style="color:#a855f7;">📍 ${t('mgrsCoords') || 'الإحداثيات'}</div>
      <table class="mortar-table">
        <tr><td>MGRS</td><td><strong>${mgrs}</strong></td></tr>
        <tr><td>UTM</td><td><strong>${utm.zone}${utm.letter} ${Math.round(utm.easting)}E ${Math.round(utm.northing)}N</strong></td></tr>
        <tr><td>Lat</td><td><strong>${latlng.lat.toFixed(6)}°</strong></td></tr>
        <tr><td>Lon</td><td><strong>${latlng.lng.toFixed(6)}°</strong></td></tr>
        <tr><td>DMS</td><td><strong>${toDMS(latlng.lat, 'lat')} ${toDMS(latlng.lng, 'lon')}</strong></td></tr>
      </table>
      <button class="mortar-delete-btn" style="border-color:rgba(168,85,247,0.3); color:#a855f7;" onclick="this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()">📋 ${t('copy') || 'نسخ'}</button>
    </div>
  `, { className: 'mortar-popup-container', maxWidth: 280 });
  
  marker.on('contextmenu', () => {
    mgrsLayer.removeLayer(marker);
    clickMarkers = clickMarkers.filter(m => m !== marker);
  });
  
  clickMarkers.push(marker);
  
  // Copy to clipboard
  navigator.clipboard.writeText(mgrs).catch(() => {});
  showToast(`📍 ${mgrs}`, 'success');
}

function updateCoordDisplay(latlng) {
  const overlay = document.getElementById('mgrs-overlay');
  if (!overlay) return;
  
  const mgrs = latLonToMGRS(latlng.lat, latlng.lng);
  const utm = latLonToUTM(latlng.lat, latlng.lng);
  
  overlay.innerHTML = `
    <div class="mgrs-row"><span class="mgrs-label">MGRS</span><span class="mgrs-value">${mgrs}</span></div>
    <div class="mgrs-row"><span class="mgrs-label">UTM</span><span class="mgrs-value">${utm.zone}${utm.letter} ${Math.round(utm.easting)}E ${Math.round(utm.northing)}N</span></div>
    <div class="mgrs-row"><span class="mgrs-label">LAT</span><span class="mgrs-value">${latlng.lat.toFixed(6)}°</span></div>
    <div class="mgrs-row"><span class="mgrs-label">LON</span><span class="mgrs-value">${latlng.lng.toFixed(6)}°</span></div>
    <div class="mgrs-row"><span class="mgrs-label">DMS</span><span class="mgrs-value">${toDMS(latlng.lat, 'lat')} ${toDMS(latlng.lng, 'lon')}</span></div>
    <div class="mgrs-actions-row">
      <button id="mgrs-clear" class="mgrs-small-btn">🗑️ ${t('mgrsClean') || 'مسح'}</button>
      <button id="mgrs-close-btn" class="mgrs-small-btn" style="color:#06d6a0;">✕ ${t('close') || 'إغلاق'}</button>
    </div>
  `;
  
  document.getElementById('mgrs-clear').onclick = () => {
    mgrsLayer.clearLayers(); clickMarkers = [];
  };
  document.getElementById('mgrs-close-btn').onclick = () => deactivateMGRS();
}

// ===== COORDINATE CONVERSIONS (fully offline) =====

function latLonToUTM(lat, lon) {
  const a = 6378137; // WGS84 semi-major axis
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const ep2 = e2 / (1 - e2);
  
  let zone = Math.floor((lon + 180) / 6) + 1;
  
  // UTM zone exceptions for Norway/Svalbard
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  
  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const lonOrigRad = lonOrigin * Math.PI / 180;
  
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = ep2 * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lonRad - lonOrigRad);
  
  const M = a * ((1 - e2/4 - 3*e4/64 - 5*e6/256) * latRad
    - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*latRad)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*latRad)
    - (35*e6/3072) * Math.sin(6*latRad));
  
  const easting = 500000 + 0.9996 * N * (A + (1-T+C)*A*A*A/6 + (5-18*T+T*T+72*C-58*ep2)*A*A*A*A*A/120);
  let northing = 0.9996 * (M + N * Math.tan(latRad) * (A*A/2 + (5-T+9*C+4*C*C)*A*A*A*A/24 + (61-58*T+T*T+600*C-330*ep2)*A*A*A*A*A*A/720));
  
  if (lat < 0) northing += 10000000;
  
  const letter = getUTMLetterDesignator(lat);
  
  return { zone, letter, easting, northing };
}

function getUTMLetterDesignator(lat) {
  const letters = 'CDEFGHJKLMNPQRSTUVWX';
  if (lat >= -80 && lat <= 84) {
    return letters[Math.floor((lat + 80) / 8)];
  }
  return 'Z';
}

function latLonToMGRS(lat, lon) {
  const utm = latLonToUTM(lat, lon);
  const zone = utm.zone;
  const letter = utm.letter;
  
  // 100km grid square
  const set = ((zone - 1) % 6);
  const col100k = Math.floor(utm.easting / 100000);
  const row100k = Math.floor(utm.northing / 100000) % 20;
  
  const colLetters = [
    'ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ',
    'ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'
  ];
  const rowLetters = [
    'ABCDEFGHJKLMNPQRSTUV',
    'FGHJKLMNPQRSTUVABCDE'
  ];
  
  const colLetter = colLetters[set][col100k - 1] || 'A';
  const rowLetter = rowLetters[set % 2][row100k] || 'A';
  
  const easting5 = String(Math.floor(utm.easting % 100000)).padStart(5, '0');
  const northing5 = String(Math.floor(utm.northing % 100000)).padStart(5, '0');
  
  return `${zone}${letter} ${colLetter}${rowLetter} ${easting5} ${northing5}`;
}

function toDMS(deg, type) {
  const d = Math.abs(deg);
  const dd = Math.floor(d);
  const mm = Math.floor((d - dd) * 60);
  const ss = ((d - dd) * 60 - mm) * 60;
  const dir = type === 'lat' ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  return `${dd}°${String(mm).padStart(2,'0')}'${ss.toFixed(1)}"${dir}`;
}

// ===== UI =====

function showCoordOverlay() {
  removeCoordOverlay();
  coordOverlay = document.createElement('div');
  coordOverlay.id = 'mgrs-overlay';
  coordOverlay.className = 'mgrs-overlay';
  coordOverlay.innerHTML = '<div class="mgrs-row"><span class="mgrs-label">MGRS</span><span class="mgrs-value">---</span></div>';
  document.getElementById('map').appendChild(coordOverlay);
  ['click', 'mousedown', 'dblclick'].forEach(evt => {
    coordOverlay.addEventListener(evt, (e) => e.stopPropagation());
  });
}

function removeCoordOverlay() {
  if (coordOverlay) { coordOverlay.remove(); coordOverlay = null; }
}
