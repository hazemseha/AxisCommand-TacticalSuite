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
import { setupShareControls } from './share.js';
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
  if (!stored) return pin === '1986'; // Fallback default
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
import { initQuickMenu } from './quickmenu.js';
import { initStreetModes, toggleStreetLabels } from './streetmodes.js';
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
    // THE RADAR: Native alert to catch path/permission errors on target tablets
    alert(crashMsg);
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
      // Vite dev server or web: relative path
      tilePath = `../tiles-cache/${layerType}/${z}/${x}/${y}${ext}`;
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
let currentEditPin = null;
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
  const offlineStreetUrl = ['..', '..', 'tiles-cache', 'street', '{z}', '{x}', '{y}.png'].join('/');
  const offlineSatelliteUrl = ['..', '..', 'tiles-cache', 'satellite', '{z}', '{x}', '{y}.jpg'].join('/');

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

// ===== PIN/FEATURE DETAIL MODAL =====

function setupIconPicker() {
  const pickerBtn = document.getElementById('icon-picker-btn');
  const pickerContent = document.getElementById('icon-picker-content');
  const pickerSearch = document.getElementById('icon-search-input');

  if (pickerBtn) {
    pickerBtn.onclick = (e) => {
      e.stopPropagation();
      const isHidden = pickerContent.classList.toggle('hidden');
      if (!isHidden) {
        renderIconPicker();
        pickerSearch.value = '';
        pickerSearch.focus();
      }
    };
  }

  if (pickerSearch) {
    pickerSearch.oninput = (e) => {
      renderIconPicker(e.target.value);
    };
  }

  // Close picker when clicking outside
  const originalOnClick = window.onclick;
  window.onclick = (e) => {
    if (originalOnClick) originalOnClick(e);
    if (pickerContent && !pickerContent.classList.contains('hidden') && !e.target.closest('#custom-icon-picker')) {
      pickerContent.classList.add('hidden');
    }
  };
}

async function openFeatureModal(feature) {
  currentEditPin = feature;
  setCurrentPin(feature.id); // For legacy video sync

  const modal = document.getElementById('pin-modal');
  const nameInput = document.getElementById('pin-name');
  const descInput = document.getElementById('pin-description');
  const titleEl = document.getElementById('modal-title');
  const iconSel = document.getElementById('feature-icon');
  const colorSel = document.getElementById('feature-color');
  const folderSel = document.getElementById('feature-folder');
  const previewImg = document.getElementById('custom-png-preview');
  const coordsInp = document.getElementById('pin-coords');
  const weightBox = document.getElementById('weight-picker-container');
  const iconBox = document.getElementById('icon-picker-container');
  const weightInp = document.getElementById('feature-weight');

  titleEl.textContent = feature.collType === 'pins' ? t('editPin') : (feature.collType === 'routes' ? t('editRoute') : t('editZone'));
  nameInput.value = feature.name || '';
  descInput.value = feature.description || '';
  
  if (feature.lat) {
    if (coordsInp) coordsInp.textContent = `Lat: ${feature.lat.toFixed(6)} | Lng: ${feature.lng.toFixed(6)}`;
    if (iconBox) iconBox.classList.remove('hidden');
    if (weightBox) weightBox.classList.add('hidden');
  } else {
    if (coordsInp) coordsInp.textContent = 'Shape coordinates managed via map';
    if (iconBox) iconBox.classList.add('hidden');
    if (weightBox) weightBox.classList.remove('hidden');
    if (weightInp) weightInp.value = feature.weight || 4;
  }
  
  if (iconSel) {
    const iconVal = feature.type || 'default';
    iconSel.value = iconVal;
    
    // Sync Custom Picker UI
    const selectedLabel = document.getElementById('picker-selected-label');
    const selectedIcon = document.getElementById('picker-selected-icon');
    if (selectedLabel && selectedIcon) {
      // Find name from ICON_METADATA or library
      import('./features.js').then(m => {
        const lib = m.getCustomTacticalIcons();
        const iconRec = lib.find(i => i.id === iconVal);
        if (iconRec) {
          selectedLabel.textContent = iconRec.name;
        } else {
          // Fallback to basic icons (these strings should match ICON_METADATA or be localized)
          const names = { 'default': 'Operational Pin', 'crosshair': 'Target / Objective', 'warning': 'Danger / Warning', 'platoon': 'Platoon (Special Ops)', 'sniper': 'Sniper Team', 'rpg': 'RPG Team', 'konkurs': 'Konkurs ATGM', 'kornet': 'Kornet ATGM', 'su23': 'SU-23 AA Gun', 'fpv_operator': 'FPV Unit (Suicide Drone)' };
          selectedLabel.textContent = names[iconVal] || 'Operational Pin';
        }
        selectedIcon.innerHTML = m.getFeatureIconHtml(iconVal, '#fff', null);
      });
    }
  }

  if (colorSel) colorSel.value = feature.color || '#ff0000';
  if (folderSel) folderSel.value = feature.folderId || 'root';
  
  if (feature.customIconData && previewImg) {
    previewImg.src = feature.customIconData;
    previewImg.classList.remove('hidden');
  } else if (previewImg) {
    previewImg.src = '';
    previewImg.classList.add('hidden');
  }

  // Load videos
  await renderVideoList(feature.id);
  modal.classList.remove('hidden');
}

