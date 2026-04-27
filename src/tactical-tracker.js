/**
 * tactical-tracker.js — Unified Native Background GPS Tracker
 * 
 * Replaces both blueforce.js and track-recorder.js with a single engine:
 *  - Native background GPS via @capgo/background-geolocation
 *  - Foreground service notification (survives screen-off)
 *  - Hardware-only GPS (no network/A-GPS fallback)
 *  - Compass heading via DeviceOrientation
 *  - Blue force dot + accuracy circle + heading cone
 *  - Live polyline on map
 *  - Auto-save to IndexedDB every 20 points
 *  - Filters: accuracy > 30m rejected, distance < 2m skipped
 *  - States: IDLE → RECORDING → PAUSED → (stop) → IDLE
 */
import L from 'leaflet';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import { saveTrack, getTrack, generateId } from './db.js';

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let map = null;
let state = 'idle'; // 'idle' | 'recording' | 'paused'

// GPS data
let watchCallbackId = null;
let currentTrackId = null;
let trackPoints = [];
let totalDistance = 0;
let startTime = null;
let lastPosition = null;

// Compass
let currentHeading = 0;

// Map layers
let bftLayer = null;
let positionMarker = null;
let headingMarker = null;
let accuracyCircle = null;
let trackPolyline = null;

// UI
let statsPanel = null;
let statsInterval = null;

