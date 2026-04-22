/**
 * track-recorder.js — GPS Track Recording
 * Records GPS positions in real-time and draws a polyline on the map.
 * Supports: start/stop/pause, export as GPX, distance/time stats.
 * Works on both Electron/Windows (if GPS available) and Capacitor/Android.
 */
import L from 'leaflet';
import { showToast } from './toast.js';
import { t } from './i18n.js';

let map = null;
let isRecording = false;
let isPaused = false;
let watchId = null;
let trackPoints = [];
let trackPolyline = null;
let startTime = null;
let totalDistance = 0;
let statsPanel = null;
let statsInterval = null;
let positionMarker = null;

// Track style
const TRACK_STYLE = {
  color: '#ff4444',
  weight: 3,
  opacity: 0.9,
  dashArray: null,
  className: 'track-recording-line'
};

export function initTrackRecorder(mapInstance) {
  map = mapInstance;
  createStatsPanel();
}

// ===== RECORDING CONTROLS =====

export function startRecording() {
  if (isRecording) return;
  
  if (!navigator.geolocation) {
    showToast('❌ GPS غير متوفر في هذا الجهاز', 'error');
    return;
  }
  
  isRecording = true;
  isPaused = false;
  trackPoints = [];
  totalDistance = 0;
  startTime = Date.now();
  
  // Create polyline
  trackPolyline = L.polyline([], TRACK_STYLE).addTo(map);
  
  // Watch position
  watchId = navigator.geolocation.watchPosition(
    onPosition,
    onError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
  
  // Update stats every second
  statsInterval = setInterval(updateStats, 1000);
  
  showStatsPanel();
  updateRecordingUI(true);
  showToast('🔴 بدأ تسجيل المسار', 'success');
}

export function stopRecording() {
  if (!isRecording) return;
  
  isRecording = false;
  isPaused = false;
  
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  
  // Remove position marker
  if (positionMarker) {
    map.removeLayer(positionMarker);
    positionMarker = null;
  }
  
  hideStatsPanel();
  updateRecordingUI(false);
  
  if (trackPoints.length > 1) {
    const dist = formatDistance(totalDistance);
    const duration = formatDuration(Date.now() - startTime);
    showToast(`✅ المسار: ${dist} — ${duration} — ${trackPoints.length} نقطة`, 'success');
    
    // Save track to localStorage
    saveTrack();
  } else {
    showToast('⚠️ لم يتم تسجيل نقاط كافية', 'info');
    if (trackPolyline) {
      map.removeLayer(trackPolyline);
      trackPolyline = null;
    }
  }
}

export function pauseRecording() {
  if (!isRecording) return;
  isPaused = !isPaused;
  
  if (isPaused) {
    showToast('⏸️ تسجيل المسار متوقف مؤقتاً', 'info');
  } else {
    showToast('▶️ استئناف تسجيل المسار', 'info');
  }
  
  updateRecordingUI(true);
}

export function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

export function isTrackRecording() {
  return isRecording;
}

// ===== GPS CALLBACK =====

function onPosition(pos) {
  if (!isRecording || isPaused) return;
  
  const { latitude, longitude, altitude, speed, accuracy } = pos.coords;
  const timestamp = pos.timestamp || Date.now();
  
  // Filter out inaccurate positions
  if (accuracy > 50) return;
  
  const point = {
    lat: latitude,
    lng: longitude,
    alt: altitude || 0,
    speed: speed || 0,
    accuracy: accuracy,
    time: timestamp
  };
  
  // Calculate distance from last point
  if (trackPoints.length > 0) {
    const last = trackPoints[trackPoints.length - 1];
    const dist = haversineDistance(last.lat, last.lng, point.lat, point.lng);
    
    // Skip if moved less than 2 meters (noise filter)
    if (dist < 2) return;
    
    totalDistance += dist;
  }
  
  trackPoints.push(point);
  
  // Update polyline
  if (trackPolyline) {
    trackPolyline.addLatLng([latitude, longitude]);
  }
  
  // Update position marker
  updatePositionMarker(latitude, longitude);
  
  // Update stats
  updateStats();
}

function onError(err) {
  console.warn('[Track] GPS error:', err.message);
  if (err.code === 1) {
    showToast('❌ تم رفض إذن GPS', 'error');
    stopRecording();
  }
}

// ===== POSITION MARKER =====

function updatePositionMarker(lat, lng) {
  if (!positionMarker) {
    positionMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#ff4444',
      fillColor: '#ff4444',
      fillOpacity: 1,
      weight: 3,
      className: 'track-position-pulse'
    }).addTo(map);
  } else {
    positionMarker.setLatLng([lat, lng]);
  }
}