function closePinModal() {
  const modal = document.getElementById('pin-modal');
  modal.classList.add('hidden');
  currentEditPin = null;
  setCurrentPin(null);
}

async function savePinFromModal() {
  if (!currentEditPin) return;

  currentEditPin.name = document.getElementById('pin-name').value.trim() || 'Unnamed';
  currentEditPin.description = document.getElementById('pin-description').value.trim();
  const iconSel = document.getElementById('feature-icon');
  const colorSel = document.getElementById('feature-color');
  const folderSel = document.getElementById('feature-folder');
  const weightInp = document.getElementById('feature-weight');
  
  if (currentEditPin.lat) {
    if (iconSel) {
      const val = iconSel.value;
      if (val !== 'custom') {
        currentEditPin.type = val;
        currentEditPin.customIconData = null;
      }
    }
  } else if (weightInp) {
    currentEditPin.weight = parseInt(weightInp.value) || 4;
  }

  if (colorSel) currentEditPin.color = colorSel.value;
  if (folderSel) currentEditPin.folderId = folderSel.value;

  await updateFeature(currentEditPin);
  showToast(t('pinSaved'), 'success');
  closePinModal();
}

async function deletePinFromModal() {
  if (!currentEditPin) return;

  confirmAction(t('confirmDelete') || 'Delete Feature', 'Are you sure you want to delete this feature?', async () => {
    try {
      const idToRemove = currentEditPin.id;
      await hardRemoveFeature(currentEditPin);
      
      showToast(t('pinDeleted') || 'Feature deleted', 'warning');
      closePinModal();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Delete failed', 'error');
    }
  });
}

// ===== SIDEBAR TOGGLE =====

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('sidebar-closed');
  sidebar.classList.toggle('sidebar-open');
}

// ===== DOWNLOAD AREA UI =====


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
      const bbox = place.boundingbox; // ["lat_min", "lat_max", "lon_min", "lon_max"]
      const bounds = L.latLngBounds(
        [parseFloat(bbox[0]), parseFloat(bbox[2])], // south-west
        [parseFloat(bbox[1]), parseFloat(bbox[3])]  // north-east
      );
      
      map.fitBounds(bounds);

      if (currentSelectionRect) map.removeLayer(currentSelectionRect);
      currentSelectionRect = L.rectangle(bounds, { color: '#06d6a0', weight: 2 }).addTo(map);

      toggleSelectAreaMode(); // exit drawing mode
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

let downloadBoundsStr = null;
function openDownloadModal(bounds) {
  downloadBoundsStr = bounds;
  const modal = document.getElementById('download-map-modal');
  modal.classList.remove('hidden');
  
  // reset UI
  document.getElementById('download-progress-container').classList.add('hidden');
  document.getElementById('map-progress-percent').textContent = '0%';
  document.getElementById('map-progress-fill').style.width = '0%';
  document.getElementById('btn-start-download').disabled = false;
  
  updateDownloadEstimate();
}

function closeDownloadModal() {
  document.getElementById('download-map-modal').classList.add('hidden');
  if (currentSelectionRect) {
    map.removeLayer(currentSelectionRect);
    currentSelectionRect = null;
  }
}

function updateDownloadEstimate() {
  if (!downloadBoundsStr) return;
  const maxZ = parseInt(document.getElementById('zoom-depth-slider').value);
  const downloadAll = document.getElementById('download-all-zooms').checked;
  const minZ = downloadAll ? 5 : maxZ;
  
  document.getElementById('zoom-depth-value').textContent = maxZ;
  
  const count = estimateTiles(downloadBoundsStr, minZ, maxZ);
  document.getElementById('estimated-tiles-count').textContent = count.toLocaleString();
}

async function startDownload() {
  if (!downloadBoundsStr) return;
  const maxZ = parseInt(document.getElementById('zoom-depth-slider').value);
  const downloadAll = document.getElementById('download-all-zooms').checked;
  const minZ = downloadAll ? 5 : maxZ;
  
  document.getElementById('btn-start-download').disabled = true;
  const progressContainer = document.getElementById('download-progress-container');
  progressContainer.classList.remove('hidden');
  
  const fill = document.getElementById('map-progress-fill');
  const percentTxt = document.getElementById('map-progress-percent');
  
  await downloadArea(downloadBoundsStr, minZ, maxZ, (done, total) => {
    const pct = Math.floor((done / total) * 100);
    fill.style.width = pct + '%';
    percentTxt.textContent = pct + '%';
  });
  
  showToast(t('downloadComplete'), 'success');
  closeDownloadModal();
}

// App is always offline — no toggle needed
let swRegistration = null;

// ===== CONFIRM MODAL ENGINE =====


// Wire up the confirm buttons in init or globally

