/**
 * optimize-buildings.cjs — Compress building data for LOS
 * Strips polygon data and keeps only centroid + height + bounding box
 * for efficient line-of-sight intersection testing.
 */
const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'public', 'buildings', 'tripoli-buildings.json');
const OUTPUT = path.join(__dirname, '..', 'public', 'buildings', 'tripoli-buildings-lite.json');

console.log('[OPT] Reading building data...');
const data = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));

console.log(`[OPT] Processing ${data.buildings.length} buildings...`);

// Keep only centroid + height + small bbox (round to 5 decimal places = ~1m precision)
const lite = data.buildings.map(b => ({
  h: b.h,
  lat: Math.round(b.c[0] * 100000) / 100000,
  lon: Math.round(b.c[1] * 100000) / 100000,
  // Approximate building radius in degrees (~width/2)
  r: Math.round(Math.max(b.b[2] - b.b[0], b.b[3] - b.b[1]) * 100000) / 200000
}));

const output = {
  meta: {
    ...data.meta,
    format: 'lite',
    note: 'Centroid + height only, for LOS intersection'
  },
  b: lite
};

fs.writeFileSync(OUTPUT, JSON.stringify(output));
const size = fs.statSync(OUTPUT).size;
console.log(`[OPT] Saved: tripoli-buildings-lite.json (${(size/1024/1024).toFixed(1)} MB)`);
console.log(`[OPT] Compression: ${(69.2).toFixed(1)} MB -> ${(size/1024/1024).toFixed(1)} MB`);
