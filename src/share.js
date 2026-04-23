/**
 * share.js — Unified Tactical Data Exchange (V2.0)
 * 
 * THREE export modes:
 *   .tactical  — Encrypted delta sync file (LWW-compatible, air-gapped sync)
 *   .pinvault  — Legacy full backup (unencrypted, for backward compat)
 *   .kml/.json — Interoperability (via exportGeo.js)
 * 
 * TWO import modes:
 *   .tactical  → decrypt → resolveConflicts() → applyResolvedRecords()
 *   .pinvault  → legacy blind upsert (backward compat)
 */
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { 
  getAllPins, savePin, 
  getAllRoutes, saveRoute, 
  getAllZones, saveZone, 
  getAllFolders, saveFolder, 
  getAllVideos, saveVideo,
  getUpdatesSince, getDeviceId, getLastSyncTime, setLastSyncTime,
  applyResolvedRecords
} from './db.js';
import { loadAllFeatures, getComputedVisibility } from './features.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import { importExternalData } from './importExt.js';
import { exportKML, exportGeoJSON } from './exportGeo.js';
import { showTacticalPrompt, showTacticalConfirm } from './user-management.js';
import { encrypt, decrypt, isEncryptionActive } from './crypto.js';
import { resolveConflicts, validateSyncPayload, formatSyncSummary } from './sync-engine.js';

// ===== HELPERS =====

function getExtension(mimeType) {
  const map = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv'
  };
  return map[mimeType] || 'mp4';
}

// ===================================================================
// SECTION 1: TACTICAL EXCHANGE ENVELOPE (.tactical) — V2.0 SYNC
// ===================================================================

/**
 * Export a Tactical Exchange Envelope (.tactical)
 * Uses delta sync payload + AES-256-GCM encryption.
 * Compatible with both file-based and WebSocket sync pipelines.
 * 
 * @param {number} [sinceTimestamp=0] — Delta export since this time (0 = full)
 * @param {string} [peerDeviceId] — If exporting for a specific peer
 * @param {Object} [options] — { folderId, folderName } for folder-scoped export
 */
export async function exportTacticalEnvelope(sinceTimestamp = 0, peerDeviceId, options = {}) {
  const modal = document.getElementById('export-modal');
  const statusText = document.getElementById('export-status-text');
  const progressFill = document.getElementById('export-progress-fill');

  modal.classList.remove('hidden');
  progressFill.style.width = '10%';

  try {
    // Step 1: Fetch delta (includes tombstones)
    statusText.textContent = options.folderId
      ? `جاري تجميع محتويات المجلد "${options.folderName || ''}"...`
      : 'جاري تجميع التحديثات...';
    const lastSync = peerDeviceId ? getLastSyncTime(peerDeviceId) : sinceTimestamp;
    let delta = await getUpdatesSince(lastSync);
    progressFill.style.width = '25%';

    // Step 1.5: If folder-scoped, filter delta to only this folder's content
    if (options.folderId) {
      const targetFolderId = options.folderId;
      delta = {
        ...delta,
        pins: (delta.pins || []).filter(r => r.folderId === targetFolderId),
        routes: (delta.routes || []).filter(r => r.folderId === targetFolderId),
        zones: (delta.zones || []).filter(r => r.folderId === targetFolderId),
        folders: (delta.folders || []).filter(r => r.id === targetFolderId || r.parentId === targetFolderId),
      };
    }
    progressFill.style.width = '30%';

    // Step 2: Serialize the sync payload to JSON
    const payloadJson = JSON.stringify(delta);

    // Step 3: Encrypt the payload
    statusText.textContent = 'جاري تشفير البيانات (AES-256-GCM)...';
    let payloadData;
    let isEncrypted = false;

    if (isEncryptionActive()) {
      payloadData = await encrypt(payloadJson);
      isEncrypted = true;
    } else {
      payloadData = payloadJson;
    }
    progressFill.style.width = '50%';

    // Step 4: Compute signature (SHA-256 of encrypted payload)
    const signatureBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payloadData)
    );
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Step 5: Build manifest
    const tombstoneCount =
      (delta.pins || []).filter(r => r.deleted).length +
      (delta.routes || []).filter(r => r.deleted).length +
      (delta.zones || []).filter(r => r.deleted).length +
      (delta.folders || []).filter(r => r.deleted).length;

    const manifest = {
      app: 'AxisCommand',
      version: '2.0',
      format: 'tactical-exchange-envelope',
      deviceId: getDeviceId(),
      timestamp: Date.now(),
      syncType: options.folderId ? 'folder' : (lastSync > 0 ? 'delta' : 'full'),
      lastSyncTime: lastSync,
      encryption: isEncrypted ? 'AES-256-GCM' : 'none',
      signature: signature,
      folderId: options.folderId || null,
      folderName: options.folderName || null,
      counts: {
        pins: (delta.pins || []).length,
        routes: (delta.routes || []).length,
        zones: (delta.zones || []).length,
        folders: (delta.folders || []).length,
        tombstones: tombstoneCount
      }
    };

    // Step 6: Package as ZIP
    statusText.textContent = 'جاري حزم الملف التكتيكي...';
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('payload.enc', payloadData);
    progressFill.style.width = '70%';

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    progressFill.style.width = '90%';

    // Step 7: Trigger download
    const date = new Date().toISOString().split('T')[0];
    let filename;
    if (options.folderId) {
      const safeName = (options.folderName || 'folder').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
      filename = `AxisCommand_folder_${safeName}_${date}.tactical`;
    } else {
      const syncLabel = lastSync > 0 ? 'delta' : 'sync';
      filename = `AxisCommand_${syncLabel}_${date}.tactical`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    progressFill.style.width = '100%';
    const scopeLabel = options.folderId ? `📁 ${options.folderName}` : '';
    statusText.textContent = `✅ تم ${scopeLabel} — ${isEncrypted ? '🔐 مشفر' : '⚠️ غير مشفر'} | SIG: ${signature.substring(0, 8)}`;

    // Update peer sync time if applicable
    if (peerDeviceId) {
      setLastSyncTime(peerDeviceId, Date.now());
    }

    setTimeout(() => { modal.classList.add('hidden'); progressFill.style.width = '0%'; }, 2000);
    showToast(`📦 ${filename} — ${manifest.counts.pins + manifest.counts.routes + manifest.counts.zones} عنصر`, 'success');

  } catch (err) {
    console.error('[TacticalExport]', err);
    modal.classList.add('hidden');
    progressFill.style.width = '0%';
    showToast('❌ فشل التصدير: ' + err.message, 'error');
  }
}

