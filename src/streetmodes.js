/**
 * streetmodes.js — Street Labels Layer Toggle
 * Simple on/off toggle for street name labels overlay.
 * Uses same tile source as spyglass (tiles-cache/labels/).
 */
import L from 'leaflet';
import { showToast } from './toast.js';

let map = null;
let labelsLayer = null;
let labelsPane = null;
let labelsVisible = false;

// ===== INIT =====

export function initStreetModes(mapInstance) {
  map = mapInstance;
  
  // Dedicated pane so it doesn't interfere with satellite tiles
  labelsPane = map.createPane('streetLabelsPane');
  labelsPane.style.zIndex = 420;
  labelsPane.style.pointerEvents = 'none';
  
  createLabelsLayer();
}

function createLabelsLayer() {
  const isFileProtocol = window.location.protocol === 'file:';
  
  labelsLayer = L.tileLayer('', {
    pane: 'streetLabelsPane',
    maxZoom: 20,
    maxNativeZoom: 18,
    attribution: '',
    opacity: 0.7,
    className: 'street-overlay-tiles'
  });

  labelsLayer.createTile = function(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    const z = Math.round(coords.z), x = Math.round(coords.x), y = Math.round(coords.y);
    const ext = '.png';
    const fallbackExt = '.jpg';

    let tilePath;
    if (isFileProtocol) {
      const baseUrl = new URL('.', window.location.href).href;
      tilePath = new URL(`../tiles-cache/labels/${z}/${x}/${y}${ext}`, baseUrl).href;
    } else {
      tilePath = `../tiles-cache/labels/${z}/${x}/${y}${ext}`;
    }

    tile.onload = function() { done(null, tile); };
    tile.onerror = function() {
      const fbPath = tilePath.replace(ext, fallbackExt);
      tile.onload = function() { done(null, tile); };
      tile.onerror = function() { done(null, tile); };
      tile.src = fbPath;
    };

    tile.src = tilePath;
    return tile;
  };
}

// ===== TOGGLE =====

export function toggleStreetLabels() {
  labelsVisible = !labelsVisible;
  
  const btn = document.getElementById('btn-street-labels');
  if (btn) btn.classList.toggle('active', labelsVisible);
  
  if (labelsVisible) {
    if (!map.hasLayer(labelsLayer)) {
      labelsLayer.addTo(map);
    }
    showToast('🏷️ أسماء الشوارع — مُفعّلة', 'success');
  } else {
    if (map.hasLayer(labelsLayer)) {
      map.removeLayer(labelsLayer);
    }
    showToast('🏷️ أسماء الشوارع — مُعطّلة', 'info');
  }
}

export function deactivateStreetLabels() {
  if (labelsVisible) {
    labelsVisible = false;
    const btn = document.getElementById('btn-street-labels');
    if (btn) btn.classList.remove('active');
    if (map.hasLayer(labelsLayer)) {
      map.removeLayer(labelsLayer);
    }
  }
}
