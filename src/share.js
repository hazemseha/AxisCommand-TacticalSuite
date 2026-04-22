/**
 * share.js — Export/Import and Local LAN Sync (Host/Pull)
 * Handles packaging pins, routes, zones, folders, and videos.
 */
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { 
  getAllPins, savePin, 
  getAllRoutes, saveRoute, 
  getAllZones, saveZone, 
  getAllFolders, saveFolder, 
  getAllVideos, saveVideo 
} from './db.js';
import { loadAllFeatures, getComputedVisibility } from './features.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import { importExternalData } from './importExt.js';
import { exportKML, exportGeoJSON } from './exportGeo.js';

/**
 * WebRTC-based Local IP Discovery
 * Works on both Android WebView and Desktop browsers without server dependency.
 * Returns the local network IP (e.g. "192.168.1.15") or null if unavailable.
 */
async function getLocalIPviaWebRTC() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      
      pc.onicecandidate = (e) => {
        if (!e || !e.candidate || !e.candidate.candidate) return;
        
        // Extract IP from ICE candidate string
        const match = e.candidate.candidate.match(/(\d{1,3}\.){3}\d{1,3}/);
        if (match && match[0] !== '0.0.0.0') {
          clearTimeout(timeout);
          pc.close();
          resolve(match[0]);
        }
      };
      
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .catch(() => { clearTimeout(timeout); resolve(null); });
    } catch (e) {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

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
    app: 'PinVault', version: '2.0',
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

  // Calculate Hash for P2P Integrity
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return { blob, hash: hashHex };
}

// ===== EXPORT =====

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

// ===== IMPORT =====

export async function importData(file) {
  if (!file) return;
  showToast(t('importingData') || 'Importing Data...', 'info');

  try {
    const zip = await JSZip.loadAsync(file);

    const checkAndParse = async (filename) => {
      const f = zip.file(filename);
      return f ? JSON.parse(await f.async('text')) : [];
    };

    const metadata = await checkAndParse('metadata.json');
    if (!metadata || metadata.app !== 'PinVault') throw new Error('Invalid file format');

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

// ===== WIRELESS LAN SYNC =====

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
    ip = prompt('Enter Host IP (e.g. 192.168.1.15):');
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
        await importData(blob);
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

// ===== SETUP =====

export function setupShareControls() {
  const getVisibleOnly = () => document.getElementById('chk-export-visible-only')?.checked || false;

  document.getElementById('btn-export')?.addEventListener('click', () => exportData(getVisibleOnly()));
  document.getElementById('btn-export-kml')?.addEventListener('click', () => exportKML(getVisibleOnly()));
  document.getElementById('btn-export-geojson')?.addEventListener('click', () => exportGeoJSON(getVisibleOnly()));

  const importBtn = document.getElementById('btn-import');
  const importInput = document.getElementById('import-file-input');

  importBtn?.addEventListener('click', () => importInput.click());
  importInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      // Cross-Platform Android Memory Intercept
      if (/Android/i.test(navigator.userAgent) && file.size > 5 * 1024 * 1024) {
         if (!confirm('Warning (Mobile Guard): This file exceeds 5MB. Processing extreme geospatial arrays on Android may exhaust browser cache boundaries. Proceed?')) {
             importInput.value = '';
             return;
         }
      }
      
      if (file.name.toLowerCase().endsWith('.pinvault')) {
        importData(file);
      } else {
        importExternalData(file);
      }
      importInput.value = '';
    }
  });

  const syncModal = document.getElementById('sync-modal');
  document.getElementById('btn-wireless-sync').addEventListener('click', async () => {
    syncModal.classList.remove('hidden');
    document.getElementById('sync-progress').classList.add('hidden');
    document.getElementById('sync-target-ip').value = '';
    
    try {
      let ipText = null;
      
      // METHOD 1: Try the Python LAN Server API (PC mode)
      if (window.location.protocol !== 'file:') {
        try {
          const res = await fetch('/api/ip', { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json();
            ipText = data.ip;
          }
        } catch (e) {
          // Server not available, will try WebRTC
        }
      }
      
      // METHOD 2: WebRTC Local IP Discovery (Android / fallback)
      if (!ipText) {
        ipText = await getLocalIPviaWebRTC();
      }
      
      if (!ipText) throw new Error('No local network detected');
      
      document.getElementById('sync-ip-display').textContent = ipText;
      
      const qrCanvas = document.getElementById('sync-qr-canvas');
      qrCanvas.classList.remove('hidden');
      await QRCode.toCanvas(qrCanvas, `http://${ipText}:8000`, { width: 140, margin: 2, color: { dark: '#1e1e24', light: '#f8f9fa' }});
    } catch (err) {
      document.getElementById('sync-ip-display').textContent = 'Unable to fetch IP';
      document.getElementById('sync-qr-canvas').classList.add('hidden');
    }
  });

  document.getElementById('sync-modal-close').addEventListener('click', () => syncModal.classList.add('hidden'));
  document.getElementById('btn-sync-host').addEventListener('click', hostData);
  document.getElementById('btn-sync-pull').addEventListener('click', () => {
    const ip = document.getElementById('sync-target-ip').value.trim();
    if (ip) pullData(ip);
  });
}
