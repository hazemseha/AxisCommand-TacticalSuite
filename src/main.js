import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import '@geoman-io/leaflet-geoman-free'; 
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorMBTilesLayer } from './mbtiles-android.js';
import { SQLiteConnection, CapacitorSQLite } from '@capacitor-community/sqlite';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { 
  loadAllFeatures, setupSearchFeatures, initFeatures, updateFeature, hardRemoveFeature, renderIconPicker,
  addIconToLibrary, removeIconFromLibrary, getCustomTacticalIcons, updateDrawingToolTranslations,
  initLibraryUI, openLibraryModal
} from './features.js';
import { setCurrentPin, renderVideoList, setupVideoUpload, closeVideoPlayer } from './video.js';
import { setupShareControls, exportTacticalEnvelope, importTacticalEnvelope } from './share.js';
import { setupTacticalTools, stopToolModes } from './tactical.js';
import { initLOS, toggleLOSMode, handleLOSClick } from './los.js';
import { initSpyglass, toggleSpyglass } from './spyglass.js';
import { initKillBox, toggleKillBoxMode } from './killbox.js';
import { initAzimuth, toggleAzimuthMode } from './azimuth.js';
import { initMortarFCS, toggleMortarMode } from './mortar-fcs.js';
import { initTacticalFigures, toggleTacticalFigures, deactivateTacticalFigures } from './tactical-figures.js';
import { initRangeRings, toggleRangeRings } from './range-rings.js';
import { initMGRS, toggleMGRS } from './mgrs.js';
import { confirmAction, initConfirmModal } from './utils.js';
import { 
  getPin, getTile, generateId, savePin,
  getAllFolders, saveFolder, deleteFolder,
  getAllTacticalIcons, saveTacticalIcon, deleteTacticalIcon 
} from './db.js';
import { showToast } from './toast.js';
import { initLang, toggleLang, t, getLang } from './i18n.js';
import { estimateTiles, downloadArea } from './downloader.js';
import { Logger } from './logger.js';
import { hasUser, getUserProfile, registerUser, login, isAuthenticated, logout, getAllUsers, switchToUser, removeUserFromList, removeUserById, clearActiveUser, getActiveUserId } from './auth.js';
import { initBFT, toggleBFT, deactivateBFT } from './blueforce.js';
import { executePrint, updatePrintFrame } from './print-engine.js';
import { requireAdminPin, buildUserListUI, showTacticalPrompt, showTacticalAlert, showTacticalConfirm, delay } from './user-management.js';
import { initQuickMenu } from './quickmenu.js';
import { initStreetModes, toggleStreetLabels } from './streetmodes.js';
import { showAuthScreen } from './auth-screen.js';
import { setupIconPicker, openFeatureModal, closePinModal, savePinFromModal, deletePinFromModal, openDownloadModal, closeDownloadModal, updateDownloadEstimate, startDownload, getCurrentEditPin, setCurrentEditPin } from './feature-modal.js';

// ===== INTERNET LOCKDOWN — DYNAMIC ADMIN PIN =====
const ADMIN_PIN_KEY = 'axis_admin_pin';

async function sha256Pin(pin) {
  const buf = new TextEncoder().encode(pin);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hasAdminPin() {
  return localStorage.getItem(ADMIN_PIN_KEY) !== null;
}

async function verifyPin(pin) {
  const stored = localStorage.getItem(ADMIN_PIN_KEY);
  if (!stored) return false; // F1: No backdoor — if no PIN stored, force setup
  return (await sha256Pin(pin)) === stored;
}

async function saveAdminPin(pin) {
  localStorage.setItem(ADMIN_PIN_KEY, await sha256Pin(pin));
}

/** Show admin PIN setup with dial pad — enter PIN then confirm it */
function showAdminPinSetup() {
  return new Promise((resolve) => {
    // Hide auth-screen so it doesn't cover the admin setup
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) authScreen.style.display = 'none';
    
    const screen = document.getElementById('admin-pin-setup');
    screen.classList.remove('hidden');
    
    const dots = screen.querySelectorAll('.setup-dot');
    const dialPad = document.getElementById('setup-dial-pad');
    const clearBtn = document.getElementById('setup-dial-clear');
    const errEl = document.getElementById('setup-error');
    const titleEl = document.getElementById('setup-title');
    const subtitleEl = document.getElementById('setup-subtitle');
    
    let enteredPin = '';
    let firstPin = null; // Stores first entry for confirmation
    
    const updateDots = () => {
      dots.forEach((dot, i) => {
        if (i < enteredPin.length) {
          dot.style.background = '#06d6a0';
          dot.style.borderColor = '#06d6a0';
        } else {
          dot.style.background = 'transparent';
          dot.style.borderColor = 'rgba(6,214,160,0.4)';
        }
      });
    };
    
    const resetPin = () => {
      enteredPin = '';
      updateDots();
      errEl.textContent = '';
    };
    
    // Dial button clicks
    dialPad.querySelectorAll('.setup-dial-btn').forEach(btn => {
      btn.onclick = () => {
        if (enteredPin.length >= 4) return;
        enteredPin += btn.dataset.digit;
        updateDots();
        errEl.textContent = '';
        
        if (enteredPin.length === 4) {
          setTimeout(async () => {
            if (!firstPin) {
              // Phase 1: First entry — ask to confirm
              firstPin = enteredPin;
              titleEl.textContent = 'تأكيد الرمز';
              subtitleEl.textContent = 'أعد إدخال الرمز للتأكيد';
              resetPin();
            } else {
              // Phase 2: Confirmation
              if (enteredPin === firstPin) {
                await saveAdminPin(enteredPin);
                dots.forEach(d => { d.style.background = '#06d6a0'; d.style.borderColor = '#06d6a0'; });
                setTimeout(() => {
                  screen.classList.add('hidden');
                  // Restore auth-screen for login flow
                  if (authScreen) authScreen.style.display = '';
                  resolve();
                }, 400);
              } else {
                errEl.textContent = 'الرمز غير متطابق — أعد المحاولة';
                firstPin = null;
                titleEl.textContent = 'إعداد رمز المسؤول';
                subtitleEl.textContent = 'أدخل رمز PIN مكون من 4 أرقام';
                dots.forEach(d => { d.style.background = '#ef4444'; d.style.borderColor = '#ef4444'; });
                setTimeout(resetPin, 600);
              }
            }
          }, 200);
        }
      };
    });
    
    clearBtn.onclick = resetPin;
  });
}

/** Internet lockdown with dial pad — PERSISTENT lock */
const LOCK_FLAG = 'axis_lockdown_active';

function isLocked() {
  return localStorage.getItem(LOCK_FLAG) === 'true';
}

function triggerLockdown() {
  localStorage.setItem(LOCK_FLAG, 'true');
}

function clearLockdown() {
  localStorage.removeItem(LOCK_FLAG);
}

