/**
 * print-engine.js — AxisCommand Tactical Print Engine
 * 
 * Extracted from main.js initPrintSystem() — fully independent module.
 * Canvas compositing pipeline for Leaflet map → printable/saveable image.
 * 
 * PUBLIC API:
 *   executePrint(map, L, options) → Promise<void>
 *   updatePrintFrame()           → void (DOM-only, no dependencies)
 * 
 * DESIGN DECISIONS:
 *   - Platform-agnostic: Capacitor Filesystem/Directory injected via options
 *   - PNG output only: preserves vector crispness (MGRS grids, kill boxes)
 *   - 300 DPI canvas for A3/A4: true print-quality output
 *   - Event-driven tile waiting: replaces fragile setTimeout(500ms)
 *   - DRY: single restoreMapState() replaces 3 duplicated blocks
 */

import { showToast } from './toast.js';
import { t } from './i18n.js';

// ===== CONSTANTS =====
const PRINT_LOG = '[AxisCommand Print]';
// 300 DPI target dimensions for standard paper sizes
const PAPER_DIMS = {
  a4: { portrait: { w: 2480, h: 3508 }, landscape: { w: 3508, h: 2480 } },
  a3: { portrait: { w: 3508, h: 4961 }, landscape: { w: 4961, h: 3508 } }
};
const TILE_LOAD_TIMEOUT = 5000; // Max wait for tiles (ms)
const MAP_BG_COLOR = '#1a1a2e';

// ===== STATE CAPTURE / RESTORE (B2 fix: single source of truth) =====

/**
 * Captures current map position/zoom for later restoration.
 * @param {L.Map} map
 * @returns {{ center: L.LatLng, zoom: number, zoomSnap: number }}
 */
function captureMapState(map) {
  return {
    center: map.getCenter(),
    zoom: map.getZoom(),
    zoomSnap: map.options.zoomSnap
  };
}

/**
 * Restores map state + cleans up all print-related DOM artifacts.
 * Replaces 3 duplicated cleanup blocks from original code.
 * @param {L.Map} map
 * @param {Object} state — from captureMapState()
 * @param {Object} L — Leaflet namespace (for L.Rectangle check)
 * @param {HTMLElement} headerEl — main header element
 */
function restoreMapState(map, state, L, headerEl) {
  // Clean up print DOM attributes first
  document.body.removeAttribute('data-print-size');
  document.body.removeAttribute('data-print-orient');
  const frame = document.getElementById('print-guide-frame');
  if (frame) frame.classList.add('hidden');
  if (headerEl) headerEl.classList.remove('hidden-tactical');

  // Remove any injected print-area rectangles
  map.eachLayer((layer) => {
    if (layer instanceof L.Rectangle && layer.options.color === '#ffca28') {
      map.removeLayer(layer);
    }
  });

  // Wait for DOM to repaint after UI restoration, then fix Leaflet's internal
  // container size calculation. Without this delay, invalidateSize() reads stale
  // dimensions and the tile grid is corrupted (black void / missing tiles).
  setTimeout(() => {
    map.options.zoomSnap = state.zoomSnap;
    map.invalidateSize(true);
    map.setView(state.center, state.zoom, { animate: false });
  }, 100);
}

// ===== TILE LOADING (B1 fix: event-driven with timeout fallback) =====

/**
 * Waits for all map tiles to finish loading using Leaflet's native events.
 * Falls back to timeout if tiles never fully load (broken tile, offline edge case).
 * @param {L.Map} map
 * @param {number} [timeout=5000]
 * @returns {Promise<void>}
 */
