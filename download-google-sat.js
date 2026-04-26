/**
 * download-google-sat.js — Single Zoom Level Chunk Downloader
 * ============================================================
 * Downloads Google Satellite tiles for ONE specific zoom level into
 * a modular chunk database: chunks/tripoli-sat-Z{zoom}.db
 *
 * Usage:  node download-google-sat.js
 *         node download-google-sat.js --zoom 16
 *
 * Pipeline:
 *   1. Pre-Flight Analysis  — tile count table for all zooms
 *   2. Interactive Prompt   — user picks EXACT zoom level
 *   3. Stealth Download     — concurrent fetches + WebP compression
 *   4. Chunk Finalize       — VACUUM + close (no swap needed)
 *
 * After downloading chunks, run:  node merge-mbtiles.js
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
  maxZoomCeiling: 20,
  
  // Google Maps Satellite tile endpoint
  tileUrl: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  servers: ['0', '1', '2', '3'],
  
  // Stealth headers
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.google.com/',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
  },
  
  // Rate limiting
  concurrency: 4,
  batchDelayMin: 500,
  batchDelayMax: 1000,
  retryAttempts: 3,
  retryDelay: 3000,
  
  // WebP compressed estimate
  avgTileSizeKB: 8,
  
  // Chunk directory
  chunksDir: path.join(__dirname, 'chunks')
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
  const yMin = lat2tile(CONFIG.bounds.north, zoom);
  const yMax = lat2tile(CONFIG.bounds.south, zoom);
  return { xMin, xMax, yMin, yMax, cols: xMax - xMin + 1, rows: yMax - yMin + 1, total: (xMax - xMin + 1) * (yMax - yMin + 1) };
}

function chunkPath(zoom) {
  return path.join(CONFIG.chunksDir, `tripoli-sat-Z${zoom}.db`);
}

// ═══════════════════════════════════════════════════════════════
// PRE-FLIGHT ANALYSIS TABLE
// ═══════════════════════════════════════════════════════════════

function printAnalysis() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║   🛰️  MODULAR CHUNK DOWNLOADER — PRE-FLIGHT ANALYSIS               ║');
  console.log('║   📍 Bounding Box: Tripoli Tactical Area                            ║');
  console.log('╠════════╤═══════════╤════════╤═══════════════╤══════════════╤═════════╣');
  console.log('║  Zoom  │  Columns  │  Rows  │  Total Tiles  │  Est. Size   │ Status  ║');
  console.log('╠════════╪═══════════╪════════╪═══════════════╪══════════════╪═════════╣');
  
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
    
    // Check if chunk already exists
    const exists = fs.existsSync(chunkPath(z));
    const status = exists ? '  ✅   ' : '  ⬜   ';
    
    console.log(
      `║  Z${String(z).padStart(2)}   │  ${String(range.cols).padStart(7)}  │  ${String(range.rows).padStart(4)}  │  ${String(range.total).padStart(11)}  │  ${sizeStr.padStart(10)}  │${status}║`
    );
  }
  
  const totalSizeStr = cumulativeSizeMB >= 1024
    ? `${(cumulativeSizeMB / 1024).toFixed(2)} GB`
    : `${cumulativeSizeMB.toFixed(1)} MB`;
  
  console.log('╠════════╧═══════════╧════════╧═══════════════╧══════════════╧═════════╣');
  console.log(`║  TOTAL: ${String(cumulativeTiles).padStart(11)} tiles ≈ ${totalSizeStr.padStart(10)}   ✅ = downloaded            ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');
}

// ═══════════════════════════════════════════════════════════════
// INTERACTIVE PROMPT
// ═══════════════════════════════════════════════════════════════

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(query, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ═══════════════════════════════════════════════════════════════
// STEALTH TILE FETCHER
// ═══════════════════════════════════════════════════════════════

// Custom error class to distinguish empty/sea tiles from real failures
class EmptyTileError extends Error {
  constructor(z, x, y, status) {
    super(`HTTP ${status} (empty/sea) Z${z}/X${x}/Y${y}`);
    this.name = 'EmptyTileError';
    this.status = status;
  }
}

let serverIdx = 0;
function getNextServer() {
  return CONFIG.servers[serverIdx++ % CONFIG.servers.length];
}

function fetchTile(z, x, y) {
  return new Promise((resolve, reject) => {
    const url = CONFIG.tileUrl
      .replace('{s}', getNextServer())
      .replace('{x}', x).replace('{y}', y).replace('{z}', z);
    
    const client = url.startsWith('https') ? https : http;
    
    const req = client.get(url, { headers: CONFIG.headers, timeout: 15000 }, (res) => {
      if (res.statusCode === 404) {
        // 404 = No satellite data for this tile (sea/empty area)
        reject(new EmptyTileError(z, x, y, 404));
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        // 403/429/500 = Real failure, should retry
        reject(new Error(`HTTP ${res.statusCode} for Z${z}/X${x}/Y${y}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout Z${z}/X${x}/Y${y}`)); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() {
  return Math.floor(Math.random() * (CONFIG.batchDelayMax - CONFIG.batchDelayMin + 1)) + CONFIG.batchDelayMin;
}

// ═══════════════════════════════════════════════════════════════
// SINGLE ZOOM CHUNK DOWNLOAD
// ═══════════════════════════════════════════════════════════════

async function downloadZoomChunk(zoom) {
  const dbPath = chunkPath(zoom);
  
  // Remove stale chunk if exists
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log(`🗑️  Removed existing chunk for Z${zoom}`);
  }
  
  // Ensure chunks directory exists
  if (!fs.existsSync(CONFIG.chunksDir)) {
    fs.mkdirSync(CONFIG.chunksDir, { recursive: true });
  }
  
  // Initialize chunk database
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  
  db.exec('CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row)');
  
  // Metadata for this chunk
  const stmtMeta = db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)');
  stmtMeta.run('name', `Tripoli Satellite Z${zoom}`);
  stmtMeta.run('format', 'webp');
  stmtMeta.run('type', 'baselayer');
  stmtMeta.run('version', '3.0');
  stmtMeta.run('description', `Google Satellite chunk Z${zoom} – WebP q85`);
  stmtMeta.run('bounds', `${CONFIG.bounds.west},${CONFIG.bounds.south},${CONFIG.bounds.east},${CONFIG.bounds.north}`);
  stmtMeta.run('minzoom', String(zoom));
  stmtMeta.run('maxzoom', String(zoom));
  
  const stmtTile = db.prepare('INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)');
  
  // Build task list for this single zoom
  const range = getTileRange(zoom);
  const tasks = [];
  for (let x = range.xMin; x <= range.xMax; x++) {
    for (let y = range.yMin; y <= range.yMax; y++) {
      tasks.push({ z: zoom, x, y });
    }
  }
  
  const totalTiles = tasks.length;
  let downloaded = 0;
  let emptySkipped = 0;
  let failed = 0;
  const failedQueue = [];
  let totalRawBytes = 0;
  let totalCompressedBytes = 0;
  
  console.log(`\n🚀 Downloading Z${zoom}: ${totalTiles.toLocaleString()} tiles (${range.cols}×${range.rows})`);
  console.log(`   Output: chunks/tripoli-sat-Z${zoom}.db`);
  console.log(`   Pipeline: Fetch → sharp WebP q85 → SQLite\n`);
  
  const startTime = Date.now();
  
  const insertTile = db.transaction((z, x, y, data) => {
    const tmsY = (1 << z) - 1 - y;
    stmtTile.run(z, x, tmsY, data);
  });
  
  // Main download loop
  for (let i = 0; i < tasks.length; i += CONFIG.concurrency) {
    const batch = tasks.slice(i, i + CONFIG.concurrency);
    
    const results = await Promise.allSettled(
      batch.map(async ({ z, x, y }) => {
        const rawData = await fetchTile(z, x, y);
        const compressed = await sharp(rawData)
          .webp({ quality: 85, effort: 4 })
          .toBuffer();
        totalRawBytes += rawData.length;
        totalCompressedBytes += compressed.length;
        insertTile(z, x, y, compressed);
        return { z, x, y };
      })
    );
    
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        downloaded++;
      } else if (results[j].reason instanceof EmptyTileError) {
        // 404 = empty/sea tile — skip silently, don't retry
        emptySkipped++;
      } else {
        // Real failure (403/429/500/timeout) — queue for retry
        failed++;
        failedQueue.push(batch[j]);
      }
    }
    
    // Progress
    const processed = downloaded + emptySkipped;
    const pct = ((processed / totalTiles) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const speed = (processed / Math.max(1, elapsed)).toFixed(1);
    const ratio = totalRawBytes > 0 ? ((1 - totalCompressedBytes / totalRawBytes) * 100).toFixed(0) : 0;
    process.stdout.write(
      `\r  📡 ${downloaded}/${totalTiles} (${pct}%) | 🌊 ${emptySkipped} sea | ❌ ${failed} | ⏱️ ${elapsed}s | ${speed} t/s | -${ratio}%`
    );
    
    await sleep(randomDelay());
  }
  
  console.log('\n');
  
  // ═══ RETRY QUEUE ═══
  if (failedQueue.length > 0) {
    console.log(`🔄 Retrying ${failedQueue.length} failed tiles...\n`);
    
    for (let attempt = 1; attempt <= CONFIG.retryAttempts; attempt++) {
      if (failedQueue.length === 0) break;
      
      console.log(`  Retry ${attempt}/${CONFIG.retryAttempts} — ${failedQueue.length} remaining`);
      await sleep(CONFIG.retryDelay * attempt);
      
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
            totalRawBytes += rawData.length;
            totalCompressedBytes += compressed.length;
            insertTile(z, x, y, compressed);
            return { z, x, y };
          })
        );
        
        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') { downloaded++; failed--; }
          else { failedQueue.push(batch[j]); }
        }
        
        await sleep(randomDelay() * 2);
      }
    }
  }
  
  // VACUUM & Close
  console.log('🗜️  Running VACUUM...');
  db.exec('VACUUM');
  db.pragma('journal_mode = DELETE');
  db.close();
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const fileSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);
  const compressionRatio = totalRawBytes > 0
    ? ((1 - totalCompressedBytes / totalRawBytes) * 100).toFixed(1)
    : '0';
  
  const actualTiles = totalTiles - emptySkipped; // tiles that actually have data
  
  console.log(`\n╔═══════════════════════════════════════════════════╗`);
  console.log(`║  📊 CHUNK Z${String(zoom).padStart(2)} — DOWNLOAD SUMMARY               ║`);
  console.log(`╠═══════════════════════════════════════════════════╣`);
  console.log(`║  Total tiles:    ${String(totalTiles).padStart(10).padEnd(32)}║`);
  console.log(`║  Downloaded:     ${String(downloaded).padStart(10).padEnd(32)}║`);
  console.log(`║  Empty/Sea (🌊): ${String(emptySkipped).padStart(10).padEnd(32)}║`);
  console.log(`║  Failed (❌):    ${String(failed).padStart(10).padEnd(32)}║`);
  console.log(`║  File size:      ${(fileSizeMB + ' MB').padStart(10).padEnd(32)}║`);
  console.log(`║  Compression:    ${(compressionRatio + '% smaller').padStart(10).padEnd(32)}║`);
  console.log(`║  Time:           ${(elapsed + ' min').padStart(10).padEnd(32)}║`);
  console.log(`╚═══════════════════════════════════════════════════╝`);
  
  if (downloaded + emptySkipped === totalTiles) {
    console.log(`\n✅ Chunk Z${zoom} complete! (${emptySkipped} sea tiles skipped)`);
    console.log(`   File: chunks/tripoli-sat-Z${zoom}.db`);
  } else if (failed > 0) {
    console.log(`\n⚠️  Chunk Z${zoom} has ${failed} real failures (not sea tiles).`);
    console.log(`   Re-run with: node download-google-sat.js --zoom ${zoom}`);
  }
  
  return { totalTiles, downloaded, emptySkipped, failed };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.clear();
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  🛰️  AxisCommand — Modular Chunk Downloader v3.0');
  console.log('  📍 Target: Tripoli Tactical Bounding Box');
  console.log('  ⚙️  Pipeline: Fetch → WebP q85 → Chunk DB → (merge later)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  
  printAnalysis();
  
  // Check for --zoom CLI arg
  const zoomArg = process.argv.find(a => a.startsWith('--zoom'));
  let zoom;
  
  if (zoomArg) {
    const idx = process.argv.indexOf(zoomArg);
    zoom = parseInt(zoomArg.includes('=') ? zoomArg.split('=')[1] : process.argv[idx + 1]);
  } else {
    const answer = await askQuestion(
      `🎯 Enter the EXACT single Zoom Level to download (${CONFIG.minZoom}–${CONFIG.maxZoomCeiling}): `
    );
    zoom = parseInt(answer);
  }
  
  if (isNaN(zoom) || zoom < CONFIG.minZoom || zoom > CONFIG.maxZoomCeiling) {
    console.log(`\n❌ Invalid zoom level. Must be ${CONFIG.minZoom}–${CONFIG.maxZoomCeiling}.`);
    process.exit(1);
  }
  
  // Check if chunk already exists
  if (fs.existsSync(chunkPath(zoom))) {
    const overwrite = await askQuestion(`⚠️  chunks/tripoli-sat-Z${zoom}.db already exists. Overwrite? (y/n): `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('\n🛑 Cancelled.');
      process.exit(0);
    }
  }
  
  const range = getTileRange(zoom);
  const sizeMB = (range.total * CONFIG.avgTileSizeKB) / 1024;
  const sizeStr = sizeMB >= 1024 ? `${(sizeMB / 1024).toFixed(2)} GB` : `${sizeMB.toFixed(1)} MB`;
  
  console.log(`\n📐 Z${zoom}: ${range.total.toLocaleString()} tiles (${range.cols}×${range.rows}) ≈ ${sizeStr}`);
  
  const confirm = await askQuestion('⚠️  Start download? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('\n🛑 Download cancelled.');
    process.exit(0);
  }
  
  await downloadZoomChunk(zoom);
  
  console.log('\n───────────────────────────────────────────────────────────────────────');
  console.log('  Next step: Download more zoom levels, then run:');
  console.log('  node merge-mbtiles.js');
  console.log('───────────────────────────────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n💀 FATAL ERROR:', err);
  process.exit(1);
});
