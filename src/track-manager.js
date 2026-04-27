/**
 * track-manager.js — Tactical Track Manager Panel
 *
 * UI panel for managing saved GPS tracks from IndexedDB:
 *  - List all tracks with stats (distance, duration, date)
 *  - Rename tracks (offline naming convention)
 *  - Render track on map as L.polyline + fit bounds
 *  - Delete tracks (soft-delete)
 *  - Export as GPX / KML to device filesystem
 */
import L from 'leaflet';
import { getAllTracks, saveTrack, deleteTrack, getTrack } from './db.js';
import { showToast } from './toast.js';
import { showTacticalConfirm } from './user-management.js';

let map = null;
let panelEl = null;
let isOpen = false;
let renderedLayers = {}; // trackId -> L.polyline

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

export function initTrackManager(mapInstance) {
  map = mapInstance;
  createPanel();
}

export function toggleTrackManager() {
  if (isOpen) closePanel();
  else openPanel();
}

// ═══════════════════════════════════════════════════════════════
// PANEL
// ═══════════════════════════════════════════════════════════════

function createPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'track-manager-panel';
  panelEl.className = 'track-manager-panel hidden';
  panelEl.innerHTML = `
    <div class="tm-header">
      <span>📋 إدارة المسارات</span>
      <button id="tm-close" class="bft-close-btn">✕</button>
    </div>
    <div id="tm-list" class="tm-list">
      <div class="tm-empty">جاري التحميل...</div>
    </div>
  `;

  document.body.appendChild(panelEl);

  // Prevent map interaction
  ['click', 'mousedown', 'dblclick', 'pointerdown', 'wheel'].forEach(evt => {
    panelEl.addEventListener(evt, e => e.stopPropagation());
  });

  panelEl.querySelector('#tm-close').onclick = () => closePanel();
}

async function openPanel() {
  isOpen = true;
  panelEl.classList.remove('hidden');
  const mapEl = document.getElementById('map');
  if (mapEl && !mapEl.contains(panelEl)) {
    mapEl.appendChild(panelEl);
  }
  await refreshList();
}

