/**
 * features.js — Geoman Drawing Engine, Marker customization, Routes, Zones, Folders
 */
import L from 'leaflet';
import { Capacitor } from '@capacitor/core';
import {
  getAllPins, savePin, deletePin,
  getAllRoutes, saveRoute, deleteRoute,
  getAllZones, saveZone, deleteZone,
  getAllFolders, saveFolder, deleteFolder, cascadeBatchDelete,
  getAllTacticalIcons, saveTacticalIcon, deleteTacticalIcon,
  getVideosByPin, generateId
} from './db.js';

const isNativeMobile = Capacitor.isNativePlatform();
import { showToast } from './toast.js';
import { t } from './i18n.js';
import { confirmAction } from './utils.js';

let map;
let onFeatureSelect;
let layerMap = {}; // Maps layer ID -> DB object 

// Cached State
let pins = [];
let routes = [];
let zones = [];
let folders = [];
export let folderLayerGroups = {};
let customTacticalIcons = [];

// Helper to bypass window.prompt with L.popup (Electron-safe)
function showFolderPrompt(callback, parentId = 'root', parentName = '') {
  const popupContent = document.createElement('div');
  popupContent.style.padding = '5px';
  const title = parentId === 'root' ? (t('newFolder') || 'New Folder') : `New Subfolder in ${parentName}`;
  popupContent.innerHTML = `
    <div style="margin-bottom: 8px; font-weight: bold; color: var(--text-primary);">${title}</div>
    <input type="text" id="folder-name-input" style="width: 100%; margin-bottom: 8px; padding: 6px; background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;" autofocus />
    <div style="display: flex; gap: 8px;">
      <button id="btn-folder-save" class="btn btn-primary" style="flex: 1; padding: 6px; font-size: 0.8rem;">${t('save') || 'Save'}</button>
      <button id="btn-folder-cancel" class="btn btn-secondary" style="flex: 1; padding: 6px; font-size: 0.8rem;">${t('cancel') || 'Cancel'}</button>
    </div>
  `;

  const popup = L.popup()
    .setLatLng(map.getCenter())
    .setContent(popupContent)
    .openOn(map);

  setTimeout(() => {
    const input = document.getElementById('folder-name-input');
    if (input) {
      input.focus();
      input.onkeydown = (ev) => {
        if (ev.key === 'Enter') document.getElementById('btn-folder-save').click();
        if (ev.key === 'Escape') document.getElementById('btn-folder-cancel').click();
      };
    }
  }, 100);

  popupContent.querySelector('#btn-folder-save').onclick = () => {
    const name = popupContent.querySelector('#folder-name-input').value.trim();
    if (name) callback(name, parentId);
    map.closePopup();
  };

  popupContent.querySelector('#btn-folder-cancel').onclick = () => map.closePopup();
}

const DEFAULT_COLOR = '#ff0000';

export function getFeatureIconSvg(type) {
  switch (type) {
    case 'crosshair': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2"/></svg>`;
    case 'warning': return `<svg viewBox="0 0 24 24" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="2"><path d="M12 2L2 22h20L12 2z"/><line x1="12" y1="9" x2="12" y2="15"/><circle cx="12" cy="18" r="1" fill="currentColor"/></svg>`;
    case 'custom': return '';
    case 'default':
    default: return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="white" stroke-width="0.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`;
  }
}

export function getTacticalVector(type) {
  // Hardcoded tactical vectors removed. All specialized units now managed via Tactical Library.
  return null;
}

export function getFeatureIconHtml(type, color, customIconData) {
  let inner = '';
  const vector = getTacticalVector(type);
  
  // Tactical Hardcoded Assets (BURNED IN)
  const TACTICAL_ASSETS = {
    'platoon': 'assets/icons/platoon.png',
    'sniper': 'assets/icons/sniper.png',
    'rpg': 'assets/icons/rpg.png',
    'konkurs': 'assets/icons/konkurs.png',
    'kornet': 'assets/icons/kornet.png',
    'su23': 'assets/icons/su23.png',
    'fpv_operator': 'assets/icons/fpv_operator.png'
  };

  if (type === 'custom' && customIconData) {
    if (customIconData.startsWith('data:image/svg+xml') || customIconData.includes('<svg')) {
      // Use CSS Masking to make custom SVGs colorable if they are silhouettes
      inner = `<div style="width:100%; height:100%; background-color:${color || DEFAULT_COLOR}; -webkit-mask-image: url('${customIconData}'); mask-image: url('${customIconData}'); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center;"></div>`;
    } else {
      inner = `<img src="${customIconData}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />`;
    }
  } else if (TACTICAL_ASSETS[type]) {
    // Priority 1: Burned-in Tactical Assets
    const path = TACTICAL_ASSETS[type];
    inner = `<img src="${path}" style="width:100%; height:100%; object-fit:contain; filter:drop-shadow(0px 2px 2px rgba(0,0,0,0.8));" />`;
  } else if (customTacticalIcons.find(i => i.id === type)) {
    // Priority 2: User-added Tactical Library
    const iconRec = customTacticalIcons.find(i => i.id === type);
    if (iconRec.data.startsWith('data:image/svg+xml') || iconRec.data.includes('<svg')) {
      inner = `<div style="width:100%; height:100%; background-color:${color || DEFAULT_COLOR}; -webkit-mask-image: url('${iconRec.data}'); mask-image: url('${iconRec.data}'); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center;"></div>`;
    } else {
      inner = `<img src="${iconRec.data}" style="width:100%; height:100%; object-fit:contain;" />`;
    }
  } else if (vector) {
    inner = `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:${color || DEFAULT_COLOR}">${vector}</div>`;
  } else {
    inner = getFeatureIconSvg(type);
  }

  return `<div class="tactical-glow" style="color:${color || DEFAULT_COLOR}; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">${inner}</div>`;
}

