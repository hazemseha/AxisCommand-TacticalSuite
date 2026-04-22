/**
 * download-hybrid-labels.cjs — Download Google Maps Hybrid Labels Layer
 * Downloads transparent PNG tiles with only street names/labels (lyrs=h)
 * These tiles have alpha transparency - perfect for overlay on satellite.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'tiles-cache', 'labels');

// Tripoli bounding box (same as satellite tiles)
const BOUNDS = {
  south: 32.40, north: 32.95,
  west: 12.88, east: 13.53
};

// Zoom levels to download
const ZOOM_LEVELS = [10, 11, 12, 13, 14, 15, 16, 17, 18];

// Google Maps hybrid labels URL
const TILE_URL = 'https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}&hl=ar';
const SERVERS = ['0', '1', '2', '3'];

function latlonToTile(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return { x, y };
}

function downloadTile(z, x, y) {
  return new Promise((resolve, reject) => {
    const dir = path.join(OUTPUT_DIR, String(z), String(x));
    const filePath = path.join(dir, `${y}.png`);
    
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size > 100) return resolve('skip');
    }
    
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const server = SERVERS[Math.floor(Math.random() * SERVERS.length)];
    const url = TILE_URL
      .replace('{s}', server)
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{z}', z);
    
    https.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, (res2) => {
          if (res2.statusCode !== 200) return resolve('fail');
          saveTile(res2, filePath, resolve, reject);
        }).on('error', () => resolve('fail'));
        return;
      }
      if (res.statusCode !== 200) return resolve('fail');
      saveTile(res, filePath, resolve, reject);
    }).on('error', () => resolve('fail'));
  });
}

function saveTile(res, filePath, resolve, reject) {
  const file = fs.createWriteStream(filePath);
  res.pipe(file);
  file.on('finish', () => { file.close(); resolve('ok'); });
  file.on('error', (e) => { fs.unlinkSync(filePath); resolve('fail'); });
}

async function downloadZoom(z) {
  const topLeft = latlonToTile(BOUNDS.north, BOUNDS.west, z);
  const bottomRight = latlonToTile(BOUNDS.south, BOUNDS.east, z);
  
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  
  const total = (maxX - minX + 1) * (maxY - minY + 1);
  let done = 0, ok = 0, skip = 0, fail = 0;
  
  console.log(`  [Z${z}] ${total} tiles (${minX}-${maxX} x ${minY}-${maxY})`);
  
  // Download in batches of 8
  const tasks = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tasks.push({ x, y });
    }
  }
  
  const BATCH = 8;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(t => downloadTile(z, t.x, t.y)));
    
    results.forEach(r => {
      done++;
      if (r === 'ok') ok++;
      else if (r === 'skip') skip++;
      else fail++;
    });
    
    process.stdout.write(`\r  [Z${z}] ${done}/${total} (${ok} new, ${skip} cached, ${fail} failed)`);
    
    // Small delay to avoid rate limiting
    if (i + BATCH < tasks.length) await new Promise(r => setTimeout(r, 50));
  }
  
  console.log('');
  return { ok, skip, fail };
}

async function main() {
  console.log('\n========================================');
  console.log('  HYBRID LABELS DOWNLOADER');
  console.log('  Transparent Street Names for PinVault');
  console.log('========================================\n');
  
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  let totalOk = 0, totalSkip = 0, totalFail = 0;
  
  for (const z of ZOOM_LEVELS) {
    const { ok, skip, fail } = await downloadZoom(z);
    totalOk += ok;
    totalSkip += skip;
    totalFail += fail;
  }
  
  console.log(`\n[DONE] Labels: ${totalOk} new, ${totalSkip} cached, ${totalFail} failed\n`);
}

main();