function closePanel() {
  isOpen = false;
  panelEl.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
// TRACK LIST
// ═══════════════════════════════════════════════════════════════

async function refreshList() {
  const listEl = panelEl.querySelector('#tm-list');
  const tracks = await getAllTracks();

  if (tracks.length === 0) {
    listEl.innerHTML = '<div class="tm-empty">لا توجد مسارات مسجلة</div>';
    return;
  }

  listEl.innerHTML = tracks.map(track => {
    const date = new Date(track.startTime || track.createdAt);
    const dateStr = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const dist = formatDistance(track.distance || 0);
    const dur = formatDuration(track.endTime && track.startTime ? track.endTime - track.startTime : 0);
    const pts = track.pointCount || (track.points ? track.points.length : 0);
    const isRendered = !!renderedLayers[track.id];
    const stateLabel = track.state === 'recording' ? '🔴' : track.state === 'paused' ? '⏸️' : '✅';

    return `
      <div class="tm-track" data-id="${track.id}">
        <div class="tm-track-header">
          <span class="tm-track-state">${stateLabel}</span>
          <span class="tm-track-name" data-id="${track.id}" title="انقر للتعديل">${track.name}</span>
        </div>
        <div class="tm-track-stats">
          <span>📅 ${dateStr} ${timeStr}</span>
          <span>📏 ${dist}</span>
          <span>⏱️ ${dur}</span>
          <span>📍 ${pts} نقطة</span>
        </div>
        <div class="tm-track-actions">
          <button class="tm-btn tm-btn-render" data-id="${track.id}">${isRendered ? '👁️ إخفاء' : '🗺️ عرض'}</button>
          <button class="tm-btn tm-btn-rename" data-id="${track.id}">✏️</button>
          <button class="tm-btn tm-btn-gpx" data-id="${track.id}">GPX</button>
          <button class="tm-btn tm-btn-kml" data-id="${track.id}">KML</button>
          <button class="tm-btn tm-btn-delete" data-id="${track.id}">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  // Wire event handlers
  listEl.querySelectorAll('.tm-btn-render').forEach(btn => {
    btn.onclick = () => toggleRenderTrack(btn.dataset.id);
  });
  listEl.querySelectorAll('.tm-btn-rename').forEach(btn => {
    btn.onclick = () => renameTrack(btn.dataset.id);
  });
  listEl.querySelectorAll('.tm-btn-gpx').forEach(btn => {
    btn.onclick = () => exportTrackGPX(btn.dataset.id);
  });
  listEl.querySelectorAll('.tm-btn-kml').forEach(btn => {
    btn.onclick = () => exportTrackKML(btn.dataset.id);
  });
  listEl.querySelectorAll('.tm-btn-delete').forEach(btn => {
    btn.onclick = () => removeTrack(btn.dataset.id);
  });
  listEl.querySelectorAll('.tm-track-name').forEach(el => {
    el.onclick = () => renameTrack(el.dataset.id);
  });
}

// ═══════════════════════════════════════════════════════════════
// RENDER ON MAP
// ═══════════════════════════════════════════════════════════════

async function toggleRenderTrack(trackId) {
  if (renderedLayers[trackId]) {
    // Remove from map
    map.removeLayer(renderedLayers[trackId]);
    delete renderedLayers[trackId];
    showToast('👁️ تم إخفاء المسار', 'info');
    await refreshList();
    return;
  }

  const track = await getTrack(trackId);
  if (!track || !track.points || track.points.length < 2) {
    showToast('⚠️ لا توجد نقاط كافية لعرض المسار', 'info');
    return;
  }

  const latlngs = track.points.map(p => [p.lat, p.lng]);
  const polyline = L.polyline(latlngs, {
    color: '#ff6b35',
    weight: 4,
    opacity: 0.85,
    dashArray: '8,4',
    className: 'rendered-track-line'
  }).addTo(map);

  // Add start/end markers
  const startMarker = L.circleMarker(latlngs[0], {
    radius: 8, color: '#00c853', fillColor: '#00c853', fillOpacity: 1, weight: 2
  }).addTo(map).bindTooltip('بداية', { permanent: false });

  const endMarker = L.circleMarker(latlngs[latlngs.length - 1], {
    radius: 8, color: '#ff1744', fillColor: '#ff1744', fillOpacity: 1, weight: 2
  }).addTo(map).bindTooltip('نهاية', { permanent: false });

  // Group them
  const group = L.layerGroup([polyline, startMarker, endMarker]).addTo(map);
  renderedLayers[trackId] = group;

  // Fit map to track bounds
  map.fitBounds(polyline.getBounds(), { padding: [50, 50], maxZoom: 17 });

  showToast(`🗺️ تم عرض: ${track.name}`, 'success');
  await refreshList();
}

// ═══════════════════════════════════════════════════════════════
// RENAME
// ═══════════════════════════════════════════════════════════════

async function renameTrack(trackId) {
  const track = await getTrack(trackId);
  if (!track) return;

  const newName = prompt('اسم المسار الجديد:', track.name);
  if (!newName || newName.trim() === '' || newName === track.name) return;

  track.name = newName.trim();
  await saveTrack(track);
  showToast(`✏️ تم تغيير الاسم إلى: ${track.name}`, 'success');
  await refreshList();
}

// ═══════════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════════

async function removeTrack(trackId) {
  const confirmed = await showTacticalConfirm('هل تريد حذف هذا المسار نهائياً؟');
  if (!confirmed) return;

  // Remove from map if rendered
  if (renderedLayers[trackId]) {
    map.removeLayer(renderedLayers[trackId]);
    delete renderedLayers[trackId];
  }

  await deleteTrack(trackId);
  showToast('🗑️ تم حذف المسار', 'info');
  await refreshList();
}

// ═══════════════════════════════════════════════════════════════
// EXPORT GPX
// ═══════════════════════════════════════════════════════════════

async function exportTrackGPX(trackId) {
  const track = await getTrack(trackId);
  if (!track || !track.points || track.points.length < 2) {
    showToast('❌ لا توجد نقاط كافية للتصدير', 'warning');
    return;
  }

  const pts = track.points.map(p => {
    const time = new Date(p.time).toISOString();
    let trkpt = `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
    if (p.alt !== null && p.alt !== undefined) {
      trkpt += `        <ele>${p.alt.toFixed ? p.alt.toFixed(1) : p.alt}</ele>\n`;
    }
    trkpt += `        <time>${time}</time>\n`;
    if (p.speed !== null && p.speed !== undefined && p.speed > 0) {
      trkpt += `        <extensions><speed>${p.speed.toFixed ? p.speed.toFixed(2) : p.speed}</speed></extensions>\n`;
    }
    trkpt += `      </trkpt>`;
    return trkpt;
  }).join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="AxisCommand Tactical Suite"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${track.name}</name>
    <time>${new Date().toISOString()}</time>
    <desc>Tactical track — ${track.points.length} points — ${formatDistance(track.distance || 0)}</desc>
  </metadata>
  <trk>
    <name>${track.name}</name>
    <desc>Points: ${track.points.length} | Distance: ${formatDistance(track.distance || 0)}</desc>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;

  downloadFile(gpx, `${track.name}.gpx`, 'application/gpx+xml');
  showToast(`📥 تم تصدير GPX — ${track.points.length} نقطة`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// EXPORT KML
// ═══════════════════════════════════════════════════════════════

async function exportTrackKML(trackId) {
  const track = await getTrack(trackId);
  if (!track || !track.points || track.points.length < 2) {
    showToast('❌ لا توجد نقاط كافية للتصدير', 'warning');
    return;
  }

  const coords = track.points.map(p => {
    const alt = (p.alt !== null && p.alt !== undefined) ? (p.alt.toFixed ? p.alt.toFixed(1) : p.alt) : '0';
    return `${p.lng},${p.lat},${alt}`;
  }).join('\n            ');

  const startTime = new Date(track.points[0].time).toISOString();
  const endTime = new Date(track.points[track.points.length - 1].time).toISOString();

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${track.name}</name>
    <description>Tactical track — ${track.points.length} points — ${formatDistance(track.distance || 0)}</description>
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
      <Point><coordinates>${track.points[0].lng},${track.points[0].lat},0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>End</name>
      <styleUrl>#endPin</styleUrl>
      <Point><coordinates>${track.points[track.points.length-1].lng},${track.points[track.points.length-1].lat},0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

  downloadFile(kml, `${track.name}.kml`, 'application/vnd.google-earth.kml+xml');
  showToast(`📥 تم تصدير KML — ${track.points.length} نقطة`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

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