function buildCustomIcon(type, color, hasVideo, customIconData) {
  const html = getFeatureIconHtml(type, color, customIconData);
  const videoInd = hasVideo ? `<div style="position:absolute; bottom:-2px; right:-2px; background:#06d6a0; border-radius:50%; width:14px; height:14px; border:2px solid #000; z-index:10;"></div>` : '';
  
  return L.divIcon({
    className: 'custom-feature-marker',
    html: `<div style="width:48px; height:48px; position:relative;">${html}${videoInd}</div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 48],
    popupAnchor: [0, -48]
  });
}

export function initFeatures(mapInstance, selectCallback) {
  map = mapInstance;
  onFeatureSelect = selectCallback;
  
  // Root Folder Initialization: Safely initialize without destroying existing layers (Electron-Safe)
  if (!window.folderLayerGroups) window.folderLayerGroups = {};
  if (!window.folderLayerGroups['root']) {
    window.folderLayerGroups['root'] = L.layerGroup().addTo(map);
  }
  folderLayerGroups = window.folderLayerGroups;

  // Geoman UI Options
  map.pm.addControls({
    position: 'topleft',
    drawMarker: false, drawPolyline: false, drawPolygon: false,
    drawCircle: false, drawCircleMarker: false, drawRectangle: false, drawText: false, cutPolygon: false,
    editMode: true, dragMode: true, removalMode: true
  });
  
  // Custom Path Styling default
  map.pm.setGlobalOptions({
    pathOptions: { color: DEFAULT_COLOR, weight: 4 },
    markerStyle: { icon: buildCustomIcon('default', DEFAULT_COLOR, false) },
    continueDrawing: false
  });

  const banner = document.getElementById('pin-mode-banner');
  
  map.on('pm:drawstart', () => { if (banner) banner.classList.remove('hidden'); });
  map.on('pm:drawend', () => { if (banner) banner.classList.add('hidden'); });
  
  document.getElementById('btn-new-folder').addEventListener('click', () => {
    showFolderPrompt(createFolder);
  });

  // Wire Map Creation
  map.on('pm:create', async (e) => {
    const layer = e.layer;
    const shape = e.shape; // 'Marker', 'Line', 'Polygon'
    
    // Bind edit events onto this new layer
    layer.on('pm:edit', () => saveLayerGeometry(layer));
    layer.on('pm:dragend', () => saveLayerGeometry(layer));

    let record = { id: generateId(), name: '', description: '', folderId: 'root', createdAt: Date.now() };

    if (shape === 'Marker') {
      record = { ...record, collType: 'pins', lat: layer.getLatLng().lat, lng: layer.getLatLng().lng, type: 'default', color: DEFAULT_COLOR };
      await savePin(record);
      pins.push(record);
    } else if (shape === 'Line') {
      record = { ...record, collType: 'routes', latlngs: layer.getLatLngs(), color: DEFAULT_COLOR };
      await saveRoute(record);
      routes.push(record);
      layer.setStyle({ color: DEFAULT_COLOR });
    } else if (shape === 'Polygon') {
      record = { ...record, collType: 'zones', latlngs: layer.getLatLngs(), color: DEFAULT_COLOR };
      await saveZone(record);
      zones.push(record);
      layer.setStyle({ color: DEFAULT_COLOR, fillColor: DEFAULT_COLOR });
    }
    
    layerMap[L.stamp(layer)] = record;
    bindPopup(layer, record);
    renderSidebar();
    showToast(`Created ${shape}`, 'success');
  });

  // Wire Deletions via UI
  map.on('pm:remove', async (e) => {
    const rec = layerMap[L.stamp(e.layer)];
    if (rec) await hardRemoveFeature(rec);
  });
}

export async function loadAllFeatures() {
  pins = await getAllPins() || [];
  routes = await getAllRoutes() || [];
  zones = await getAllZones() || [];
  folders = await getAllFolders() || [];
  customTacticalIcons = await getAllTacticalIcons() || [];
  
  // Plot everything
  [...pins, ...routes, ...zones].forEach(plotRecord);
  renderSidebar();
  populateIconDropdowns();
}

async function plotRecord(rec) {
  const color = rec.color || DEFAULT_COLOR;
  const weight = rec.weight || (rec.collType === 'routes' ? 4 : 2);
  let layer;

  if (rec.type === 'text') {
      layer = L.marker([rec.lat, rec.lng], {
          icon: L.divIcon({ className: 'tactical-invisible-marker', iconSize: [0, 0] })
      });
      // Standalone text doesn't need to be wrapped in an extra name because the label IS the name
  } else if (rec.collType === 'pins' || (rec.lat && !rec.radius && rec.type !== 'text')) {
      const vids = await getVideosByPin(rec.id);
      layer = L.marker([rec.lat, rec.lng], { 
          icon: buildCustomIcon(rec.type || 'default', color, vids.length > 0, rec.customIconData) 
      });
  } else if (rec.collType === 'routes' || rec.type === 'polyline') {
      layer = L.polyline(rec.latlngs, { color, weight });
  } else if (rec.collType === 'zones' || rec.radius || rec.type === 'circle' || rec.type === 'polygon') {
      if (rec.type === 'circle' || rec.radius) {
          layer = L.circle([rec.lat, rec.lng], { 
              radius: rec.radius, color, fillColor: color, fillOpacity: 0.2, weight 
          });
      } else {
          layer = L.polygon(rec.latlngs, { color, fillColor: color, weight });
      }
  }

  if (layer && rec.name) {
      let labelText = rec.name;
      if (rec.radius) labelText += ` (${Math.round(rec.radius)}m)`;
      
      const tooltipDirection = (rec.collType === 'zones' || rec.radius || rec.type === 'text') ? 'center' : 'top';
      // Offset above anchor so the label floats clearly above the icon, centered
      const tooltipOffset = (tooltipDirection === 'top') ? [0, -20] : [0, 0];
      
      layer.bindTooltip(labelText, {
          permanent: true,
          direction: tooltipDirection,
          className: 'tactical-persistent-label',
          offset: tooltipOffset
      });
  }

  if (layer) {
    const pId = rec.folderId || 'root';
    if (!folderLayerGroups[pId]) {
      folderLayerGroups[pId] = L.layerGroup();
    }
    folderLayerGroups[pId].addLayer(layer);

    if (getComputedVisibility(pId)) {
      if (!map.hasLayer(folderLayerGroups[pId])) {
        folderLayerGroups[pId].addTo(map);
      }
    }

    layerMap[L.stamp(layer)] = rec;
    bindPopup(layer, rec);
    layer.on('pm:edit', () => saveLayerGeometry(layer));
    layer.on('pm:dragend', () => saveLayerGeometry(layer));
  }
}

function bindPopup(layer, rec) {
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="font-weight:bold; margin-bottom: 5px;">${rec.name || t('unnamedPin') || 'Unnamed Feature'}</div>
    <div style="display:flex; gap: 5px;">
      <button class="btn btn-primary" style="padding: 2px 6px; font-size: 0.7rem;" data-action="edit">${t('editPin') || 'Edit'}</button>
      <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 0.7rem;" data-action="delete">${t('delete') || 'Delete'}</button>
    </div>
  `;
  content.querySelector('[data-action="edit"]').onclick = () => { layer.closePopup(); onFeatureSelect(rec); };
  content.querySelector('[data-action="delete"]').onclick = () => { layer.closePopup(); map.removeLayer(layer); hardRemoveFeature(rec); };
  layer.bindPopup(content);
}

async function saveLayerGeometry(layer) {
  const rec = layerMap[L.stamp(layer)];
  if (!rec) return;

  if (layer instanceof L.Marker) {
      rec.collType = 'pins';
      rec.lat = layer.getLatLng().lat;
      rec.lng = layer.getLatLng().lng;
      await savePin(rec);
  } else if (layer instanceof L.Circle) {
      rec.collType = 'zones';
      rec.type = 'circle';
      rec.lat = layer.getLatLng().lat;
      rec.lng = layer.getLatLng().lng;
      rec.radius = layer.getRadius();
      await saveZone(rec);
  } else if (layer instanceof L.Polygon) {
      rec.collType = 'zones';
      rec.type = 'polygon';
      rec.latlngs = layer.getLatLngs();
      await saveZone(rec);
  } else if (layer instanceof L.Polyline) {
      rec.collType = 'routes';
      rec.type = 'polyline';
      rec.latlngs = layer.getLatLngs();
      await saveRoute(rec);
  }
}


export async function updateFeature(rec) {
  rec.updatedAt = Date.now();
  if (rec.collType === 'zones') { 
    await saveZone(rec); 
    const idx = zones.findIndex(p=>p.id===rec.id); 
    if(idx>=0) zones[idx]=rec;
    else zones.push(rec);
  } else if (rec.collType === 'routes') { 
    await saveRoute(rec); 
    const idx = routes.findIndex(p=>p.id===rec.id); 
    if(idx>=0) routes[idx]=rec;
    else routes.push(rec);
  } else if (rec.collType === 'pins' || rec.lat) { 
    rec.collType = 'pins'; 
    await savePin(rec); 
    const idx = pins.findIndex(p=>p.id===rec.id); 
    if(idx>=0) pins[idx]=rec;
    else pins.push(rec);
  }
  
  // Soft reload visual layer
  for (const id in layerMap) {
    if (layerMap[id].id === rec.id) {
      const layer = map._layers[id];
      if (layer) {
        const pId = layerMap[id].folderId || 'root';
        if (folderLayerGroups[pId] && folderLayerGroups[pId].hasLayer(layer)) {
            folderLayerGroups[pId].removeLayer(layer);
        }
        layer.remove(); // Unmount from Leaflet native hierarchy core completely
        delete layerMap[id]; 
      }
    }
  }
  await plotRecord(rec);
  renderSidebar();
}

export async function refreshFeatureMarker(id) {
  const rec = pins.find(p => p.id === id) || routes.find(p => p.id === id) || zones.find(p => p.id === id);
  if (rec) await updateFeature(rec);
}

// ===== FOLDERS & SIDEBAR ===== //

export function getComputedVisibility(folderId, hash = null) {
  if (folderId === 'root' || !folderId) return true;
  let f = hash ? hash[folderId] : folders.find(x => x.id === folderId);
  if (!f) return true;
  if (f.isVisible === false) return false;
  return getComputedVisibility(f.parentId, hash);
}

export function syncFolderVisibilities() {
  if (!map.hasLayer(folderLayerGroups['root'])) folderLayerGroups['root'].addTo(map);
  const hash = {};
  for(let i=0; i<folders.length; i++) hash[folders[i].id] = folders[i];
  
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i];
    const lg = folderLayerGroups[f.id];
    if (!lg) continue;
    const isVis = getComputedVisibility(f.id, hash);
    if (isVis && !map.hasLayer(lg)) lg.addTo(map);
    else if (!isVis && map.hasLayer(lg)) map.removeLayer(lg);
  }
}

