import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tilesRoot = path.resolve(__dirname, '../public/tiles');
const PORT = 3055;

function lon2tile(lon, zoom) { return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); }
function lat2tile(lat, zoom) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); }

async function downloadTile(url, dest) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return resolve(true);
    
    const jitter = Math.floor(Math.random() * 150) + 50;
    setTimeout(() => {
      const file = fs.createWriteStream(dest);
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.google.com/maps',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive'
        }
      };

      const protocol = url.startsWith('https') ? https : http;
      protocol.get(url, options, (res) => {
        if (res.statusCode === 200) { 
          res.pipe(file); 
          file.on('finish', () => { file.close(); resolve(true); });
        } else { 
          file.close(); 
          fs.unlink(dest, () => resolve(false)); 
        }
      }).on('error', () => { 
        file.close(); 
        fs.unlink(dest, () => resolve(false)); 
      });
    }, jitter);
  });
}

// ============ GUI ============
const html = `<!DOCTYPE html>
<html>
<head>
  <title>PinVault Dual-Layer Bundler</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body{margin:0;font-family:'Segoe UI',sans-serif;background:#0a0a0a;}
    #map{height:100vh;}
    .panel{position:absolute;top:20px;right:20px;background:rgba(10,10,10,0.95);color:#fff;padding:20px;z-index:9999;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.6);width:340px;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);}
    .panel h3{margin-top:0;color:#06d6a0;font-size:1.1em;}
    .layer-toggle{display:flex;gap:8px;margin-bottom:12px;}
    .layer-toggle label{flex:1;text-align:center;padding:8px;background:#222;border-radius:6px;cursor:pointer;font-size:0.85em;border:2px solid transparent;transition:all 0.2s;}
    .layer-toggle label.active{border-color:#06d6a0;background:#1a3a2a;}
    .layer-toggle input{display:none;}
    #btn{width:100%;padding:14px;background:#333;color:#fff;border:none;border-radius:8px;cursor:not-allowed;font-weight:bold;font-size:0.95em;transition:all 0.2s;}
    #btn:not(:disabled){background:linear-gradient(135deg,#067fd6,#06d6a0);cursor:pointer;}
    #btn:not(:disabled):hover{transform:translateY(-1px);box-shadow:0 4px 15px rgba(6,127,214,0.4);}
    #status{font-size:0.8em;text-align:center;margin-bottom:0;color:#06d6a0;min-height:1.2em;}
    .info{font-size:0.82em;opacity:0.7;margin:8px 0;}
    .zoom-display{background:#1a1a2e;padding:10px 14px;border-radius:8px;margin-bottom:14px;}
    .zoom-display input[type=range]{width:100%;margin-top:6px;accent-color:#06d6a0;}
    .zoom-val{color:#06d6a0;float:right;font-weight:bold;}
  </style>
</head>
<body>
  <div class="panel">
    <h3>🗺️ Dual-Layer Map Bundler</h3>
    <p class="info">Select layers to burn. Hold <b>SHIFT</b> + Drag on the map to define the area.</p>
    
    <div class="layer-toggle">
      <label class="active"><input type="checkbox" id="satCheck" checked> 🛰️ Satellite</label>
      <label class="active"><input type="checkbox" id="streetCheck" checked> 🗺️ Street</label>
    </div>

    <div class="zoom-display">
      <label style="font-size:0.9em;font-weight:bold;">Max Zoom Depth (5 - 18):
      <span class="zoom-val" id="zv">15</span><br>
      <input type="range" id="z" value="15" min="10" max="18" oninput="document.getElementById('zv').innerText=this.value">
      </label>
    </div>

    <button id="btn" disabled>Awaiting Area Selection...</button>
    <p id="status"></p>
  </div>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([32.9, 13.18], 12);
    L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}').addTo(map);
    let rect = null, b = null, sPoint = null;
    
    // Toggle button active states
    document.querySelectorAll('.layer-toggle label').forEach(lbl => {
      lbl.querySelector('input').addEventListener('change', function() {
        lbl.classList.toggle('active', this.checked);
      });
    });

    map.on('mousedown', e => { if(!e.originalEvent.shiftKey) return; sPoint = e.latlng; map.dragging.disable(); });
    map.on('mousemove', e => {
      if(!sPoint) return;
      if(rect) map.removeLayer(rect);
      const bounds = L.latLngBounds(sPoint, e.latlng);
      rect = L.rectangle(bounds, {color:'#06d6a0', weight:2, fillOpacity:0.15}).addTo(map);
    });
    map.on('mouseup', e => { 
      if(!sPoint) return; 
      b = L.latLngBounds(sPoint, e.latlng); 
      sPoint = null; map.dragging.enable(); 
      const btn = document.getElementById('btn');
      btn.disabled = false; btn.innerText = '🔥 Burn Selected Layers';
    });
    
    document.getElementById('btn').onclick = () => {
      const sat = document.getElementById('satCheck').checked;
      const street = document.getElementById('streetCheck').checked;
      if (!sat && !street) { document.getElementById('status').innerText = '⚠️ Select at least one layer!'; return; }
      
      document.getElementById('status').innerText = '⏳ Transmitting coordinates to backend...';
      const btn = document.getElementById('btn');
      btn.disabled = true; btn.innerText = '⏳ Burning...';
      
      fetch('/pack', {
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
          n: b.getNorth(), s: b.getSouth(), e: b.getEast(), w: b.getWest(), 
          z: document.getElementById('z').value,
          satellite: sat, street: street
        })
      }).then(r=>r.text()).then(t => { 
        document.getElementById('status').innerText = '✅ Backend Worker Activated! Watch the console for progress.'; 
      });
    }
  </script>
</body>
</html>`;