function waitForTilesLoaded(map, timeout = TILE_LOAD_TIMEOUT) {
  return new Promise((resolve) => {
    // Check if tiles are already idle (no pending loads)
    let hasPendingLoads = false;
    map.eachLayer((layer) => {
      if (layer._loading) hasPendingLoads = true;
    });

    if (!hasPendingLoads) {
      // Give a minimal settle time even if already loaded
      setTimeout(resolve, 150);
      return;
    }

    let settled = false;
    const onLoad = () => {
      if (settled) return;
      settled = true;
      // Small buffer after 'load' fires for rendering to complete
      setTimeout(resolve, 150);
    };

    // Listen for the Leaflet map 'load' event (fires when all tile layers finish)
    map.once('load', onLoad);

    // Timeout fallback: don't freeze the UI forever
    setTimeout(() => {
      if (settled) return;
      settled = true;
      map.off('load', onLoad);
      console.warn(`${PRINT_LOG} Tile load timeout (${timeout}ms) — proceeding with available tiles`);
      resolve();
    }, timeout);
  });
}

// ===== CANVAS PIPELINE: Individual Layer Renderers =====

/**
 * Loads an image from a Blob URL and returns a Promise.
 * Utility shared by SVG overlay and marker renderers.
 */
function loadBlobImage(blobUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { resolve(null); };
    img.src = blobUrl;
  });
}

/**
 * Stage 1: Draw all loaded tile images onto canvas at correct positions.
 */
function drawTiles(ctx, mapEl, mapRect) {
  let count = 0;
  const tiles = mapEl.querySelectorAll('.leaflet-tile');
  tiles.forEach(tile => {
    if (tile.complete && tile.naturalWidth > 0) {
      const r = tile.getBoundingClientRect();
      const x = r.left - mapRect.left;
      const y = r.top - mapRect.top;
      if (x + r.width > 0 && y + r.height > 0 && x < mapRect.width && y < mapRect.height) {
        try {
          ctx.drawImage(tile, x, y, r.width, r.height);
          count++;
        } catch (e) {
          console.warn(`${PRINT_LOG} Tile draw failed:`, e);
        }
      }
    }
  });
  return count;
}

/**
 * Stage 2: Draw SVG overlay layers (polylines, polygons, kill box grid lines).
 * Clone → inline computed styles → serialize → render as image.
 * B5 fix: removed dead `cs` variable, improved element matching.
 */