function assignOrphanToRoot(items) {
  items.forEach(item => {
    if (item.folderId && String(item.folderId) !== 'root') {
      const exists = folders.some(f => String(f.id) === String(item.folderId));
      if (!exists) {
        item.folderId = 'root';
        updateFeature(item);
      }
    }
  });
}

async function createFolder(name, parentId = 'root') {
  if (!name) return;
  try {
    const id = generateId();
    const f = { id, name, parentId, isVisible: true };
    
    // Physical state initialization as requested (Surgical Strike)
    if (!window.folderLayerGroups) window.folderLayerGroups = {};
    if (!window.folderLayerGroups[id]) {
        window.folderLayerGroups[id] = L.layerGroup();
        // Add to map immediately if root or parent visible
        if (parentId === 'root') window.folderLayerGroups[id].addTo(map);
    }
    
    // Sync local reference
    folderLayerGroups = window.folderLayerGroups;

    folders.push(f);
    await saveFolder(f);
    renderSidebar();
    populateFolderDropdowns();
  } catch (err) {
    console.error("FATAL: Folder creation failed:", err);
    showToast("Folder creation failed", "error");
  }
}

async function promptDeleteFolder(folderId) {
  const childFolders = folders.filter(f => f.parentId === folderId);
  const childItems = [...pins, ...routes, ...zones].filter(f => f.folderId === folderId);
  
  let totalItems = childItems.length;
  let totalFolders = childFolders.length;

  const fIdsToKill = [folderId];
  const pIdsToKill = childItems.filter(i => i.collType === 'pins' || (i.lat && !i.radius)).map(i=>i.id);
  const rIdsToKill = childItems.filter(i => i.collType === 'routes').map(i=>i.id);
  const zIdsToKill = childItems.filter(i => i.collType === 'zones').map(i=>i.id);

  function countCascades(fId) {
      fIdsToKill.push(fId);
      const subF = folders.filter(f => f.parentId === fId);
      totalFolders += subF.length;
      
      const subItems = [...pins, ...routes, ...zones].filter(f => f.folderId === fId);
      totalItems += subItems.length;
      
      subItems.forEach(i => {
          if (i.collType === 'pins' || (i.lat && !i.radius)) pIdsToKill.push(i.id);
          else if (i.collType === 'routes') rIdsToKill.push(i.id);
          else if (i.collType === 'zones') zIdsToKill.push(i.id);
      });

      subF.forEach(s => countCascades(s.id));
  }
  childFolders.forEach(c => countCascades(c.id));

  if (totalItems > 0 || totalFolders > 0) {
      if (!confirm(`Warning: Deleting this folder will definitively purge ${totalItems} operational markers and ${totalFolders} sub-folders permanently via BATCH DELETE. Proceed?`)) return;
  }

  // 1. Remove from Map RAM locally first to prevent ghost leaks
  for (const id in layerMap) {
      const rec = layerMap[id];
      if (rec && fIdsToKill.includes(rec.folderId || 'root')) {
         const layer = map._layers[id];
         if (layer) {
            const pId = rec.folderId;
            if (folderLayerGroups[pId] && folderLayerGroups[pId].hasLayer(layer)) {
                folderLayerGroups[pId].removeLayer(layer);
            }
            layer.remove();
         }
         delete layerMap[id];
      }
  }

  // 2. Erase LayerGroups entirely
  fIdsToKill.forEach(fid => {
      if (folderLayerGroups[fid]) {
          map.removeLayer(folderLayerGroups[fid]);
          delete folderLayerGroups[fid];
      }
  });

  // 3. Batch IndexedDB Transaction
  await cascadeBatchDelete(fIdsToKill, pIdsToKill, rIdsToKill, zIdsToKill);

  // 4. Clean active cache arrays
  folders = folders.filter(f => !fIdsToKill.includes(f.id));
  pins = pins.filter(p => !pIdsToKill.includes(p.id));
  routes = routes.filter(r => !rIdsToKill.includes(r.id));
  zones = zones.filter(z => !zIdsToKill.includes(z.id));

  renderSidebar();
  populateFolderDropdowns();
}

