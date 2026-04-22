import L from 'leaflet';
import { generateId, saveRoute, saveZone } from './db.js';
import { updateFeature } from './features.js';
import { showToast } from './toast.js';

let map;
let tacticalLayer;
let layerControl;

// Measurement State
let isMeasureMode = false;
let isMeasureFinished = false; // NEW: locked/finished state
let measurePoints = [];
let activeMeasurePolyline = null;
let activeMeasurePolygon = null;
let measureTooltip = null;
let areaLabel = null; // NEW: center area label

// Circle State
let isCircleMode = false;
let activeCircle = null;
let circleLabel = null;  // Editable label on circle center

// Extracted from Turf.js equivalent logic for accurate geodesic ring area
function calculateGeodesicArea(latlngs) {
  let area = 0;
  const d2r = Math.PI / 180;
  if (latlngs.length > 2) {
    for (let i = 0; i < latlngs.length; i++) {
        let p1 = latlngs[i];
        let p2 = latlngs[(i + 1) % latlngs.length];
        area += ((p2.lng - p1.lng) * d2r) * (2 + Math.sin(p1.lat * d2r) + Math.sin(p2.lat * d2r));
    }
    area = area * 6378137.0 * 6378137.0 / 2.0;
  }
  return Math.abs(area);
}

function updateMeasurePanel() {
  const distEl = document.getElementById('tactical-measure-distance');
  const areaEl = document.getElementById('tactical-measure-area');
  const pinBtn = document.getElementById('btn-pin-measure');
  const finishBtn = document.getElementById('btn-finish-measure');
  const closeAreaBtn = document.getElementById('btn-close-area');
  
  if (measurePoints.length < 2) {
    distEl.textContent = '0 m';
    areaEl.textContent = '0 m²';
    if (pinBtn) pinBtn.style.display = 'none';
    if (finishBtn) finishBtn.style.display = 'none';
    if (closeAreaBtn) closeAreaBtn.style.display = 'none';
    return;
  }

  let distance = 0;
  for (let i = 0; i < measurePoints.length - 1; i++) {
    distance += measurePoints[i].distanceTo(measurePoints[i+1]);
  }
  distEl.textContent = distance > 1000 ? (distance/1000).toFixed(2) + ' km' : Math.round(distance) + ' m';

  let area = calculateGeodesicArea(measurePoints);
  if (area > 1000000) {
    areaEl.textContent = (area / 1000000).toFixed(3) + ' km²';
  } else if (area > 10000) {
    areaEl.textContent = (area / 10000).toFixed(2) + ' Ha';
  } else {
    areaEl.textContent = Math.round(area) + ' m²';
  }
  
  if (pinBtn) pinBtn.style.display = 'block';
  
  // Show finish button only while still drawing
  if (finishBtn) finishBtn.style.display = (!isMeasureFinished && isMeasureMode) ? 'block' : 'none';
  
  // Show close area button when we have 3+ points and not yet finished
  if (closeAreaBtn) closeAreaBtn.style.display = (measurePoints.length >= 3 && !isMeasureFinished) ? 'block' : 'none';
}

export function stopToolModes() {
  isMeasureMode = false;
  isMeasureFinished = false;
  isCircleMode = false;
  document.getElementById('btn-measure-tool').classList.remove('active');
  document.getElementById('btn-draw-circle').classList.remove('active');
  document.getElementById('tactical-measure-panel').classList.add('hidden');
  // Only hide circle panel if there's no unpinned circle waiting
  if (!activeCircle) {
    document.getElementById('tactical-circle-panel').classList.add('hidden');
  }
  document.getElementById('map').style.cursor = '';
  // SAFETY GUARD: Prevent crash if Geoman plugin isn't fully attached yet
  if (map && map.pm) {
    map.pm.disableDraw(); 
  }
  map.off('mousemove', handleMouseMove);
  cursorPoint = null;
  renderMeasurement();
}

let cursorPoint = null;