/**
 * Import a Tactical Exchange Envelope (.tactical)
 * Decrypts → validates → resolveConflicts() → applyResolvedRecords()
 * 
 * @param {File|Blob} file
 */
export async function importTacticalEnvelope(file) {
  showToast('📥 جاري استيراد الملف التكتيكي...', 'info');

  try {
    // Step 1: Unzip
    const zip = await JSZip.loadAsync(file);

    // Step 2: Read manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('ملف تالف — manifest.json مفقود');
    const manifest = JSON.parse(await manifestFile.async('text'));

    if (!manifest.app || (manifest.app !== 'AxisCommand' && manifest.app !== 'PinVault')) {
      throw new Error('ملف غير صالح — ليس ملف AxisCommand');
    }
    if (manifest.version !== '2.0') {
      throw new Error(`إصدار غير مدعوم: ${manifest.version}`);
    }

    // Step 3: Read encrypted payload
    const payloadFile = zip.file('payload.enc');
    if (!payloadFile) throw new Error('ملف تالف — payload.enc مفقود');
    let payloadData = await payloadFile.async('text');

    // Step 4: Verify signature
    const signatureBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payloadData)
    );
    const computedSig = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (manifest.signature && computedSig !== manifest.signature) {
      throw new Error('🔴 فشل التحقق من السلامة — الملف ربما تم التلاعب به');
    }

    // Step 5: Decrypt if encrypted
    let payloadJson;
    if (manifest.encryption === 'AES-256-GCM') {
      if (!isEncryptionActive()) {
        throw new Error('🔐 الملف مشفر — يجب تسجيل الدخول أولاً لفك التشفير');
      }
      payloadJson = await decrypt(payloadData);
      if (!payloadJson || payloadJson === payloadData) {
        throw new Error('🔴 فشل فك التشفير — مفتاح خاطئ أو بيانات تالفة');
      }
    } else {
      payloadJson = payloadData;
    }

    // Step 6: Parse and validate
    const remoteData = JSON.parse(payloadJson);
    const validation = validateSyncPayload(remoteData);
    if (!validation.valid) {
      throw new Error('بيانات غير صالحة: ' + validation.error);
    }

    // Step 7: Get local state for conflict resolution
    const localData = await getUpdatesSince(0); // Full local state

    // Step 8: Resolve conflicts using LWW
    const { toApplyLocally, toSendToRemote, stats } = resolveConflicts(localData, remoteData);

    // Step 9: Apply remote wins to local DB
    let appliedCounts = { pins: 0, routes: 0, zones: 0, folders: 0 };
    const totalToApply = (toApplyLocally.pins?.length || 0) + (toApplyLocally.routes?.length || 0) +
                         (toApplyLocally.zones?.length || 0) + (toApplyLocally.folders?.length || 0);

    if (totalToApply > 0) {
      appliedCounts = await applyResolvedRecords(toApplyLocally);
    }

    // Step 10: Update peer sync time
    if (remoteData.deviceId) {
      setLastSyncTime(remoteData.deviceId, Date.now());
    }

    // Step 11: Reload map features
    await loadAllFeatures();

    // Step 12: Show results
    const summary = formatSyncSummary(stats);
    showToast(`✅ ${summary}`, 'success');
    console.log('[TacticalImport] Complete:', stats, 'Applied:', appliedCounts);

  } catch (err) {
    console.error('[TacticalImport]', err);
    showToast('❌ ' + err.message, 'error');
  }
}

