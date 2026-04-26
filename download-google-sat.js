/**
 * download-google-sat.js — Interactive Stealth Tile Downloader
 * ============================================================
 * Downloads Google Satellite tiles into a temporary MBTiles database,
 * verifies completeness, then performs an atomic swap with the production DB.
 *
 * Usage:  node download-google-sat.js
 *
 * Phases:
 *   1. Pre-Flight Analysis  — calculates tile counts per zoom, shows cost table
 *   2. Interactive Prompt   — user selects max zoom level
 *   3. Stealth Download     — concurrent fetches with headers + rate limiting
 *   3.5 WebP Compression    — sharp converts raw JPG → WebP (q85) before DB insert
 *   4. Atomic Swap          — backup old DB, promote temp DB only on 100% success
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import https from 'https';
import http from 'http';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Tripoli tactical bounding box (matches main.js)
  bounds: {
    south: 32.4000,
    west:  12.8800,
    north: 32.9500,
    east:  13.5300
  },
  
  // Zoom range to analyze
  minZoom: 10,
  maxZoomCeiling: 19,
  
  // Google Maps Satellite tile endpoint
  tileUrl: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  servers: ['0', '1', '2', '3'],  // mt0–mt3 round-robin
  
  // Stealth headers to prevent 403
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.google.com/',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
  },
  
  // Rate limiting
  concurrency: 4,
  batchDelayMin: 500,   // ms
  batchDelayMax: 1000,  // ms
  retryAttempts: 3,
  retryDelay: 3000,     // ms
  
  // Average tile size estimate (WebP compressed @ q85)
  avgTileSizeKB: 8,
  
  // File paths
  productionDb: path.join(__dirname, 'tripoli-satellite.db'),
  tempDb: path.join(__dirname, 'tripoli-satellite-temp.db'),
  backupDb: path.join(__dirname, 'tripoli-satellite.bak')
};

// ═══════════════════════════════════════════════════════════════
// TILE MATH
// ═══════════════════════════════════════════════════════════════

function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
}

function getTileRange(zoom) {
  const xMin = lon2tile(CONFIG.bounds.west, zoom);
  const xMax = lon2tile(CONFIG.bounds.east, zoom);
  const yMin = lat2tile(CONFIG.bounds.north, zoom);  // north = smaller y
  const yMax = lat2tile(CONFIG.bounds.south, zoom);   // south = larger y
  
  const cols = xMax - xMin + 1;
  const rows = yMax - yMin + 1;
  const total = cols * rows;
  
  return { xMin, xMax, yMin, yMax, cols, rows, total };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: PRE-FLIGHT ANALYSIS
// ═══════════════════════════════════════════════════════════════

function printAnalysis() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   🛰️  GOOGLE SATELLITE TILE DOWNLOADER — PRE-FLIGHT       ║');
  console.log('║   📍 Bounding Box: Tripoli Tactical Area                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Zoom  │  Columns  │  Rows  │  Total Tiles  │  Est. Size   ║');
  console.log('╠════════╪═══════════╪════════╪═══════════════╪══════════════╣');
  
  let cumulativeTiles = 0;
  let cumulativeSizeMB = 0;
  
  for (let z = CONFIG.minZoom; z <= CONFIG.maxZoomCeiling; z++) {
    const range = getTileRange(z);
    const sizeMB = (range.total * CONFIG.avgTileSizeKB) / 1024;
    cumulativeTiles += range.total;
    cumulativeSizeMB += sizeMB;
    
    const sizeStr = sizeMB >= 1024
      ? `${(sizeMB / 1024).toFixed(2)} GB`
      : `${sizeMB.toFixed(1)} MB`;
    
    console.log(
      `║  Z${String(z).padStart(2)}   │  ${String(range.cols).padStart(7)}  │  ${String(range.rows).padStart(4)}  │  ${String(range.total).padStart(11)}  │  ${sizeStr.padStart(10)}  ║`
    );
  }
  
  const totalSizeStr = cumulativeSizeMB >= 1024
    ? `${(cumulativeSizeMB / 1024).toFixed(2)} GB`
    : `${cumulativeSizeMB.toFixed(1)} MB`;
  
  console.log('╠════════╧═══════════╧════════╧═══════════════╧══════════════╣');
  console.log(`║  TOTAL (Z${CONFIG.minZoom}–Z${CONFIG.maxZoomCeiling}): ${String(cumulativeTiles).padStart(11)} tiles ≈ ${totalSizeStr.padStart(10)}    ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

// ═══════════════════════════════════════════════════════════════
// INTERACTIVE PROMPT
// ═══════════════════════════════════════════════════════════════

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// TILE FETCHER (Stealth Mode)
// ═══════════════════════════════════════════════════════════════

let serverIdx = 0;
function getNextServer() {
  const s = CONFIG.servers[serverIdx % CONFIG.servers.length];
  serverIdx++;
  return s;
}

function fetchTile(z, x, y, attempt = 1) {
  return new Promise((resolve, reject) => {
    const server = getNextServer();
    const url = CONFIG.tileUrl
      .replace('{s}', server)
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{z}', z);
    
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(url, {
      headers: CONFIG.headers,
      timeout: 15000
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for Z${z}/X${x}/Y${y}`));
        res.resume();
        return;
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    
    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout for Z${z}/X${x}/Y${y}`));
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay() {
  const min = CONFIG.batchDelayMin;
  const max = CONFIG.batchDelayMax;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2 & 3: STAGED DOWNLOAD
// ═══════════════════════════════════════════════════════════════

async function downloadTiles(maxZoom) {
  // Clean up any previous temp DB
  if (fs.existsSync(CONFIG.tempDb)) {
    fs.unlinkSync(CONFIG.tempDb);
    console.log('🗑️  Removed stale temp database.');
  }
  
  // Initialize temp database
  const db = new Database(CONFIG.tempDb);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  
  db.exec('CREATE TABLE metadata (name TEXT, value TEXT)');
  db.exec('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)');
  db.exec('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)');
  
  // Metadata
  const stmtMeta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
  stmtMeta.run('name', 'Tripoli Google Satellite');
  stmtMeta.run('format', 'webp');
  stmtMeta.run('type', 'baselayer');
  stmtMeta.run('version', '2.0');
  stmtMeta.run('description', 'Google Satellite tiles – WebP Compressed – Stealth Downloaded');
  stmtMeta.run('bounds', `${CONFIG.bounds.west},${CONFIG.bounds.south},${CONFIG.bounds.east},${CONFIG.bounds.north}`);
  stmtMeta.run('minzoom', String(CONFIG.minZoom));
  stmtMeta.run('maxzoom', String(maxZoom));
  
  const stmtTile = db.prepare('INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)');
  
  // Build tile task list
  const tasks = [];
  for (let z = CONFIG.minZoom; z <= maxZoom; z++) {
    const range = getTileRange(z);
    for (let x = range.xMin; x <= range.xMax; x++) {
      for (let y = range.yMin; y <= range.yMax; y++) {
        tasks.push({ z, x, y });
      }
    }
  }
  
  const totalTiles = tasks.length;
  let downloaded = 0;
  let failed = 0;
  const failedQueue = [];
  
  console.log(`\n🚀 Starting download: ${totalTiles} tiles (Z${CONFIG.minZoom}–Z${maxZoom})`);
  console.log(`   Concurrency: ${CONFIG.concurrency} | Stealth headers: ON | WebP: q85\n`);
  
  const startTime = Date.now();
  
  // Process in batches
  const insertTile = db.transaction((z, x, y, data) => {
    // Convert Slippy Y to TMS Y for MBTiles spec
    const tmsY = (1 << z) - 1 - y;
    stmtTile.run(z, x, tmsY, data);
  });
  
  for (let i = 0; i < tasks.length; i += CONFIG.concurrency) {
    const batch = tasks.slice(i, i + CONFIG.concurrency);
    
    const results = await Promise.allSettled(
      batch.map(async ({ z, x, y }) => {
        const rawData = await fetchTile(z, x, y);
        // WebP compression pipeline — ~40-60% smaller than raw JPG
        const compressed = await sharp(rawData)
          .webp({ quality: 85, effort: 4 })
          .toBuffer();
        insertTile(z, x, y, compressed);
        return { z, x, y };
      })
    );
    
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        downloaded++;
      } else {
        failed++;
        failedQueue.push(batch[j]);
      }
    }
    
    // Progress
    const pct = ((downloaded / totalTiles) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const speed = (downloaded / Math.max(1, elapsed)).toFixed(1);
    process.stdout.write(
      `\r  📡 ${downloaded}/${totalTiles} (${pct}%) | ❌ ${failed} fails | ⏱️ ${elapsed}s | ${speed} tiles/s`
    );
    
    // Rate limit between batches
    await sleep(randomDelay());
  }
  
  console.log('\n');
  
  // ═══ RETRY QUEUE ═══
  if (failedQueue.length > 0) {
    console.log(`\n🔄 Retrying ${failedQueue.length} failed tiles (${CONFIG.retryAttempts} attempts)...\n`);
    
    for (let attempt = 1; attempt <= CONFIG.retryAttempts; attempt++) {
      if (failedQueue.length === 0) break;
      
      console.log(`  Retry attempt ${attempt}/${CONFIG.retryAttempts} — ${failedQueue.length} tiles remaining`);
      await sleep(CONFIG.retryDelay * attempt); // Increasing backoff
      
      const retryBatch = [...failedQueue];
      failedQueue.length = 0;
      
      for (let i = 0; i < retryBatch.length; i += CONFIG.concurrency) {
        const batch = retryBatch.slice(i, i + CONFIG.concurrency);
        
        const results = await Promise.allSettled(
          batch.map(async ({ z, x, y }) => {
            const rawData = await fetchTile(z, x, y);
            const compressed = await sharp(rawData)
              .webp({ quality: 85, effort: 4 })
              .toBuffer();
            insertTile(z, x, y, compressed);
            return { z, x, y };
          })
        );
        
        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            downloaded++;
            failed--;
          } else {
            failedQueue.push(batch[j]);
          }
        }
        
        await sleep(randomDelay() * 2); // Slower on retries
      }
    }
    
    console.log(`\n  Retry complete. Recovered: ${failed === 0 ? 'ALL' : `${failedQueue.length} still failed`}`);
  }
  
  // VACUUM — defragment and minimize file size on disk
  console.log('\n🗜️  Running VACUUM to optimize database size...');
  db.exec('VACUUM');
  
  // Finalize DB
  db.pragma('journal_mode = DELETE');
  db.close();
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const fileSize = fs.existsSync(CONFIG.tempDb)
    ? (fs.statSync(CONFIG.tempDb).size / 1024 / 1024).toFixed(1)
    : '0';
  
  console.log(`\n📊 Download Summary:`);
  console.log(`   Total expected:  ${totalTiles}`);
  console.log(`   Downloaded:      ${downloaded}`);
  console.log(`   Failed:          ${totalTiles - downloaded}`);
  console.log(`   Database size:   ${fileSize} MB`);
  console.log(`   Time elapsed:    ${elapsed} minutes`);
  
  return { totalTiles, downloaded, tempDbPath: CONFIG.tempDb };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: ATOMIC SWAP (FAIL-SAFE)
// ═══════════════════════════════════════════════════════════════

function atomicSwap(totalTiles, downloaded) {
  if (downloaded !== totalTiles) {
    console.log('\n❌ DOWNLOAD INCOMPLETE — ABORTING SWAP');
    console.log(`   Missing ${totalTiles - downloaded} tiles.`);
    console.log(`   Old database is UNTOUCHED. Safe.`);
    console.log(`   Temp file preserved at: ${CONFIG.tempDb}`);
    return false;
  }
  
  console.log('\n✅ Download 100% complete. Initiating atomic swap...');
  
  // Step 1: Backup existing production DB
  if (fs.existsSync(CONFIG.productionDb)) {
    if (fs.existsSync(CONFIG.backupDb)) {
      fs.unlinkSync(CONFIG.backupDb);
    }
    fs.renameSync(CONFIG.productionDb, CONFIG.backupDb);
    console.log(`   📦 Old DB backed up → tripoli-satellite.bak`);
  }
  
  // Step 2: Promote temp to production
  fs.renameSync(CONFIG.tempDb, CONFIG.productionDb);
  console.log(`   🔄 New DB promoted → tripoli-satellite.db`);
  
  console.log('\n✅ TACTICAL MAP UPDATE COMPLETE. Old map backed up.');
  return true;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.clear();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🛰️  AxisCommand — Google Satellite Stealth Downloader v3.0');
  console.log('  📍 Target: Tripoli Tactical Bounding Box');
  console.log(`  ⚙️  Stealth Mode: ON | WebP Compression: q85`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  // PHASE 1: Show analysis table
  printAnalysis();
  
  // PHASE 1.5: Interactive prompt
  const answer = await askQuestion(
    `🎯 Enter the maximum Zoom Level to download (${CONFIG.minZoom}–${CONFIG.maxZoomCeiling}): `
  );
  
  const maxZoom = parseInt(answer);
  if (isNaN(maxZoom) || maxZoom < CONFIG.minZoom || maxZoom > CONFIG.maxZoomCeiling) {
    console.log(`\n❌ Invalid zoom level "${answer}". Must be ${CONFIG.minZoom}–${CONFIG.maxZoomCeiling}. Aborting.`);
    process.exit(1);
  }
  
  // Calculate selected scope
  let selectedTiles = 0;
  for (let z = CONFIG.minZoom; z <= maxZoom; z++) {
    selectedTiles += getTileRange(z).total;
  }
  const selectedSizeMB = (selectedTiles * CONFIG.avgTileSizeKB) / 1024;
  const sizeDisplay = selectedSizeMB >= 1024
    ? `${(selectedSizeMB / 1024).toFixed(2)} GB`
    : `${selectedSizeMB.toFixed(1)} MB`;
  
  console.log(`\n📐 Selected: Z${CONFIG.minZoom}–Z${maxZoom} = ${selectedTiles.toLocaleString()} tiles ≈ ${sizeDisplay}`);
  
  // Confirm
  const confirm = await askQuestion('⚠️  Proceed with download? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('\n🛑 Download cancelled by user.');
    process.exit(0);
  }
  
  // PHASE 2 & 3: Download
  const result = await downloadTiles(maxZoom);
  
  // PHASE 4: Atomic swap
  const swapAnswer = await askQuestion(
    `\n🔄 Swap databases now? Old DB will be backed up. (y/n): `
  );
  
  if (swapAnswer.toLowerCase() === 'y') {
    atomicSwap(result.totalTiles, result.downloaded);
  } else {
    console.log(`\n📁 Temp database preserved at: ${CONFIG.tempDb}`);
    console.log('   You can manually swap later.');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Mission Complete. خرائط غرفة العمليات العسكرية');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n💀 FATAL ERROR:', err);
  process.exit(1);
});