export function populateFolderDropdowns() {
  const sel = document.getElementById('feature-folder');
  if(!sel) return;
  sel.innerHTML = '<option value="root">-- Root --</option>';
  
  function recurseDropdown(parentId, prefix) {
    const children = folders.filter(f => f.parentId === parentId);
    children.forEach(f => {
      sel.innerHTML += `<option value="${f.id}">${prefix}${f.name}</option>`;
      recurseDropdown(f.id, prefix + '--');
    });
  }
  recurseDropdown('root', '');
  folders.filter(f => !f.parentId).forEach(f => {
    sel.innerHTML += `<option value="${f.id}">${f.name}</option>`;
    recurseDropdown(f.id, '--');
  });
}

export async function renderSidebar(filter = '') {


  assignOrphanToRoot([...pins, ...routes, ...zones]);
  syncFolderVisibilities();

  const listEl = document.getElementById('pin-list');
  if (!listEl) {
      console.error("FATAL: #pin-list container not found in DOM!");
      return;
  }

  const allElements = [...pins, ...routes, ...zones];
  const filtered = filter ? allElements.filter(e => (e.name||'').toLowerCase().includes(filter.toLowerCase())) : allElements;
  

  
  const frag = document.createDocumentFragment();
  await appendFolderNode(frag, 'root', filtered, 0, filter);
  
  const emptyState = document.getElementById('pin-list-empty');
  if (emptyState && emptyState.parentNode) {
      emptyState.parentNode.removeChild(emptyState);
  }

  listEl.innerHTML = '';
  listEl.appendChild(frag);

  // Forced Render Strategy: Always log and never hide if broken temporarily
  if (emptyState) {
      // Temporarily bypassed the length guard as requested
      emptyState.style.display = allElements.length === 0 ? 'flex' : 'none';
      listEl.appendChild(emptyState);
  }

  populateFolderDropdowns();

}