async function drawSvgOverlays(ctx, mapEl, mapRect) {
  const svgOverlay = mapEl.querySelector('.leaflet-overlay-pane svg');
  if (!svgOverlay) return;

  try {
    const svgRect = svgOverlay.getBoundingClientRect();
    const clonedSvg = svgOverlay.cloneNode(true);
    clonedSvg.setAttribute('width', svgRect.width);
    clonedSvg.setAttribute('height', svgRect.height);

    // Inline computed styles on all vector elements
    const origElements = svgOverlay.querySelectorAll('path, circle, rect, line, polyline, polygon');
    const clonedElements = clonedSvg.querySelectorAll('path, circle, rect, line, polyline, polygon');

    // B5 fix: match by index instead of fragile [d="..."] selector
    clonedElements.forEach((el, idx) => {
      const origEl = origElements[idx] || el;
      const style = window.getComputedStyle(origEl);
      el.setAttribute('stroke', style.stroke || el.getAttribute('stroke') || 'none');
      el.setAttribute('stroke-width', style.strokeWidth || el.getAttribute('stroke-width') || '1');
      el.setAttribute('stroke-opacity', style.strokeOpacity || el.getAttribute('stroke-opacity') || '1');
      el.setAttribute('fill', style.fill || el.getAttribute('fill') || 'none');
      el.setAttribute('fill-opacity', style.fillOpacity || el.getAttribute('fill-opacity') || '0');
      if (style.strokeDasharray && style.strokeDasharray !== 'none') {
        el.setAttribute('stroke-dasharray', style.strokeDasharray);
      }
    });

    const svgData = new XMLSerializer().serializeToString(clonedSvg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const svgImg = await loadBlobImage(svgUrl);
    if (svgImg) {
      ctx.drawImage(svgImg, svgRect.left - mapRect.left, svgRect.top - mapRect.top, svgRect.width, svgRect.height);
    }
    URL.revokeObjectURL(svgUrl);
  } catch (e) {
    console.warn(`${PRINT_LOG} SVG overlay capture error:`, e);
  }
}

/**
 * Stage 3: Draw marker icons (handles IMG, DIV with inner img/svg, plain divIcons).
 */
async function drawMarkers(ctx, mapEl, mapRect) {
  const markerPane = mapEl.querySelector('.leaflet-marker-pane');
  if (!markerPane) return;

  const allMarkers = markerPane.querySelectorAll('.leaflet-marker-icon');
  for (const marker of allMarkers) {
    const mRect = marker.getBoundingClientRect();
    const x = mRect.left - mapRect.left;
    const y = mRect.top - mapRect.top;

    // Skip off-screen markers
    if (x + mRect.width < 0 || y + mRect.height < 0 || x > mapRect.width || y > mapRect.height) continue;

    // Branch A: Direct IMG marker
    if (marker.tagName === 'IMG' && marker.complete && marker.naturalWidth > 0) {
      try { ctx.drawImage(marker, x, y, mRect.width, mRect.height); } catch (e) { /* skip */ }
      continue;
    }

    // Branch B: DIV marker (divIcon) — find inner content
    const innerImg = marker.querySelector('img');
    const innerSvg = marker.querySelector('svg');

    if (innerImg && innerImg.complete && innerImg.naturalWidth > 0) {
      try {
        const imgRect = innerImg.getBoundingClientRect();
        ctx.drawImage(innerImg, imgRect.left - mapRect.left, imgRect.top - mapRect.top, imgRect.width, imgRect.height);
      } catch (e) { /* skip */ }
    } else if (innerSvg) {
      try {
        const svgStr = new XMLSerializer().serializeToString(innerSvg);
        const svgB = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgB);
        const img = await loadBlobImage(url);
        if (img) {
          const svgR = innerSvg.getBoundingClientRect();
          ctx.drawImage(img, svgR.left - mapRect.left, svgR.top - mapRect.top, svgR.width, svgR.height);
        }
        URL.revokeObjectURL(url);
      } catch (e) { /* skip */ }
    } else {
      // Fallback: draw colored circle for plain div markers
      const bgColor = window.getComputedStyle(marker).backgroundColor;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        ctx.arc(x + mRect.width / 2, y + mRect.height / 2, Math.min(mRect.width, mRect.height) / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/**
 * Stage 4: Draw tooltip labels + kill box grid labels.
 */
function drawAnnotations(ctx, mapEl, mapRect) {
  // Sub-stage A: Leaflet tooltips
  const tooltips = mapEl.querySelectorAll('.leaflet-tooltip');
  tooltips.forEach(tooltip => {
    const tRect = tooltip.getBoundingClientRect();
    const x = tRect.left - mapRect.left;
    const y = tRect.top - mapRect.top;
    const text = tooltip.textContent || '';
    if (text) {
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(text, x + 4, y + 14);
      ctx.fillText(text, x + 4, y + 14);
    }
  });

  // Sub-stage B: Kill box grid labels
  const killboxLabels = mapEl.querySelectorAll('.killbox-label, .killbox-title');
  killboxLabels.forEach(label => {
    const lRect = label.getBoundingClientRect();
    const x = lRect.left - mapRect.left;
    const y = lRect.top - mapRect.top;
    const span = label.querySelector('span');
    if (span) {
      const text = span.textContent || '';
      const color = span.style.color || '#f97316';
      const fontSize = parseInt(span.style.fontSize) || 14;
      ctx.font = `900 ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(text, x + lRect.width / 2, y + lRect.height / 2 + 4);
      ctx.fillText(text, x + lRect.width / 2, y + lRect.height / 2 + 4);
      ctx.textAlign = 'start'; // Reset
    }
  });
}

/**
 * Stage 5: Draw scale bar on print canvas (bottom-left).
 */
function drawScaleBar(ctx, mapEl, mapRect) {
  const scaleLines = mapEl.querySelectorAll('.leaflet-control-scale-line');
  if (scaleLines.length === 0) return;

  const scaleX = 20;
  let scaleY = mapRect.height - 25;

  scaleLines.forEach((scaleLine, idx) => {
    const text = scaleLine.textContent || '';
    const scaleWidth = scaleLine.offsetWidth;

    // Background
    ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
    ctx.fillRect(scaleX, scaleY - 16, scaleWidth, 20);

    // Scale line bar
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (idx === 0) {
      // Metric: bottom border with end caps
      ctx.moveTo(scaleX, scaleY + 4);
      ctx.lineTo(scaleX + scaleWidth, scaleY + 4);
      ctx.moveTo(scaleX, scaleY - 2);
      ctx.lineTo(scaleX, scaleY + 4);
      ctx.moveTo(scaleX + scaleWidth, scaleY - 2);
      ctx.lineTo(scaleX + scaleWidth, scaleY + 4);
    } else {
      // Imperial: top border with end caps
      ctx.moveTo(scaleX, scaleY - 16);
      ctx.lineTo(scaleX + scaleWidth, scaleY - 16);
      ctx.moveTo(scaleX, scaleY - 16);
      ctx.lineTo(scaleX, scaleY - 10);
      ctx.moveTo(scaleX + scaleWidth, scaleY - 16);
      ctx.lineTo(scaleX + scaleWidth, scaleY - 10);
    }
    ctx.stroke();

    // Text
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(text, scaleX + scaleWidth / 2, scaleY);
    ctx.textAlign = 'start';

    scaleY -= 22; // Stack next scale line above
  });
}

// ===== CANVAS COMPOSITOR =====

/**
 * Runs the full 5-stage compositing pipeline.
 * B3 fix: Canvas dimensions calculated from 300 DPI paper size.
 * @param {HTMLElement} mapEl
 * @param {string} size — 'a4' | 'a3'
 * @param {string} orient — 'portrait' | 'landscape'
 * @returns {Promise<{ canvas: HTMLCanvasElement, tilesDrawn: number }>}
 */
async function compositeMapToCanvas(mapEl, size, orient) {
  const mapRect = mapEl.getBoundingClientRect();

  // B3 fix: Use 300 DPI target dimensions for true print quality
  const paperSize = PAPER_DIMS[size]?.[orient] || PAPER_DIMS.a4.portrait;
  const canvasW = paperSize.w;
  const canvasH = paperSize.h;

  // Calculate scale factor from viewport to print canvas
  const scaleX = canvasW / mapRect.width;
  const scaleY = canvasH / mapRect.height;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.scale(scaleX, scaleY);

  // Background fill
  ctx.fillStyle = MAP_BG_COLOR;
  ctx.fillRect(0, 0, mapRect.width, mapRect.height);

  // Execute compositing pipeline
  const tilesDrawn = drawTiles(ctx, mapEl, mapRect);
  await drawSvgOverlays(ctx, mapEl, mapRect);
  await drawMarkers(ctx, mapEl, mapRect);
  drawAnnotations(ctx, mapEl, mapRect);
  drawScaleBar(ctx, mapEl, mapRect);

  console.log(`${PRINT_LOG} Composited ${tilesDrawn} tiles onto ${canvasW}×${canvasH} canvas (${size.toUpperCase()} ${orient})`);
  return { canvas, tilesDrawn };
}

// ===== PLATFORM OUTPUT =====

/**
 * Android output: saves PNG to Documents folder.
 * Uses injected Filesystem/Directory — no Capacitor import in this module.
 */
async function saveToAndroid(dataUrl, Filesystem, Directory) {
  const base64Data = dataUrl.split(',')[1];
  const date = new Date().toISOString().replace(/[:.]/g, '-').split('T');
  const filename = `AxisCommand_Map_${date[0]}_${date[1].substring(0, 8)}.png`;

  await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Documents
  });

  showToast(`Map saved to Documents/${filename}`, 'success');
  console.log(`${PRINT_LOG} Android: Saved to Documents/${filename}`);
}

/**
 * PC output — Normal path: open print window with embedded image.
 * B6 fix: uses img.decode() to ensure image is ready before printing.
 */
function openPrintWindow(dataUrl, size, orient, canvasW, canvasH) {
  const printWindow = window.open('', '_blank', `width=${canvasW},height=${canvasH}`);
  if (!printWindow) return false; // Popup blocked

  const pageSize = size === 'a3' ? 'A3' : 'A4';
  const pageOrient = orient === 'portrait' ? 'portrait' : 'landscape';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>AxisCommand Tactical Print</title>
      <style>
        @page { size: ${pageSize} ${pageOrient}; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
        img { display: block; width: 100vw; height: 100vh; object-fit: contain; }
      </style>
    </head>
    <body>
      <img id="print-img" src="${dataUrl}" />
    </body>
    </html>
  `);
  printWindow.document.close();

  // B6 fix: wait for image decode before triggering print
  printWindow.onload = () => {
    const img = printWindow.document.getElementById('print-img');
    const triggerPrint = () => {
      printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
      printWindow.addEventListener('focus', () => {
        setTimeout(() => printWindow.close(), 500);
      });
    };

    if (img && typeof img.decode === 'function') {
      img.decode().then(triggerPrint).catch(triggerPrint);
    } else {
      setTimeout(triggerPrint, 300);
    }
  };

  return true; // Success
}

/**
 * PC output — Fallback: inject overlay directly into main page.
 * Used when popup blocker prevents window.open.
 */
function inlinePrintFallback(dataUrl) {
  console.warn(`${PRINT_LOG} Popup blocked, falling back to inline print`);

  const overlay = document.createElement('img');
  overlay.id = 'print-canvas-overlay';
  overlay.src = dataUrl;
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 99999; object-fit: contain;
    background: #000;
  `;
  document.body.appendChild(overlay);

  // Hide app for clean print
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';

  window.addEventListener('afterprint', function restoreFromInline() {
    overlay.remove();
    if (app) app.style.display = '';
    window.removeEventListener('afterprint', restoreFromInline);
  }, { once: true });

  setTimeout(() => window.print(), 200);
}

/**
 * Platform router: directs output to Android save or PC print.
 */
async function outputForPlatform(dataUrl, options) {
  const { size, orient, isNativeMobile, Filesystem: Fs, Directory: Dir, canvasW, canvasH } = options;

  if (isNativeMobile && Fs && Dir) {
    try {
      await saveToAndroid(dataUrl, Fs, Dir);
    } catch (err) {
      console.error(`${PRINT_LOG} Android save failed:`, err);
      showToast('Save failed: ' + err.message, 'error');
    }
  } else {
    // PC: try popup, fallback to inline
    const opened = openPrintWindow(dataUrl, size, orient, canvasW, canvasH);
    if (!opened) {
      inlinePrintFallback(dataUrl);
    }
  }
}

// ===== PRIVACY GUARD SUPPRESSION (B4 fix: event-based with safe cleanup) =====

/**
 * Temporarily hides privacy guard during print output.
 * B4 fix: uses afterprint event instead of arbitrary setTimeout.
 */
function suppressPrivacyGuard() {
  const guard = document.getElementById('privacy-guard');
  if (!guard) return;

  guard.style.setProperty('display', 'none', 'important');

  // Restore on afterprint, with timeout safety net
  const restore = () => {
    guard.style.removeProperty('display');
  };
  window.addEventListener('afterprint', restore, { once: true });

  // Safety net: if afterprint never fires (e.g., Android save path)
  setTimeout(() => {
    window.removeEventListener('afterprint', restore);
    restore();
  }, 8000);
}

// ===== MAIN ENTRY POINT =====

/**
 * Executes the full tactical print pipeline.
 * 
 * @param {L.Map} map — Leaflet map instance
 * @param {Object} L — Leaflet namespace (for L.latLngBounds, L.Rectangle)
 * @param {Object} options
 * @param {string} options.size — 'a4' | 'a3'
 * @param {string} options.orient — 'portrait' | 'landscape'
 * @param {boolean} options.isNativeMobile — platform detection flag
 * @param {HTMLElement} options.headerEl — main header element
 * @param {HTMLElement} options.frameEl — print guide frame element
 * @param {Object} [options.Filesystem] — Capacitor Filesystem plugin (Android only)
 * @param {Object} [options.Directory] — Capacitor Directory enum (Android only)
 * @returns {Promise<void>}
 */
export async function executePrint(map, L, options) {
  const { size, orient, headerEl, frameEl } = options;

  // Set CSS @page attributes
  document.body.setAttribute('data-print-size', size);
  document.body.setAttribute('data-print-orient', orient);
  showToast(t('preparingPrint') || 'Compositing map for print...', 'info');

  // Guard: if map isn't available, fallback to basic window.print()
  if (!map || typeof map.getCenter !== 'function') {
    setTimeout(() => {
      window.print();
      document.body.removeAttribute('data-print-size');
      document.body.removeAttribute('data-print-orient');
      if (frameEl) frameEl.classList.add('hidden');
      if (headerEl) headerEl.classList.remove('hidden-tactical');
    }, 500);
    return;
  }

  // Calculate the LatLng bounds of the user's selected print frame
  const frameRect = frameEl.getBoundingClientRect();
  const mapContainer = document.getElementById('map');
  const mapContainerRect = mapContainer.getBoundingClientRect();
  const nw = map.containerPointToLatLng([frameRect.left - mapContainerRect.left, frameRect.top - mapContainerRect.top]);
  const se = map.containerPointToLatLng([frameRect.right - mapContainerRect.left, frameRect.bottom - mapContainerRect.top]);
  const selectedBounds = L.latLngBounds(nw, se);

  // Capture state for restoration
  const savedState = captureMapState(map);

  try {
    // Fit map to selected area for compositing
    map.options.zoomSnap = 0;
    map.invalidateSize();
    map.fitBounds(selectedBounds, { animate: false, padding: [0, 0] });

    // B1 fix: event-driven tile load waiting
    await waitForTilesLoaded(map, TILE_LOAD_TIMEOUT);

    // Run the compositing pipeline
    const { canvas } = await compositeMapToCanvas(mapContainer, size, orient);

    // B8 fix: PNG output for vector crispness
    const dataUrl = canvas.toDataURL('image/png');

    // Suppress privacy guard during output
    suppressPrivacyGuard();

    // Route output to correct platform
    const paperDims = PAPER_DIMS[size]?.[orient] || PAPER_DIMS.a4.portrait;
    await outputForPlatform(dataUrl, {
      ...options,
      canvasW: paperDims.w,
      canvasH: paperDims.h
    });

    // Restore map and clean up
    restoreMapState(map, savedState, L, headerEl);

  } catch (e) {
    console.error(`${PRINT_LOG} Canvas compositing failed:`, e);
    showToast('Print failed: ' + e.message, 'error');
    // Always restore state, even on error
    restoreMapState(map, savedState, L, headerEl);
  }
}

// ===== UPDATE PRINT FRAME (DOM-only, no dependencies) =====

/**
 * Calculates and applies the print guide frame dimensions
 * based on selected paper size and orientation.
 * Uses correct √2 aspect ratio for standard ISO paper.
 */
export function updatePrintFrame() {
  const frame = document.getElementById('print-guide-frame');
  const printBar = document.getElementById('print-control-bar');
  const size = document.getElementById('print-size-select').value;
  const orient = document.getElementById('print-orientation-select').value;

  // Guard: don't resurrect frame if print bar is hidden
  if (!frame || !printBar || printBar.classList.contains('hidden')) return;

  frame.classList.remove('hidden');

  const ratio = 1.414; // √2 — ISO 216 standard (same for A4 & A3)
  const isLandscape = orient === 'landscape';

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const padding = 0.85; // Frame occupies 85% of shortest dimension

  let frameW, frameH;
  if (isLandscape) {
    frameW = Math.min(vw * padding, vh * padding * ratio);
    frameH = frameW / ratio;
  } else {
    frameH = Math.min(vh * padding, vw * padding * ratio);
    frameW = frameH / ratio;
  }

  frame.style.width = `${Math.round(frameW)}px`;
  frame.style.height = `${Math.round(frameH)}px`;
}
