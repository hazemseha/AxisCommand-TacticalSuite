/**
 * los.js — Line of Sight (LOS) Tactical Analysis Engine
 * Reads SRTM HGT elevation data and computes visibility between two points.
 * Fully offline — all calculations done client-side.
 */
import L from 'leaflet';
import { t } from './i18n.js';

// ===== HGT FILE STORAGE =====
// HGT tiles loaded into memory as Int16Arrays
const hgtTiles = new Map();
const HGT_SIZE = 1201; // SRTM3: 1201x1201 samples per 1°x1° tile

// Earth radius in meters
const EARTH_RADIUS = 6371000;

// ===== BUILDING DATA =====
let buildingData = null;
let buildingGrid = null; // spatial hash for fast lookup
const GRID_SIZE = 0.001; // ~100m grid cells

/**
 * Load OSM building data for urban LOS
 */
export async function loadBuildingData() {
  if (buildingData) return true;
  try {
    let fetchUrl;
    if (window.location.protocol === 'file:') {
      const baseUrl = new URL('.', window.location.href).href;
      fetchUrl = new URL('buildings/tripoli-buildings-lite.json', baseUrl).href;
    } else {
      fetchUrl = './buildings/tripoli-buildings-lite.json';
    }
    const res = await fetch(fetchUrl);
    if (!res.ok) { console.warn('[LOS] No building data found'); return false; }
    const data = await res.json();
    buildingData = data.b;
    
    // Build spatial hash grid for fast lookup
    buildingGrid = {};
    for (const b of buildingData) {
      const key = `${Math.floor(b.lat / GRID_SIZE)}_${Math.floor(b.lon / GRID_SIZE)}`;
      if (!buildingGrid[key]) buildingGrid[key] = [];
      buildingGrid[key].push(b);
    }
    
    console.log(`[LOS] Loaded ${buildingData.length} buildings for urban LOS`);
    return true;
  } catch (e) {
    console.warn('[LOS] Building data load failed:', e);
    return false;
  }
}

/**
 * Get building height at a lat/lon (returns 0 if no building)
 */
function getBuildingHeight(lat, lon) {
  if (!buildingGrid) return 0;
  
  // Check current cell AND all 8 neighbors for comprehensive coverage
  const baseCellLat = Math.floor(lat / GRID_SIZE);
  const baseCellLon = Math.floor(lon / GRID_SIZE);
  let maxHeight = 0;
  
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const key = `${baseCellLat + dLat}_${baseCellLon + dLon}`;
      const cell = buildingGrid[key];
      if (!cell) continue;
      
      for (const b of cell) {
        const distLat = Math.abs(b.lat - lat);
        const distLon = Math.abs(b.lon - lon);
        // Use circular radius check (not rectangular)
        const distDeg = Math.sqrt(distLat * distLat + distLon * distLon);
        if (distDeg <= b.r) {
          if (b.h > maxHeight) maxHeight = b.h;
        }
      }
    }
  }
  return maxHeight;
}

/**
 * Load an HGT file from a URL/path into memory
 */
