/**
 * blueforce.js — Blue Force Tracking (BFT) + Track Recording
 * GPS tracking with real-time position (blue dot), compass heading,
 * automatic track recording, and GPX/KML export.
 */
import L from 'leaflet';
import { showToast } from './toast.js';
import { t } from './i18n.js';

let map = null;
let bftActive = false;
let bftLayer = null;
let positionMarker = null;
let headingMarker = null;
let accuracyCircle = null;
let trackLine = null;
let trackPoints = [];         // {lat, lng, alt, speed, heading, accuracy, time}
let watchId = null;
let currentHeading = 0;
let lastPosition = null;
let panel = null;
let recordingStartTime = null;
let isRecording = true;       // Recording on by default when BFT active

// ===== INIT =====

export function initBFT(mapInstance) {
  map = mapInstance;
  bftLayer = L.layerGroup().addTo(map);
  
  // Load saved track from localStorage
  try {
    const saved = localStorage.getItem('pinvault_bft_track');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.points && data.points.length > 0) {
        trackPoints = data.points;
        updateTrackLine();
      }
    }
  } catch(e) {}
}

// ===== TOGGLE =====

export function toggleBFT() {
  if (bftActive) {
    deactivateBFT();
  } else {
    activateBFT();
  }
}

export function deactivateBFT() {
  bftActive = false;
  const btn = document.getElementById('btn-bft');
  if (btn) btn.classList.remove('active');

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  window.removeEventListener('deviceorientationabsolute', onCompass);
  window.removeEventListener('deviceorientation', onCompass);

  // Auto-save track
  saveTrackToStorage();

  if (panel) { panel.remove(); panel = null; }

  showToast('📍 ' + (t('bftStopped') || 'تم إيقاف التتبع — المسار محفوظ'), 'info');
}

function activateBFT() {
  if (!navigator.geolocation) {
    showToast('❌ GPS غير متوفر في هذا الجهاز', 'error');
    return;
  }

  bftActive = true;
  isRecording = true;
  recordingStartTime = recordingStartTime || Date.now();
  const btn = document.getElementById('btn-bft');
  if (btn) btn.classList.add('active');

  createBFTPanel();
  startGPS();
  startCompass();

  showToast('🔵 ' + (t('bftStarted') || 'التتبع الذاتي — GPS مُفعّل'), 'success');
}

// ===== GPS =====

function startGPS() {
  const options = {
    enableHighAccuracy: true,
    maximumAge: 3000,
    timeout: 10000
  };

  navigator.geolocation.getCurrentPosition(
    pos => onPosition(pos, true),
    err => showToast('❌ GPS Error: ' + err.message, 'error'),
    options
  );

  watchId = navigator.geolocation.watchPosition(
    pos => onPosition(pos, false),
    err => console.warn('[BFT] GPS error:', err),
    options
  );
}

function onPosition(pos, flyTo) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const accuracy = pos.coords.accuracy;
  const speed = pos.coords.speed;
  const gpsHeading = pos.coords.heading;
  const altitude = pos.coords.altitude;
  const timestamp = pos.timestamp;

  const latlng = L.latLng(lat, lng);
  lastPosition = { lat, lng, accuracy, speed, altitude, timestamp };

  if (gpsHeading !== null && !isNaN(gpsHeading) && speed > 0.5) {
    currentHeading = gpsHeading;
  }

  // Only add to track if recording
  if (isRecording) {
    trackPoints.push({
      lat, lng,
      alt: altitude,
      speed: speed,
      heading: currentHeading,
      accuracy: accuracy,
      time: timestamp
    });
    
    // Auto-save every 30 points
    if (trackPoints.length % 30 === 0) {
      saveTrackToStorage();
    }
  }

  updateBlueForce(latlng, accuracy);
  updateTrackLine();
  updateBFTPanel();

  if (flyTo) {
    map.flyTo(latlng, Math.max(map.getZoom(), 15), { duration: 1.5 });
  }
}

// ===== COMPASS =====

function startCompass() {
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onCompass);
  } else if ('ondeviceorientation' in window) {
    window.addEventListener('deviceorientation', onCompass);
  }

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

