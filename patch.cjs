const fs = require('fs');
const file = 'c:\\\\Users\\\\hazem\\\\.gemini\\\\antigravity\\\\scratch\\\\offline-map-app\\\\src\\\\features.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace('getAllFolders, saveFolder, deleteFolder,', 'getAllFolders, saveFolder, deleteFolder, cascadeBatchDelete,');

content = content.replace(
/export function getComputedVisibility[\s\S]*?map\.removeLayer\(lg\);\s*}\);\s*}/m,
`export function getComputedVisibility(folderId, hash = null) {
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
}`
);

content = content.replace(
/async function promptDeleteFolder[\s\S]*?populateFolderDropdowns\(\);\s*}/m,
`async function promptDeleteFolder(folderId) {
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
      if (!confirm(\`Warning: Deleting this folder will definitively purge \${totalItems} operational markers and \${totalFolders} sub-folders permanently via BATCH DELETE. Proceed?\`)) return;
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
}`
);

content = content.replace(
/export async function renderSidebar[\s\S]*?populateFolderDropdowns\(\);\s*}/m,
`export async function renderSidebar(filter = '') {
  assignOrphanToRoot([...pins, ...routes, ...zones]);
  syncFolderVisibilities();

  const listEl = document.getElementById('pin-list');
  const allElements = [...pins, ...routes, ...zones];
  const filtered = filter ? allElements.filter(e => (e.name||'').toLowerCase().includes(filter.toLowerCase())) : allElements;
  
  const frag = document.createDocumentFragment();
  await appendFolderNode(frag, 'root', filtered, 0, filter);
  
  listEl.innerHTML = '';
  listEl.appendChild(frag);
  populateFolderDropdowns();
}`
);

fs.writeFileSync(file, content, 'utf8');
console.log('Patch complete.');