function initInternetLockdown() {
  const lockScreen = document.getElementById('internet-lock');
  if (!lockScreen) return;
  
  const dots = lockScreen.querySelectorAll('.pin-dot');
  const dialError = document.getElementById('dial-error');
  const dialPad = document.getElementById('dial-pad');
  const clearBtn = document.getElementById('dial-clear');
  const submitBtn = document.getElementById('dial-submit');
  
  let enteredPin = '';
  
  const updateDots = () => {
    dots.forEach((dot, i) => {
      if (i < enteredPin.length) {
        dot.style.background = '#ef4444';
        dot.style.borderColor = '#ef4444';
      } else {
        dot.style.background = 'transparent';
        dot.style.borderColor = 'rgba(255,255,255,0.3)';
      }
    });
  };
  
  const resetPin = () => {
    enteredPin = '';
    updateDots();
    dialError.textContent = '';
  };
  
  const showLock = () => {
    lockScreen.classList.remove('hidden');
    resetPin();
  };
  
  const tryUnlock = async () => {
    const valid = await verifyPin(enteredPin);
    if (valid) {
      clearLockdown(); // Remove persistent lock
      lockScreen.classList.add('hidden');
      dots.forEach(d => { d.style.background = '#06d6a0'; d.style.borderColor = '#06d6a0'; });
    } else {
      dialError.textContent = 'رمز خاطئ';
      dots.forEach(d => { d.style.background = '#ef4444'; d.style.borderColor = '#ef4444'; });
      setTimeout(resetPin, 600);
    }
  };
  
  // Dial button clicks
  dialPad.querySelectorAll('.dial-btn').forEach(btn => {
    btn.onclick = () => {
      if (enteredPin.length >= 4) return;
      enteredPin += btn.dataset.digit;
      updateDots();
      dialError.textContent = '';
      if (enteredPin.length === 4) setTimeout(tryUnlock, 200);
    };
  });
  
  clearBtn.onclick = resetPin;
  submitBtn.onclick = tryUnlock;
  
  // Keyboard support
  document.addEventListener('keydown', (e) => {
    if (lockScreen.classList.contains('hidden')) return;
    if (e.key >= '0' && e.key <= '9' && enteredPin.length < 4) {
      enteredPin += e.key;
      updateDots();
      if (enteredPin.length === 4) setTimeout(tryUnlock, 200);
    } else if (e.key === 'Backspace') {
      enteredPin = enteredPin.slice(0, -1);
      updateDots();
    }
  });
  
  // PERSISTENT: If internet detected → lock permanently until admin PIN
  window.addEventListener('online', () => {
    triggerLockdown();
    showLock();
  });
  
  // Going offline does NOT unlock — only admin PIN can unlock
  // (lock screen stays visible)
  
  // BOOT CHECK: Lock if previously triggered OR currently online
  if (isLocked()) {
    showLock(); // Was locked before restart — stay locked
  } else if (navigator.onLine) {
    triggerLockdown();
    showLock(); // Currently online — lock now
  }
}
// mesh.js is lazy-loaded to prevent blocking auth

// EXPOSE LEAFLET GLOBALLY (Mandatory for plugin compatibility in bundled Electron)
window.L = L;

const isNativeMobile = Capacitor.isNativePlatform();
let mobileDbSat, mobileDbStreet;

/**
 * ANDROID BRIDGE: Initialize SQLite databases from Public Storage
 */
const initMobileDatabases = async () => {
  if (!isNativeMobile) return;
  try {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    
    // GUARD: If connections already exist (from previous session), close them first
    // NCConnections can't be retrieved — must be closed and re-created
    const checkSat = await sqlite.isConnection("tripoli-satellite", false);
    const checkStreet = await sqlite.isConnection("tripoli-street", false);
    if ((checkSat && checkSat.result) || (checkStreet && checkStreet.result)) {
        console.log("[PinVault Mobile] Stale connections detected. Closing for fresh init...");
        try { await sqlite.closeConnection("tripoli-satellite", false); } catch(x) {}
        try { await sqlite.closeConnection("tripoli-street", false); } catch(x) {}
    }

    // CRITICAL: Disable the automatic '.db' suffix globally.
    // Our files are named '.mbtiles', so we prevent the plugin from searching for '.mbtiles.db'.
    await sqlite.addSQLiteSuffix(false);

    // 1. Target absolute filenames in the app's internal sandbox.
    // We use createNCConnection (Non-Conforming) to bypass standard plugin 
    // overhead/integrity checks which can take minutes on 4GB map files.
    // 1. OMNI-SCAN: We broaden the search to include the 'files' directory
    // In Android 15, 'files' is often more accessible than the legacy 'databases' folder
    const packageID = "com.pinvault.tactical";
    const fileName = "tripoli-satellite.db";
    
    const variations = [
      // 1. Android Public App Storage (For physical tablets via USB USB MTP)
      `/storage/emulated/0/Android/data/${packageID}/files/${fileName}`,
      `file:///storage/emulated/0/Android/data/${packageID}/files/${fileName}`,
      // 2. Internal Sandboxes (For Emulators / ADB Device Explorer)
      `/data/user/0/${packageID}/files/${fileName}`,
      `/data/data/${packageID}/files/${fileName}`,
      `/data/user/0/${packageID}/databases/${fileName}`,
      `/data/data/${packageID}/databases/${fileName}`,
      `file:///data/user/0/${packageID}/files/${fileName}`,
      `file:///data/data/${packageID}/files/${fileName}`
    ];
    
    console.log("[PinVault Mobile] Omni-Scanning Files & Databases...");

    let successPath = null;
    for (const testPath of variations) {
      try {
        console.log(`[PinVault] Probing Sector: ${testPath}`);
        mobileDbSat = await sqlite.createNCConnection(testPath, 0);
        await mobileDbSat.open();
        successPath = testPath;
        console.log(`[PinVault] 🎯 DIRECT HIT: ${testPath}`);
        break; 
      } catch (e) {
        // Silent fail for probe
      }
    }

    if (!successPath) {
      // LAST RESORT: Try simple internal filename without path (DataType 1)
      try {
        console.log("[PinVault] Attempting Internal Reference (DataType 1)...");
        mobileDbSat = await sqlite.createNCConnection(fileName, 1);
        await mobileDbSat.open();
        successPath = fileName;
      } catch (e) {
        throw new Error("Tactical Mapping Data remains hidden. Please move maps to the /files/ folder in Device Explorer.");
      }
    }

    // Connect Street (using same working root) with Graceful Degradation
    const streetPath = successPath.includes('/') 
      ? successPath.replace("satellite", "street")
      : "tripoli-street.db";
      
    try {
      mobileDbStreet = await sqlite.createNCConnection(streetPath, successPath.includes('/') ? 0 : 1);
      await mobileDbStreet.open();
    } catch (streetErr) {
      console.warn(`[PinVault Mobile] Street layer not found at ${streetPath}. Continuing with Satellite only.`);
      mobileDbStreet = null;
    }
    
    console.log(`[PinVault Mobile] Tactical Capsules Online (Active: ${successPath})`);
    return true; // SUCCESS
  } catch (err) {
    const crashMsg = `CRASH LOG: ${err.message || err}`;
    console.error("[PinVault Mobile] " + crashMsg, err);
    // THE RADAR: Alert to catch path/permission errors on target tablets
    showTacticalAlert(crashMsg, 'error');
    showToast("Tactical Map Data missing/inaccessible", "warning");
    return false; // FAILURE
  }
};

/**
 * Close SQLite MBTiles connections (call before page reload)
 */