function handleMapClick(e) {
  if (isMeasureMode && !isMeasureFinished) {
    measurePoints.push(e.latlng);
    renderMeasurement();
    updateMeasurePanel();
  } else if (isCircleMode) {
    const radius = parseInt(document.getElementById('circle-diameter-input').value, 10) / 2;
    const color = document.getElementById('circle-color-picker').value;
    
    // Remove previous circle and label
    if (activeCircle) { tacticalLayer.removeLayer(activeCircle); }
    if (circleLabel) { tacticalLayer.removeLayer(circleLabel); }
    
    activeCircle = L.circle(e.latlng, {
      radius: radius,
      color: color,
      fillColor: color,
      fillOpacity: 0.15,
      weight: 2
    }).addTo(tacticalLayer);
    
    // Create editable radius input at circle center
    addCircleCenterLabel(e.latlng, radius, color);
    
    document.getElementById('btn-pin-circle').style.display = 'block';
    
    // Auto-disable mode after dropping
    isCircleMode = false;
    document.getElementById('btn-draw-circle').classList.remove('active');
    document.getElementById('map').style.cursor = '';
    map.off('mousemove', handleMouseMove);
  }
}

function handleMouseMove(e) {
  if (isMeasureMode && !isMeasureFinished && measurePoints.length > 0) {
    cursorPoint = e.latlng;
    renderMeasurement();
  }
}

function renderMeasurement() {
  if (activeMeasurePolyline) tacticalLayer.removeLayer(activeMeasurePolyline);
  if (activeMeasurePolygon) tacticalLayer.removeLayer(activeMeasurePolygon);

  let activePoints = [...measurePoints];
  if (isMeasureMode && !isMeasureFinished && cursorPoint) {
    activePoints.push(cursorPoint);
  }

  if (activePoints.length > 1) {
    activeMeasurePolyline = L.polyline(activePoints, { color: '#06d6a0', weight: 4, dashArray: '5, 10' }).addTo(tacticalLayer);
  }
  if (measurePoints.length > 2) {
    // Polygon is solid using locked nodes (not the moving cursor)
    activeMeasurePolygon = L.polygon(measurePoints, { color: '#06d6a0', fillColor: '#06d6a0', fillOpacity: 0.1, stroke: false }).addTo(tacticalLayer);
  }
}

/**
 * Finish drawing — stop adding points, keep measurement on map
 */
function finishMeasure() {
  if (measurePoints.length < 2) return;
  
  isMeasureFinished = true;
  cursorPoint = null;
  map.off('mousemove', handleMouseMove);
  document.getElementById('map').style.cursor = '';
  
  renderMeasurement();
  updateMeasurePanel();
  
  showToast('✅ القياس مُثبت — انقر "تثبيت" للحفظ', 'success');
}

/**
 * Close the polygon area — connect last point to first
 */
function closeArea() {
  if (measurePoints.length < 3) return;
  
  // Finish and close the shape
  isMeasureFinished = true;
  cursorPoint = null;
  map.off('mousemove', handleMouseMove);
  document.getElementById('map').style.cursor = '';
  
  renderMeasurement();
  updateMeasurePanel();
  
  // Add area label in center of polygon
  addAreaLabel();
  
  showToast('📐 المنطقة مُغلقة — المساحة محسوبة', 'success');
}

/**
 * Add a label showing the area at the center of the polygon
 */
function addAreaLabel() {
  if (areaLabel) {
    tacticalLayer.removeLayer(areaLabel);
    areaLabel = null;
  }
  
  if (measurePoints.length < 3) return;
  
  const area = calculateGeodesicArea(measurePoints);
  let areaText;
  if (area > 1000000) {
    areaText = (area / 1000000).toFixed(3) + ' km²';
  } else if (area > 10000) {
    areaText = (area / 10000).toFixed(2) + ' Ha';
  } else {
    areaText = Math.round(area) + ' m²';
  }
  
  // Also show perimeter
  let perimeter = 0;
  for (let i = 0; i < measurePoints.length; i++) {
    perimeter += measurePoints[i].distanceTo(measurePoints[(i + 1) % measurePoints.length]);
  }
  const perimText = perimeter > 1000 ? (perimeter / 1000).toFixed(2) + ' km' : Math.round(perimeter) + ' m';
  
  // Calculate centroid
  let latSum = 0, lngSum = 0;
  measurePoints.forEach(p => { latSum += p.lat; lngSum += p.lng; });
  const center = L.latLng(latSum / measurePoints.length, lngSum / measurePoints.length);
  
  areaLabel = L.marker(center, {
    icon: L.divIcon({
      className: 'measure-area-label',
      html: `<div style="
        background: rgba(0,0,0,0.75);
        border: 2px solid #06d6a0;
        border-radius: 8px;
        padding: 6px 12px;
        text-align: center;
        color: #fff;
        font-family: 'Inter', monospace;
        white-space: nowrap;
        pointer-events: none;
      ">
        <div style="font-size: 14px; font-weight: bold; color: #06d6a0;">📐 ${areaText}</div>
        <div style="font-size: 11px; opacity: 0.7; margin-top: 2px;">المحيط: ${perimText}</div>
      </div>`,
      iconSize: [160, 50],
      iconAnchor: [80, 25]
    }),
    interactive: false
  }).addTo(tacticalLayer);
}