function onCompass(e) {
  if (!bftActive) return;
  let heading = e.webkitCompassHeading || (e.alpha ? (360 - e.alpha) : 0);
  if (heading !== undefined && !isNaN(heading)) {
    currentHeading = heading;
    updateHeadingMarker();
  }
}

// ===== MAP MARKERS =====

function updateBlueForce(latlng, accuracy) {
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
  updateHeadingMarker();

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

function updateHeadingMarker() {
  const cone = document.getElementById('bft-heading-cone');
  if (cone) {
    cone.style.transform = `rotate(${currentHeading}deg)`;
  }
}

function updateTrackLine() {
  const points = trackPoints.map(p => [p.lat, p.lng]);

  if (!trackLine) {
    trackLine = L.polyline(points, {
      color: '#4285f4',
      weight: 3,
      opacity: 0.7,
      smoothFactor: 0
    }).addTo(bftLayer);
  } else {
    trackLine.setLatLngs(points);
  }
}

// ===== PERSISTENCE =====

function saveTrackToStorage() {
  try {
    localStorage.setItem('pinvault_bft_track', JSON.stringify({
      points: trackPoints,
      startTime: recordingStartTime
    }));
  } catch(e) {
    console.warn('[BFT] Save failed:', e);
  }
}

// ===== EXPORT GPX =====

function exportGPX() {
  if (trackPoints.length < 2) {
    showToast('❌ لا توجد نقاط كافية للتصدير', 'warning');
    return;
  }

  const now = new Date().toISOString();
  const trackName = `PinVault_Track_${new Date().toISOString().slice(0,10)}`;
  
  let trkpts = '';
  trackPoints.forEach(p => {
    const time = new Date(p.time).toISOString();
    trkpts += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
    if (p.alt !== null && p.alt !== undefined) {
      trkpts += `        <ele>${p.alt.toFixed(1)}</ele>\n`;
    }
    trkpts += `        <time>${time}</time>\n`;
    if (p.speed !== null && p.speed !== undefined) {
      trkpts += `        <extensions><speed>${p.speed.toFixed(2)}</speed></extensions>\n`;
    }
    trkpts += `      </trkpt>\n`;
  });

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PinVault Tactical Suite"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${trackName}</name>
    <time>${now}</time>
    <desc>Tactical track recorded by PinVault BFT</desc>
  </metadata>
  <trk>
    <name>${trackName}</name>
    <desc>Points: ${trackPoints.length} | Distance: ${getTrackDistanceText()}</desc>
    <trkseg>
${trkpts}    </trkseg>
  </trk>
</gpx>`;

  downloadFile(gpx, `${trackName}.gpx`, 'application/gpx+xml');
  showToast(`📥 تم تصدير GPX — ${trackPoints.length} نقطة`, 'success');
}

// ===== EXPORT KML =====

function exportKML() {
  if (trackPoints.length < 2) {
    showToast('❌ لا توجد نقاط كافية للتصدير', 'warning');
    return;
  }

  const trackName = `PinVault_Track_${new Date().toISOString().slice(0,10)}`;
  
  // KML coordinates: lng,lat,alt (space-separated)
  const coords = trackPoints.map(p => {
    const alt = (p.alt !== null && p.alt !== undefined) ? p.alt.toFixed(1) : '0';
    return `${p.lng},${p.lat},${alt}`;
  }).join('\n            ');

  // Add timestamps for TimeSpan
  const startTime = new Date(trackPoints[0].time).toISOString();
  const endTime = new Date(trackPoints[trackPoints.length - 1].time).toISOString();

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${trackName}</name>
    <description>Tactical track — ${trackPoints.length} points — ${getTrackDistanceText()}</description>
    <Style id="trackStyle">
      <LineStyle>
        <color>ffff7700</color>
        <width>4</width>
      </LineStyle>
    </Style>
    <Style id="startPin">
      <IconStyle><color>ff00ff00</color><scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/go.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="endPin">
      <IconStyle><color>ff0000ff</color><scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/stop.png</href></Icon>
      </IconStyle>
    </Style>
    <Placemark>
      <name>Track</name>
      <styleUrl>#trackStyle</styleUrl>
      <TimeSpan>
        <begin>${startTime}</begin>
        <end>${endTime}</end>
      </TimeSpan>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>
            ${coords}
        </coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <name>Start</name>
      <styleUrl>#startPin</styleUrl>
      <TimeStamp><when>${startTime}</when></TimeStamp>
      <Point><coordinates>${trackPoints[0].lng},${trackPoints[0].lat},0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>End</name>
      <styleUrl>#endPin</styleUrl>
      <TimeStamp><when>${endTime}</when></TimeStamp>
      <Point><coordinates>${trackPoints[trackPoints.length-1].lng},${trackPoints[trackPoints.length-1].lat},0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

  downloadFile(kml, `${trackName}.kml`, 'application/vnd.google-earth.kml+xml');
  showToast(`📥 تم تصدير KML — ${trackPoints.length} نقطة`, 'success');
}

// ===== HELPERS =====

function getTrackDistance() {
  let dist = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    const a = L.latLng(trackPoints[i-1].lat, trackPoints[i-1].lng);
    const b = L.latLng(trackPoints[i].lat, trackPoints[i].lng);
    dist += a.distanceTo(b);
  }
  return dist;
}

function getTrackDistanceText() {
  const dist = getTrackDistance();
  return dist > 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m';
}

function getTrackDuration() {
  if (trackPoints.length < 2) return '00:00:00';
  const ms = trackPoints[trackPoints.length - 1].time - trackPoints[0].time;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function getAvgSpeed() {
  const speeds = trackPoints.filter(p => p.speed !== null && p.speed > 0).map(p => p.speed);
  if (speeds.length === 0) return 0;
  return (speeds.reduce((a,b) => a + b, 0) / speeds.length) * 3.6; // km/h
}

function getMaxAlt() {
  const alts = trackPoints.filter(p => p.alt !== null && p.alt !== undefined).map(p => p.alt);
  if (alts.length === 0) return null;
  return Math.max(...alts);
}

function getMinAlt() {
  const alts = trackPoints.filter(p => p.alt !== null && p.alt !== undefined).map(p => p.alt);
  if (alts.length === 0) return null;
  return Math.min(...alts);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== UI PANEL =====

function createBFTPanel() {
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'bft-panel';
  panel.className = 'bft-panel';
  panel.innerHTML = `
    <div class="bft-panel-header">
      <span>🔵 التتبع الذاتي — BFT</span>
      <button id="bft-close" class="bft-close-btn">✕</button>
    </div>
    <div class="bft-panel-body">
      <div class="bft-row"><span class="bft-label">الموقع</span><span id="bft-coords" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">الدقة</span><span id="bft-accuracy" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">الارتفاع</span><span id="bft-altitude" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">السرعة</span><span id="bft-speed" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">الاتجاه</span><span id="bft-heading" class="bft-value">---</span></div>
      <div class="bft-section-title">📊 إحصائيات المسار</div>
      <div class="bft-row"><span class="bft-label">النقاط</span><span id="bft-points" class="bft-value">0</span></div>
      <div class="bft-row"><span class="bft-label">المسافة</span><span id="bft-distance" class="bft-value">0 m</span></div>
      <div class="bft-row"><span class="bft-label">المدة</span><span id="bft-duration" class="bft-value">00:00:00</span></div>
      <div class="bft-row"><span class="bft-label">متوسط السرعة</span><span id="bft-avg-speed" class="bft-value">---</span></div>
      <div class="bft-row"><span class="bft-label">أعلى/أدنى ارتفاع</span><span id="bft-alt-range" class="bft-value">---</span></div>
    </div>
    <div class="bft-panel-actions">
      <button id="bft-center" class="bft-btn">🎯 توسيط</button>
      <button id="bft-toggle-rec" class="bft-btn bft-btn-rec">⏸️ إيقاف</button>
    </div>
    <div class="bft-panel-actions">
      <button id="bft-export-gpx" class="bft-btn bft-btn-export">📥 GPX</button>
      <button id="bft-export-kml" class="bft-btn bft-btn-export">📥 KML</button>
      <button id="bft-clear-track" class="bft-btn bft-btn-warn">🗑️ مسح</button>
    </div>
  `;

  document.getElementById('map').appendChild(panel);

  ['click', 'mousedown', 'dblclick', 'pointerdown', 'wheel'].forEach(evt => {
    panel.addEventListener(evt, (e) => e.stopPropagation());
  });

  // Wire buttons
  document.getElementById('bft-close').onclick = () => deactivateBFT();
  
  document.getElementById('bft-center').onclick = () => {
    if (lastPosition) {
      map.flyTo([lastPosition.lat, lastPosition.lng], Math.max(map.getZoom(), 16), { duration: 0.5 });
    }
  };
  
  document.getElementById('bft-toggle-rec').onclick = () => {
    isRecording = !isRecording;
    const btn = document.getElementById('bft-toggle-rec');
    if (btn) {
      btn.textContent = isRecording ? '⏸️ إيقاف' : '⏺️ تسجيل';
      btn.classList.toggle('bft-btn-rec-paused', !isRecording);
    }
    showToast(isRecording ? '⏺️ استئناف التسجيل' : '⏸️ التسجيل متوقف', 'info');
  };

  document.getElementById('bft-export-gpx').onclick = exportGPX;
  document.getElementById('bft-export-kml').onclick = exportKML;
  
  document.getElementById('bft-clear-track').onclick = () => {
    if (trackPoints.length > 0 && !confirm('هل تريد مسح المسار بالكامل؟')) return;
    trackPoints = [];
    recordingStartTime = Date.now();
    if (trackLine) { bftLayer.removeLayer(trackLine); trackLine = null; }
    localStorage.removeItem('pinvault_bft_track');
    updateBFTPanel();
    showToast('🗑️ تم مسح المسار', 'info');
  };
}

function updateBFTPanel() {
  if (!panel) return;

  const coordsEl = document.getElementById('bft-coords');
  const accEl = document.getElementById('bft-accuracy');
  const altEl = document.getElementById('bft-altitude');
  const spdEl = document.getElementById('bft-speed');
  const hdgEl = document.getElementById('bft-heading');

  if (lastPosition) {
    if (coordsEl) coordsEl.textContent = `${lastPosition.lat.toFixed(6)}, ${lastPosition.lng.toFixed(6)}`;
    if (accEl) accEl.textContent = `${Math.round(lastPosition.accuracy)} m`;
    if (altEl) altEl.textContent = lastPosition.altitude !== null ? `${Math.round(lastPosition.altitude)} m` : 'N/A';
    if (spdEl) {
      if (lastPosition.speed !== null && lastPosition.speed > 0) {
        spdEl.textContent = `${(lastPosition.speed * 3.6).toFixed(1)} km/h`;
      } else {
        spdEl.textContent = '0 km/h';
      }
    }
    if (hdgEl) {
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const dir = dirs[Math.round(currentHeading / 45) % 8];
      hdgEl.textContent = `${Math.round(currentHeading)}° ${dir}`;
    }
  }

  // Track stats
  const ptsEl = document.getElementById('bft-points');
  const distEl = document.getElementById('bft-distance');
  const durEl = document.getElementById('bft-duration');
  const avgEl = document.getElementById('bft-avg-speed');
  const altREl = document.getElementById('bft-alt-range');

  if (ptsEl) ptsEl.textContent = trackPoints.length;
  if (distEl) distEl.textContent = getTrackDistanceText();
  if (durEl) durEl.textContent = getTrackDuration();
  if (avgEl) avgEl.textContent = getAvgSpeed() > 0 ? getAvgSpeed().toFixed(1) + ' km/h' : '---';
  if (altREl) {
    const maxA = getMaxAlt();
    const minA = getMinAlt();
    if (maxA !== null && minA !== null) {
      altREl.textContent = `${Math.round(minA)}m — ${Math.round(maxA)}m`;
    } else {
      altREl.textContent = 'N/A';
    }
  }
}

export function isBFTActive() {
  return bftActive;
}
