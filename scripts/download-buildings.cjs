/**
 * download-buildings.cjs — Download Tripoli building footprints from OpenStreetMap
 * Queries the Overpass API for buildings with height data in the Tripoli area.
 * Output: public/buildings/tripoli-buildings.json
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'buildings');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'tripoli-buildings.json');

// Tripoli bounding box (same as tile coverage)
const BBOX = '32.40,12.88,32.95,13.53'; // south,west,north,east

// Overpass QL query: Get all buildings with geometry
const QUERY = `
[out:json][timeout:120];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
);
out body;
>;
out skel qt;
`;

function downloadBuildings() {
  return new Promise((resolve, reject) => {
    console.log('[BUILD] Querying Overpass API for Tripoli buildings...');
    console.log('[BUILD] Area: Tripoli (32.40-32.95°N, 12.88-13.53°E)');
    
    const postData = `data=${encodeURIComponent(QUERY)}`;
    
    const options = {
      hostname: 'overpass-api.de',
      port: 443,
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'PinVault-Tactical/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      let downloaded = 0;
      
      res.on('data', (chunk) => {
        data += chunk;
        downloaded += chunk.length;
        process.stdout.write(`\r[BUILD] Downloaded: ${(downloaded/1024/1024).toFixed(1)} MB`);
      });
      
      res.on('end', () => {
        console.log(`\n[BUILD] Download complete. Processing...`);
        
        try {
          const osmData = JSON.parse(data);
          
          // Build node lookup
          const nodes = {};
          osmData.elements.forEach(el => {
            if (el.type === 'node') {
              nodes[el.id] = { lat: el.lat, lon: el.lon };
            }
          });
          
          // Extract buildings with coordinates
          const buildings = [];
          osmData.elements.forEach(el => {
            if (el.type === 'way' && el.tags && el.tags.building) {
              const coords = [];
              let valid = true;
              
              for (const nodeId of el.nodes) {
                const node = nodes[nodeId];
                if (!node) { valid = false; break; }
                coords.push([node.lat, node.lon]);
              }
              
              if (!valid || coords.length < 3) return;
              
              // Estimate building height
              let height = 6; // Default: 2 floors × 3m
              
              if (el.tags.height) {
                height = parseFloat(el.tags.height) || height;
              } else if (el.tags['building:levels']) {
                height = (parseInt(el.tags['building:levels']) || 2) * 3;
              } else if (el.tags.building === 'apartments' || el.tags.building === 'residential') {
                height = 12; // ~4 floors
              } else if (el.tags.building === 'commercial' || el.tags.building === 'office') {
                height = 15; // ~5 floors
              } else if (el.tags.building === 'industrial' || el.tags.building === 'warehouse') {
                height = 8;
              } else if (el.tags.building === 'mosque' || el.tags.building === 'church') {
                height = 15;
              }
              
              // Calculate centroid for quick spatial lookup
              let cLat = 0, cLon = 0;
              coords.forEach(c => { cLat += c[0]; cLon += c[1]; });
              cLat /= coords.length;
              cLon /= coords.length;
              
              // Calculate bounding box for quick AABB test
              let minLat = 999, maxLat = -999, minLon = 999, maxLon = -999;
              coords.forEach(c => {
                if (c[0] < minLat) minLat = c[0];
                if (c[0] > maxLat) maxLat = c[0];
                if (c[1] < minLon) minLon = c[1];
                if (c[1] > maxLon) maxLon = c[1];
              });
              
              buildings.push({
                h: height,
                c: [cLat, cLon],         // centroid
                b: [minLat, minLon, maxLat, maxLon], // bbox
                p: coords                 // polygon
              });
            }
          });
          
          console.log(`[BUILD] Processed ${buildings.length} buildings`);
          
          // Save as compact JSON
          const output = { 
            meta: {
              source: 'OpenStreetMap',
              area: 'Tripoli, Libya',
              count: buildings.length,
              generated: new Date().toISOString()
            },
            buildings 
          };
          
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));
          const size = fs.statSync(OUTPUT_FILE).size;
          console.log(`[BUILD] Saved: tripoli-buildings.json (${(size/1024/1024).toFixed(1)} MB)`);
          resolve(buildings.length);
          
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('\n========================================');
  console.log('  OSM BUILDING DATA DOWNLOADER');
  console.log('  Tripoli Urban LOS Enhancement');
  console.log('========================================\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  try {
    const count = await downloadBuildings();
    console.log(`\n[DONE] ${count} buildings ready for urban LOS analysis.\n`);
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
  }
}

main();