// ===================================================================
// SECTION 2: LEGACY .pinvault EXPORT/IMPORT (V1.0 COMPAT)
// ===================================================================

async function prepareZipContent(statusCallback, progressCallback, options = {}) {
  const zip = new JSZip();
  const { visibleOnly = false } = options;

  statusCallback(t('packagingPins') || 'Packaging Features...');
  let pins = await getAllPins();
  let routes = await getAllRoutes();
  let zones = await getAllZones();
  let folders = await getAllFolders();
  let videos = await getAllVideos();

  if (visibleOnly) {
      statusCallback(t('filteringVisible') || 'Filtering Visible Features...');
      const fHash = {};
      folders.forEach(f => fHash[f.id] = f);
      
      const isVisible = (rec) => getComputedVisibility(rec.folderId, fHash);
      
      pins = pins.filter(isVisible);
      routes = routes.filter(isVisible);
      zones = zones.filter(isVisible);
      folders = folders.filter(f => getComputedVisibility(f.id, fHash));
      
      const visiblePinIds = new Set(pins.map(p => p.id));
      videos = videos.filter(v => visiblePinIds.has(v.pinId));
  }

  progressCallback(20);

  zip.file('pins.json', JSON.stringify(pins, null, 2));
  zip.file('routes.json', JSON.stringify(routes, null, 2));
  zip.file('zones.json', JSON.stringify(zones, null, 2));
  zip.file('folders.json', JSON.stringify(folders, null, 2));

  // Save videos metadata + binary
  const videosMetadata = [];
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const filename = `videos/${video.id}.${getExtension(video.type)}`;

    videosMetadata.push({
      id: video.id, pinId: video.pinId, name: video.name, type: video.type, size: video.size, filename: filename, createdAt: video.createdAt
    });

    if (video.blob) zip.file(filename, video.blob);

    progressCallback(30 + ((i + 1) / videos.length) * 50);
    statusCallback(`${t('packagingVideo') || 'Packaging Video'} ${i + 1}/${videos.length}...`);
  }
  zip.file('videos.json', JSON.stringify(videosMetadata, null, 2));

  const metadata = {
    app: 'PinVault', version: '1.0',
    exportDate: new Date().toISOString(),
    pinCount: pins.length, routeCount: routes.length, zoneCount: zones.length, videoCount: videos.length,
    visibleOnly: visibleOnly
  };
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  statusCallback(t('generating') || 'Generating File...');
  
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  }, (metadata) => {
    progressCallback(85 + (metadata.percent / 100) * 15);
  });

  // Calculate Hash for Integrity
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return { blob, hash: hashHex };
}

export async function exportData(visibleOnly = false) {
  const modal = document.getElementById('export-modal');
  const statusText = document.getElementById('export-status-text');
  const progressFill = document.getElementById('export-progress-fill');

  modal.classList.remove('hidden');
  progressFill.style.width = '10%';

  try {
    const { blob, hash } = await prepareZipContent(
      (text) => { statusText.textContent = text; },
      (perc) => { progressFill.style.width = `${perc}%`; },
      { visibleOnly }
    );

    const date = new Date().toISOString().split('T')[0];
    const filename = `PinVault_${visibleOnly ? 'visible_' : 'backup_'}${date}.pinvault`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    progressFill.style.width = '100%';
    statusText.textContent = `Complete! Hash: ${hash.substring(0, 8)}`;

    setTimeout(() => { modal.classList.add('hidden'); progressFill.style.width = '0%'; }, 1200);
    showToast(`Exported ${filename}`, 'success');
  } catch (err) {
    console.error(err);
    modal.classList.add('hidden');
    progressFill.style.width = '0%';
    showToast('Export failed: ' + err.message, 'error');
  }
}