/**
 * Add editable radius input at center of circle on the map
 */
function addCircleCenterLabel(center, radius, color) {
  if (circleLabel) {
    tacticalLayer.removeLayer(circleLabel);
    circleLabel = null;
  }
  
  const area = Math.PI * radius * radius;
  let areaText;
  if (area > 1000000) {
    areaText = (area / 1000000).toFixed(3) + ' km²';
  } else if (area > 10000) {
    areaText = (area / 10000).toFixed(2) + ' Ha';
  } else {
    areaText = Math.round(area) + ' m²';
  }
  
  circleLabel = L.marker(center, {
    icon: L.divIcon({
      className: 'circle-center-label',
      html: `<div style="
        background: rgba(0,0,0,0.8);
        border: 2px solid ${color};
        border-radius: 10px;
        padding: 8px 14px;
        text-align: center;
        min-width: 140px;
      ">
        <div style="font-size: 10px; color: ${color}; margin-bottom: 4px; font-weight: bold;">⭕ نصف القطر (m)</div>
        <input type="number" id="circle-radius-input" value="${Math.round(radius)}" 
          style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid ${color}; 
          border-radius: 4px; color: #fff; font-size: 16px; font-weight: bold; 
          text-align: center; padding: 4px; outline: none; font-family: monospace;"
          min="1" max="100000" step="10" />
        <div id="circle-area-display" style="font-size: 10px; color: #aaa; margin-top: 4px;">📐 ${areaText}</div>
      </div>`,
      iconSize: [170, 90],
      iconAnchor: [85, 45]
    }),
    interactive: true,
    pane: 'tooltipPane'
  }).addTo(tacticalLayer);
  
  // Wire up the input AFTER it appears in DOM
  setTimeout(() => {
    const input = document.getElementById('circle-radius-input');
    if (input) {
      // Prevent map click when clicking the input
      ['click', 'mousedown', 'dblclick', 'pointerdown'].forEach(evt => {
        input.addEventListener(evt, (e) => e.stopPropagation());
      });
      
      // Update circle when value changes
      input.addEventListener('input', () => {
        const newRadius = parseInt(input.value) || 10;
        if (activeCircle) {
          activeCircle.setRadius(newRadius);
          // Update the diameter input too
          const dimInput = document.getElementById('circle-diameter-input');
          if (dimInput) {
            dimInput.value = newRadius * 2;
            const valEl = document.getElementById('circle-diameter-val');
            if (valEl) valEl.textContent = (newRadius * 2) + 'm';
          }
          // Update area display
          const newArea = Math.PI * newRadius * newRadius;
          const areaDisplay = document.getElementById('circle-area-display');
          if (areaDisplay) {
            let txt;
            if (newArea > 1000000) txt = (newArea / 1000000).toFixed(3) + ' km²';
            else if (newArea > 10000) txt = (newArea / 10000).toFixed(2) + ' Ha';
            else txt = Math.round(newArea) + ' m²';
            areaDisplay.textContent = '📐 ' + txt;
          }
        }
      });
      
      // Focus input for easy typing
      input.focus();
      input.select();
    }
  }, 100);
}