const closeMobileDatabases = async () => {
  if (!isNativeMobile) return;
  try {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    try { await sqlite.closeConnection("tripoli-satellite", false); } catch(e) {}
    try { await sqlite.closeConnection("tripoli-street", false); } catch(e) {}
    mobileDbSat = null;
    mobileDbStreet = null;
    console.log("[PinVault Mobile] SQLite connections closed.");
  } catch(e) { console.warn("[PinVault Mobile] Close error:", e); }
};

// Mobile databases will be initialized after the map UI is ready
// to prevent blocking the JavaScript thread.

// Global state for offline toggle
window.isOfflineMode = true;

// Custom TileLayer to read from local files when offline
L.TileLayer.Offline = L.TileLayer.extend({
  createTile: function (coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    const z = Math.round(coords.z), x = Math.round(coords.x), y = Math.round(coords.y);
    const layerType = this.options.layerType || 'satellite';
    const ext = layerType === 'satellite' ? '.jpg' : '.png';
    const fallbackExt = layerType === 'satellite' ? '.png' : '.jpg';

    // Build absolute file path for tiles
    let tilePath;
    if (window.location.protocol === 'file:') {
      // Electron: resolve absolute path from dist/index.html -> ../tiles-cache/
      const baseUrl = new URL('.', window.location.href).href;
      tilePath = new URL(`../tiles-cache/${layerType}/${z}/${x}/${y}${ext}`, baseUrl).href;
    } else {
      // Vite dev server or web: served from public/tiles-cache
      tilePath = `/tiles-cache/${layerType}/${z}/${x}/${y}${ext}`;
    }

    tile.onload = function() { done(null, tile); };
    tile.onerror = function() {
      // Try fallback extension before giving up
      const fbPath = tilePath.replace(ext, fallbackExt);
      tile.onload = function() { done(null, tile); };
      tile.onerror = function() { done(null, tile); }; // silent fail, transparent pixel
      tile.src = fbPath;
    };

    tile.src = tilePath;
    return tile;
  }
});

// ===== HELPERS =====

// ===== STATE =====
let map;
// currentEditPin — managed by feature-modal.js (getCurrentEditPin/setCurrentEditPin)
let streetLayer, satelliteLayer, labelsLayer;
let currentLayer = 'satellite';
let labelsVisible = false;

// ===== MAP SETUP =====

function initMap() {
  // 1. Define the strictly enforced tactical bounding box (Tripoli Area)
  const southWest = L.latLng(32.4000, 12.8800);
  const northEast = L.latLng(32.9500, 13.5300);
  const bounds = L.latLngBounds(southWest, northEast);

  // 2. Initialize map with strict boundary enforcement
  map = L.map('map', {
    center: [32.8872, 13.1913], // Tripoli Center
    zoom: 15,
    minZoom: 12,
    maxZoom: 20,
    rotate: true,
    touchRotate: true,
    maxBounds: bounds,
    maxBoundsViscosity: 1.0, 
    zoomControl: true,
    attributionControl: true
  });

  // App is permanently in offline mode
  window.isOfflineMode = true;

  // --- PLATFORM ADAPTIVE LAYERS ---
  const offlineStreetUrl = '/tiles-cache/street/{z}/{x}/{y}.png';
  const offlineSatelliteUrl = '/tiles-cache/satellite/{z}/{x}/{y}.jpg';

  if (isNativeMobile) {
    // ANDROID MODE: Dynamic injection after DB ready
    // We create the layers with null DB initially.
    // PERFORMANCE: Added keepBuffer: 16 and disabled debug to stop console.log blocking.
    streetLayer = new CapacitorMBTilesLayer('', { db: null, layerType: 'street', maxZoom: 20, maxNativeZoom: 18, debug: false, keepBuffer: 16, updateInterval: 100 });
    satelliteLayer = new CapacitorMBTilesLayer('', { db: null, layerType: 'satellite', maxZoom: 20, maxNativeZoom: 18, debug: false, keepBuffer: 16, updateInterval: 100 });
    labelsLayer = new CapacitorMBTilesLayer('', { db: null, layerType: 'street', maxZoom: 20, maxNativeZoom: 18, debug: false, keepBuffer: 16, updateInterval: 100 });
    
    // Add satellite as default (even if empty) to mount the layer
    satelliteLayer.addTo(map);

    // Layers will be wired by the global bootloader once DBs are ready.
    // Redundant initMobileDatabases() call removed to prevent SQLite connection race conditions.

  } else {
    // WINDOWS MODE: Standard Folder Offline logic
    streetLayer = new L.TileLayer.Offline(offlineStreetUrl, {
      attribution: '&copy; PinVault Tactical',
      maxZoom: 20,
      maxNativeZoom: 18,
      layerType: 'street'
    });

    satelliteLayer = new L.TileLayer.Offline(offlineSatelliteUrl, {
      attribution: '&copy; PinVault Tactical Satellite',
      maxZoom: 20,
      maxNativeZoom: 18,
      layerType: 'satellite'
    }).addTo(map);

    labelsLayer = new L.TileLayer.Offline(offlineStreetUrl, {
      attribution: '&copy; PinVault Tactical',
      maxZoom: 20,
      layerType: 'street'
    });
  }

  // Force initial recognition
  if (map) map.invalidateSize(); 

  // Dynamic Marker Scaling
  const updateMarkerScale = () => {
    const zoom = map.getZoom();
    // Base zoom 15 = scale 1.0
    // Zoom 18+ = scale 0.8 (smaller for precision)
    // Zoom 10- = scale 1.5 (larger for visibility)
    const scale = Math.max(0.7, Math.min(1.8, 1 + (15 - zoom) * 0.1));
    document.documentElement.style.setProperty('--marker-scale', scale);
  };
  map.on('zoom', updateMarkerScale);
  updateMarkerScale(); // Initial call

  // ===== COMPASS / NORTH RESET BUTTON =====
  // Creates a compass indicator that shows bearing and resets to North on click
  const compassBtn = document.createElement('div');
  compassBtn.id = 'compass-btn';
  compassBtn.title = 'Reset North';
  compassBtn.innerHTML = `
    <svg id="compass-needle" viewBox="0 0 32 32" width="40" height="40" style="transition: transform 0.3s ease;">
      <circle cx="16" cy="16" r="15" fill="rgba(0,0,0,0.6)" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
      <polygon points="16,4 19,16 16,14 13,16" fill="#ef4444"/>
      <polygon points="16,28 19,16 16,18 13,16" fill="#9ca3af"/>
      <circle cx="16" cy="16" r="2" fill="white"/>
      <text x="16" y="4.5" text-anchor="middle" font-size="3.5" fill="#ef4444" font-family="monospace" font-weight="bold">N</text>
    </svg>
  `;
  compassBtn.style.cssText = `
    position: absolute; bottom: 90px; right: 10px;
    z-index: 1000; cursor: pointer;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  `;
  document.getElementById('map').appendChild(compassBtn);

  // Update compass needle as map rotates
  const updateCompass = () => {
    const bearing = map.getBearing ? map.getBearing() : 0;
    const needle = document.getElementById('compass-needle');
    if (needle) needle.style.transform = `rotate(${-bearing}deg)`;
  };

  map.on('rotate', updateCompass);
  map.on('rotateend', updateCompass);

  // Click compass to reset North
  compassBtn.addEventListener('click', () => {
    if (map.setBearing) {
      map.setBearing(0, { animate: true, duration: 0.5 });
    }
  });

  // Map click handler (for pin dropping)
  map.on('click', handleMapClick);

  return map;
}

