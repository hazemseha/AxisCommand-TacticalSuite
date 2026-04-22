import { saveTile } from './db.js';

function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

export function estimateTiles(bounds, minZoom = 10, maxZoom = 16) {
  let count = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const minX = lon2tile(bounds.getWest(), z);
    const maxX = lon2tile(bounds.getEast(), z);
    const minY = lat2tile(bounds.getNorth(), z);
    const maxY = lat2tile(bounds.getSouth(), z);

    count += (maxX - minX + 1) * (maxY - minY + 1);
  }
  // Double the count because we are downloading 2 layers: Satellite and Labels
  return count * 2;
}

export async function downloadArea(bounds, minZoom = 10, maxZoom = 16, onProgress) {
  const tileUrls = [];
  
  // Base URLs templates
  const satelliteTemplate = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
  const labelsTemplate = 'https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}';

  for (let z = minZoom; z <= maxZoom; z++) {
    // Leaflet bounds getNorth() is the top, getSouth() is bottom
    // getWest() is left, getEast() is right.
    const startX = lon2tile(bounds.getWest(), z);
    const endX = lon2tile(bounds.getEast(), z);
    
    // Y tile coordinates go from 0 (North) to 2^z - 1 (South)
    const startY = lat2tile(bounds.getNorth(), z);
    const endY = lat2tile(bounds.getSouth(), z);

    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        tileUrls.push(satelliteTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y));
        tileUrls.push(labelsTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      }
    }
  }

  const total = tileUrls.length;
  let downloaded = 0;
  
  // Set up a simple concurrency queue
  const CONCURRENCY = 10;
  
  async function worker() {
    while (tileUrls.length > 0) {
      const url = tileUrls.shift();
      if (!url) break;
      
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) {
          const blob = await response.blob();
          await saveTile({ url, blob, createdAt: Date.now() });
        }
      } catch (err) {
        console.warn('Failed to fetch tile:', url, err);
      }
      
      downloaded++;
      if (onProgress) {
        onProgress(downloaded, total);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
}
