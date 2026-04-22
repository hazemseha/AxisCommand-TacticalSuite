/**
 * pack-mbtiles-v2.js — Tactical Layer Processor (better-sqlite3)
 * Converts Slippy Tile cache (tiles-cache/) into dual MBTiles SQLite capsules.
 * Uses better-sqlite3 which has prebuilt binaries (no Visual Studio needed).
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TILES_ROOT = path.join(__dirname, 'tiles-cache');

function packLayer(layerName, outputFilename, format) {
    console.log(`\n--- PACKING LAYER: ${layerName.toUpperCase()} ---`);
    const layerDir = path.join(TILES_ROOT, layerName);
    
    if (!fs.existsSync(layerDir)) {
        console.warn(`[SKIP] Directory not found: ${layerDir}`);
        return;
    }

    const outputPath = path.join(__dirname, outputFilename);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    const db = new Database(outputPath);

    // Enable WAL mode for faster writes
    db.pragma('journal_mode = WAL');

    // 1. Initialize Schema
    db.exec("CREATE TABLE metadata (name text, value text)");
    db.exec("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)");
    db.exec("CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row)");

    // 2. Insert Metadata
    const stmtMeta = db.prepare("INSERT INTO metadata VALUES (?, ?)");
    stmtMeta.run("name", `Tripoli ${layerName.charAt(0).toUpperCase() + layerName.slice(1)}`);
    stmtMeta.run("format", format);
    stmtMeta.run("type", "baselayer");
    stmtMeta.run("version", "1.0");
    stmtMeta.run("description", `Tactical ${layerName} map for PinVault`);

    // 3. Crawl & Insert Tiles in a transaction
    const stmtTile = db.prepare("INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)");
    let count = 0;

    const insertAll = db.transaction(() => {
        const zooms = fs.readdirSync(layerDir);
        zooms.forEach(z => {
            const zPath = path.join(layerDir, z);
            if (!fs.statSync(zPath).isDirectory()) return;

            const xs = fs.readdirSync(zPath);
            xs.forEach(x => {
                const xPath = path.join(zPath, x);
                if (!fs.statSync(xPath).isDirectory()) return;

                const ys = fs.readdirSync(xPath);
                ys.forEach(yFile => {
                    const y = yFile.split('.')[0];
                    const tilePath = path.join(xPath, yFile);

                    // CRITICAL TMS MATH: Convert Slippy Y to TMS Y
                    const slippyZ = parseInt(z);
                    const slippyX = parseInt(x);
                    const slippyY = parseInt(y);
                    const tmsY = (1 << slippyZ) - 1 - slippyY;

                    const data = fs.readFileSync(tilePath);
                    stmtTile.run(slippyZ, slippyX, tmsY, data);
                    
                    count++;
                    if (count % 1000 === 0) process.stdout.write(`\r  Processed ${count} tiles...`);
                });
            });
        });
    });

    insertAll();
    
    // Switch back to normal journal for portable DB
    db.pragma('journal_mode = DELETE');
    db.close();
    
    console.log(`\n[SUCCESS] Generated ${outputFilename} with ${count} tiles.`);

    // Show file size
    const stats = fs.statSync(outputPath);
    console.log(`  File size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
}

try {
    packLayer('satellite', 'tripoli-satellite.db', 'jpg');
    packLayer('street', 'tripoli-street.db', 'png');
    console.log("\n--- PACKING COMPLETE: DUAL CAPSULES READY ---");
} catch (err) {
    console.error("PACKING FATAL ERROR:", err);
    process.exit(1);
}