let pinMode = false;
let routeMode = false;
let zoneMode = false;
let selectAreaMode = false;
let textMode = false;
let selectAreaPoint = null;
let currentSelectionRect = null;
let selectAreaPreview = null;  // Preview rect during selection

async function handleMapClick(e) {
  // LOS mode intercept
  if (handleLOSClick(e)) return;

  if (textMode) {
    const popupContent = document.createElement('div');
    popupContent.style.padding = '5px';
    popupContent.innerHTML = `
      <div style="margin-bottom: 8px; font-weight: bold; color: var(--text-primary);">${t('enterTextLabel') || 'Enter Text Label'}</div>
      <input type="text" id="popup-text-input" style="width: 100%; margin-bottom: 8px; padding: 6px; background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;" autofocus />
      <div style="display: flex; gap: 8px;">
        <button id="btn-popup-save" class="btn btn-primary" style="flex: 1; padding: 6px; font-size: 0.8rem;">${t('savePin') || 'Save'}</button>
        <button id="btn-popup-cancel" class="btn btn-secondary" style="flex: 1; padding: 6px; font-size: 0.8rem;">${t('cancel') || 'Cancel'}</button>
      </div>
    `;

    const popup = L.popup()
      .setLatLng(e.latlng)
      .setContent(popupContent)
      .openOn(map);

    setTimeout(() => {
        const input = document.getElementById('popup-text-input');
        if (input) {
            input.focus();
            input.onkeydown = (ev) => {
                if (ev.key === 'Enter') document.getElementById('btn-popup-save').click();
                if (ev.key === 'Escape') document.getElementById('btn-popup-cancel').click();
            };
        }
    }, 100);

    popupContent.querySelector('#btn-popup-save').onclick = async () => {
      const text = popupContent.querySelector('#popup-text-input').value.trim();
      if (text) {
        const id = generateId();
        const rec = {
          id: id,
          type: 'text',
          collType: 'pins',
          name: text,
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          folderId: 'root',
          createdAt: Date.now()
        };
        await savePin(rec);
        updateFeature(rec);
        showToast(t('textAdded') || "Text overlay added", 'success');
      }
      map.closePopup();
      toggleTextMode();
    };

    popupContent.querySelector('#btn-popup-cancel').onclick = () => {
      map.closePopup();
      toggleTextMode();
    };
    return;
  }

  if (selectAreaMode) {
    if (!selectAreaPoint) {
      selectAreaPoint = e.latlng;
      // Add a corner marker
      L.circleMarker(selectAreaPoint, {
        radius: 6, color: '#06d6a0', fillColor: '#06d6a0',
        fillOpacity: 1, weight: 2
      }).addTo(map).on('remove', () => {});
      
      // Start preview on mousemove
      map.on('mousemove', onSelectAreaMouseMove);
      showToast(t('selectAreaEnd') || 'انقر على الزاوية الثانية لتحديد المنطقة', 'info');
    } else {
      const bounds = L.latLngBounds(selectAreaPoint, e.latlng);
      if (currentSelectionRect) map.removeLayer(currentSelectionRect);
      if (selectAreaPreview) { map.removeLayer(selectAreaPreview); selectAreaPreview = null; }
      currentSelectionRect = L.rectangle(bounds, { color: '#06d6a0', weight: 2, fillOpacity: 0.1 }).addTo(map);
      
      map.off('mousemove', onSelectAreaMouseMove);
      toggleSelectAreaMode(); // exit drawing mode
      showToast(t('areaSelected'), 'success');
      openDownloadModal(bounds);
    }
  }
}

function onSelectAreaMouseMove(e) {
  if (!selectAreaPoint || !selectAreaMode) return;
  const bounds = L.latLngBounds(selectAreaPoint, e.latlng);
  if (selectAreaPreview) {
    selectAreaPreview.setBounds(bounds);
  } else {
    selectAreaPreview = L.rectangle(bounds, {
      color: '#06d6a0',
      weight: 2,
      fillOpacity: 0.1,
      dashArray: '8 4'
    }).addTo(map);
  }
}


// ===== LAYER TOGGLE =====

function toggleLayer() {
  const isSat = currentLayer === 'satellite';
  
  // Remove current, add the other (offline only)
  if (isSat) {
    map.removeLayer(satelliteLayer);
    streetLayer.addTo(map);
    currentLayer = 'street';
    showToast(t('streetView'), 'info');
  } else {
    map.removeLayer(streetLayer);
    satelliteLayer.addTo(map);
    currentLayer = 'satellite';
    showToast(t('satelliteView'), 'info');
  }
}

// ===== LABELS TOGGLE =====

function toggleLabels() {
  labelsVisible = !labelsVisible;
  const btn = document.getElementById('btn-label-toggle');
  const mapContainer = document.getElementById('map');
  
  if (labelsVisible) {
    mapContainer.classList.remove('hide-tactical-labels');
    btn.classList.add('active');
    showToast(t('labelsOn') || 'Labels Visible', 'info');
  } else {
    mapContainer.classList.add('hide-tactical-labels');
    btn.classList.remove('active');
    showToast(t('labelsOff') || 'Labels Hidden', 'info');
  }
}

// ===== TRANSLATIONS =====

function updateTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  // Update toggle language text
  const langBtn = document.getElementById('btn-lang-toggle');
  langBtn.textContent = getLang() === 'en' ? 'العربية' : 'English';
  
  // Titles
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
  
  const layerToggle = document.getElementById('btn-layer-toggle');
  if (layerToggle) layerToggle.title = t('toggleView');
  
  const labelToggle = document.getElementById('btn-label-toggle');
  if (labelToggle) labelToggle.title = t('toggleLabels');
  
  // Geoman Tooltips
  updateDrawingToolTranslations(getLang());
  
  // Custom Icon Picker Setup
  setupIconPicker();
}

function handleLangToggle() {
  toggleLang();
  updateTranslations();
}

function togglePinMode() {
  pinMode = !pinMode;
  routeMode = false;
  zoneMode = false;
  selectAreaMode = false;
  textMode = false;
  
  updateModeUI();
  
  if (pinMode) {
    map.pm.enableDraw('Marker');
    showToast(t('clickMapDrop') || 'Click map to drop marker', 'info');
  } else {
    map.pm.disableDraw();
  }
}

function toggleRouteMode() {
  routeMode = !routeMode;
  pinMode = false;
  zoneMode = false;
  selectAreaMode = false;
  textMode = false;
  
  updateModeUI();
  
  if (routeMode) {
    map.pm.enableDraw('Line', { finishOn: 'contextmenu' });
    showToast(t('clickMapRoute') || 'Click map to draw route. Right-click to finish.', 'info');
  } else {
    map.pm.disableDraw();
  }
}

function toggleZoneMode() {
  zoneMode = !zoneMode;
  pinMode = false;
  routeMode = false;
  selectAreaMode = false;
  textMode = false;
  
  updateModeUI();
  
  if (zoneMode) {
    map.pm.enableDraw('Polygon', { finishOn: 'contextmenu' });
    showToast(t('clickMapZone') || 'Click map to draw zone. Right-click to finish.', 'info');
  } else {
    map.pm.disableDraw();
  }
}