export async function loadHgtTile(lat, lon) {
  const tileKey = getTileKey(lat, lon);
  if (hgtTiles.has(tileKey)) return true;

  // Determine file path
  const latPrefix = lat >= 0 ? 'N' : 'S';
  const lonPrefix = lon >= 0 ? 'E' : 'W';
  const latStr = Math.abs(Math.floor(lat)).toString().padStart(2, '0');
  const lonStr = Math.abs(Math.floor(lon)).toString().padStart(3, '0');
  const fileName = `${latPrefix}${latStr}${lonPrefix}${lonStr}.hgt`;

  try {
    // Build URL that works in both Electron (file://) and web (http://)
    let fetchUrl;
    if (window.location.protocol === 'file:') {
      const baseUrl = new URL('.', window.location.href).href;
      fetchUrl = new URL(`elevation-data/${fileName}`, baseUrl).href;
    } else {
      fetchUrl = `./elevation-data/${fileName}`;
    }
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      console.warn(`[LOS] HGT file not found: ${fileName}`);
      return false;
    }

    const buffer = await response.arrayBuffer();
    const data = new Int16Array(buffer);

    // Validate size (SRTM3 = 1201*1201 = 1,442,401 samples)
    if (data.length !== HGT_SIZE * HGT_SIZE) {
      console.error(`[LOS] Invalid HGT size: ${data.length} (expected ${HGT_SIZE * HGT_SIZE})`);
      return false;
    }

    // SRTM files are big-endian, but TypedArrays are native-endian
    // We need to byte-swap on little-endian systems
    const view = new DataView(buffer);
    const corrected = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      corrected[i] = view.getInt16(i * 2, false); // false = big-endian
    }

    hgtTiles.set(tileKey, {
      data: corrected,
      baseLat: Math.floor(lat),
      baseLon: Math.floor(lon)
    });

    console.log(`[LOS] Loaded elevation tile: ${fileName} (${(buffer.byteLength/1024/1024).toFixed(1)} MB)`);
    return true;
  } catch (e) {
    console.error(`[LOS] Failed to load ${fileName}:`, e);
    return false;
  }
}

function getTileKey(lat, lon) {
  return `${Math.floor(lat)}_${Math.floor(lon)}`;
}

/**
 * Get elevation at a specific lat/lon using bilinear interpolation
 */
export function getElevation(lat, lon) {
  const tileKey = getTileKey(lat, lon);
  const tile = hgtTiles.get(tileKey);
  if (!tile) return null;

  // Position within tile (0 to 1200)
  const row = (lat - tile.baseLat) * (HGT_SIZE - 1);
  const col = (lon - tile.baseLon) * (HGT_SIZE - 1);

  // HGT files store data from north to south (top-left = NW corner)
  const r = (HGT_SIZE - 1) - row;

  const r0 = Math.floor(r);
  const c0 = Math.floor(col);
  const r1 = Math.min(r0 + 1, HGT_SIZE - 1);
  const c1 = Math.min(c0 + 1, HGT_SIZE - 1);

  const fr = r - r0;
  const fc = col - c0;

  // Bilinear interpolation
  const v00 = tile.data[r0 * HGT_SIZE + c0];
  const v10 = tile.data[r1 * HGT_SIZE + c0];
  const v01 = tile.data[r0 * HGT_SIZE + c1];
  const v11 = tile.data[r1 * HGT_SIZE + c1];

  // SRTM void = -32768
  if (v00 === -32768 || v10 === -32768 || v01 === -32768 || v11 === -32768) {
    // Return nearest non-void value
    const vals = [v00, v10, v01, v11].filter(v => v !== -32768);
    return vals.length > 0 ? vals[0] : 0;
  }

  const elevation = v00 * (1 - fr) * (1 - fc)
                   + v10 * fr * (1 - fc)
                   + v01 * (1 - fr) * fc
                   + v11 * fr * fc;

  return Math.round(elevation);
}

/**
 * Haversine distance between two points (meters)
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Calculate bearing (azimuth) from point A to point B (degrees)
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Calculate Line of Sight between observer and target
 * @returns { profile: Array, visible: Boolean, obstructions: Array, distance: Number, bearing: Number }
 */
