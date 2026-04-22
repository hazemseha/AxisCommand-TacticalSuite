/**
 * mbtiles-android.js
 * Custom Leaflet GridLayer for reading MBTiles directly from Capacitor SQLite.
 * Optimized for asynchronous mobile tactical performance.
 */
import L from 'leaflet';

// HIGH-PERFORMANCE BLOB CACHE: 
// Stores the last 250 tiles in memory to instantly render when dragging back and forth.
// This completely bypasses the SQLite bridge latency for local panning.
const tileCache = new Map();
const MAX_CACHE_SIZE = 250;

export const CapacitorMBTilesLayer = L.TileLayer.extend({
  options: {
    db: null, // SQLite database connection object
    layerType: 'satellite' // 'satellite' or 'street'
  },

  initialize: function (url, options) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    // We rely on this.options.db directly to allow dynamic mounting
  },

  createTile: function (coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    
    // 1. Calculate TMS Y coordinate (MBTiles standard)
    // Slippy Y works from top-down, MBTiles Y works from bottom-up
    const z = Math.round(coords.z);
    const x = Math.round(coords.x);
    const y = Math.round(coords.y);
    
    // TMS Inversion: Slippy Y (top-down) to MBTiles Y (bottom-up)
    const tmsY = (1 << z) - 1 - y;

    if (this.options.debug) {
      console.log(`[MBTiles Debug] Request Z:${z} X:${x} Y:${y} -> tmsY:${tmsY}`);
    }

    if (!this.options.db) {
      // FAIL-SAFE: Return transparent pixel if DB is not ready
      if (this.options.debug) console.warn("[MBTiles] DB not mounted for layer", this.options.layerType);
      tile.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      done(null, tile);
      return tile;
    }

    // 2. Fetch tile BLOB asynchronously from SQLite
    this._fetchTile(z, x, tmsY)
      .then(tileData => {
        if (tileData) {
          let objectUrl = null;
          let dataUrl = null;

          // ASYNC RENDER SYNC: Ensure the WebView repaints properly
          tile.onload = () => {
            if (this.options.debug) console.log(`[MBTiles] Tile Painted: ${z}/${x}/${y}`);
            // Force paint call for older Android WebViews
            requestAnimationFrame(() => done(null, tile));
            // Memory Cleanup for Blob URLs
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          };
          tile.onerror = (err) => {
            console.error(`[MBTiles] Render Error: ${z}/${x}/${y}`, err);
            done(err, tile);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          };

          // PATH A: Raw Byte Array (numeric array from SQLite BLOB)
          if (Array.isArray(tileData) || (typeof tileData === 'object' && !tileData.startsWith)) {
            try {
              const bytes = new Uint8Array(tileData);
              // Simple magic byte check for blobs
              let type = 'image/png';
              if (bytes[0] === 0xFF && bytes[1] === 0xD8) type = 'image/jpeg';
              
              const blob = new Blob([bytes], { type });
              objectUrl = URL.createObjectURL(blob);
              tile.src = objectUrl;
              
              if (this.options.debug) {
                console.log(`[MBTiles] Byte Array Detected - Length: ${bytes.length}`);
              }
            } catch (e) {
              console.error("[MBTiles] Blob conversion failed", e);
              tile.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
              done(null, tile);
            }
          } 
          // PATH B: Base64 String
          else if (typeof tileData === 'string') {
            // DYNAMIC MIME DETECTION (Magic Bytes Radar)
            let mimeType = 'image/png';
            if (tileData.startsWith('/9j/')) mimeType = 'image/jpeg';
            else if (tileData.startsWith('iVBORw')) mimeType = 'image/png';
            else if (tileData.startsWith('R0lGOD')) mimeType = 'image/gif';

            dataUrl = `data:${mimeType};base64,${tileData}`;
            if (this.options.debug) {
              console.log(`[MBTiles] Base64 Detected - Length: ${dataUrl.length}`);
            }
            tile.src = dataUrl;
          }
        } else {
          // Transparent fallback for missing tiles
          tile.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          done(null, tile);
        }
      })
      .catch(err => {
        if (this.options.debug) console.error(`[MBTiles] DB Query Error: ${z}/${x}/${y}`, err);
        tile.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        done(null, tile);
      });

    return tile;
  },

  _fetchTile: async function (z, x, y) {
    try {
      const db = this.options.db;
      if (!db) return null;

      // FAST CACHE LOOKUP: Skip DB if we just saw this tile
      const cacheKey = `${this.options.layerType}_${z}_${x}_${y}`;
      if (tileCache.has(cacheKey)) {
        // M1 fix: Re-insert on access to maintain true LRU order
        const data = tileCache.get(cacheKey);
        tileCache.delete(cacheKey);
        tileCache.set(cacheKey, data);
        return data;
      }

      // Capacitor SQLite query syntax
      const sql = "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?";
      const values = [z, x, y];
      
      const result = await db.query(sql, values);
      
      if (result && result.values && result.values.length > 0) {
        const tileData = result.values[0].tile_data;
        
        // SAVE TO LRU CACHE
        tileCache.set(cacheKey, tileData);
        // Manage RAM size dynamically
        if (tileCache.size > MAX_CACHE_SIZE) {
          const firstKey = tileCache.keys().next().value;
          tileCache.delete(firstKey);
        }
        
        return tileData;
      }
      return null;
    } catch (e) {
      if (this.options.debug) console.error("[MBTiles] Fetch error:", e);
      throw e;
    }
  }
});

L.tileLayer.capacitorMBTiles = function (url, options) {
    return new CapacitorMBTilesLayer(url, options);
};