function toggleTextMode() {
  textMode = !textMode;
  pinMode = false;
  routeMode = false;
  zoneMode = false;
  selectAreaMode = false;
  
  updateModeUI();
  
  if (textMode) {
    map.pm.disableDraw();
    showToast(t('clickMapText') || 'Click map to place text label', 'info');
    document.getElementById('map').style.cursor = 'crosshair';
  } else {
    document.getElementById('map').style.cursor = '';
  }
}

function updateModeUI() {
  const pinBtn = document.getElementById('btn-add-marker');
  const routeBtn = document.getElementById('btn-add-route');
  const zoneBtn = document.getElementById('btn-add-zone');
  const textBtn = document.getElementById('btn-add-text');
  const selectBtn = document.getElementById('btn-select-area');
  const pinBanner = document.getElementById('pin-mode-banner');
  const cityPanel = document.getElementById('city-search-panel');

  if (pinBtn) pinBtn.classList.toggle('active', pinMode);
  if (routeBtn) routeBtn.classList.toggle('active', routeMode);
  if (zoneBtn) zoneBtn.classList.toggle('active', zoneMode);
  if (textBtn) textBtn.classList.toggle('active', textMode);
  if (selectBtn) selectBtn.classList.toggle('active', selectAreaMode);
  
  if (pinBanner) pinBanner.classList.toggle('hidden', !pinMode);
  if (cityPanel) cityPanel.classList.toggle('hidden', !selectAreaMode);
  
  // Floating Cancel FAB for mobile — always accessible
  let cancelFab = document.getElementById('tool-cancel-fab');
  if (!cancelFab) {
    cancelFab = document.createElement('button');
    cancelFab.id = 'tool-cancel-fab';
    cancelFab.innerHTML = '✕ إلغاء';
    cancelFab.style.cssText = `
      position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
      z-index: 9999; padding: 12px 28px; border-radius: 30px;
      background: rgba(239, 68, 68, 0.9); color: #fff; border: 2px solid #fff;
      font-size: 1rem; font-weight: bold; cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5); backdrop-filter: blur(10px);
      touch-action: manipulation; -webkit-tap-highlight-color: rgba(255,0,0,0.3);
      display: none;
    `;
    document.body.appendChild(cancelFab);
    
    // Use BOTH click and touchstart for maximum responsiveness
    const cancelAllModes = (e) => {
      e.preventDefault();
      e.stopPropagation();
      pinMode = false;
      routeMode = false;
      zoneMode = false;
      selectAreaMode = false;
      textMode = false;
      try { map.pm.disableDraw(); } catch(err) {}
      updateModeUI();
      showToast('❌ تم إلغاء الأداة', 'info');
    };
    cancelFab.addEventListener('click', cancelAllModes);
    cancelFab.addEventListener('touchstart', cancelAllModes, { passive: false });
  }
  
  const anyToolActive = pinMode || routeMode || zoneMode || selectAreaMode || textMode;
  cancelFab.style.display = anyToolActive ? 'block' : 'none';

  if (selectAreaMode || textMode) {
    document.getElementById('map').style.cursor = 'crosshair';
  } else {
    document.getElementById('map').style.cursor = '';
  }
}



function toggleSelectAreaMode() {
  selectAreaMode = !selectAreaMode;
  pinMode = false;
  routeMode = false;
  zoneMode = false;
  selectAreaPoint = null;
  
  updateModeUI();
  
  if (selectAreaMode) showToast(t('selectAreaStart'), 'info');
}

// ===== PIN/FEATURE DETAIL MODAL — extracted to feature-modal.js =====

// savePinFromModal + deletePinFromModal — extracted to feature-modal.js

// ===== SIDEBAR TOGGLE =====

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('sidebar-closed');
  sidebar.classList.toggle('sidebar-open');
}

// ===== DOWNLOAD AREA UI — extracted to feature-modal.js (except searchCityBounds) =====

