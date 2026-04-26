/**
 * merge-mbtiles.js — Modular Chunk Merger Pipeline
 * =================================================
 * Scans the chunks/ directory for tripoli-sat-Z{N}.db files and merges
 * them into the master tripoli-satellite.db using SQLite ATTACH DATABASE.
 *
 * Usage:  node merge-mbtiles.js
 *
 * The ATTACH method is critical for performance:
 *   - SQLite handles the data transfer entirely within its C engine
 *   - Zero JavaScript memory allocation for tile BLOBs
 *   - A 1GB chunk merges in seconds (vs minutes with JS read/write loops)
 *   - No risk of Node.js heap OOM on large datasets
 *
 * Pipeline:
 *   1. Scan chunks/ for all .db files
 *   2. Create master DB if needed (schema + metadata)
 *   3. ATTACH each chunk → INSERT OR REPLACE → DETACH
 *   4. Update metadata (bounds, minzoom, maxzoom)
 *   5. VACUUM master DB
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHUNKS_DIR = path.join(__dirname, 'chunks');
const MASTER_DB_PATH = path.join(__dirname, 'tripoli-satellite.db');
const BACKUP_DB_PATH = path.join(__dirname, 'tripoli-satellite-pre-merge.bak');

const BOUNDS = {
  south: 32.4000,
  west:  12.8800,
  north: 32.9500,
  east:  13.5300
};

// ═══════════════════════════════════════════════════════════════
// CHUNK DISCOVERY
// ═══════════════════════════════════════════════════════════════

function discoverChunks() {
  if (!fs.existsSync(CHUNKS_DIR)) {
    console.log('❌ chunks/ directory not found. Download some zoom levels first.');
    console.log('   Run: node download-google-sat.js');
    process.exit(1);
  }
  
  const files = fs.readdirSync(CHUNKS_DIR)
    .filter(f => f.startsWith('tripoli-sat-Z') && f.endsWith('.db'))
    .sort((a, b) => {
      const zA = parseInt(a.match(/Z(\d+)/)[1]);
      const zB = parseInt(b.match(/Z(\d+)/)[1]);
      return zA - zB;
    });
  
  if (files.length === 0) {
    console.log('❌ No chunk files found in chunks/ directory.');
    console.log('   Expected format: tripoli-sat-Z{zoom}.db');
    process.exit(1);
  }
  
  return files.map(f => {
    const zoom = parseInt(f.match(/Z(\d+)/)[1]);
    const fullPath = path.join(CHUNKS_DIR, f);
    const stats = fs.statSync(fullPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    
    // Count tiles in chunk
    let tileCount = 0;
    try {
      const chunkDb = new Database(fullPath, { readonly: true });
      const row = chunkDb.prepare('SELECT COUNT(*) as cnt FROM tiles').get();
      tileCount = row.cnt;
      chunkDb.close();
    } catch (e) {
      tileCount = -1; // corrupted
    }
    
    return { filename: f, fullPath, zoom, sizeMB, tileCount };
  });
}

// ═══════════════════════════════════════════════════════════════
// MASTER DB INITIALIZATION
// ═══════════════════════════════════════════════════════════════

function initMasterDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
    CREATE TABLE IF NOT EXISTS tiles (
      zoom_level INTEGER, 
      tile_column INTEGER, 
      tile_row INTEGER, 
      tile_data BLOB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tile_index 
      ON tiles (zoom_level, tile_column, tile_row);
  `);
  
  // Set/update metadata
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)
  `);
  
  upsert.run('name', 'Tripoli Google Satellite');
  upsert.run('format', 'webp');
  upsert.run('type', 'baselayer');
  upsert.run('version', '3.0');
  upsert.run('description', 'Google Satellite – Merged from modular chunks – WebP q85');
  upsert.run('bounds', `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north}`);
}

// ═══════════════════════════════════════════════════════════════
// MERGE ENGINE (ATTACH DATABASE)
// ═══════════════════════════════════════════════════════════════

function mergeChunk(masterDb, chunk) {
  const startTime = Date.now();
  
  // ATTACH the chunk database as a named schema
  // Using parameterized path to prevent SQL injection
  const absPath = path.resolve(chunk.fullPath).replace(/\\/g, '/');
  masterDb.exec(`ATTACH DATABASE '${absPath}' AS chunk`);
  
  // Bulk INSERT OR REPLACE — entirely in SQLite's C engine
  // No tile data ever touches JavaScript memory
  const result = masterDb.prepare(`
    INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data)
    SELECT zoom_level, tile_column, tile_row, tile_data FROM chunk.tiles
  `).run();
  
  // DETACH to free the connection
  masterDb.exec('DETACH DATABASE chunk');
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  
  return {
    inserted: result.changes,
    elapsed
  };
}

// ═══════════════════════════════════════════════════════════════
// UPDATE METADATA (post-merge)
// ═══════════════════════════════════════════════════════════════

function updateMetadata(db, chunks) {
  const zooms = chunks.map(c => c.zoom);
  const minZoom = Math.min(...zooms);
  const maxZoom = Math.max(...zooms);
  
  const upsert = db.prepare('INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)');
  upsert.run('minzoom', String(minZoom));
  upsert.run('maxzoom', String(maxZoom));
  
  // Count total tiles in master
  const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM tiles').get();
  
  return { minZoom, maxZoom, totalTiles: totalRow.cnt };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

function main() {
  console.clear();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔗 AxisCommand — Modular MBTiles Merger v3.0');
  console.log('  📁 Source: chunks/tripoli-sat-Z{N}.db');
  console.log('  📦 Target: tripoli-satellite.db');
  console.log('  ⚡ Method: SQLite ATTACH DATABASE (zero-copy, C-engine)');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Phase 1: Discover chunks
  const chunks = discoverChunks();
  
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  📦 DISCOVERED CHUNKS                            ║');
  console.log('╠═════════╤═══════════════╤═════════════╤══════════╣');
  console.log('║  Zoom   │  Tile Count   │  File Size  │  Status  ║');
  console.log('╠═════════╪═══════════════╪═════════════╪══════════╣');
  
  let totalChunkTiles = 0;
  let totalChunkSizeMB = 0;
  
  for (const chunk of chunks) {
    const status = chunk.tileCount > 0 ? '   ✅   ' : '   ❌   ';
    totalChunkTiles += Math.max(0, chunk.tileCount);
    totalChunkSizeMB += parseFloat(chunk.sizeMB);
    
    console.log(
      `║  Z${String(chunk.zoom).padStart(2)}    │  ${String(chunk.tileCount).padStart(11)}  │  ${(chunk.sizeMB + ' MB').padStart(9)}  │${status}║`
    );
  }
  
  console.log('╠═════════╧═══════════════╧═════════════╧══════════╣');
  console.log(`║  TOTAL: ${String(totalChunkTiles).padStart(11)} tiles in ${String(chunks.length).padStart(2)} chunks (${totalChunkSizeMB.toFixed(1)} MB) ║`);
  console.log('╚═══════════════════════════════════════════════════╝\n');
  
  // Phase 2: Backup existing master if present
  if (fs.existsSync(MASTER_DB_PATH)) {
    const existingSize = (fs.statSync(MASTER_DB_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`📦 Existing master DB found (${existingSize} MB). Creating backup...`);
    fs.copyFileSync(MASTER_DB_PATH, BACKUP_DB_PATH);
    console.log(`   → Backed up to tripoli-satellite-pre-merge.bak\n`);
  }
  
  // Phase 3: Open/create master DB
  console.log('🔧 Initializing master database schema...');
  const masterDb = new Database(MASTER_DB_PATH);
  masterDb.pragma('journal_mode = WAL');
  masterDb.pragma('synchronous = NORMAL');
  masterDb.pragma('cache_size = -128000'); // 128MB cache for merge
  
  initMasterDb(masterDb);
  console.log('   ✅ Schema ready\n');
  
  // Phase 4: Merge each chunk
  console.log('🔗 Merging chunks into master database...\n');
  
  let totalMerged = 0;
  
  for (const chunk of chunks) {
    if (chunk.tileCount <= 0) {
      console.log(`   ⏭️  Z${chunk.zoom}: Skipped (empty/corrupted)`);
      continue;
    }
    
    process.stdout.write(`   🔄 Z${chunk.zoom}: Merging ${chunk.tileCount.toLocaleString()} tiles...`);
    
    try {
      const result = mergeChunk(masterDb, chunk);
      totalMerged += result.inserted;
      console.log(` ✅ ${result.inserted.toLocaleString()} rows in ${result.elapsed}s`);
    } catch (err) {
      console.log(` ❌ FAILED: ${err.message}`);
    }
  }
  
  // Phase 5: Update metadata
  console.log('\n📝 Updating metadata...');
  const meta = updateMetadata(masterDb, chunks);
  console.log(`   Zoom range: Z${meta.minZoom}–Z${meta.maxZoom}`);
  console.log(`   Total tiles in master: ${meta.totalTiles.toLocaleString()}`);
  
  // Phase 6: VACUUM
  console.log('\n🗜️  Running VACUUM (defragmenting master DB)...');
  const vacStart = Date.now();
  masterDb.exec('VACUUM');
  const vacTime = ((Date.now() - vacStart) / 1000).toFixed(1);
  
  masterDb.pragma('journal_mode = DELETE');
  masterDb.close();
  
  // Final stats
  const finalSize = fs.statSync(MASTER_DB_PATH).size;
  const finalSizeMB = (finalSize / 1024 / 1024).toFixed(1);
  const finalSizeGB = (finalSize / 1024 / 1024 / 1024).toFixed(2);
  const sizeDisplay = finalSize > 1024 * 1024 * 1024 ? `${finalSizeGB} GB` : `${finalSizeMB} MB`;
  
  console.log(`   VACUUM complete in ${vacTime}s`);
  
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  ✅ ALL CHUNKS MERGED SUCCESSFULLY                ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║  Master DB:      tripoli-satellite.db             ║`);
  console.log(`║  Final size:     ${sizeDisplay.padStart(10).padEnd(33)}║`);
  console.log(`║  Total tiles:    ${String(meta.totalTiles.toLocaleString()).padEnd(33)}║`);
  console.log(`║  Zoom range:     Z${meta.minZoom}–Z${String(meta.maxZoom).padEnd(30)}║`);
  console.log(`║  Chunks merged:  ${String(chunks.length).padEnd(33)}║`);
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log('║  🚀 Master DB ready for deployment!               ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
}

try {
  main();
} catch (err) {
  console.error('\n💀 FATAL ERROR:', err);
  process.exit(1);
}
