/**
 * download-srtm.cjs — SRTM Elevation Data Downloader
 * Downloads NASA SRTM 3-arc-second HGT files for the Tripoli tactical area.
 * Source: USGS/NASA public domain elevation data.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createGunzip } = require('zlib');

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'elevation-data');
const TILES = [
  'N32E012',  // West Tripoli
  'N32E013',  // East Tripoli / Center
];

// USGS SRTM mirror (public, no auth required for SRTM3)
const BASE_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/skadi';

function downloadFile(tileName) {
  return new Promise((resolve, reject) => {
    const lat = tileName.substring(0, 3);  // N32
    const outputPath = path.join(OUTPUT_DIR, `${tileName}.hgt`);
    
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      // SRTM3 HGT files are exactly 2,884,802 bytes (1201x1201 x 2 bytes + header)
      if (stats.size >= 2884802) {
        console.log(`  [SKIP] ${tileName}.hgt already exists (${(stats.size/1024/1024).toFixed(1)} MB)`);
        return resolve();
      }
    }

    const url = `${BASE_URL}/${lat}/${tileName}.hgt.gz`;
    console.log(`  [DL] Downloading ${tileName}.hgt.gz from S3...`);
    console.log(`       URL: ${url}`);

    const tempPath = outputPath + '.gz';

    https.get(url, { headers: { 'User-Agent': 'PinVault-Tactical/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        https.get(res.headers.location, { headers: { 'User-Agent': 'PinVault-Tactical/1.0' } }, (res2) => {
          if (res2.statusCode !== 200) return reject(new Error(`HTTP ${res2.statusCode} for ${tileName}`));
          handleResponse(res2, tempPath, outputPath, tileName, resolve, reject);
        }).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${tileName}`));
      handleResponse(res, tempPath, outputPath, tileName, resolve, reject);
    }).on('error', reject);
  });
}

function handleResponse(res, tempPath, outputPath, tileName, resolve, reject) {
  const file = fs.createWriteStream(tempPath);
  let downloaded = 0;
  
  res.on('data', (chunk) => {
    downloaded += chunk.length;
    process.stdout.write(`\r  [DL] ${tileName}: ${(downloaded/1024).toFixed(0)} KB`);
  });
  
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log(`\n  [UNZIP] Decompressing ${tileName}.hgt.gz...`);
    
    // Decompress .gz to .hgt
    const gunzip = createGunzip();
    const input = fs.createReadStream(tempPath);
    const output = fs.createWriteStream(outputPath);
    
    input.pipe(gunzip).pipe(output);
    output.on('finish', () => {
      fs.unlinkSync(tempPath); // Clean up .gz
      const stats = fs.statSync(outputPath);
      console.log(`  [OK] ${tileName}.hgt ready (${(stats.size/1024/1024).toFixed(1)} MB)`);
      resolve();
    });
    output.on('error', reject);
  });
}

async function main() {
  console.log('\n========================================');
  console.log('  SRTM ELEVATION DATA DOWNLOADER');
  console.log('  Tactical Terrain for PinVault LOS');
  console.log('========================================\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const tile of TILES) {
    try {
      await downloadFile(tile);
    } catch (err) {
      console.error(`\n  [ERROR] Failed to download ${tile}: ${err.message}`);
    }
  }

  console.log('\n[DONE] Elevation data ready for LOS analysis.\n');
}

main();