export async function calculateLOS(observerLat, observerLon, targetLat, targetLon, observerHeight = 1.7) {
  // Load required HGT tiles and building data in parallel
  await Promise.all([
    loadHgtTile(observerLat, observerLon),
    loadHgtTile(targetLat, targetLon),
    loadBuildingData()
  ]);

  const dist = haversineDistance(observerLat, observerLon, targetLat, targetLon);
  const bearing = calculateBearing(observerLat, observerLon, targetLat, targetLon);

  // Sample every ~10m for urban accuracy, minimum 100 samples
  const numSamples = Math.max(100, Math.ceil(dist / 10));
  const profile = [];
  const obstructions = [];

  const observerElev = getElevation(observerLat, observerLon) || 0;
  const targetElev = getElevation(targetLat, targetLon) || 0;

  // Auto-detect if observer/target is on a building rooftop
  const observerBldgH = getBuildingHeight(observerLat, observerLon);
  const targetBldgH = getBuildingHeight(targetLat, targetLon);

  // Observer eye level: ground + building height (if on building) + person height
  const observerEye = observerElev + observerBldgH + observerHeight;
  // Target ground: terrain + building at target (if any)
  const effectiveTargetElev = targetElev + targetBldgH;

  for (let i = 0; i <= numSamples; i++) {
    const fraction = i / numSamples;
    const lat = observerLat + (targetLat - observerLat) * fraction;
    const lon = observerLon + (targetLon - observerLon) * fraction;
    const sampleDist = dist * fraction;

    const groundElev = getElevation(lat, lon) || 0;
    const buildingH = getBuildingHeight(lat, lon);
    const totalElev = groundElev + buildingH;

    // Expected LOS height at this distance (linear interpolation observer->target)
    const losHeight = observerEye + (effectiveTargetElev - observerEye) * fraction;

    // Earth curvature correction
    const curvatureDrop = (sampleDist * sampleDist) / (2 * EARTH_RADIUS);
    const effectiveGround = totalElev + curvatureDrop;

    const isBlocked = effectiveGround > losHeight && i > 0 && i < numSamples;

    profile.push({
      distance: sampleDist,
      lat, lon,
      groundElevation: groundElev,
      buildingHeight: buildingH,
      totalElevation: totalElev,
      losHeight: losHeight - curvatureDrop,
      blocked: isBlocked
    });

    if (isBlocked) {
      obstructions.push({
        distance: sampleDist,
        lat, lon,
        groundElevation: groundElev,
        buildingHeight: buildingH,
        totalElevation: totalElev,
        clearanceNeeded: effectiveGround - losHeight,
        isBuilding: buildingH > 0
      });
    }
  }

  return {
    profile,
    visible: obstructions.length === 0,
    obstructions,
    distance: dist,
    bearing,
    observerElevation: observerElev,
    observerBuildingHeight: observerBldgH,
    targetElevation: targetElev,
    targetBuildingHeight: targetBldgH,
    observerHeight,
    observerTotalHeight: observerEye,
    targetTotalHeight: effectiveTargetElev
  };
}

// ===== LOS UI TOOL =====

let losMode = false;
let losPoints = [];
let losLayers = [];
let losMap = null;
let losPanel = null;

export function initLOS(mapInstance) {
  losMap = mapInstance;
}

export function toggleLOSMode() {
  losMode = !losMode;
  losPoints = [];
  
  // Clear previous LOS visualization
  clearLOS();
  
  const btn = document.getElementById('btn-los-tool');
  if (btn) btn.classList.toggle('active', losMode);
  
  if (losMode) {
    losMap.getContainer().style.cursor = 'crosshair';
    showLOSStatus(t('losClickObserver') || 'انقر لتحديد موقع المراقب');
  } else {
    losMap.getContainer().style.cursor = '';
    hideLOSPanel();
  }
}

export function handleLOSClick(e) {
  if (!losMode) return false;

  losPoints.push(e.latlng);

  if (losPoints.length === 1) {
    // Observer placed — show marker
    const marker = L.circleMarker(e.latlng, {
      radius: 8, fillColor: '#06d6a0', fillOpacity: 1,
      color: '#fff', weight: 2
    }).addTo(losMap).bindTooltip(t('observer') || 'المراقب', { permanent: true, direction: 'top', className: 'tactical-persistent-label' });
    losLayers.push(marker);
    showLOSStatus(t('losClickTarget') || 'انقر لتحديد الهدف');
  }

  if (losPoints.length === 2) {
    // Target placed — run LOS analysis
    const marker = L.circleMarker(e.latlng, {
      radius: 8, fillColor: '#ef4444', fillOpacity: 1,
      color: '#fff', weight: 2
    }).addTo(losMap).bindTooltip(t('target') || 'الهدف', { permanent: true, direction: 'top', className: 'tactical-persistent-label' });
    losLayers.push(marker);

    losMap.getContainer().style.cursor = 'wait';
    showLOSStatus(t('losAnalyzing') || 'جاري تحليل خط النظر...');

    runLOSAnalysis(losPoints[0], losPoints[1]);
    losMode = false;
    const btn = document.getElementById('btn-los-tool');
    if (btn) btn.classList.remove('active');
  }

  return true; // consumed the click
}