async function appendFolderNode(container, folderId, allElements, depth, filter) {
  const items = allElements.filter(f => String(f.folderId || 'root') === String(folderId));
  
  let childFolders;
  if (folderId === 'root') {
      childFolders = folders.filter(f => !f.parentId || f.parentId === 'root');
  } else {
      childFolders = folders.filter(f => f.parentId === folderId);
  }

  if (folderId !== 'root') {
    const folderData = folders.find(f => f.id === folderId);
    if (!folderData) return;

    const div = document.createElement('div');
    div.style.marginBottom = '5px';
    div.style.background = 'rgba(0,0,0,0.1)';
    div.style.borderRadius = '5px';
    div.style.overflow = 'hidden';
    div.style.marginLeft = `${depth * 15}px`;

    const header = document.createElement('div');
    header.style.padding = '8px 10px';
    header.style.fontWeight = 'bold';
    header.style.background = 'rgba(255,255,255,0.05)';
    header.style.display = 'flex';
    header.style.alignItems = 'center';

    const visibilityCheckbox = document.createElement('input');
    visibilityCheckbox.type = 'checkbox';
    visibilityCheckbox.checked = folderData.isVisible !== false;
    visibilityCheckbox.style.marginRight = '8px';
    visibilityCheckbox.onclick = async (e) => {
      e.stopPropagation();
      folderData.isVisible = e.target.checked;
      await saveFolder(folderData);
      syncFolderVisibilities();
    };

    const flexTitle = document.createElement('div');
    flexTitle.style.flex = '1';
    flexTitle.style.cursor = 'pointer';
    flexTitle.style.display = 'flex';
    flexTitle.style.justifyContent = 'space-between';
    flexTitle.innerHTML = `<span>📁 ${folderData.name}</span> <span style="font-size:0.8em; opacity:0.7;">${items.length}</span>`;

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '5px';
    controls.style.marginLeft = '8px';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-secondary';
    addBtn.style.padding = '2px 6px';
    addBtn.style.fontSize = '0.7rem';
    addBtn.innerHTML = '+';
    addBtn.onclick = (e) => {
      e.stopPropagation();
      showFolderPrompt(createFolder, folderData.id, folderData.name);
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-secondary';
    delBtn.style.padding = '2px 6px';
    delBtn.style.fontSize = '0.7rem';
    delBtn.innerHTML = 'Del';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      promptDeleteFolder(folderData.id);
    };

    controls.appendChild(addBtn);
    controls.appendChild(delBtn);

    header.appendChild(visibilityCheckbox);
    header.appendChild(flexTitle);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.style.display = filter ? 'block' : 'none';
    body.style.padding = '5px 8px';

    flexTitle.onclick = () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; };

    await renderItemsToBody(items, body);
    
    div.appendChild(header);
    div.appendChild(body);
    container.appendChild(div);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    for (const childF of childFolders) {
        await appendFolderNode(childrenContainer, childF.id, allElements, depth + 1, filter);
    }
    body.appendChild(childrenContainer);

  } else {
    await renderItemsToBody(items, container);
    for (const childF of childFolders) {
        await appendFolderNode(container, childF.id, allElements, 0, filter);
    }
  }
}