// ============ SERVER ============
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
  } else if (req.method === 'POST' && req.url === '/pack') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        res.end('ok');
        
        const MAX_ZOOM = parseInt(data.z);
        const doSatellite = data.satellite !== false;
        const doStreet = data.street !== false;

        console.log(`\n[+] Targeting: N${data.n.toFixed(4)}, S${data.s.toFixed(4)}, W${data.w.toFixed(4)}, E${data.e.toFixed(4)} [Max Zoom: ${MAX_ZOOM}]`);
        console.log(`[+] Layers: ${doSatellite ? '🛰️ Satellite (ESRI)' : ''} ${doStreet ? '🗺️ Street (Google)' : ''}`);

        // Count total tiles per layer
        let tilesPerLayer = 0;
        for (let z = 5; z <= MAX_ZOOM; z++) {
          const xMin = lon2tile(data.w, z), xMax = lon2tile(data.e, z);
          const yMin = lat2tile(data.n, z), yMax = lat2tile(data.s, z);
          const safeXMin = Math.min(xMin, xMax), safeXMax = Math.max(xMin, xMax);
          const safeYMin = Math.min(yMin, yMax), safeYMax = Math.max(yMin, yMax);
          tilesPerLayer += ((safeXMax - safeXMin + 1) * (safeYMax - safeYMin + 1));
        }

        const layers = [];
        if (doSatellite) layers.push({ name: 'satellite', ext: '.jpg' });
        if (doStreet) layers.push({ name: 'street', ext: '.png' });

        const totalAll = tilesPerLayer * layers.length;
        console.log(`[!] Total blocks to download: ${totalAll} (${tilesPerLayer} per layer x ${layers.length} layers)`);

        let globalDone = 0;
        let globalFail = 0;

        for (const layer of layers) {
          console.log(`\n========== Burning ${layer.name.toUpperCase()} ==========`);
          const layerDir = path.join(tilesRoot, layer.name);

          for (let z = 5; z <= MAX_ZOOM; z++) {
            const xMin = lon2tile(data.w, z), xMax = lon2tile(data.e, z);
            const yMin = lat2tile(data.n, z), yMax = lat2tile(data.s, z);
            const safeXMin = Math.min(xMin, xMax), safeXMax = Math.max(xMin, xMax);
            const safeYMin = Math.min(yMin, yMax), safeYMax = Math.max(yMin, yMax);

            for (let x = safeXMin; x <= safeXMax; x++) {
              const promises = [];
              for (let y = safeYMin; y <= safeYMax; y++) {
                let url;
                if (layer.name === 'satellite') {
                  // ESRI World Imagery — confirmed working with 200 OK
                  url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
                } else {
                  // Google Street Maps — confirmed working with 200 OK
                  const shard = Math.floor(Math.random() * 4);
                  url = `https://mt${shard}.google.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}`;
                }
                const dest = path.join(layerDir, z.toString(), x.toString(), `${y}${layer.ext}`);
                promises.push(downloadTile(url, dest).then(ok => { if (!ok) globalFail++; }));
              }
              await Promise.all(promises);
              globalDone += promises.length;
              process.stdout.write(`\r[${layer.name.toUpperCase()}] Progress: ${globalDone} / ${totalAll} (${Math.round(globalDone/totalAll*100)}%)`);
            }
          }
          console.log(`\n[✓] ${layer.name.toUpperCase()} layer complete!`);
        }

        console.log(`\n==========================================`);
        console.log(`[✓] ALL LAYERS BURNED SUCCESSFULLY!`);
        console.log(`[+] Total tiles: ${globalDone} | Failed: ${globalFail}`);
        console.log(`[+] Stored in: public/tiles/satellite/ and public/tiles/street/`);
        console.log(`[+] Run 'npm run build' to compile the final app.`);
        console.log(`==========================================`);
        process.exit(0);
      } catch (err) {
        console.error('[!] Pipeline Error:', err.message);
        res.statusCode = 400;
        res.end('error');
      }
    });
  }
});

server.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`[!] PinVault Dual-Layer Map Bundler`);
  console.log(`==========================================`);
  console.log(`    Open [ http://localhost:${PORT} ] in your browser.`);
  console.log(`    Hold SHIFT + Drag to select your area.`);
  console.log(`    Then click "Burn Selected Layers".`);
});