async function runLOSAnalysis(observer, target) {
  try {
    const result = await calculateLOS(
      observer.lat, observer.lng,
      target.lat, target.lng,
      1.7 // Observer height 1.7m (standing)
    );

    // Draw LOS line on map
    const lineColor = result.visible ? '#06d6a0' : '#ef4444';
    const line = L.polyline(
      [[observer.lat, observer.lng], [target.lat, target.lng]],
      { color: lineColor, weight: 3, dashArray: result.visible ? null : '10,8', opacity: 0.8 }
    ).addTo(losMap);
    losLayers.push(line);

    // Draw obstruction markers
    result.obstructions.forEach(obs => {
      const obsMarker = L.circleMarker([obs.lat, obs.lon], {
        radius: 5, fillColor: '#f59e0b', fillOpacity: 1, color: '#fff', weight: 1
      }).addTo(losMap).bindTooltip(`⚠️ ${Math.round(obs.groundElevation)}m`, { permanent: false });
      losLayers.push(obsMarker);
    });

    // Show results panel
    showLOSResults(result);
    losMap.getContainer().style.cursor = '';

  } catch (err) {
    console.error('[LOS] Analysis failed:', err);
    showLOSStatus(t('losNoData') || 'بيانات التضاريس غير متوفرة لهذه المنطقة');
    losMap.getContainer().style.cursor = '';
  }
}

function showLOSResults(result) {
  let panel = document.getElementById('los-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'los-panel';
    document.getElementById('map').appendChild(panel);
  }
  losPanel = panel;

  const buildingObs = result.obstructions.filter(o => o.isBuilding).length;
  const terrainObs = result.obstructions.length - buildingObs;
  
  let statusText;
  if (result.visible) {
    statusText = `<span style="color:#06d6a0;">✅ ${t('losClear') || 'رؤية واضحة'}</span>`;
  } else {
    let detail = '';
    if (buildingObs > 0) detail += `🏗️ ${buildingObs} `;
    if (terrainObs > 0) detail += `⛰️ ${terrainObs}`;
    statusText = `<span style="color:#ef4444;">⛔ ${t('losBlocked') || 'رؤية محجوبة'} (${detail.trim()})</span>`;
  }

  panel.innerHTML = `
    <div class="los-header">
      <span>🎯 ${t('losResult') || 'نتيجة خط النظر'}</span>
      <button id="los-close" class="los-close-btn">✕</button>
    </div>
    <div class="los-status">${statusText}</div>
    <div class="los-info">
      <div><strong>${t('distance') || 'المسافة'}:</strong> ${formatDistance(result.distance)}</div>
      <div><strong>${t('bearing') || 'الاتجاه'}:</strong> ${result.bearing.toFixed(1)}° (${compassDirection(result.bearing)})</div>
      <div><strong>${t('observer') || 'المراقب'}:</strong> ${result.observerElevation}m${result.observerBuildingHeight > 0 ? ` + 🏗️${result.observerBuildingHeight}m` : ''}</div>
      <div><strong>${t('target') || 'الهدف'}:</strong> ${result.targetElevation}m${result.targetBuildingHeight > 0 ? ` + 🏗️${result.targetBuildingHeight}m` : ''}</div>
    </div>
    <canvas id="los-chart" width="360" height="140"></canvas>
    <button id="los-clear-btn" class="los-action-btn">${t('losClearAll') || 'مسح'}</button>
  `;

  panel.classList.remove('hidden');

  // Draw elevation profile chart
  drawElevationProfile(result);

  // Wire buttons
  document.getElementById('los-close').onclick = hideLOSPanel;
  document.getElementById('los-clear-btn').onclick = () => { clearLOS(); hideLOSPanel(); };
}

