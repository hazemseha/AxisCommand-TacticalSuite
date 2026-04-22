const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * TACTICAL TILE DOWNLOADER FOR PINVAULT (V2 - Interactive)
 * -------------------------------------------------------
 * This script downloads satellite or street map tiles for a specified region.
 */

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const CONFIG = {
    // Zoom range — HIGH RESOLUTION (zoom 15-18 for city-level detail)
    minZoom: 15,
    maxZoom: 18,

    // Bounding Box: Tripoli City Center (Focused for high zoom)
    boundingBox: {
        north: 32.95,
        south: 32.82,
        east: 13.25,
        west: 13.08
    },

    // Anti-Ban Throttle (ms between requests)
    delay: 200
};

const MODES = {
    '1': {
        name: 'Satellite Imagery',
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        ext: '.jpg',
        dir: 'satellite'
    },
    '2': {
        name: 'Street & Labels',
        url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        ext: '.png',
        dir: 'street'
    }
};

// --- SLIPPY MAP MATH ---
function lon2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

// --- DOWNLOADER CORE ---
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadTile(z, x, y, mode) {
    const dir = path.join(__dirname, 'tiles-cache', mode.dir, String(z), String(x));
    const filePath = path.join(dir, `${y}${mode.ext}`);

    if (fs.existsSync(filePath)) return { skipped: true };

    fs.mkdirSync(dir, { recursive: true });

    const url = mode.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);

    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const file = fs.createWriteStream(filePath);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve({ skipped: false }); });
        }).on('error', (err) => { fs.unlink(filePath, () => {}); reject(err); });
    });
}

async function startDownload(selectedMode) {
    const mode = MODES[selectedMode];
    console.log(`\nStarting Download for: [${mode.name}]`);
    
    let total = 0;
    for (let z = CONFIG.minZoom; z <= CONFIG.maxZoom; z++) {
        total += (lon2tile(CONFIG.boundingBox.east, z) - lon2tile(CONFIG.boundingBox.west, z) + 1) * 
                 (lat2tile(CONFIG.boundingBox.south, z) - lat2tile(CONFIG.boundingBox.north, z) + 1);
    }

    let current = 0, downloaded = 0, skipped = 0;
    for (let z = CONFIG.minZoom; z <= CONFIG.maxZoom; z++) {
        const xRange = [lon2tile(CONFIG.boundingBox.west, z), lon2tile(CONFIG.boundingBox.east, z)];
        const yRange = [lat2tile(CONFIG.boundingBox.north, z), lat2tile(CONFIG.boundingBox.south, z)];

        for (let x = xRange[0]; x <= xRange[1]; x++) {
            for (let y = yRange[0]; y <= yRange[1]; y++) {
                current++;
                try {
                    const res = await downloadTile(z, x, y, mode);
                    if (res.skipped) skipped++;
                    else { downloaded++; await sleep(CONFIG.delay); }
                    if (current % 10 === 0 || current === total) {
                        process.stdout.write(`\rProgress: ${((current/total)*100).toFixed(1)}% (${current}/${total}) | DL: ${downloaded} | Skip: ${skipped}   `);
                    }
                } catch (e) { console.error(`\nError ${z}/${x}/${y}: ${e.message}`); }
            }
        }
    }
    console.log(`\n[${mode.name}] Download Complete!`);
}

async function main() {
    console.log('\x1b[33m%s\x1b[0m', '=========================================');
    console.log('\x1b[33m%s\x1b[0m', '   PINVAULT TACTICAL TILE DOWNLOADER     ');
    console.log('\x1b[33m%s\x1b[0m', '=========================================');
    console.log('\nChoose what you want to download:');
    console.log(' [1] Satellite Imagery (Real terrain - .jpg)');
    console.log(' [2] Street & Labels (Roads/Names - .png)');
    console.log(' [3] Both Layers (Sequential)');
    console.log(' [Q] Quit');
    
    rl.question('\nEnter your choice (1, 2, or 3): ', async (answer) => {
        const choice = answer.trim();
        if (choice === '1' || choice === '2') {
            await startDownload(choice);
        } else if (choice === '3') {
            await startDownload('1');
            await startDownload('2');
        } else {
            console.log('Exiting...');
        }
        rl.close();
    });
}

main();