async function searchCityBounds() {
  const query = document.getElementById('city-search-input').value.trim();
  if (!query) return;

  const btn = document.getElementById('btn-city-search');
  btn.disabled = true;

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
    const data = await res.json();

    if (data && data.length > 0) {
      const place = data[0];
      const bbox = place.boundingbox;
      const bounds = L.latLngBounds(
        [parseFloat(bbox[0]), parseFloat(bbox[2])],
        [parseFloat(bbox[1]), parseFloat(bbox[3])]
      );
      
      map.fitBounds(bounds);

      if (currentSelectionRect) map.removeLayer(currentSelectionRect);
      currentSelectionRect = L.rectangle(bounds, { color: '#06d6a0', weight: 2 }).addTo(map);

      toggleSelectAreaMode();
      showToast(t('areaSelected'), 'success');
      openDownloadModal(bounds);
    } else {
      showToast(t('cityNotFound'), 'warning');
    }
  } catch (err) {
    showToast('Search Failed', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ===== INIT =====

async function init() {
  // GLOBAL BOOT GUARD: Prevent multiple initializations (resolves black screen races)
  if (window.appBooted) return;
  window.appBooted = true;

  const startupGuard = (stage, err) => {
    const msg = `STARTUP ERROR [${stage}]: ${err.message || err}`;
    console.error(msg, err);
    // Visual alert if crash happens in first 5 seconds
    const errorDiv = document.createElement('div');
    errorDiv.style = "position:fixed; top:0; left:0; width:100%; background:rgba(255,0,0,0.9); color:white; padding:15px; z-index:9999; font-family:monospace; font-size:12px; border-bottom:2px solid black;";
    errorDiv.innerHTML = `<strong>⚠️ TACTICAL BOOT ERROR</strong><br>${msg}<br><button onclick="this.parentElement.remove()" style="margin-top:10px; background:white; color:red; border:none; padding:5px 10px; cursor:pointer;">DISMISS</button>`;
    document.body.appendChild(errorDiv);
  };

  console.log("🚀 PinVault Tactical Boot Sequence Started [Parallel Mode]");

  // ===== PERSISTENT LOCKDOWN CHECK =====
  // Only block boot with lockdown if device has NO registered users
  // (prevents unauthorized first-time setup). Returning users go straight to login.
  if (isLocked() && !hasUser() && getAllUsers().length === 0) {
    const authEl = document.getElementById('auth-screen');
    if (authEl) authEl.style.display = 'none';
    
    initInternetLockdown();
    await new Promise((resolve) => {
      const checkUnlocked = setInterval(() => {
        if (!isLocked()) {
          clearInterval(checkUnlocked);
          if (authEl) authEl.style.display = '';
          resolve();
        }
      }, 500);
    });
  } else if (isLocked()) {
    // Clear stale lockdown for returning users
    clearLockdown();
  }

  // ===== ADMIN PIN SETUP (First-time only) =====
  if (!hasAdminPin()) {
    await showAdminPinSetup();
  }

  // ===== ADMIN PIN VERIFICATION (ONLY when no users exist) =====
  // Only require admin PIN when there are NO registered users AND no active user
  // This gates new account creation on a fresh device, but lets returning users
  // go straight to their login screen without admin popup
  if (hasAdminPin() && !isAuthenticated() && !hasUser() && getAllUsers().length === 0) {
    const authEl = document.getElementById('auth-screen');
    if (authEl) authEl.style.display = 'none';
    
    const lockScreen = document.getElementById('internet-lock');
    if (lockScreen) {
      // Show lock screen with admin PIN verification
      lockScreen.classList.remove('hidden');
      const lockTitle = lockScreen.querySelector('h2');
      if (lockTitle) lockTitle.textContent = '🔑 تحقق المسؤول مطلوب';
      const lockSub = lockScreen.querySelector('p');
      if (lockSub) lockSub.textContent = 'أدخل رمز المسؤول للسماح بإنشاء حساب جديد';
      
      initInternetLockdown();
      
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (lockScreen.classList.contains('hidden')) {
            clearInterval(checkInterval);
            if (lockTitle) lockTitle.textContent = '⛔ SECURITY LOCKDOWN';
            if (lockSub) lockSub.textContent = 'Internet connection detected — Enter admin PIN';
            if (authEl) authEl.style.display = '';
            resolve();
          }
        }, 300);
      });
    }
  }

  // ===== AUTH GATE =====
  if (!isAuthenticated()) {
    await showAuthScreen({ verifyPin, closeMobileDatabases });
    return; // init() will be re-called after successful auth
  }
  // Show app, hide auth
  document.getElementById('auth-screen')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');

  // ===== RESTORE CRYPTO KEY (survives page reload via sessionStorage) =====
  try {
    const { restoreKey } = await import('./crypto.js');
    await restoreKey();
  } catch(e) { console.warn('Crypto restore skipped:', e); }

  // ===== INTERNET LOCKDOWN — Activate after successful login =====
  initInternetLockdown();

  try {
    // 1. STAGE ONE: START ASYNC ENGINES IN PARALLEL
    // We launch the SQLite connection and UI preparation simultaneously
    const bootTasks = [
      initMobileDatabases(), // Start DB connection immediately
      (async () => {
        setupButtonListeners();
        updateTranslations();
        initConfirmModal();
        initIconUploader(); // F5: was orphaned module-scope code
        initPrintSystem();
        initPrivacyGuard();
      })()
    ];

    const [dbSuccess] = await Promise.all(bootTasks);

    // 2. STAGE TWO: MOUNT MAP ENGINE
    console.log("Mounting Leaflet Engine...");
    const mapInstance = initMap();
    if (!mapInstance) throw new Error("Map failed to mount.");

    // Add scale bar to map (metric + imperial, bottom-left)
    L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: true,
      maxWidth: 200
    }).addTo(mapInstance);

    // 3. STAGE THREE: ACTIVATE LAYERS & LOAD DATA
    // Once map is ready, we signal the layers to use the DBs we opened in Stage One
    if (dbSuccess && Capacitor.isNativePlatform()) {
      console.log("[PinVault Mobile] Mapping Layers to Active Database Stream...");
      if (satelliteLayer) satelliteLayer.options.db = mobileDbSat;
      if (streetLayer) streetLayer.options.db = mobileDbStreet;
      if (labelsLayer) labelsLayer.options.db = mobileDbStreet;
      if (satelliteLayer) satelliteLayer.redraw();
    }

    // Load functional modules in parallel
    const moduleBatch = [
      (async () => {
        initFeatures(mapInstance, openFeatureModal);
        setupSearchFeatures();
      })(),
      setupVideoUpload(),
      initLibraryUI(),
      setupShareControls(),
      (async () => {
        // Wire V2 tactical export button
        document.getElementById('btn-export-tactical')?.addEventListener('click', () => {
          exportTacticalEnvelope(0, mapInstance);
        });
        // Wire Data Center collapsible toggle
        document.getElementById('btn-data-center-toggle')?.addEventListener('click', () => {
          const panel = document.getElementById('data-center-panel');
          const chevron = document.getElementById('data-center-chevron');
          if (panel) {
            panel.classList.toggle('hidden');
            if (chevron) chevron.style.transform = panel.classList.contains('hidden') ? '' : 'rotate(180deg)';
          }
        });
      })(),
      setupTacticalTools(mapInstance),
      loadAllFeatures(),
      (async () => initLOS(mapInstance))(),
      (async () => initSpyglass(mapInstance))(),
      (async () => initKillBox(mapInstance))(),
      (async () => initAzimuth(mapInstance))(),
      (async () => initMortarFCS(mapInstance))(),
      (async () => initTacticalFigures(mapInstance))(),
      (async () => initRangeRings(mapInstance))(),
      (async () => initMGRS(mapInstance))(),
      (async () => initBFT(mapInstance))(),
      (async () => initQuickMenu(mapInstance))(),
      (async () => initStreetModes(mapInstance))()
    ];

    await Promise.all(moduleBatch.map(p => Promise.resolve(p).catch(e => console.warn("Module Load Error", e))));

    // Reset all draw modes when Leaflet PM finishes drawing
    // This ensures the cancel FAB hides after pin/route/zone is placed
    mapInstance.on('pm:drawend', () => {
      pinMode = false;
      routeMode = false;
      zoneMode = false;
      updateModeUI();
    });

    // Init mesh network with user's name (lazy loaded)
    try {
      const profile = getUserProfile();
      const { initMesh } = await import('./mesh.js');
      initMesh(mapInstance, profile?.name || 'مشغل');
    } catch (e) { console.warn('Mesh init skipped:', e); }

    // Init Android sync (WiFi Direct / Bluetooth) — only on Capacitor
    if (typeof window.Capacitor !== 'undefined') {
      try {
        const { initAndroidSync } = await import('./android-sync.js');
        await initAndroidSync();
      } catch (e) { console.warn('Android sync skipped:', e); }
    }

    console.log('🗺️ PinVault initialized and operational!');
    
    // TACTICAL VIEWPORT RECOVERY: Ensure the map container fills the screen after boot
    setTimeout(() => {
      if (mapInstance) {
        mapInstance.invalidateSize();
        console.log("[PinVault] Platform Viewport Calibrated.");
      }
    }, 500);

  } catch (e) {
    console.error("Critical Startup Failure", e);
    startupGuard("GLOBAL_BOOT", e);
  }
}