// ===== STATS PANEL =====

function createStatsPanel() {
  statsPanel = document.createElement('div');
  statsPanel.id = 'track-stats-panel';
  statsPanel.className = 'track-stats-panel hidden';
  statsPanel.innerHTML = `
    <div class="track-stats-header">
      <span class="track-rec-dot">●</span>
      <span>تسجيل المسار</span>
    </div>
    <div class="track-stats-body">
      <div class="track-stat">
        <span class="track-stat-label">المسافة</span>
        <span id="track-distance" class="track-stat-value">0 م</span>
      </div>
      <div class="track-stat">
        <span class="track-stat-label">الوقت</span>
        <span id="track-duration" class="track-stat-value">00:00</span>
      </div>
      <div class="track-stat">
        <span class="track-stat-label">النقاط</span>
        <span id="track-points" class="track-stat-value">0</span>
      </div>
      <div class="track-stat">
        <span class="track-stat-label">السرعة</span>
        <span id="track-speed" class="track-stat-value">0 كم/س</span>
      </div>
    </div>
    <div class="track-stats-actions">
      <button id="track-pause-btn" class="track-btn">⏸️ إيقاف مؤقت</button>
      <button id="track-stop-btn" class="track-btn track-btn-danger">⏹️ إيقاف</button>
    </div>
  `;
  
  document.body.appendChild(statsPanel);
  
  document.getElementById('track-pause-btn')?.addEventListener('click', pauseRecording);
  document.getElementById('track-stop-btn')?.addEventListener('click', stopRecording);
}

function showStatsPanel() {
  if (statsPanel) statsPanel.classList.remove('hidden');
}

function hideStatsPanel() {
  if (statsPanel) statsPanel.classList.add('hidden');
}

function updateStats() {
  if (!isRecording) return;
  
  const distEl = document.getElementById('track-distance');
  const durEl = document.getElementById('track-duration');
  const ptsEl = document.getElementById('track-points');
  const spdEl = document.getElementById('track-speed');
  
  if (distEl) distEl.textContent = formatDistance(totalDistance);
  if (durEl) durEl.textContent = formatDuration(Date.now() - startTime);
  if (ptsEl) ptsEl.textContent = trackPoints.length.toString();
  
  if (spdEl && trackPoints.length > 0) {
    const lastSpeed = trackPoints[trackPoints.length - 1].speed;
    spdEl.textContent = `${(lastSpeed * 3.6).toFixed(1)} كم/س`;
  }
}

function updateRecordingUI(recording) {
  const btn = document.getElementById('btn-track-record');
  if (btn) {
    btn.classList.toggle('active', recording);
  }
}

// ===== SAVE / EXPORT =====

function saveTrack() {
  if (trackPoints.length < 2) return;
  
  const track = {
    id: Date.now().toString(36),
    name: `مسار ${new Date().toLocaleDateString('ar-EG')} ${new Date().toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}`,
    points: trackPoints,
    distance: totalDistance,
    duration: Date.now() - startTime,
    startTime: startTime,
    endTime: Date.now()
  };
  
  // Save to localStorage (separate from IndexedDB to avoid conflicts)
  const tracks = JSON.parse(localStorage.getItem('pinvault_tracks') || '[]');
  tracks.push(track);
  localStorage.setItem('pinvault_tracks', JSON.stringify(tracks));
}

/**
 * Export current/last track as GPX
 */
export function exportTrackGPX() {
  const tracks = JSON.parse(localStorage.getItem('pinvault_tracks') || '[]');
  if (tracks.length === 0) {
    showToast('⚠️ لا يوجد مسارات مسجلة', 'info');
    return;
  }
  
  const lastTrack = tracks[tracks.length - 1];
  const gpx = buildGPX(lastTrack);
  
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${lastTrack.name}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('📥 تم تصدير المسار كـ GPX', 'success');
}

function buildGPX(track) {
  const pts = track.points.map(p => 
    `      <trkpt lat="${p.lat}" lon="${p.lng}">
        <ele>${p.alt || 0}</ele>
        <time>${new Date(p.time).toISOString()}</time>
      </trkpt>`
  ).join('\n');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PinVault Tactical Suite">
  <trk>
    <name>${track.name}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

// ===== HELPERS =====

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters/1000).toFixed(2)} كم`;
  return `${Math.round(meters)} م`;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