function drawElevationProfile(result) {
  const canvas = document.getElementById('los-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const padding = { top: 15, right: 10, bottom: 25, left: 40 };

  ctx.clearRect(0, 0, W, H);

  const profile = result.profile;
  if (!profile.length) return;

  // Find elevation range
  const elevations = profile.map(p => p.groundElevation);
  const losHeights = profile.map(p => p.losHeight);
  const allHeights = [...elevations, ...losHeights];
  const minElev = Math.min(...allHeights) - 10;
  const maxElev = Math.max(...allHeights) + 20;
  const maxDist = result.distance;

  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  const toX = (d) => padding.left + (d / maxDist) * chartW;
  const toY = (e) => padding.top + chartH - ((e - minElev) / (maxElev - minElev)) * chartH;

  // Background
  ctx.fillStyle = 'rgba(10, 14, 26, 0.95)';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(W - padding.right, y); ctx.stroke();
    const elev = maxElev - ((maxElev - minElev) / 4) * i;
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.fillText(`${Math.round(elev)}m`, 2, y + 3);
  }

  // Terrain fill
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(minElev));
  profile.forEach(p => ctx.lineTo(toX(p.distance), toY(p.groundElevation)));
  ctx.lineTo(toX(maxDist), toY(minElev));
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, padding.top, 0, H);
  grad.addColorStop(0, 'rgba(34, 139, 34, 0.6)');
  grad.addColorStop(1, 'rgba(34, 139, 34, 0.1)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Terrain line
  ctx.beginPath();
  ctx.strokeStyle = '#228B22';
  ctx.lineWidth = 1.5;
  profile.forEach((p, i) => {
    if (i === 0) ctx.moveTo(toX(p.distance), toY(p.groundElevation));
    else ctx.lineTo(toX(p.distance), toY(p.groundElevation));
  });
  ctx.stroke();

  // Draw buildings on top of terrain
  ctx.fillStyle = 'rgba(249, 115, 22, 0.5)';
  profile.forEach(p => {
    if (p.buildingHeight > 0) {
      const bx = toX(p.distance);
      const by = toY(p.groundElevation + p.buildingHeight);
      const bh = toY(p.groundElevation) - by;
      ctx.fillRect(bx - 1, by, 2, bh);
    }
  });

  // LOS line
  ctx.beginPath();
  ctx.strokeStyle = result.visible ? 'rgba(6, 214, 160, 0.8)' : 'rgba(239, 68, 68, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  profile.forEach((p, i) => {
    if (i === 0) ctx.moveTo(toX(p.distance), toY(p.losHeight));
    else ctx.lineTo(toX(p.distance), toY(p.losHeight));
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Obstruction markers
  result.obstructions.forEach(obs => {
    ctx.fillStyle = obs.isBuilding ? '#f97316' : '#f59e0b';
    ctx.beginPath();
    ctx.arc(toX(obs.distance), toY(obs.totalElevation || obs.groundElevation), 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Observer & Target markers
  ctx.fillStyle = '#06d6a0';
  ctx.beginPath();
  ctx.arc(toX(0), toY(result.observerElevation + result.observerHeight), 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(toX(maxDist), toY(result.targetElevation), 5, 0, Math.PI * 2);
  ctx.fill();

  // Distance label
  ctx.fillStyle = '#888';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(formatDistance(maxDist), W / 2, H - 3);
}

function showLOSStatus(msg) {
  let panel = document.getElementById('los-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'los-panel';
    document.getElementById('map').appendChild(panel);
  }
  panel.innerHTML = `<div class="los-status-msg">${msg}</div>`;
  panel.classList.remove('hidden');
}

function hideLOSPanel() {
  const panel = document.getElementById('los-panel');
  if (panel) panel.classList.add('hidden');
}

export function clearLOS() {
  losLayers.forEach(layer => {
    if (losMap && losMap.hasLayer(layer)) losMap.removeLayer(layer);
  });
  losLayers = [];
  losPoints = [];
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters/1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function compassDirection(bearing) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(bearing / 45) % 8];
}