/**
 * Legacy .pinvault import (V1.0 compat — blind upsert, no LWW)
 */
export async function importLegacyPinvault(file) {
  if (!file) return;
  showToast(t('importingData') || 'Importing Data...', 'info');

  try {
    const zip = await JSZip.loadAsync(file);

    const checkAndParse = async (filename) => {
      const f = zip.file(filename);
      return f ? JSON.parse(await f.async('text')) : [];
    };

    const metadata = await checkAndParse('metadata.json');
    if (!metadata || (metadata.app !== 'PinVault' && metadata.app !== 'AxisCommand')) {
      throw new Error('Invalid file format');
    }

    const pinsData = await checkAndParse('pins.json');
    const routesData = await checkAndParse('routes.json');
    const zonesData = await checkAndParse('zones.json');
    const foldersData = await checkAndParse('folders.json');
    const videosMetadata = await checkAndParse('videos.json');

    for (const p of pinsData) await savePin(p);
    for (const r of routesData) await saveRoute(r);
    for (const z of zonesData) await saveZone(z);
    for (const f of foldersData) await saveFolder(f);

    for (const vMeta of videosMetadata) {
      const videoFile = zip.file(vMeta.filename);
      if (videoFile) {
        const blob = await videoFile.async('blob');
        await saveVideo({ ...vMeta, blob });
      }
    }

    await loadAllFeatures();
    showToast(`Imported ${pinsData.length} markers, ${routesData.length} routes, ${zonesData.length} zones`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Import failed: ' + err.message, 'error');
  }
}

// ===================================================================
// SECTION 3: WIRELESS LAN SYNC (Legacy Host/Pull via Python server)
// ===================================================================

export async function hostData() {
  const syncStatus = document.getElementById('sync-status');
  const spinner = document.querySelector('#sync-progress .spinner');
  document.getElementById('sync-progress').classList.remove('hidden');
  syncStatus.style.color = 'var(--text-primary)';
  spinner.style.display = 'block';
  
  try {
    const content = await prepareZipContent((text) => { syncStatus.textContent = text; }, () => {});
    syncStatus.textContent = 'Transferring to Local Router...';
    
    if (window.location.protocol === 'file:') {
      throw new Error('Wireless Sync requires the Tactical LAN Server (Python). Please start server.exe for this feature.');
    }
    const res = await fetch('/api/sync/upload', { method: 'POST', body: content });
    
    if (res.ok) {
      syncStatus.style.color = 'var(--success)';
      syncStatus.textContent = 'Data Hosted! Ready for Pull on the other device.';
      showToast('Device is now hosting data over Wi-Fi!', 'success');
    } else {
      throw new Error('Upload to local interface failed');
    }
  } catch (err) {
    console.error(err);
    syncStatus.textContent = 'Error: ' + err.message;
    syncStatus.style.color = 'var(--error)';
  } finally {
     spinner.style.display = 'none';
  }
}

export async function pullData(ip) {
  const syncStatus = document.getElementById('sync-status');
  const spinner = document.querySelector('#sync-progress .spinner');
  
  if (!ip) {
    ip = await showTacticalPrompt('Enter Host IP (e.g. 192.168.1.15):');
    if (!ip) return;
  }

  document.getElementById('sync-progress').classList.remove('hidden');
  syncStatus.style.color = 'var(--text-primary)';
  syncStatus.textContent = `Connecting to ${ip}...`;
  spinner.style.display = 'block';
  
  try {
    const url = ip.includes('http') ? ip : `http://${ip}:8000`;
    const res = await fetch(`${url}/sync.pinvault`);
    if (!res.ok) throw new Error('Could not pull data. Is the host PC ready?');
    
    const blob = await res.blob();
    
    // Integrity Verification
    syncStatus.textContent = 'Verifying Integrity (SHA-256)...';
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    syncStatus.textContent = `Integrity Verified: ${hashHex.substring(0, 8)}`;
    setTimeout(async () => {
        syncStatus.textContent = 'Importing data into tactical map...';
        await importLegacyPinvault(blob);
        syncStatus.style.color = 'var(--success)';
        syncStatus.textContent = 'Import Complete! (Checksum OK)';
    }, 1000);

  } catch (err) {
    console.error(err);
    syncStatus.textContent = 'Error: ' + err.message;
    syncStatus.style.color = 'var(--error)';
  } finally {
    spinner.style.display = 'none';
  }
}

// ===================================================================
// SECTION 4: SETUP (Wire all UI controls)
// ===================================================================

export function setupShareControls() {
  const getVisibleOnly = () => document.getElementById('chk-export-visible-only')?.checked || false;

  // Interop exports
  document.getElementById('btn-export-kml')?.addEventListener('click', () => exportKML(getVisibleOnly()));
  document.getElementById('btn-export-geojson')?.addEventListener('click', () => exportGeoJSON(getVisibleOnly()));
  
  // Legacy .pinvault backup
  document.getElementById('btn-export')?.addEventListener('click', () => exportData(getVisibleOnly()));

  // ★ NEW: Tactical Sync Export (.tactical)
  document.getElementById('btn-export-tactical')?.addEventListener('click', () => exportTacticalEnvelope(0));

  // Import handler — routes by file extension
  const importBtn = document.getElementById('btn-import');
  const importInput = document.getElementById('import-file-input');

  importBtn?.addEventListener('click', () => importInput.click());
  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      // Cross-Platform Android Memory Intercept
      if (/Android/i.test(navigator.userAgent) && file.size > 5 * 1024 * 1024) {
         const ok = await showTacticalConfirm('Warning (Mobile Guard): This file exceeds 5MB. Processing extreme geospatial arrays on Android may exhaust browser cache boundaries. Proceed?');
         if (!ok) {
             importInput.value = '';
             return;
         }
      }
      
      const nameLower = file.name.toLowerCase();
      if (nameLower.endsWith('.tactical')) {
        // ★ V2.0 encrypted sync file → LWW pipeline
        importTacticalEnvelope(file);
      } else if (nameLower.endsWith('.pinvault')) {
        // Legacy backup → blind upsert
        importLegacyPinvault(file);
      } else {
        // External formats (KML, GeoJSON, GPX, KMZ)
        importExternalData(file);
      }
      importInput.value = '';
    }
  });

  // Update accepted file types to include .tactical
  if (importInput) {
    importInput.accept = '.tactical,.pinvault,.geojson,.kml,.kmz,.gpx';
  }

  // Wireless LAN Sync Modal
  const syncModal = document.getElementById('sync-modal');
  document.getElementById('btn-wireless-sync')?.addEventListener('click', async () => {
    syncModal.classList.remove('hidden');
    document.getElementById('sync-progress').classList.add('hidden');
    document.getElementById('sync-target-ip').value = '';
    
    // Replace broken auto-discovery with manual entry instructions
    const ipDisplay = document.getElementById('sync-ip-display');
    ipDisplay.innerHTML = `
      <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.6; text-align: right;">
        <div style="margin-bottom: 6px; font-size: 0.85rem; color: var(--accent-primary);">🔍 كيف تجد عنوان IP الخاص بك:</div>
        <div>💻 <strong>Windows:</strong> افتح CMD → اكتب <code style="background:rgba(255,255,255,0.1); padding:1px 5px; border-radius:3px;">ipconfig</code> → ابحث عن IPv4</div>
        <div>📱 <strong>Android:</strong> الإعدادات → WiFi → الشبكة المتصلة → عنوان IP</div>
        <div style="margin-top: 6px; color: rgba(255,255,255,0.3); font-size: 0.7rem;">مثال: 192.168.1.15</div>
      </div>
    `;
    
    // Hide QR canvas (no auto-IP to generate QR for)
    const qrCanvas = document.getElementById('sync-qr-canvas');
    if (qrCanvas) qrCanvas.classList.add('hidden');
  });

  document.getElementById('sync-modal-close')?.addEventListener('click', () => syncModal.classList.add('hidden'));
  document.getElementById('btn-sync-host')?.addEventListener('click', hostData);
  document.getElementById('btn-sync-pull')?.addEventListener('click', () => {
    const ip = document.getElementById('sync-target-ip').value.trim();
    if (ip) pullData(ip);
  });
}