function setupButtonListeners() {
  // Simple click listener — header and map are siblings so events don't cross
  const safeListen = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };

  // Helper: deactivate all drawing modes before activating new tool
  function clearAllDrawModes() {
    try { map.pm.disableDraw(); } catch(e) {}
    pinMode = false;
    routeMode = false;
    zoneMode = false;
    selectAreaMode = false;
    textMode = false;
    updateModeUI();
  }

  safeListen('sidebar-toggle', 'click', toggleSidebar);
  safeListen('btn-layer-toggle', 'click', toggleLayer);
  safeListen('btn-label-toggle', 'click', toggleLabels);
  safeListen('btn-lang-toggle', 'click', handleLangToggle);
  
  // SESSION LOGOUT — clears session, reloads to login screen
  safeListen('btn-session-logout', 'click', async () => {
    const confirmed = await showTacticalConfirm('تسجيل خروج؟\n\nسيتم إنهاء الجلسة الحالية فقط.\nلن يتم حذف أي بيانات.');
    if (!confirmed) return;
    logout();
    await closeMobileDatabases();
    window.location.reload();
  });
  
  // DELETE USER — admin-only, uses unified user-management module
  safeListen('btn-delete-user', 'click', async () => {
    const authorized = await requireAdminPin(verifyPin);
    if (!authorized) return;
    
    const modal = document.getElementById('delete-user-modal');
    const container = document.getElementById('user-list-container');
    if (!modal || !container) return;
    
    await buildUserListUI(container, verifyPin);
    modal.classList.remove('hidden');
  });
  
  // Close delete user modal
  safeListen('btn-close-user-modal', 'click', () => {
    document.getElementById('delete-user-modal')?.classList.add('hidden');
  });
  
  safeListen('btn-add-marker', 'click', () => {
    deactivateAllTactical();  // kill any tactical tool
    clearAllDrawModes();
    togglePinMode();
  });
  safeListen('btn-cancel-pin-mode', 'click', () => {
    clearAllDrawModes();
    updateModeUI();
  });
  safeListen('btn-add-route', 'click', () => {
    deactivateAllTactical();
    clearAllDrawModes();
    toggleRouteMode();
  });
  safeListen('btn-add-zone', 'click', () => {
    deactivateAllTactical();
    clearAllDrawModes();
    toggleZoneMode();
  });
  safeListen('btn-add-text', 'click', () => {
    deactivateAllTactical();
    clearAllDrawModes();
    toggleTextMode();
  });
  safeListen('btn-select-area', 'click', () => {
    deactivateAllTactical();
    clearAllDrawModes();
    toggleSelectAreaMode();
  });
  safeListen('btn-icon-library', 'click', openLibraryModal);

  // === TACTICAL TOOLS (exclusive — only one at a time) ===
  let activeTacticalKey = null;
  
  const tacticalOff = {
    los: () => { try { const b = document.getElementById('btn-los-tool'); if(b && b.classList.contains('active')) toggleLOSMode(); } catch(e){} },
    spyglass: () => { try { const b = document.getElementById('btn-spyglass'); if(b && b.classList.contains('active')) toggleSpyglass(); } catch(e){} },
    killbox: () => { try { const b = document.getElementById('btn-killbox'); if(b && b.classList.contains('active')) toggleKillBoxMode(); } catch(e){} },
    azimuth: () => { try { const b = document.getElementById('btn-azimuth'); if(b && b.classList.contains('active')) toggleAzimuthMode(); } catch(e){} },
    mortar: () => { try { const b = document.getElementById('btn-mortar-fcs'); if(b && b.classList.contains('active')) toggleMortarMode(); } catch(e){} },
    freehand: () => { try { deactivateTacticalFigures(); } catch(e){} },
    rings: () => { try { const b = document.getElementById('btn-range-rings'); if(b && b.classList.contains('active')) toggleRangeRings(); } catch(e){} },
    mgrs: () => { try { const b = document.getElementById('btn-mgrs'); if(b && b.classList.contains('active')) toggleMGRS(); } catch(e){} },
    bft: () => { try { deactivateBFT(); } catch(e){} },
  };

  function deactivateAllTactical(except) {
    clearAllDrawModes();
    stopToolModes(); // Also deactivate measure/circle tools (tactical.js)
    // Only deactivate the currently active tool
    if (activeTacticalKey && activeTacticalKey !== except) {
      const fn = tacticalOff[activeTacticalKey];
      if (fn) fn();
      activeTacticalKey = null;
    }
  }

  // Listen for deactivation requests from tactical.js (measure/circle tools)
  document.addEventListener('deactivate-tactical', () => {
    if (activeTacticalKey) {
      const fn = tacticalOff[activeTacticalKey];
      if (fn) fn();
      activeTacticalKey = null;
    }
  });

  function activateTactical(key) {
    deactivateAllTactical(key);
    // If same tool is active, deactivate it (toggle off)
    if (activeTacticalKey === key) {
      const fn = tacticalOff[key];
      if (fn) fn();
      activeTacticalKey = null;
      return;
    }
    activeTacticalKey = key;
  }

  safeListen('btn-los-tool', 'click', () => { activateTactical('los'); if(activeTacticalKey==='los') toggleLOSMode(); });
  safeListen('btn-spyglass', 'click', () => { activateTactical('spyglass'); if(activeTacticalKey==='spyglass') toggleSpyglass(); });
  safeListen('btn-killbox', 'click', () => { activateTactical('killbox'); if(activeTacticalKey==='killbox') toggleKillBoxMode(); });
  safeListen('btn-azimuth', 'click', () => { activateTactical('azimuth'); if(activeTacticalKey==='azimuth') toggleAzimuthMode(); });
  safeListen('btn-mortar-fcs', 'click', () => { activateTactical('mortar'); if(activeTacticalKey==='mortar') toggleMortarMode(); });
  safeListen('btn-freehand', 'click', () => { activateTactical('freehand'); if(activeTacticalKey==='freehand') toggleTacticalFigures(); });
  safeListen('btn-range-rings', 'click', () => { activateTactical('rings'); if(activeTacticalKey==='rings') toggleRangeRings(); });
  safeListen('btn-mgrs', 'click', () => { activateTactical('mgrs'); if(activeTacticalKey==='mgrs') toggleMGRS(); });
  safeListen('btn-bft', 'click', () => { activateTactical('bft'); if(activeTacticalKey==='bft') toggleBFT(); });

  // Street Labels Toggle
  safeListen('btn-street-labels', 'click', toggleStreetLabels);

  // Mesh Network Chat
  safeListen('btn-wireless-sync', 'click', async () => {
    try {
      const { toggleChatPanel } = await import('./mesh.js');
      toggleChatPanel();
    } catch (e) { console.warn('Mesh chat not available:', e); }
  });

  // Track Recording (lazy loaded)
  safeListen('btn-track-record', 'click', async () => {
    try {
      const { toggleRecording, initTrackRecorder } = await import('./track-recorder.js');
      if (!window._trackRecorderInit) {
        initTrackRecorder(map);
        window._trackRecorderInit = true;
      }
      toggleRecording();
    } catch (e) { console.warn('Track recorder not available:', e); }
  });

  // Data Migration (lazy loaded)
  safeListen('btn-migrate-data', 'click', async () => {
    try {
      const { migrateToEncrypted } = await import('./migrate.js');
      const confirmed = await showTacticalConfirm('🔐 هل تريد تشفير جميع البيانات القديمة؟\n\nهذا الإجراء آمن ولا يحذف أي بيانات.');
      if (confirmed) {
        await migrateToEncrypted();
      }
    } catch (e) { console.warn('Migration not available:', e); }
  });

  // Night Ops Mode — cycles through: off → red → green → off
  let nightOpsMode = 0; // 0=off, 1=red, 2=green
  safeListen('btn-night-ops', 'click', () => {
    const app = document.getElementById('app');
    const btn = document.getElementById('btn-night-ops');
    app.classList.remove('night-ops-red', 'night-ops-green');
    nightOpsMode = (nightOpsMode + 1) % 3;
    if (nightOpsMode === 1) {
      app.classList.add('night-ops-red');
      btn.classList.add('active');
      btn.style.color = '#ef4444';
      showToast('🔴 ' + (t('nightOpsRed') || 'وضع ليلي — فلتر أحمر'), 'info');
    } else if (nightOpsMode === 2) {
      app.classList.add('night-ops-green');
      btn.classList.add('active');
      btn.style.color = '#22c55e';
      showToast('🟢 ' + (t('nightOpsGreen') || 'وضع ليلي — فلتر أخضر'), 'info');
    } else {
      btn.classList.remove('active');
      btn.style.color = '#ef4444';
      showToast(t('nightOpsOff') || 'الوضع الليلي معطل', 'info');
    }
  });

  // Modal Closers
  safeListen('log-modal-close', 'click', () => document.getElementById('log-modal').classList.add('hidden'));
  safeListen('log-modal-backdrop', 'click', () => document.getElementById('log-modal').classList.add('hidden'));
  safeListen('download-modal-close', 'click', closeDownloadModal);
  safeListen('btn-cancel-download', 'click', closeDownloadModal);
  safeListen('modal-close', 'click', closePinModal);
  safeListen('video-modal-close', 'click', closeVideoPlayer);
  
  // Persistence Actions
  safeListen('btn-save-pin', 'click', savePinFromModal);
  safeListen('btn-delete-pin', 'click', deletePinFromModal);
  safeListen('btn-start-download', 'click', startDownload);
  safeListen('btn-city-search', 'click', searchCityBounds);

  // Sync / Shared
  safeListen('sync-modal-close', 'click', () => document.getElementById('sync-modal').classList.add('hidden'));

  // Shutdown Logic
  safeListen('btn-shutdown-app', 'click', () => {
    confirmAction(t('confirmExit'), t('confirmExitDesc'), async () => {
      showToast(t('savingData'), "success");
      
      // Delay to allow toast and ensure all SQLite operations are flushed
      setTimeout(async () => {
        if (Capacitor.isNativePlatform()) {
          await App.exitApp();
        } else {
          window.close();
        }
      }, 1000);
    });
  });
}

