/**
 * feature-modal.js — Feature Detail Modal & Download Modal
 * Extracted from main.js
 * 
 * Handles:
 *  - Pin/Route/Zone detail modal (open, save, delete, close)
 *  - Custom icon picker setup
 *  - Download area modal (estimate, progress, start)
 *  - City search for download bounds
 * 
 * Uses getter/setter for currentEditPin to decouple from main.js global state.
 */

import { updateFeature, hardRemoveFeature, renderIconPicker, getCustomTacticalIcons, openLibraryModal } from './features.js';
import { savePin, generateId, getAllFolders } from './db.js';
import { setCurrentPin, renderVideoList } from './video.js';
import { confirmAction } from './utils.js';
import { estimateTiles, downloadArea } from './downloader.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

// ===== STATE: currentEditPin with getter/setter =====
let _currentEditPin = null;

export function getCurrentEditPin() {
  return _currentEditPin;
}

export function setCurrentEditPin(pin) {
  _currentEditPin = pin;
}

// ===== ICON PICKER SETUP =====

export function setupIconPicker() {
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

// ===== FEATURE DETAIL MODAL =====

export async function openFeatureModal(feature) {
  _currentEditPin = feature;
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
      import('./features.js').then(m => {
        const lib = m.getCustomTacticalIcons();
        const iconRec = lib.find(i => i.id === iconVal);
        if (iconRec) {
          selectedLabel.textContent = iconRec.name;
        } else {
          const names = { 'default': 'Operational Pin', 'crosshair': 'Target / Objective', 'warning': 'Danger / Warning', 'platoon': 'Platoon (Special Ops)', 'sniper': 'Sniper Team', 'rpg': 'RPG Team', 'konkurs': 'Konkurs ATGM', 'kornet': 'Kornet ATGM', 'su23': 'SU-23 AA Gun', 'fpv_operator': 'FPV Unit (Suicide Drone)' };
          selectedLabel.textContent = names[iconVal] || 'Operational Pin';
        }
        selectedIcon.innerHTML = m.getFeatureIconHtml(iconVal, '#fff', null);
      });
    }
  }

  if (colorSel) colorSel.value = feature.color || '#ff0000';

  // Populate folder dropdown from DB
  if (folderSel) {
    folderSel.innerHTML = '<option value="root">-- Root --</option>';
    try {
      const folders = await getAllFolders();
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        if (feature.folderId === folder.id) {
          option.selected = true;
        }
        folderSel.appendChild(option);
      });
    } catch (e) {
      console.warn('[FeatureModal] Failed to load folders:', e);
    }
    // Fallback: ensure correct value if pre-select didn't match
    folderSel.value = feature.folderId || 'root';
  }
  
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

export function closePinModal() {
  const modal = document.getElementById('pin-modal');
  modal.classList.add('hidden');
  _currentEditPin = null;
  setCurrentPin(null);
}

export async function savePinFromModal() {
  if (!_currentEditPin) return;

  _currentEditPin.name = document.getElementById('pin-name').value.trim() || 'Unnamed';
  _currentEditPin.description = document.getElementById('pin-description').value.trim();
  const iconSel = document.getElementById('feature-icon');
  const colorSel = document.getElementById('feature-color');
  const folderSel = document.getElementById('feature-folder');
  const weightInp = document.getElementById('feature-weight');
  
  if (_currentEditPin.lat) {
    if (iconSel) {
      const val = iconSel.value;
      if (val !== 'custom') {
        _currentEditPin.type = val;
        _currentEditPin.customIconData = null;
      }
    }
  } else if (weightInp) {
    _currentEditPin.weight = parseInt(weightInp.value) || 4;
  }

  if (colorSel) _currentEditPin.color = colorSel.value;
  if (folderSel) _currentEditPin.folderId = folderSel.value;

  await updateFeature(_currentEditPin);
  showToast(t('pinSaved'), 'success');
  closePinModal();
}

export async function deletePinFromModal() {
  if (!_currentEditPin) return;

  confirmAction(t('confirmDelete') || 'Delete Feature', 'Are you sure you want to delete this feature?', async () => {
    try {
      await hardRemoveFeature(_currentEditPin);
      showToast(t('pinDeleted') || 'Feature deleted', 'warning');
      closePinModal();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Delete failed', 'error');
    }
  });
}

// ===== DOWNLOAD AREA MODAL =====

let downloadBoundsStr = null;

/**
 * @param {L.LatLngBounds} bounds
 */
export function openDownloadModal(bounds) {
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

export function closeDownloadModal() {
  document.getElementById('download-map-modal').classList.add('hidden');
  // Note: currentSelectionRect cleanup handled by main.js caller
}

export function updateDownloadEstimate() {
  if (!downloadBoundsStr) return;
  const maxZ = parseInt(document.getElementById('zoom-depth-slider').value);
  const downloadAll = document.getElementById('download-all-zooms').checked;
  const minZ = downloadAll ? 5 : maxZ;
  
  document.getElementById('zoom-depth-value').textContent = maxZ;
  
  const count = estimateTiles(downloadBoundsStr, minZ, maxZ);
  document.getElementById('estimated-tiles-count').textContent = count.toLocaleString();
}

export async function startDownload() {
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