async function renderItemsToBody(items, container) {
  const DEFAULT_COLOR = '#ff0000';
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'pin-card';
    el.style.background = 'rgba(255,255,255,0.02)';
    const color = item.color || DEFAULT_COLOR;
    let ic = '';

    if (item.collType === 'pins' || (item.lat && !item.radius)) {
        ic = getFeatureIconHtml(item.type, color, item.customIconData);
    } else if (item.collType === 'routes' || item.type === 'polyline') {
        ic = `<svg viewBox="0 0 24 24" stroke="${color}" fill="none" stroke-width="2" style="width:100%; height:100%;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    } else if (item.collType === 'zones' || item.radius || item.type === 'circle' || item.type === 'polygon') {
        if (item.type === 'circle' || item.radius) {
            ic = `<svg viewBox="0 0 24 24" stroke="${color}" fill="none" stroke-width="2" style="width:100%; height:100%;"><circle cx="12" cy="12" r="9"/></svg>`;
        } else {
            ic = `<svg viewBox="0 0 24 24" stroke="${color}" fill="none" stroke-width="2" style="width:100%; height:100%;"><path d="M12 2l8 6v8l-8 6-8-6V8l8-6z"/></svg>`;
        }
    }
    
    let vidIndicator = '';
    const videos = await getVideosByPin(item.id);
    if (videos && videos.length > 0) {
      vidIndicator = `<div class="pin-card-video-icon" title="Videos" style="margin-left:auto; display:flex; align-items:center; color:#06d6a0;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></div>`;
    }
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'pin-card-info';
    infoDiv.style.display = 'flex';
    infoDiv.style.width = '100%';
    infoDiv.style.alignItems = 'center';
    infoDiv.style.justifyContent = 'space-between';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'pin-card-name';
    nameDiv.textContent = item.name || 'Unnamed';
    
    const rightControls = document.createElement('div');
    rightControls.style.display = 'flex';
    rightControls.style.alignItems = 'center';
    rightControls.style.gap = '8px';
    
    if (vidIndicator) {
      const vidSpan = document.createElement('span');
      vidSpan.innerHTML = vidIndicator;
      rightControls.appendChild(vidSpan);
    }
    
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-secondary';
    delBtn.style.padding = '2px 6px';
    delBtn.style.fontSize = '0.7rem';
    delBtn.style.background = 'rgba(255, 0, 0, 0.1)';
    delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    delBtn.title = 'Delete';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      
      // Use the custom non-blocking confirm dialog to prevent window blur
      const isConfirmed = await window.showConfirmDialog(`Permanently delete "${item.name || 'this item'}"?`);

      if (isConfirmed) {
        // Find and remove map layer first
        for (const id in layerMap) {
          if (layerMap[id].id === item.id) {
            const l = map._layers[id];
            if (l) map.removeLayer(l);
            break;
          }
        }
        await hardRemoveFeature(item);
        showToast(t('itemDeleted') || 'Item deleted successfully', 'success');
      }
    };
    rightControls.appendChild(delBtn);

    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(rightControls);
    
    el.innerHTML = `<div class="pin-card-icon" style="width:24px; height:24px; flex-shrink:0;">${ic}</div>`;
    el.appendChild(infoDiv);
    
    el.onclick = () => {
      for (const id in layerMap) {
        if (layerMap[id].id === item.id) {
          const l = map._layers[id];
          if(l) {
            if(l.getBounds) map.fitBounds(l.getBounds());
            else map.flyTo(l.getLatLng(), 15);
            l.openPopup();
          }
        }
      }
    };
    container.appendChild(el);
  }
}

export function setupSearchFeatures() {
  document.getElementById('search-pins').addEventListener('input', (e) => renderSidebar(e.target.value.trim()));
}