// App is permanently offline — no toggle listeners needed

// F5: Icon uploader encapsulated in function, called from boot sequence
function initIconUploader() {
  const iconSelectEl = document.getElementById('feature-icon');
  const previewImgEl = document.getElementById('custom-png-preview');

  if (iconSelectEl) {
    iconSelectEl.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        const uploaderEl = document.getElementById('feature-icon-upload');
        if (uploaderEl) { uploaderEl.value = ''; uploaderEl.click(); }
      } else if (e.target.value === 'manage-library' || e.target.value === 'manage') {
        iconSelectEl.value = 'default';
        openLibraryModal();
      } else if (previewImgEl) {
        previewImgEl.classList.add('hidden');
        previewImgEl.src = '';
      }
    });
  }

  const uploaderEl = document.getElementById('feature-icon-upload');
  if (uploaderEl) {
    uploaderEl.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const pin = getCurrentEditPin();
      if (file && pin && file.type === 'image/svg+xml') {
        const reader = new FileReader();
        reader.onload = (ev) => {
          pin.customIconData = ev.target.result;
          if (previewImgEl) {
            previewImgEl.src = pin.customIconData;
            previewImgEl.classList.remove('hidden');
            if (iconSelectEl) iconSelectEl.value = 'custom';
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

// Start app
document.addEventListener('DOMContentLoaded', init);

// ===== AUTH SCREEN LOGIC — extracted to auth-screen.js =====

function initPrintSystem() {
  const btnPrint = document.getElementById('btn-print-map');
  const printBar = document.getElementById('print-control-bar');
  const mainHeader = document.getElementById('header');
  const btnCancel = document.getElementById('btn-print-cancel');
  const btnConfirm = document.getElementById('btn-print-confirm');
  const sizeSelect = document.getElementById('print-size-select');
  const orientSelect = document.getElementById('print-orientation-select');

  if (btnPrint) {
    btnPrint.onclick = () => {
      mainHeader.classList.add('hidden-tactical');
      printBar.classList.remove('hidden');
      updatePrintFrame();
      showToast(t('adjustMapPrint') || 'Adjust map to fit area inside the frame.', 'info');
    };
  }

  if (btnCancel) {
    btnCancel.onclick = () => {
      mainHeader.classList.remove('hidden-tactical');
      printBar.classList.add('hidden');
      document.getElementById('print-guide-frame').classList.add('hidden');
    };
  }

  if (sizeSelect) sizeSelect.onchange = updatePrintFrame;
  if (orientSelect) orientSelect.onchange = updatePrintFrame;

  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      printBar.classList.add('hidden');
      await executePrint(map, L, {
        size: sizeSelect.value,
        orient: orientSelect.value,
        isNativeMobile,
        headerEl: mainHeader,
        frameEl: document.getElementById('print-guide-frame'),
        Filesystem,
        Directory
      });
    };
  }
}

function initPrivacyGuard() {
  const guard = document.getElementById('privacy-guard');

  // 1. Hide/Blur content when tab is hidden or window loses focus
  const showGuard = () => {
    if (guard) guard.classList.remove('hidden');
  };
  
  const hideGuard = () => {
    if (guard) guard.classList.add('hidden');
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) showGuard();
    else hideGuard();
  });

  window.addEventListener('blur', showGuard);
  window.addEventListener('focus', hideGuard);

  // === CUSTOM NON-BLOCKING CONFIRM UI ===
  // Prevents window blur that triggers the privacy screen
  window.showConfirmDialog = (message) => {
    return new Promise((resolve) => {
      let modal = document.getElementById('custom-confirm-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'custom-confirm-modal';
        modal.className = 'modal-container hidden';
        modal.style.zIndex = '10000';
        modal.innerHTML = `
          <div class="modal-backdrop"></div>
          <div class="modal-content" style="max-width: 400px; border: 1px solid var(--accent-primary);">
            <div class="modal-header">
              <h3 id="confirm-modal-title" style="color: var(--accent-primary);">Confirm Action</h3>
            </div>
            <div class="modal-body">
              <p id="confirm-modal-message" style="margin-bottom: 20px; font-size: 1rem;"></p>
              <div style="display: flex; gap: 10px;">
                <button id="btn-confirm-yes" class="btn btn-primary" style="flex: 1;">Confirm</button>
                <button id="btn-confirm-no" class="btn btn-secondary" style="flex: 1;">Cancel</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      
      const msgEl = modal.querySelector('#confirm-modal-message');
      const yesBtn = modal.querySelector('#btn-confirm-yes');
      const noBtn = modal.querySelector('#btn-confirm-no');
      
      msgEl.textContent = message;
      modal.classList.remove('hidden');
      
      const cleanup = (result) => {
        modal.classList.add('hidden');
        yesBtn.onclick = null;
        noBtn.onclick = null;
        resolve(result);
      };
      
      yesBtn.onclick = () => cleanup(true);
      noBtn.onclick = () => cleanup(false);
    });
  };

  // 2. Disable Context Menu (Right Click)
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
  });

  // 3. Block common screenshot keys (PrintScreen)
  window.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') {
      navigator.clipboard.writeText(' '); // Attempt to clear clipboard
      showToast(t('screenshotDetected') || 'Screenshots of tactical data are restricted.', 'warning');
    }
  });

  // 4. Force hide on page load if not focused
  if (!document.hasFocus()) showGuard();
}