// ===== PIN MODAL HANDLERS =====

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
    await showAuthScreen();
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
    const confirmed = confirm('تسجيل خروج؟\n\nسيتم إنهاء الجلسة الحالية فقط.\nلن يتم حذف أي بيانات.');
    if (!confirmed) return;
    // Clear session + crypto key
    logout();
    // Close SQLite connections before reload so they can be re-created
    await closeMobileDatabases();
    // Full reload — clean state
    window.location.reload();
  });
  
  // DELETE USER — admin-only, shows user list modal for targeted deletion
  safeListen('btn-delete-user', 'click', async () => {
    // Require admin PIN first
    const pin = prompt('🔑 أدخل رمز المسؤول (4 أرقام):');
    if (!pin) return;
    const valid = await verifyPin(pin);
    if (!valid) {
      alert('❌ رمز خاطئ — تم إلغاء العملية');
      return;
    }
    
    // Show the delete user modal — FRESH query every time
    const modal = document.getElementById('delete-user-modal');
    const container = document.getElementById('user-list-container');
    if (!modal || !container) return;
    
    // Always clear first to prevent stale data
    container.innerHTML = '';
    
    // Scan IndexedDB + auth registry for all unique userIds
    try {
      const { getDB } = await import('./db.js');
      const db = await getDB();
      
      const userMap = new Map();
      
      const allPins = await db.getAll('pins');
      const allRoutes = await db.getAll('routes');
      const allZones = await db.getAll('zones');
      
      for (const item of [...allPins, ...allRoutes, ...allZones]) {
        const uid = item.userId || 'default';
        if (!userMap.has(uid)) userMap.set(uid, { pins: 0, routes: 0, zones: 0 });
        const counts = userMap.get(uid);
        if (allPins.includes(item)) counts.pins++;
        else if (allRoutes.includes(item)) counts.routes++;
        else counts.zones++;
      }
      
      // ALSO include users from auth registry (new users with no data yet)
      const authUsers = getAllUsers();
      for (const u of authUsers) {
        const uid = u.name + '_' + (u.createdAt || '0');
        if (!userMap.has(uid)) userMap.set(uid, { pins: 0, routes: 0, zones: 0 });
      }
      
      if (userMap.size === 0) {
        container.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.4); padding: 20px;">لا يوجد بيانات مستخدمين</p>';
      } else {
        for (const [userId, counts] of userMap) {
          const displayName = userId === 'default' ? 'مستخدم قديم (بدون تعريف)' : userId.split('_')[0];
          
          const row = document.createElement('div');
          row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px;';
          row.innerHTML = `
            <div>
              <div style="font-weight:bold; font-size:0.95rem;">👤 ${displayName}</div>
              <div style="font-size:0.75rem; color:rgba(255,255,255,0.4); margin-top:4px;">
                📌 ${counts.pins} | 🛣️ ${counts.routes} | 📐 ${counts.zones}
              </div>
            </div>
            <button class="delete-user-btn" data-userid="${userId}" data-username="${displayName}" style="
              padding:8px 14px; border-radius:8px;
              background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.5);
              color:#ef4444; font-weight:bold; font-size:0.8rem;
              cursor:pointer; white-space:nowrap;
            ">حذف</button>
          `;
          container.appendChild(row);
        }
        
        // Attach delete handlers
        container.querySelectorAll('.delete-user-btn').forEach(btn => {
          btn.onclick = async () => {
            const targetUserId = btn.dataset.userid;
            const targetName = btn.dataset.username || targetUserId.split('_')[0];
            const sure = confirm(`⚠️ حذف جميع بيانات "${targetName}"?\n\nلا يمكن التراجع!`);
            if (!sure) return;
            
            // Delete all records with this userId from IndexedDB
            const db2 = await getDB();
            const tx = db2.transaction(['pins', 'routes', 'zones', 'folders'], 'readwrite');
            
            for (const store of ['pins', 'routes', 'zones', 'folders']) {
              const s = tx.objectStore(store);
              const all = await s.getAll();
              for (const item of all) {
                if ((item.userId || 'default') === targetUserId) await s.delete(item.id);
              }
            }
            await tx.done;
            
            // Cascade delete: remove from auth users list
            removeUserById(targetUserId);
            
            // Remove the row from UI
            btn.closest('div[style]').remove();
            alert(`✅ تم حذف بيانات "${targetName}"`);
            
            if (container.children.length === 0) {
              container.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.4); padding: 20px;">تم حذف جميع البيانات</p>';
            }
          };
        });
      }
    } catch(e) {
      container.innerHTML = `<p style="text-align:center; color:#ef4444; padding:20px;">خطأ: ${e.message}</p>`;
    }
    
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
      const confirmed = confirm('🔐 هل تريد تشفير جميع البيانات القديمة؟\n\nهذا الإجراء آمن ولا يحذف أي بيانات.');
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
  // Wire Custom PNG Uploader
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
      if (file && typeof currentEditPin !== 'undefined' && currentEditPin && file.type === 'image/svg+xml') {
        const reader = new FileReader();
        reader.onload = (ev) => {
          currentEditPin.customIconData = ev.target.result;
          if (previewImgEl) {
            previewImgEl.src = currentEditPin.customIconData;
            previewImgEl.classList.remove('hidden');
            if (iconSelectEl) iconSelectEl.value = 'custom';
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

// Start app
document.addEventListener('DOMContentLoaded', init);

// ===== AUTH SCREEN LOGIC =====
async function showAuthScreen() {
  const authScreen = document.getElementById('auth-screen');
  const setupForm = document.getElementById('auth-setup');
  const loginForm = document.getElementById('auth-login');
  const userSelect = document.getElementById('auth-user-select');
  
  authScreen.classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  // ALWAYS clear ALL input fields and error messages on auth screen show
  const fieldsToClear = ['login-password', 'setup-name', 'setup-rank', 'setup-password', 'setup-confirm'];
  fieldsToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const errorsToClear = ['login-error', 'setup-error'];
  errorsToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  });

  // Helper to show user select panel
  function showUserSelectPanel() {
    setupForm.classList.add('hidden');
    loginForm.classList.add('hidden');
    userSelect.classList.remove('hidden');
    
    const listEl = document.getElementById('previous-users-list');
    const users = getAllUsers();
    listEl.innerHTML = '';
    
    if (users.length === 0) {
      listEl.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.4); padding:10px;">لا توجد حسابات سابقة</p>';
    } else {
      for (const user of users) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'width:100%; padding:12px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; color:#fff; cursor:pointer; text-align:right; transition:all 0.2s; display:flex; align-items:center; gap:12px;';
        btn.innerHTML = `
          <div style="width:40px; height:40px; border-radius:50%; background:rgba(6,214,160,0.15); border:1px solid rgba(6,214,160,0.3); display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">👤</div>
          <div style="flex:1; text-align:right;">
            <div style="font-weight:bold; font-size:0.95rem;">${user.name}</div>
            <div style="font-size:0.75rem; color:rgba(255,255,255,0.4);">${user.rank || 'مشغل'}</div>
          </div>
        `;
        btn.onclick = () => {
          switchToUser(user);
          showLoginForUser();
        };
        listEl.appendChild(btn);
      }
    }
    
    // Create new user button
    const createBtn = document.getElementById('btn-create-new-user');
    if (createBtn) {
      createBtn.onclick = async () => {
        // Require admin PIN before creating new user
        const pin = prompt('🔑 أدخل رمز المسؤول (4 أرقام):');
        if (!pin) return;
        const valid = await verifyPin(pin);
        if (!valid) {
          alert('❌ رمز خاطئ — تم إلغاء العملية');
          return;
        }
        userSelect.classList.add('hidden');
        setupForm.classList.remove('hidden');
        bindSetupForm(); // Bind the submit handler!
      };
    }
  }
  
  // Reusable setup form submit handler
  function bindSetupForm() {
    setupForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('setup-name').value.trim();
      const rank = document.getElementById('setup-rank').value.trim();
      const pw = document.getElementById('setup-password').value;
      const confirmPw = document.getElementById('setup-confirm').value;
      const errEl = document.getElementById('setup-error');
      
      if (pw !== confirmPw) {
        errEl.textContent = t('passwordMismatch') || 'كلمات المرور غير متطابقة';
        errEl.classList.remove('hidden');
        return;
      }
      if (pw.length < 4) {
        errEl.textContent = t('passwordTooShort') || 'كلمة المرور قصيرة (4 أحرف على الأقل)';
        errEl.classList.remove('hidden');
        return;
      }
      
      try {
        await registerUser(name, rank, pw);
        // Close SQLite before reload so connections can be re-created
        await closeMobileDatabases();
        window.location.reload();
      } catch(regErr) {
        errEl.textContent = '❌ خطأ في التسجيل: ' + regErr.message;
        errEl.classList.remove('hidden');
      }
    };
  }
  
  // Helper to show login form for current user
  function showLoginForUser() {
    setupForm.classList.add('hidden');
    userSelect.classList.add('hidden');
    loginForm.classList.remove('hidden');
    
    const profile = getUserProfile();
    document.getElementById('login-greeting').textContent = 
      (t('welcomeBack') || 'مرحباً') + '، ' + (profile?.name || '');
    document.getElementById('login-rank').textContent = profile?.rank || '';
    
    setTimeout(() => document.getElementById('login-password')?.focus(), 100);
    
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const pw = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      
      try {
        const success = await login(pw);
        if (success) {
          // Close SQLite before reload so connections can be re-created
          await closeMobileDatabases();
          window.location.reload();
        } else {
          errEl.textContent = t('wrongPassword') || 'كلمة المرور خاطئة';
          errEl.classList.remove('hidden');
          document.getElementById('login-password').value = '';
          document.getElementById('login-password').focus();
        }
      } catch (lockErr) {
        if (lockErr.message.startsWith('LOCKED:')) {
          const secs = lockErr.message.split(':')[1];
          errEl.textContent = (t('accountLocked') || 'الحساب مقفل') + ` (${secs}s)`;
          errEl.classList.remove('hidden');
        }
      }
    };
  }

  if (!hasUser()) {
    // Check if there are previous users to show
    const allUsers = getAllUsers();
    if (allUsers.length > 0) {
      // Show user select panel
      showUserSelectPanel();
    } else {
      // FIRST TIME: Show setup form
      setupForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
      if (userSelect) userSelect.classList.add('hidden');
      bindSetupForm(); // Bind submit handler
    }
  } else {
    // RETURNING USER: Show login form
    showLoginForUser();
  }
  
  // === LOGIN SCREEN: Session Logout (switch user) ===
  const loginLogoutBtn = document.getElementById('btn-login-logout');
  if (loginLogoutBtn) {
    loginLogoutBtn.onclick = () => {
      clearActiveUser();
      const allUsers = getAllUsers();
      if (allUsers.length > 0) {
        showUserSelectPanel();
      } else {
        // No previous users — show setup
        loginForm.classList.add('hidden');
        setupForm.classList.remove('hidden');
        if (userSelect) userSelect.classList.add('hidden');
      }
    };
  }
  
  // === LOGIN SCREEN: Delete User (requires admin PIN) ===
  const loginDelBtn = document.getElementById('btn-login-delete-user');
  if (loginDelBtn) {
    loginDelBtn.onclick = async () => {
      const pin = prompt('🔑 أدخل رمز المسؤول (4 أرقام):');
      if (!pin) return;
      const valid = await verifyPin(pin);
      if (!valid) {
        alert('❌ رمز خاطئ — تم إلغاء العملية');
        return;
      }
      
      // Show delete user modal (reuse the one from sidebar)
      const modal = document.getElementById('delete-user-modal');
      const container = document.getElementById('user-list-container');
      if (!modal || !container) return;
      
      try {
        const { getDB } = await import('./db.js');
        const db = await getDB();
        const userMap = new Map();
        
        const allPins = await db.getAll('pins');
        const allRoutes = await db.getAll('routes');
        const allZones = await db.getAll('zones');
        
        for (const item of [...allPins, ...allRoutes, ...allZones]) {
          const uid = item.userId || 'default';
          if (!userMap.has(uid)) userMap.set(uid, { pins: 0, routes: 0, zones: 0 });
          const counts = userMap.get(uid);
          if (allPins.includes(item)) counts.pins++;
          else if (allRoutes.includes(item)) counts.routes++;
          else counts.zones++;
        }
        
        // Also add users from auth list that may not have data yet
        const authUsers = getAllUsers();
        for (const u of authUsers) {
          const uid = u.name + '_' + (u.createdAt || '0');
          if (!userMap.has(uid)) userMap.set(uid, { pins: 0, routes: 0, zones: 0 });
        }
        
        container.innerHTML = '';
        
        if (userMap.size === 0) {
          container.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.4); padding:20px;">لا يوجد بيانات مستخدمين</p>';
        } else {
          for (const [userId, counts] of userMap) {
            const displayName = userId === 'default' ? 'مستخدم قديم (بدون تعريف)' : userId.split('_')[0];
            
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px;';
            row.innerHTML = `
              <div>
                <div style="font-weight:bold; font-size:0.95rem;">👤 ${displayName}</div>
                <div style="font-size:0.75rem; color:rgba(255,255,255,0.4); margin-top:4px;">
                  📌 ${counts.pins} | 🛣️ ${counts.routes} | 📐 ${counts.zones}
                </div>
              </div>
              <button class="delete-user-btn" data-userid="${userId}" data-username="${displayName}" style="
                padding:8px 14px; border-radius:8px;
                background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.5);
                color:#ef4444; font-weight:bold; font-size:0.8rem;
                cursor:pointer; white-space:nowrap;
              ">حذف</button>
            `;
            container.appendChild(row);
          }
          
          container.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.onclick = async () => {
              const targetUserId = btn.dataset.userid;
              const targetName = btn.dataset.username;
              const sure = confirm(`⚠️ حذف جميع بيانات "${targetName}"?\n\nلا يمكن التراجع!`);
              if (!sure) return;
              
              const db2 = await getDB();
              const tx = db2.transaction(['pins', 'routes', 'zones', 'folders'], 'readwrite');
              
              for (const store of ['pins', 'routes', 'zones', 'folders']) {
                const s = tx.objectStore(store);
                const all = await s.getAll();
                for (const item of all) {
                  if ((item.userId || 'default') === targetUserId) await s.delete(item.id);
                }
              }
              await tx.done;
              
              // Cascade delete: remove from auth users list
              removeUserById(targetUserId);
              
              btn.closest('div[style]').remove();
              alert(`✅ تم حذف بيانات "${targetName}"`);
              
              if (container.children.length === 0) {
                container.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.4); padding:20px;">تم حذف جميع البيانات</p>';
              }
            };
          });
        }
      } catch(e) {
        container.innerHTML = `<p style="text-align:center; color:#ef4444; padding:20px;">خطأ: ${e.message}</p>`;
      }
      
      modal.classList.remove('hidden');
    };
  }
  
  // Panic Wipe button (DO NOT MODIFY)
  const panicBtn = document.getElementById('btn-panic-wipe');
  if (panicBtn) {
    panicBtn.addEventListener('click', async () => {
      const confirmed = confirm('⚠️ تحذير: سيتم حذف جميع البيانات نهائياً!\n\nهل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.');
      if (!confirmed) return;
      
      const doubleConfirm = confirm('🗑️ تأكيد نهائي: مسح كل شيء الآن؟');
      if (!doubleConfirm) return;
      
      try {
        const { panicWipe } = await import('./crypto.js');
        await panicWipe();
      } catch (e) {
        // Fallback if import fails
        localStorage.clear();
        sessionStorage.clear();
        indexedDB.deleteDatabase('PinVaultDB');
        window.location.reload();
      }
    });
  }
}

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
      updatePrintFrame(); // Show frame when selector opens
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
    btnConfirm.onclick = () => {
      const size = sizeSelect.value;
      const orient = orientSelect.value;
      
      printBar.classList.add('hidden');
      
      // Set print attributes to body for CSS @page rules
      document.body.setAttribute('data-print-size', size);
      document.body.setAttribute('data-print-orient', orient);
      
      showToast(t('preparingPrint') || 'Preparing map for print...', 'info');
      
      // Fix: clear the old image/state from memory and accurately fetch the newly selected area
      if (typeof map !== 'undefined') {
        const frame = document.getElementById('print-guide-frame');
        const frameRect = frame.getBoundingClientRect();
        const mapRect = document.getElementById('map').getBoundingClientRect();
        
        // Mathematically calculate the LatLng bounds of the user's selected frame
        const nw = map.containerPointToLatLng([frameRect.left - mapRect.left, frameRect.top - mapRect.top]);
        const se = map.containerPointToLatLng([frameRect.right - mapRect.left, frameRect.bottom - mapRect.top]);
        const selectedFrameBounds = L.latLngBounds(nw, se);
        
        // Capture pre-print state for restoration after printing
        const origCenter = map.getCenter();
        const origZoom = map.getZoom();
        const origZoomSnap = map.options.zoomSnap;

        // ============================================================
        // CANVAS COMPOSITING PRINT ENGINE
        // ============================================================
        // Chrome/Electron print engine CANNOT render Leaflet's GPU-composited
        // tile layers (translate3d, will-change:transform). Instead of trying
        // to flatten transforms (which doesn't work), we manually render all
        // visible tiles onto a Canvas, convert to a flat data: URL image,
        // and print THAT. This guarantees tiles appear in the PDF.
        
        showToast(t('preparingPrint') || 'Compositing map for print...', 'info');
        
        // Step 1: Fit map to the user's selected area FIRST so tiles are correct
        map.options.zoomSnap = 0;
        map.invalidateSize();
        map.fitBounds(selectedFrameBounds, { animate: false, padding: [0, 0] });
        
        // Step 2: Wait for Leaflet to settle and tiles to load, then composite
        setTimeout(async () => {
          try {
            const mapEl = document.getElementById('map');
            const mapRect = mapEl.getBoundingClientRect();
            
            // Create high-resolution canvas for print quality
            const dpr = 2; // 2x resolution for crisp print output
            const canvas = document.createElement('canvas');
            canvas.width = mapRect.width * dpr;
            canvas.height = mapRect.height * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            
            // Fill with map background
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, mapRect.width, mapRect.height);
            
            // Draw all loaded tile images at their correct screen positions
            let tilesDrawn = 0;
            const tiles = document.querySelectorAll('.leaflet-tile');
            tiles.forEach(tile => {
              if (tile.complete && tile.naturalWidth > 0) {
                const tileRect = tile.getBoundingClientRect();
                const x = tileRect.left - mapRect.left;
                const y = tileRect.top - mapRect.top;
                
                // Only draw tiles that are within the visible map area
                if (x + tileRect.width > 0 && y + tileRect.height > 0 &&
                    x < mapRect.width && y < mapRect.height) {
                  try {
                    ctx.drawImage(tile, x, y, tileRect.width, tileRect.height);
                    tilesDrawn++;
                  } catch(e) {
                    console.warn('[Print] Tile draw failed:', e);
                  }
                }
              }
            });
            
            // Draw SVG overlay layers (polylines, polygons, circles, KILL BOX GRID LINES)
            const svgOverlay = mapEl.querySelector('.leaflet-overlay-pane svg');
            if (svgOverlay) {
              try {
                const svgRect = svgOverlay.getBoundingClientRect();
                // Clone SVG and inline all computed styles for accurate rendering
                const clonedSvg = svgOverlay.cloneNode(true);
                // Set explicit dimensions on the cloned SVG
                clonedSvg.setAttribute('width', svgRect.width);
                clonedSvg.setAttribute('height', svgRect.height);
                // Inline stroke/fill styles on all paths so they render correctly as image
                clonedSvg.querySelectorAll('path, circle, rect, line, polyline, polygon').forEach(el => {
                  const cs = window.getComputedStyle(el.closest('[class]') || el);
                  // Copy from original element by matching
                  const origEl = svgOverlay.querySelector(`[d="${el.getAttribute('d')}"]`) || el;
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
                
                // SYNCHRONOUS wait for SVG to load before continuing
                await new Promise((resolve, reject) => {
                  const svgImg = new Image();
                  svgImg.onload = () => {
                    ctx.drawImage(svgImg, svgRect.left - mapRect.left, svgRect.top - mapRect.top, svgRect.width, svgRect.height);
                    URL.revokeObjectURL(svgUrl);
                    resolve();
                  };
                  svgImg.onerror = () => {
                    URL.revokeObjectURL(svgUrl);
                    console.warn('[Print] SVG overlay render failed');
                    resolve(); // Continue anyway
                  };
                  svgImg.src = svgUrl;
                });
              } catch(svgErr) {
                console.warn('[Print] SVG overlay capture error:', svgErr);
              }
            }
            
            // Draw marker icons (handles both IMG and DIV markers)
            const markerPane = mapEl.querySelector('.leaflet-marker-pane');
            if (markerPane) {
              const allMarkers = markerPane.querySelectorAll('.leaflet-marker-icon');
              for (const marker of allMarkers) {
                const mRect = marker.getBoundingClientRect();
                const x = mRect.left - mapRect.left;
                const y = mRect.top - mapRect.top;
                
                // Skip markers outside visible area
                if (x + mRect.width < 0 || y + mRect.height < 0 || x > mapRect.width || y > mapRect.height) continue;
                
                // Check if it's an IMG directly
                if (marker.tagName === 'IMG' && marker.complete && marker.naturalWidth > 0) {
                  try { ctx.drawImage(marker, x, y, mRect.width, mRect.height); } catch(e) {}
                } else {
                  // DIV marker (divIcon) — find inner img/svg
                  const innerImg = marker.querySelector('img');
                  const innerSvg = marker.querySelector('svg');
                  
                  if (innerImg && innerImg.complete && innerImg.naturalWidth > 0) {
                    try {
                      const imgRect = innerImg.getBoundingClientRect();
                      ctx.drawImage(innerImg, imgRect.left - mapRect.left, imgRect.top - mapRect.top, imgRect.width, imgRect.height);
                    } catch(e) {}
                  } else if (innerSvg) {
                    try {
                      const svgStr = new XMLSerializer().serializeToString(innerSvg);
                      const svgB = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                      const url = URL.createObjectURL(svgB);
                      await new Promise((resolve) => {
                        const img = new Image();
                        img.onload = () => {
                          const svgR = innerSvg.getBoundingClientRect();
                          ctx.drawImage(img, svgR.left - mapRect.left, svgR.top - mapRect.top, svgR.width, svgR.height);
                          URL.revokeObjectURL(url);
                          resolve();
                        };
                        img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
                        img.src = url;
                      });
                    } catch(e) {}
                  } else {
                    // Fallback: draw colored circle for plain div markers
                    const bgColor = window.getComputedStyle(marker).backgroundColor;
                    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
                      ctx.fillStyle = bgColor;
                      ctx.beginPath();
                      ctx.arc(x + mRect.width/2, y + mRect.height/2, Math.min(mRect.width, mRect.height)/2, 0, Math.PI * 2);
                      ctx.fill();
                    }
                  }
                }
              }
            }
            
            // Draw tooltip labels
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

            // Draw kill box grid labels (divIcons in tooltip pane)
            // NOTE: ctx is already scaled by dpr, so use raw coordinates
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
            
            // Draw scale bar on print canvas (bottom-left)
            const scaleLines = mapEl.querySelectorAll('.leaflet-control-scale-line');
            if (scaleLines.length > 0) {
              const scaleX = 20; // margin from left
              let scaleY = mapRect.height - 25; // margin from bottom
              
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
                  // Metric: bottom border
                  ctx.moveTo(scaleX, scaleY + 4);
                  ctx.lineTo(scaleX + scaleWidth, scaleY + 4);
                  ctx.moveTo(scaleX, scaleY - 2);
                  ctx.lineTo(scaleX, scaleY + 4);
                  ctx.moveTo(scaleX + scaleWidth, scaleY - 2);
                  ctx.lineTo(scaleX + scaleWidth, scaleY + 4);
                } else {
                  // Imperial: top border
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
            
            console.log(`[PinVault Print] Composited ${tilesDrawn} tiles onto canvas (${canvas.width}x${canvas.height})`);
            
            // Step 3: Convert canvas to data URL and create printable image
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            
            // PLATFORM BRANCH: Android saves image, PC opens print dialog
            if (isNativeMobile) {
              // ANDROID MODE: Save composited image to Documents folder
              try {
                const base64Data = dataUrl.split(',')[1];
                const date = new Date().toISOString().replace(/[:.]/g, '-').split('T');
                const filename = `PinVault_Map_${date[0]}_${date[1].substring(0,8)}.jpg`;
                
                await Filesystem.writeFile({
                  path: filename,
                  data: base64Data,
                  directory: Directory.Documents
                });
                
                showToast(`Map saved to Documents/${filename}`, 'success');
                console.log(`[PinVault Print] Android: Saved to Documents/${filename}`);
              } catch (saveErr) {
                console.error('[PinVault Print] Android save failed:', saveErr);
                showToast('Save failed: ' + saveErr.message, 'error');
              }
            } else {
              // PC MODE: Standard print window flow (unchanged)
              const printWindow = window.open('', '_blank', `width=${mapRect.width},height=${mapRect.height}`);
              
              if (printWindow) {
                const pageSize = size === 'a3' ? 'A3' : 'A4';
                const pageOrient = orient === 'portrait' ? 'portrait' : 'landscape';
                
                printWindow.document.write(`
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <title>PinVault Tactical Print</title>
                    <style>
                      @page {
                        size: ${pageSize} ${pageOrient};
                        margin: 0;
                      }
                      * { margin: 0; padding: 0; box-sizing: border-box; }
                      html, body {
                        width: 100%;
                        height: 100%;
                        background: #000;
                        overflow: hidden;
                      }
                      img {
                        display: block;
                        width: 100vw;
                        height: 100vh;
                        object-fit: contain;
                      }
                    </style>
                  </head>
                  <body>
                    <img src="${dataUrl}" />
                  </body>
                  </html>
                `);
                printWindow.document.close();
                
                // Wait for the image to load in the new window, then print
                printWindow.onload = () => {
                  setTimeout(() => {
                    printWindow.print();
                    // Close after print dialog
                    printWindow.onafterprint = () => printWindow.close();
                    // Fallback close after focus return
                    printWindow.addEventListener('focus', () => {
                      setTimeout(() => printWindow.close(), 500);
                    });
                  }, 300);
                };
              } else {
                // Popup blocked fallback: inject overlay directly into main page
                console.warn('[Print] Popup blocked, falling back to inline print');
                
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
                
                // Hide everything else for print
                document.getElementById('app').style.display = 'none';
                
                window.addEventListener('afterprint', function restoreFromInline() {
                  overlay.remove();
                  document.getElementById('app').style.display = '';
                  window.removeEventListener('afterprint', restoreFromInline);
                }, { once: true });
                
                setTimeout(() => window.print(), 200);
              }
            }
            
            // Step 5: Restore map state
            map.options.zoomSnap = origZoomSnap;
            map.invalidateSize();
            map.setView(origCenter, origZoom, { animate: false });
            
            // Clean up UI
            document.body.removeAttribute('data-print-size');
            document.body.removeAttribute('data-print-orient');
            document.getElementById('print-guide-frame').classList.add('hidden');
            mainHeader.classList.remove('hidden-tactical');
            
            // Remove any injected print rectangles
            map.eachLayer((layer) => {
              if (layer instanceof L.Rectangle && layer.options.color === '#ffca28') {
                map.removeLayer(layer);
              }
            });
            
            // Suppress privacy guard during print
            const guard = document.getElementById('privacy-guard');
            if (guard) guard.style.setProperty('display', 'none', 'important');
            setTimeout(() => {
              if (guard) guard.style.removeProperty('display');
            }, 5000);
            
          } catch(e) {
            console.error('[PinVault Print] Canvas compositing failed:', e);
            showToast('Print failed: ' + e.message, 'error');
            
            // Restore state on error
            map.options.zoomSnap = origZoomSnap;
            map.invalidateSize();
            map.setView(origCenter, origZoom, { animate: false });
            document.body.removeAttribute('data-print-size');
            document.body.removeAttribute('data-print-orient');
            document.getElementById('print-guide-frame').classList.add('hidden');
            mainHeader.classList.remove('hidden-tactical');
          }
        }, 500); // Wait 500ms for tiles to settle after fitBounds
        
      } else {
        // Fallback if map isn't defined
        setTimeout(() => {
          window.print();
          document.body.removeAttribute('data-print-size');
          document.body.removeAttribute('data-print-orient');
          document.getElementById('print-guide-frame').classList.add('hidden');
          mainHeader.classList.remove('hidden-tactical');
        }, 500);
      }
    };
  }
}

function updatePrintFrame() {
  const frame = document.getElementById('print-guide-frame');
  const printBar = document.getElementById('print-control-bar');
  const size = document.getElementById('print-size-select').value;
  const orient = document.getElementById('print-orientation-select').value;
  
  // Prevent ghost frame resurrection: If the Print Control Bar is closed/hidden, do absolutely nothing.
  if (!frame || !printBar || printBar.classList.contains('hidden')) return;
  
  frame.classList.remove('hidden');
  
  // A4 ratio is ~1.414 (297/210)
  const ratio = 1.414;
  const isLandscape = orient === 'landscape';
  
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  
  // We want the frame to occupy 85% of the shortest dimension
  const padding = 0.85;
  let frameW, frameH;
  
  if (isLandscape) {
    // Width is long side
    frameW = Math.min(viewportW * padding, viewportH * padding * ratio);
    frameH = frameW / ratio;
  } else {
    // Height is long side (Portrait)
    frameH = Math.min(viewportH * padding, viewportW * padding * ratio);
    frameW = frameH / ratio;
  }
  
  frame.style.width = `${Math.round(frameW)}px`;
  frame.style.height = `${Math.round(frameH)}px`;
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