const ICON_METADATA = [
  { id: 'platoon', name: 'Platoon (Special Ops)', emoji: '🪖', group: 'Primary' },
  { id: 'sniper', name: 'Sniper Team', emoji: '🎯', group: 'Primary' },
  { id: 'rpg', name: 'RPG Team', emoji: '🚀', group: 'Primary' },
  { id: 'konkurs', name: 'Konkurs ATGM', emoji: '🛡️', group: 'Primary' },
  { id: 'kornet', name: 'Kornet ATGM', emoji: '🔱', group: 'Primary' },
  { id: 'su23', name: 'SU-23 AA Gun', emoji: '🚜', group: 'Primary' },
  { id: 'fpv_operator', name: 'FPV Unit (Suicide Drone)', emoji: '💥', group: 'Primary' },
  { id: 'default', name: 'Operational Pin', emoji: '📍', group: 'Status' },
  { id: 'crosshair', name: 'Target / Objective', emoji: '🎯', group: 'Status' },
  { id: 'warning', name: 'Danger / Warning', emoji: '⚠️', group: 'Status' },
  { id: 'custom', name: 'Custom PNG...', emoji: '📷', group: 'Custom' }
];

export function renderIconPicker(filter = '') {
  const listEl = document.getElementById('icon-picker-list');
  if (!listEl) return;
  
  const currentVal = document.getElementById('feature-icon').value;
  listEl.innerHTML = '';

  const groups = { 'Status': [], 'Custom': [], 'Library': [] };
  
  // Basic Icons
  ICON_METADATA.forEach(icon => {
    if (groups[icon.group] && icon.name.toLowerCase().includes(filter.toLowerCase())) {
      groups[icon.group].push(icon);
    }
  });

  // Library Icons
  customTacticalIcons.forEach(icon => {
    if (icon.name.toLowerCase().includes(filter.toLowerCase())) {
      groups['Library'].push({ id: icon.id, name: icon.name, group: 'Library' });
    }
  });

  ['Library', 'Status', 'Custom'].forEach(groupName => {
    const items = groups[groupName];
    if (items.length === 0) return;

    const label = document.createElement('div');
    label.className = 'picker-group-label';
    label.textContent = groupName === 'Library' ? '── Tactical Library ──' : `── ${groupName} ──`;
    listEl.appendChild(label);

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = `picker-item ${currentVal === item.id ? 'selected' : ''}`;
      el.dataset.id = item.id;
      el.dataset.name = item.name;

      const iconHtml = getFeatureIconHtml(item.id, '#fff', null);
      el.innerHTML = `
        <div class="picker-item-icon">${iconHtml}</div>
        <div class="picker-item-label">${item.name}</div>
      `;

      el.onclick = () => {
        selectIcon(item.id, item.name);
      };

      listEl.appendChild(el);
    });
  });
  
  // Add Manage Library at the bottom
  const manage = document.createElement('div');
  manage.className = 'picker-item';
  manage.style.borderTop = '1px solid var(--border-color)';
  manage.style.marginTop = '8px';
  manage.innerHTML = `
    <div class="picker-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg></div>
    <div class="picker-item-label">Manage Library...</div>
  `;
  manage.onclick = () => {
    document.getElementById('icon-picker-content').classList.add('hidden');
    openLibraryModal();
  };
  listEl.appendChild(manage);
}

export function openLibraryModal() {
  const modal = document.getElementById('library-modal');
  if (modal) {
    modal.classList.remove('hidden');
    renderLibraryList();
  }
}

export async function renderLibraryList() {
  const icons = getCustomTacticalIcons();
  const listEl = document.getElementById('lib-items-list');
  if (!listEl) return;

  listEl.innerHTML = '';
  if (icons.length === 0) {
    listEl.innerHTML = '<p style="text-align:center; opacity:0.5; font-size:0.8rem;">Library is empty</p>';
    return;
  }

  icons.forEach(icon => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '12px';
    row.style.padding = '8px';
    row.style.background = 'rgba(255,255,255,0.05)';
    row.style.borderRadius = '6px';
    
    let previewHtml = '';
    if (icon.data.startsWith('data:image/svg+xml')) {
      previewHtml = `<div style="width:24px; height:24px; -webkit-mask-image: url('${icon.data}'); mask-image: url('${icon.data}'); -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; background-color: var(--accent-primary);"></div>`;
    } else {
      previewHtml = `<img src="${icon.data}" style="width:24px; height:24px; object-fit:contain;" />`;
    }

    row.innerHTML = `
      <div style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:#000; border-radius:4px;">${previewHtml}</div>
      <div style="flex:1; font-weight:500; font-size:0.9rem;">${icon.name}</div>
      <button class="icon-btn" style="color:var(--danger);" data-delete-id="${icon.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M9 6V3h6v3"/></svg>
      </button>
    `;
    row.querySelector('[data-delete-id]').onclick = () => {
      confirmAction('Remove Unit', 'Permanently remove this unit from the tactical library?', async () => {
        await removeIconFromLibrary(icon.id);
        renderLibraryList();
      });
    };
    listEl.appendChild(row);
  });
}

