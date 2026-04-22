/**
 * download-google-satellite.cjs — V3 Smart Browser Mimic
 * 
 * Anti-detection strategy:
 * 1. First visits Google Maps page to get real session cookies
 * 2. Uses those cookies in every tile request
 * 3. Randomizes tile download ORDER (not sequential — looks like browsing)
 * 4. Uses Google's INTERNAL tile API format (same as browser)
 * 5. Random realistic delays that mimic human map scrolling
 * 6. Batch pattern: download cluster, pause, download cluster (like a person)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const OUTPUT_DIR = path.join(__dirname, '..', 'tiles-cache', 'satellite');

// ============ SMART HEADERS (exact Chrome headers) ============
function getHeaders(cookies) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Referer': 'https://www.google.com/maps/@32.9,13.1,12z',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'same-origin',
    'DNT': '1',
    'Connection': 'keep-alive',
    ...(cookies ? { 'Cookie': cookies } : {}),
  };
}

// ============ STEP 1: Get session cookies from Google ============
function getSessionCookies() {
  return new Promise((resolve) => {
    console.log('  🍪 Getting session cookies from Google Maps...');
    
    https.get('https://www.google.com/maps/@32.9,13.1,12z', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    }, (res) => {
      const cookies = (res.headers['set-cookie'] || [])
        .map(c => c.split(';')[0])
        .join('; ');
      res.resume(); // drain the response
      console.log(`  🍪 Got ${cookies ? 'cookies' : 'no cookies'} (${cookies.length} chars)`);
      resolve(cookies);
    }).on('error', () => {
      console.log('  ⚠️  Could not get cookies, continuing without');
      resolve('');
    });
  });
}

// ============ TILE MATH ============
function lon2tile(lon, zoom) { return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); }
function lat2tile(lat, zoom) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); }

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Human-like delay: short bursts with occasional pauses
function humanDelay(tileIndex) {
  // Every 5-8 tiles, take a longer "scroll" pause
  if (tileIndex % (5 + Math.floor(Math.random() * 4)) === 0) {
    return 3000 + Math.random() * 4000; // 3-7 second "thinking" pause
  }
  return 500 + Math.random() * 1500; // 0.5-2s normal browsing
}

// ============ DOWNLOAD ONE TILE ============
function downloadTile(z, x, y, cookies, retries = 3) {
  return new Promise((resolve) => {
    const tilePath = path.join(OUTPUT_DIR, `${z}`, `${x}`, `${y}.jpg`);
    
    if (fs.existsSync(tilePath) && fs.statSync(tilePath).size > 1024) {
      return resolve('skip');
    }
    
    const dir = path.dirname(tilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // Use different mt servers (0-3) — rotate based on tile position
    const server = (x + y + z) % 4;
    const url = `https://mt${server}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
    
    const attempt = (retriesLeft) => {
      https.get(url, { headers: getHeaders(cookies), timeout: 10000 }, (res) => {
        if (res.statusCode === 200) {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks);
            if (data.length > 500) {
              fs.writeFileSync(tilePath, data);
              resolve('ok');
            } else {
              resolve('empty');
            }
          });
        } else if (retriesLeft > 0 && (res.statusCode === 403 || res.statusCode === 429)) {
          res.resume();
          // Rate limited — back off
          const wait = (4 - retriesLeft) * 8000 + Math.random() * 5000;
          setTimeout(() => attempt(retriesLeft - 1), wait);
        } else {
          res.resume();
          resolve('fail');
        }
      }).on('error', () => {
        if (retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), 5000);
        } else {
          resolve('fail');
        }
      }).on('timeout', function() { this.destroy(); resolve('fail'); });
    };
    
    attempt(retries);
  });
}

// ============ SHUFFLE TILES (random order = looks like browsing) ============
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============ MAIN ============
async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  🛰️  GOOGLE SATELLITE DOWNLOADER V3        ║');
  console.log('║  Smart Browser Mimic — Anti-Detection      ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const boundsArg = process.argv.find(a => a.startsWith('--bounds='));
  const zoomArg = process.argv.find(a => a.startsWith('--zoom='));
  
  if (!boundsArg || !zoomArg) {
    console.log('Usage: node download-google-satellite.cjs --bounds=S,W,N,E --zoom=MIN-MAX');
    return;
  }

  const [south, west, north, east] = boundsArg.replace('--bounds=', '').split(',').map(Number);
  const bounds = { south, west, north, east };
  const [minZoom, maxZoom] = zoomArg.replace('--zoom=', '').split('-').map(Number);

  // Step 1: Get cookies
  const cookies = await getSessionCookies();
  await sleep(2000);

  // Step 2: Build tile list per zoom
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lon2tile(bounds.west, z);
    const xMax = lon2tile(bounds.east, z);
    const yMin = lat2tile(bounds.north, z);
    const yMax = lat2tile(bounds.south, z);
    
    // Build tile list and SHUFFLE for randomness
    let tiles = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ x, y });
      }
    }
    
    // Shuffle so download order is random (mimics browsing)
    tiles = shuffleArray(tiles);
    
    console.log(`\n  ═══ Zoom ${z} ═══ (${tiles.length} tiles, shuffled)`);
    
    let ok = 0, skip = 0, fail = 0;
    
    for (let i = 0; i < tiles.length; i++) {
      const { x, y } = tiles[i];
      const result = await downloadTile(z, x, y, cookies);
      
      if (result === 'skip') skip++;
      else if (result === 'ok') { ok++; await sleep(humanDelay(i)); }
      else if (result === 'empty') skip++;
      else fail++;
      
      const total = ok + skip + fail;
      const pct = ((total / tiles.length) * 100).toFixed(0);
      process.stdout.write(`\r  [${pct}%] ✅${ok} ⏭️${skip} ❌${fail} / ${tiles.length}   `);
    }
    
    console.log(`\n  ✓ Zoom ${z} done: ${ok} new, ${skip} existed, ${fail} failed`);
    
    // Pause between zoom levels (like switching zoom in browser)
    if (z < maxZoom) {
      const pause = 5 + Math.random() * 10; // 5-15 seconds
      console.log(`  ⏸️  Pausing ${pause.toFixed(0)}s before zoom ${z+1}...`);
      await sleep(pause * 1000);
    }
  }
  
  console.log('\n  ╔══════════════════════════════╗');
  console.log('  ║       DOWNLOAD COMPLETE       ║');
  console.log('  ╚══════════════════════════════╝\n');
}

main().catch(console.error);
