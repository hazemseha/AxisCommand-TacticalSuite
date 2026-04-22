/**
 * spyglass.js — Tactical Spyglass / Magnifying Lens
 * A circular overlay that follows the cursor and reveals street labels
 * only within the circle, on top of the satellite imagery.
 * Fully offline — uses the same local street tile cache.
 */
import L from 'leaflet';
import { t } from './i18n.js';

let map = null;
let spyglassActive = false;
let spyglassLayer = null;
let spyglassPane = null;
let spyglassRing = null;
let radius = 120; // px

export function initSpyglass(mapInstance) {
  map = mapInstance;

  // Create a custom Leaflet pane for the spyglass layer
  spyglassPane = map.createPane('spyglassPane');
  spyglassPane.style.zIndex = 450; // Above tiles but below markers
  spyglassPane.style.pointerEvents = 'none';
  spyglassPane.style.clipPath = 'circle(0px at -100px -100px)';
  spyglassPane.style.webkitClipPath = 'circle(0px at -100px -100px)';
  spyglassPane.style.transition = 'none';

  // Create the visible ring indicator (follows mouse)
  spyglassRing = document.createElement('div');
  spyglassRing.id = 'spyglass-ring';
  spyglassRing.className = 'spyglass-ring hidden';
  document.getElementById('map').appendChild(spyglassRing);
}

export function toggleSpyglass() {
  spyglassActive = !spyglassActive;

  const btn = document.getElementById('btn-spyglass');
  if (btn) btn.classList.toggle('active', spyglassActive);

  if (spyglassActive) {
    activateSpyglass();
  } else {
    deactivateSpyglass();
  }
}

function activateSpyglass() {
  // Create the street labels tile layer inside the spyglass pane
  if (!spyglassLayer) {
    // Build tile URL same as the main offline layer
    const isFileProtocol = window.location.protocol === 'file:';

    spyglassLayer = L.tileLayer('', {
      pane: 'spyglassPane',
      maxZoom: 20,
      maxNativeZoom: 18,
      attribution: ''
    });

    // Override createTile for offline loading (same logic as main TileLayer.Offline)
    spyglassLayer.createTile = function(coords, done) {
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

  spyglassLayer.addTo(map);
  spyglassRing.classList.remove('hidden');
  updateRingSize();

  // Bind mouse tracking
  map.getContainer().addEventListener('mousemove', onMouseMove);
  map.getContainer().addEventListener('touchmove', onTouchMove, { passive: true });
  map.getContainer().style.cursor = 'none';
}

function deactivateSpyglass() {
  if (spyglassLayer && map.hasLayer(spyglassLayer)) {
    map.removeLayer(spyglassLayer);
  }

  spyglassRing.classList.add('hidden');

  // Reset clip
  if (spyglassPane) {
    spyglassPane.style.clipPath = 'circle(0px at -100px -100px)';
    spyglassPane.style.webkitClipPath = 'circle(0px at -100px -100px)';
  }

  map.getContainer().removeEventListener('mousemove', onMouseMove);
  map.getContainer().removeEventListener('touchmove', onTouchMove);
  map.getContainer().style.cursor = '';
}

function onMouseMove(e) {
  updateSpyglassPosition(e.clientX, e.clientY);
}

function onTouchMove(e) {
  if (e.touches.length > 0) {
    updateSpyglassPosition(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function updateSpyglassPosition(clientX, clientY) {
  const container = map.getContainer();
  const rect = container.getBoundingClientRect();

  // Position relative to the map container
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  // The spyglass pane uses CSS transform (translate3d) from Leaflet.
  // clip-path is relative to the pane's own coordinate system.
  // Use getBoundingClientRect() for the most reliable offset calculation.
  if (spyglassPane) {
    const paneRect = spyglassPane.getBoundingClientRect();
    const clipX = clientX - paneRect.left;
    const clipY = clientY - paneRect.top;
    const clip = `circle(${radius}px at ${clipX}px ${clipY}px)`;
    spyglassPane.style.clipPath = clip;
    spyglassPane.style.webkitClipPath = clip;
  }

  // Update the ring position
  if (spyglassRing) {
    spyglassRing.style.left = `${x}px`;
    spyglassRing.style.top = `${y}px`;
    spyglassRing.style.width = `${radius * 2}px`;
    spyglassRing.style.height = `${radius * 2}px`;
  }
}

function updateRingSize() {
  if (spyglassRing) {
    spyglassRing.style.width = `${radius * 2}px`;
    spyglassRing.style.height = `${radius * 2}px`;
  }
}

// Allow mouse wheel to resize the spyglass
export function handleSpyglassScroll(e) {
  if (!spyglassActive) return false;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    radius = Math.max(50, Math.min(300, radius + (e.deltaY > 0 ? -10 : 10)));
    updateRingSize();
    // Re-trigger position update
    updateSpyglassPosition(e.clientX, e.clientY);
    return true;
  }
  return false;
}

export function isSpyglassActive() {
  return spyglassActive;
}