export function setupTacticalTools(mapInstance) {
  map = mapInstance;
  
  // Tactical Layer Group for volatile states
  tacticalLayer = L.layerGroup().addTo(map);
  layerControl = L.control.layers(null, { 'Tactical Overlays': tacticalLayer }, { position: 'bottomright' }).addTo(map);

  const sidebar = document.getElementById('tactical-sidebar');
  const toggleBtn = document.getElementById('btn-tactical-tools');
  const closeBtn = document.getElementById('btn-close-tactical');
  
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.remove('tactical-sidebar-closed');
    sidebar.classList.add('tactical-sidebar-open');
  });

  closeBtn.addEventListener('click', () => {
    sidebar.classList.add('tactical-sidebar-closed');
    sidebar.classList.remove('tactical-sidebar-open');
    stopToolModes();
  });

  // Global map listener
  map.on('click', handleMapClick);

  // Measure Tool Binding
  document.getElementById('btn-measure-tool').addEventListener('click', () => {
    const isActivating = !isMeasureMode;
    stopToolModes();
    // Deactivate all main.js tactical tools
    document.dispatchEvent(new CustomEvent('deactivate-tactical'));
    if (isActivating) {
      isMeasureMode = true;
      isMeasureFinished = false;
      document.getElementById('btn-measure-tool').classList.add('active');
      document.getElementById('tactical-measure-panel').classList.remove('hidden');
      document.getElementById('map').style.cursor = 'crosshair';
      measurePoints = [];
      cursorPoint = null;
      if (areaLabel) { tacticalLayer.removeLayer(areaLabel); areaLabel = null; }
      updateMeasurePanel();
      renderMeasurement();
      map.on('mousemove', handleMouseMove);
    }
  });

  // Finish drawing button
  document.getElementById('btn-finish-measure').addEventListener('click', finishMeasure);
  
  // Close area button
  document.getElementById('btn-close-area').addEventListener('click', closeArea);

  document.getElementById('btn-clear-measure').addEventListener('click', () => {
    measurePoints = [];
    isMeasureFinished = false;
    if (activeMeasurePolyline) tacticalLayer.removeLayer(activeMeasurePolyline);
    if (activeMeasurePolygon) tacticalLayer.removeLayer(activeMeasurePolygon);
    if (areaLabel) { tacticalLayer.removeLayer(areaLabel); areaLabel = null; }
    activeMeasurePolyline = null;
    activeMeasurePolygon = null;
    updateMeasurePanel();
    
    // Re-enable drawing if still in measure mode
    if (isMeasureMode) {
      document.getElementById('map').style.cursor = 'crosshair';
      map.on('mousemove', handleMouseMove);
    }
  });

  document.getElementById('btn-pin-measure').addEventListener('click', async () => {
    if (measurePoints.length < 2) return;
    try {
      const rec = {
        id: generateId(),
        name: 'Tactical Measurement',
        desc: document.getElementById('tactical-measure-distance').textContent,
        folderId: 'root',
        color: '#06d6a0',
        createdAt: Date.now()
      };
      
      if (measurePoints.length === 2) {
        rec.collType = 'routes';
        rec.latlngs = [...measurePoints];
        await saveRoute(rec);
      } else {
        rec.collType = 'zones';
        rec.latlngs = [...measurePoints];
        await saveZone(rec);
      }
      
      showToast('Measurement pinned to map permanently!', 'success');
      document.getElementById('btn-clear-measure').click();
      
      // Force UI reload (from features.js) to show permanent object in sidebar
      import('./features.js').then(m => m.renderSidebar());
      import('./main.js').then(m => {
        // Need to push internal array proxy manually or reload it entirely
        m.default(); // This isn't reliable. We'll let `features.js` `updateFeature` push it natively.
      });
      // The cleanest way is to use updateFeature from features
      updateFeature(rec);
      
    } catch (e) {
      console.error(e);
      showToast('Failed to pin measurement', 'error');
    }
  });

  // Circle Tool Binding
  document.getElementById('btn-draw-circle').addEventListener('click', () => {
    const isActivating = !isCircleMode;
    stopToolModes();
    // Deactivate all main.js tactical tools
    document.dispatchEvent(new CustomEvent('deactivate-tactical'));
    if (isActivating) {
      isCircleMode = true;
      document.getElementById('btn-draw-circle').classList.add('active');
      document.getElementById('tactical-circle-panel').classList.remove('hidden');
      document.getElementById('map').style.cursor = 'crosshair';
    }
  });

  const circleDiamInput = document.getElementById('circle-diameter-input');
  const circleColor = document.getElementById('circle-color-picker');
  
  function applyCircleDiameter(diameter) {
    diameter = Math.max(20, Math.min(200000, diameter));
    const newRadius = Math.round(diameter / 2);
    circleDiamInput.value = diameter;
    document.getElementById('circle-diameter-val').textContent = diameter + 'm';
    
    if (activeCircle) {
      const center = activeCircle.getLatLng();
      const color = activeCircle.options.color;
      
      // Remove and recreate circle (guaranteed visual update)
      tacticalLayer.removeLayer(activeCircle);
      activeCircle = L.circle(center, {
        radius: newRadius,
        color: color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2
      }).addTo(tacticalLayer);
      
      // Update center label
      if (circleLabel) {
        tacticalLayer.removeLayer(circleLabel);
      }
      addCircleCenterLabel(center, newRadius, color);
      document.getElementById('btn-pin-circle').style.display = 'block';
    }
  }
  
  // Button controls: -500, -100, +100, +500
  document.getElementById('circle-dec-large').addEventListener('click', () => {
    applyCircleDiameter(parseInt(circleDiamInput.value, 10) - 500);
  });
  document.getElementById('circle-dec-small').addEventListener('click', () => {
    applyCircleDiameter(parseInt(circleDiamInput.value, 10) - 100);
  });
  document.getElementById('circle-inc-small').addEventListener('click', () => {
    applyCircleDiameter(parseInt(circleDiamInput.value, 10) + 100);
  });
  document.getElementById('circle-inc-large').addEventListener('click', () => {
    applyCircleDiameter(parseInt(circleDiamInput.value, 10) + 500);
  });
  
  // Direct number input
  circleDiamInput.addEventListener('input', () => {
    const val = parseInt(circleDiamInput.value, 10);
    if (val && val >= 20) applyCircleDiameter(val);
  });
  circleDiamInput.addEventListener('change', () => {
    const val = parseInt(circleDiamInput.value, 10);
    if (val && val >= 20) applyCircleDiameter(val);
  });
  
  // Prevent sidebar clicks from propagating to map
  ['click', 'mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
    circleDiamInput.addEventListener(evt, (e) => e.stopPropagation());
  });

  circleColor.addEventListener('input', (e) => {
    if (activeCircle) {
      activeCircle.setStyle({ color: e.target.value, fillColor: e.target.value });
    }
  });

  document.getElementById('btn-clear-circle').addEventListener('click', () => {
    if (activeCircle) tacticalLayer.removeLayer(activeCircle);
    if (circleLabel) { tacticalLayer.removeLayer(circleLabel); circleLabel = null; }
    activeCircle = null;
    document.getElementById('btn-pin-circle').style.display = 'none';
  });

  document.getElementById('btn-pin-circle').addEventListener('click', async () => {
    if (!activeCircle) return;
    try {
      const rec = {
        id: generateId(),
        collType: 'zones',
        type: 'circle',
        name: `Airspace ${circleDiamInput.value}m`,
        desc: 'Tactical Deployment Circle',
        lat: activeCircle.getLatLng().lat,
        lng: activeCircle.getLatLng().lng,
        radius: activeCircle.getRadius(),
        color: circleColor.value,
        folderId: 'root',
        createdAt: Date.now()
      };
      
      await saveZone(rec);
      updateFeature(rec);
      
      showToast('✅ تم تثبيت الدائرة على الخريطة', 'success');
      
      // Remove temporary drawing objects (permanent circle is on features layer)
      if (activeCircle) { tacticalLayer.removeLayer(activeCircle); activeCircle = null; }
      if (circleLabel) { tacticalLayer.removeLayer(circleLabel); circleLabel = null; }
      document.getElementById('btn-pin-circle').style.display = 'none';
    } catch (e) {
      console.error(e);
      showToast('Failed to pin circle', 'error');
    }
  });
}