export function initLibraryUI() {
  const libModal = document.getElementById('library-modal');
  const libClose = document.getElementById('library-modal-close');
  const libFileInput = document.getElementById('lib-file-input');
  const libBtnUpload = document.getElementById('btn-lib-upload');
  const libPreviewArea = document.getElementById('lib-upload-preview');
  const libPreviewCtn = document.getElementById('lib-preview-container');
  const libPreviewName = document.getElementById('lib-preview-filename');
  const libNameInput = document.getElementById('lib-icon-name');
  const libBtnSave = document.getElementById('btn-lib-save');

  let libPendingData = null;

  if (libClose) libClose.onclick = () => libModal.classList.add('hidden');
  if (libBtnUpload) libBtnUpload.onclick = () => libFileInput.click();

  if (libFileInput) {
    libFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          libPendingData = ev.target.result;
          libPreviewArea.classList.remove('hidden');
          libPreviewName.textContent = file.name;
          if (file.type === 'image/svg+xml') {
            libPreviewCtn.innerHTML = `<div style="width:100%; height:100%; -webkit-mask-image: url('${libPendingData}'); mask-image: url('${libPendingData}'); -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; background-color: var(--accent-primary);"></div>`;
          } else {
            libPreviewCtn.innerHTML = `<img src="${libPendingData}" style="width:100%; height:100%; object-fit:contain;" />`;
          }
        };
        reader.readAsDataURL(file);
      }
    };
  }

  if (libBtnSave) {
    libBtnSave.onclick = async () => {
      const name = libNameInput.value.trim();
      if (!name) { alert('Enter a name for this unit'); return; }
      if (!libPendingData) return;

      await addIconToLibrary(name, libPendingData);
      libNameInput.value = '';
      libPendingData = null;
      libPreviewArea.classList.add('hidden');
      renderLibraryList();
      showToast(t('pinSaved') || 'Unit added to Tactical Library!', 'success');
    };
  }
}

function selectIcon(id, name) {
  const hiddenInp = document.getElementById('feature-icon');
  const btnIcon = document.getElementById('picker-selected-icon');
  const btnLabel = document.getElementById('picker-selected-label');
  const content = document.getElementById('icon-picker-content');
  
  hiddenInp.value = id;
  btnLabel.textContent = name;
  btnIcon.innerHTML = getFeatureIconHtml(id, '#fff', null);
  content.classList.add('hidden');

  if (id === 'custom') {
    document.getElementById('feature-icon-upload').click();
  }
}

export function populateIconDropdowns() {
  // Legacy function kept for compatibility, now redirects to new system
  renderIconPicker();
}

export async function addIconToLibrary(name, data) {
  const id = 'lib-' + generateId();
  const icon = { id, name, data };
  await saveTacticalIcon(icon);
  customTacticalIcons.push(icon);
  populateIconDropdowns();
  return icon;
}

export async function removeIconFromLibrary(id) {
  await deleteTacticalIcon(id);
  customTacticalIcons = customTacticalIcons.filter(i => i.id !== id);
  populateIconDropdowns();
}

export function getCustomTacticalIcons() {
  return customTacticalIcons;
}

export async function hardRemoveFeature(rec) {
  const idToRemove = rec.id;
  
  // Remove from map
  for (const id in layerMap) {
    if (layerMap[id].id === idToRemove) {
      const layer = map._layers[id];
      if (layer) {
        const pId = layerMap[id].folderId || 'root';
        if (folderLayerGroups[pId] && folderLayerGroups[pId].hasLayer(layer)) {
            folderLayerGroups[pId].removeLayer(layer);
        }
        layer.remove();
      }
      delete layerMap[id];
    }
  }

  // Remove from DB directly using the imported db functions
  if (rec.collType === 'pins' || rec.lat) await deletePin(idToRemove);
  else if (rec.collType === 'routes') await deleteRoute(idToRemove);
  else if (rec.collType === 'zones') await deleteZone(idToRemove);

  // Remove from local cache module state
  pins = pins.filter(p => p.id !== idToRemove);
  routes = routes.filter(p => p.id !== idToRemove);
  zones = zones.filter(p => p.id !== idToRemove);

  renderSidebar();
}

export function updateDrawingToolTranslations(lang) {
  if (!map || !map.pm) return;
  const isAr = lang === 'ar';
  map.pm.setLang('customLocale', {
    tooltips: {
      placeMarker: isAr ? 'انقر لوضع المؤشر' : 'Click to place marker',
      firstVertex: isAr ? 'انقر لوضع نقطة البداية' : 'Click to place first point',
      continueLine: isAr ? 'انقر للاستمرار في الرسم' : 'Click to continue drawing',
      finishLine: isAr ? 'انقر مكانك كليك يمين للإنهاء' : 'Right-click to finish line',
      finishPoly: isAr ? 'انقر على نقطة البداية لإنهاء المضلع' : 'Click first point to close polygon',
      finishCircle: isAr ? 'انقر لإنهاء الدائرة' : 'Click to finish circle'
    }
  }, 'en');
  map.pm.setLang('customLocale');
}