// Config
const CONFIG = {
  maxAccuracy: 30,      // Reject points with accuracy > 30m
  minDistance: 2,        // Skip if moved less than 2m
  autoSaveInterval: 20, // Save to IndexedDB every N points
  highAccuracy: true,
  backgroundTitle: 'القيادة المحورية — تتبع نشط',
  backgroundMessage: 'جاري تسجيل المسار التكتيكي...',
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

export function initTacticalTracker(mapInstance) {
  map = mapInstance;
  bftLayer = L.layerGroup().addTo(map);
  createStatsPanel();
  console.log('[TacticalTracker] Initialized');
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export async function startTracking() {
  if (state === 'recording') return;

  // Reset state
  currentTrackId = generateId();
  trackPoints = [];
  totalDistance = 0;
  startTime = Date.now();
  lastPosition = null;
  state = 'recording';

  // Create polyline
  trackPolyline = L.polyline([], {
    color: '#4285f4',
    weight: 3,
    opacity: 0.9,
    smoothFactor: 0
  }).addTo(bftLayer);

  // Start GPS
  await startNativeGPS();
  startCompass();

  // Stats update interval
  statsInterval = setInterval(updateStats, 1000);
  showStatsPanel();
  updateTrackerUI();
  showToast('🔵 ' + (t('trackingStarted') || 'بدأ التتبع التكتيكي'), 'success');
}

export async function stopTracking() {
  if (state === 'idle') return;

  state = 'idle';
  await stopNativeGPS();
  stopCompass();

  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }

  // Remove position markers
  if (positionMarker) { bftLayer.removeLayer(positionMarker); positionMarker = null; }
  if (headingMarker) { bftLayer.removeLayer(headingMarker); headingMarker = null; }
  if (accuracyCircle) { bftLayer.removeLayer(accuracyCircle); accuracyCircle = null; }

  hideStatsPanel();
  updateTrackerUI();

  // Save final track to IndexedDB
  if (trackPoints.length > 1) {
    await saveCurrentTrack('completed');
    const dist = formatDistance(totalDistance);
    const dur = formatDuration(Date.now() - startTime);
    showToast(`✅ المسار: ${dist} — ${dur} — ${trackPoints.length} نقطة`, 'success');
  } else {
    showToast('⚠️ لم يتم تسجيل نقاط كافية', 'info');
    if (trackPolyline) { bftLayer.removeLayer(trackPolyline); trackPolyline = null; }
  }
}

export function pauseTracking() {
  if (state !== 'recording') return;
  state = 'paused';
  updateTrackerUI();
  showToast('⏸️ ' + (t('trackingPaused') || 'التتبع متوقف مؤقتاً'), 'info');
}

export function resumeTracking() {
  if (state !== 'paused') return;
  state = 'recording';
  updateTrackerUI();
  showToast('▶️ ' + (t('trackingResumed') || 'استئناف التتبع'), 'info');
}

export function toggleTracking() {
  if (state === 'idle') {
    startTracking();
  } else {
    stopTracking();
  }
}

export function togglePause() {
  if (state === 'recording') pauseTracking();
  else if (state === 'paused') resumeTracking();
}

export function isTracking() {
  return state !== 'idle';
}

export function getTrackerState() {
  return state;
}

// ═══════════════════════════════════════════════════════════════
// NATIVE GPS — @capgo/background-geolocation
// ═══════════════════════════════════════════════════════════════

let BackgroundGeolocation = null;

async function loadPlugin() {
  if (BackgroundGeolocation) return BackgroundGeolocation;
  try {
    const mod = await import('@capgo/background-geolocation');
    BackgroundGeolocation = mod.BackgroundGeolocation;
    return BackgroundGeolocation;
  } catch (e) {
    console.warn('[TacticalTracker] Native plugin not available, falling back to Web API');
    return null;
  }
}

async function startNativeGPS() {
  const plugin = await loadPlugin();

  if (plugin) {
    // Native path — works in background
    try {
      watchCallbackId = await plugin.addWatcher(
        {
          backgroundMessage: CONFIG.backgroundMessage,
          backgroundTitle: CONFIG.backgroundTitle,
          requestPermissions: true,
          stale: false,
          distanceFilter: CONFIG.minDistance
        },
        (location, error) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') {
              showToast('❌ تم رفض إذن GPS', 'error');
            }
            return;
          }
          if (location) {
            onGPSPosition({
              lat: location.latitude,
              lng: location.longitude,
              alt: location.altitude,
              speed: location.speed,
              accuracy: location.accuracy,
              heading: location.bearing,
              time: location.time || Date.now()
            });
          }
        }
      );
      console.log('[TacticalTracker] Native GPS started, watcher:', watchCallbackId);
      return;
    } catch (e) {
      console.warn('[TacticalTracker] Native GPS failed:', e);
    }
  }

  // Web API fallback (no background support)
  if (navigator.geolocation) {
    // Initial fix
    navigator.geolocation.getCurrentPosition(
      pos => onGPSPosition(extractWebPosition(pos)),
      err => console.warn('[TacticalTracker] GPS error:', err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    // Continuous watch
    watchCallbackId = navigator.geolocation.watchPosition(
      pos => onGPSPosition(extractWebPosition(pos)),
      err => {
        if (err.code === 1) {
          showToast('❌ تم رفض إذن GPS', 'error');
          stopTracking();
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    console.log('[TacticalTracker] Web GPS fallback started');
  } else {
    showToast('❌ GPS غير متوفر', 'error');
  }
}

async function stopNativeGPS() {
  const plugin = await loadPlugin();

  if (plugin && watchCallbackId !== null) {
    try {
      await plugin.removeWatcher({ id: watchCallbackId });
    } catch (e) {
      console.warn('[TacticalTracker] Error removing watcher:', e);
    }
  } else if (watchCallbackId !== null) {
    navigator.geolocation.clearWatch(watchCallbackId);
  }
  watchCallbackId = null;
}

function extractWebPosition(pos) {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    alt: pos.coords.altitude,
    speed: pos.coords.speed,
    accuracy: pos.coords.accuracy,
    heading: pos.coords.heading,
    time: pos.timestamp || Date.now()
  };
}

// ═══════════════════════════════════════════════════════════════
// GPS POSITION HANDLER
// ═══════════════════════════════════════════════════════════════

function onGPSPosition(pos) {
  // Always update blue dot position (even when paused)
  updateBlueDot(pos.lat, pos.lng, pos.accuracy);

  // Update heading from GPS if moving
  if (pos.heading !== null && !isNaN(pos.heading) && pos.speed > 0.5) {
    currentHeading = pos.heading;
    updateHeadingCone();
  }

  lastPosition = pos;
  updateStats();

  // Only record when actively recording
  if (state !== 'recording') return;

  // FILTER: accuracy
  if (pos.accuracy > CONFIG.maxAccuracy) return;

  // FILTER: minimum distance
  if (trackPoints.length > 0) {
    const last = trackPoints[trackPoints.length - 1];
    const dist = haversineDistance(last.lat, last.lng, pos.lat, pos.lng);
    if (dist < CONFIG.minDistance) return;
    totalDistance += dist;
  }

  // Add point
  const point = {
    lat: pos.lat,
    lng: pos.lng,
    alt: pos.alt || 0,
    speed: pos.speed || 0,
    heading: currentHeading,
    accuracy: pos.accuracy,
    time: pos.time
  };

  trackPoints.push(point);

  // Update polyline
  if (trackPolyline) {
    trackPolyline.addLatLng([pos.lat, pos.lng]);
  }

  // Auto-save to IndexedDB
  if (trackPoints.length % CONFIG.autoSaveInterval === 0) {
    saveCurrentTrack('recording');
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPASS
// ═══════════════════════════════════════════════════════════════

function startCompass() {
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onCompass);
  } else if ('ondeviceorientation' in window) {
    window.addEventListener('deviceorientation', onCompass);
  }

  // iOS permission
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(perm => {
        if (perm === 'granted') {
          window.addEventListener('deviceorientation', onCompass);
        }
      }).catch(() => {});
  }
}

function stopCompass() {
  window.removeEventListener('deviceorientationabsolute', onCompass);
  window.removeEventListener('deviceorientation', onCompass);
}

function onCompass(e) {
  let heading = e.webkitCompassHeading || (e.alpha ? (360 - e.alpha) : 0);
  if (heading !== undefined && !isNaN(heading)) {
    currentHeading = heading;
    updateHeadingCone();
  }
}

// ═══════════════════════════════════════════════════════════════
// MAP MARKERS — Blue Dot + Heading + Accuracy
// ═══════════════════════════════════════════════════════════════

function updateBlueDot(lat, lng, accuracy) {
  const latlng = L.latLng(lat, lng);

  if (!positionMarker) {
    positionMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'bft-position-marker',
        html: `<div class="bft-dot">
          <div class="bft-dot-inner"></div>
          <div class="bft-dot-pulse"></div>
        </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
      zIndexOffset: 2000,
      interactive: false
    }).addTo(bftLayer);
  } else {
    positionMarker.setLatLng(latlng);
  }

  if (!headingMarker) {
    headingMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'bft-heading-marker',
        html: `<div class="bft-heading-cone" id="bft-heading-cone"></div>`,
        iconSize: [60, 60],
        iconAnchor: [30, 30]
      }),
      zIndexOffset: 1999,
      interactive: false
    }).addTo(bftLayer);
  } else {
    headingMarker.setLatLng(latlng);
  }
  updateHeadingCone();

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latlng, {
      radius: Math.min(accuracy, 500),
      color: '#4285f4',
      fillColor: '#4285f4',
      fillOpacity: 0.08,
      weight: 1,
      interactive: false
    }).addTo(bftLayer);
  } else {
    accuracyCircle.setLatLng(latlng);
    accuracyCircle.setRadius(Math.min(accuracy, 500));
  }
}

function updateHeadingCone() {
  const cone = document.getElementById('bft-heading-cone');
  if (cone) {
    cone.style.transform = `rotate(${currentHeading}deg)`;
  }
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE — IndexedDB
// ═══════════════════════════════════════════════════════════════

async function saveCurrentTrack(trackState) {
  if (!currentTrackId || trackPoints.length < 1) return;

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const autoName = `OP_TRACK_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

  // Check if track already exists (for updates)
  let existing = null;
  try { existing = await getTrack(currentTrackId); } catch (e) {}

  const track = {
    id: currentTrackId,
    name: existing?.name || autoName,
    state: trackState,
    points: trackPoints,
    distance: totalDistance,
    startTime: startTime,
    endTime: Date.now(),
    pointCount: trackPoints.length
  };

  try {
    await saveTrack(track);
  } catch (e) {
    console.warn('[TacticalTracker] Save failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// STATS PANEL UI
// ═══════════════════════════════════════════════════════════════

function createStatsPanel() {
  statsPanel = document.createElement('div');
  statsPanel.id = 'tactical-tracker-panel';
  statsPanel.className = 'bft-panel hidden';
  statsPanel.innerHTML = `
    <div class="bft-panel-header">
      <span>🔵 التتبع التكتيكي</span>
      <button id="tt-close" class="bft-close-btn">✕</button>
    </div>
    <div class="bft-panel-body">
      <div class="bft-row"><span class="bft-label">الموقع</span><span id="tt-coords" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">الدقة</span><span id="tt-accuracy" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">الارتفاع</span><span id="tt-altitude" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">السرعة</span><span id="tt-speed" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">الاتجاه</span><span id="tt-heading" class="bft-value">---</span></div>
      <div class="bft-section-title">📊 إحصائيات المسار</div>
      <div class="bft-row"><span class="bft-label">النقاط</span><span id="tt-points" class="bft-value">0</span></div>
      <div class="bft-row"><span class="bft-label">المسافة</span><span id="tt-distance" class="bft-value">0 م</span></div>
      <div class="bft-row"><span class="bft-label">المدة</span><span id="tt-duration" class="bft-value">00:00</span></div>
    </div>
    <div class="bft-panel-actions">
      <button id="tt-center" class="bft-btn">🎯 توسيط</button>
      <button id="tt-pause" class="bft-btn bft-btn-rec">⏸️ إيقاف مؤقت</button>
    </div>
    <div class="bft-panel-actions">
      <button id="tt-stop" class="bft-btn bft-btn-warn">⏹️ إيقاف التتبع</button>
    </div>
  `;

  document.body.appendChild(statsPanel);

  // Prevent map interaction through panel
  ['click', 'mousedown', 'dblclick', 'pointerdown', 'wheel'].forEach(evt => {
    statsPanel.addEventListener(evt, e => e.stopPropagation());
  });

  // Wire buttons
  statsPanel.querySelector('#tt-close').onclick = () => stopTracking();
  statsPanel.querySelector('#tt-center').onclick = () => {
    if (lastPosition) {
      map.flyTo([lastPosition.lat, lastPosition.lng], Math.max(map.getZoom(), 16), { duration: 0.5 });
    }
  };
  statsPanel.querySelector('#tt-pause').onclick = () => {
    togglePause();
    const btn = statsPanel.querySelector('#tt-pause');
    if (state === 'paused') {
      btn.textContent = '▶️ استئناف';
      btn.classList.add('bft-btn-rec-paused');
    } else {
      btn.textContent = '⏸️ إيقاف مؤقت';
      btn.classList.remove('bft-btn-rec-paused');
    }
  };
  statsPanel.querySelector('#tt-stop').onclick = () => stopTracking();
}

function showStatsPanel() {
  if (statsPanel) {
    statsPanel.classList.remove('hidden');
    const mapEl = document.getElementById('map');
    if (mapEl && !mapEl.contains(statsPanel)) {
      mapEl.appendChild(statsPanel);
    }
  }
}

function hideStatsPanel() {
  if (statsPanel) statsPanel.classList.add('hidden');
}

function updateStats() {
  if (!statsPanel || statsPanel.classList.contains('hidden')) return;

  if (lastPosition) {
    const el = id => document.getElementById(id);
    const coordsEl = el('tt-coords');
    const accEl = el('tt-accuracy');
    const altEl = el('tt-altitude');
    const spdEl = el('tt-speed');
    const hdgEl = el('tt-heading');

    if (coordsEl) coordsEl.textContent = `${lastPosition.lat.toFixed(6)}, ${lastPosition.lng.toFixed(6)}`;
    if (accEl) accEl.textContent = `${Math.round(lastPosition.accuracy)} م`;
    if (altEl) altEl.textContent = lastPosition.alt ? `${Math.round(lastPosition.alt)} م` : 'N/A';
    if (spdEl) spdEl.textContent = lastPosition.speed > 0 ? `${(lastPosition.speed * 3.6).toFixed(1)} كم/س` : '0 كم/س';
    if (hdgEl) {
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const dir = dirs[Math.round(currentHeading / 45) % 8];
      hdgEl.textContent = `${Math.round(currentHeading)}° ${dir}`;
    }
  }

  const ptsEl = document.getElementById('tt-points');
  const distEl = document.getElementById('tt-distance');
  const durEl = document.getElementById('tt-duration');

  if (ptsEl) ptsEl.textContent = trackPoints.length;
  if (distEl) distEl.textContent = formatDistance(totalDistance);
  if (durEl && startTime) durEl.textContent = formatDuration(Date.now() - startTime);
}

function updateTrackerUI() {
  const btn = document.getElementById('btn-bft');
  if (btn) btn.classList.toggle('active', state !== 'idle');
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} كم`;
  return `${Math.round(meters)} م`;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
