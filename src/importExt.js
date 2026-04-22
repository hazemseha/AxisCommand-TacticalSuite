import JSZip from 'jszip';
import { kml, gpx } from '@tmcw/togeojson';
import { savePin, saveRoute, saveZone, generateId } from './db.js';
import { loadAllFeatures } from './features.js';
import { showToast } from './toast.js';

/**
 * Extracts color from a feature's properties, preferring explicit stroke/fill or standard KML styles.
 * Fallback to default orange #FFA500.
 */
function extractColor(properties) {
  if (!properties) return '#FFA500';
  if (properties.stroke) return properties.stroke;
  if (properties.fill) return properties.fill;
  if (properties['marker-color']) return properties['marker-color'];
  // KML colors are often AABBGGRR, but togeojson maps them roughly to hex strings
  return '#FFA500';
}

/**
 * Attempt to extract a decent label/description from varied KML/GeoJSON standards.
 */
function extractMetadata(properties) {
  if (!properties) return { name: 'Imported Feature', desc: '' };
  const name = properties.name || properties.title || 'Imported Feature';
  const desc = properties.description || properties.desc || properties.timestamp || '';
  return { name, desc };
}

/**
 * Main parser entry. Reads string contents depending on format.
 */
export async function importExternalData(file) {
  showToast(`Parsing ${file.name}...`, 'info');
  try {
    const filenameLower = file.name.toLowerCase();
    let geojson = null;

    if (filenameLower.endsWith('.geojson')) {
      const text = await file.text();
      geojson = JSON.parse(text);
    } 
    else if (filenameLower.endsWith('.kml')) {
      const text = await file.text();
      const dom = new DOMParser().parseFromString(text, 'text/xml');
      geojson = kml(dom);
    } 
    else if (filenameLower.endsWith('.gpx')) {
      const text = await file.text();
      const dom = new DOMParser().parseFromString(text, 'text/xml');
      geojson = gpx(dom);
    } 
    else if (filenameLower.endsWith('.kmz')) {
      const zip = await JSZip.loadAsync(file);
      // Find the first .kml file inside the KMZ
      let kmlFile = null;
      zip.forEach((relativePath, zipEntry) => {
        if (!kmlFile && relativePath.toLowerCase().endsWith('.kml')) {
          kmlFile = zipEntry;
        }
      });
      if (!kmlFile) throw new Error('No .kml payload found inside the KMZ archive.');
      const text = await kmlFile.async('string');
      const dom = new DOMParser().parseFromString(text, 'text/xml');
      geojson = kml(dom);
    } 
    else {
      throw new Error(`Unsupported format exactly: ${filenameLower}`);
    }

    if (!geojson || geojson.type !== 'FeatureCollection') {
      // If it's a single feature, wrap it
      if (geojson && geojson.type === 'Feature') {
        geojson = { type: 'FeatureCollection', features: [geojson] };
      } else {
        throw new Error('Parsed data is not a valid GeoJSON FeatureCollection.');
      }
    }

    let importedPoints = 0;
    let importedLines = 0;
    let importedZones = 0;

    for (const feature of geojson.features) {
      if (!feature.geometry) continue;
      const type = feature.geometry.type;
      const meta = extractMetadata(feature.properties);
      const color = extractColor(feature.properties);

      // GeoJSON is natively [lng, lat], Leaflet is [lat, lng].
      
      if (type === 'Point') {
        // [lng, lat]
        const lng = feature.geometry.coordinates[0];
        const lat = feature.geometry.coordinates[1];
        await savePin({
          id: generateId(),
          lat, lng,
          name: meta.name,
          desc: meta.desc,
          type: 'default', // Fallback standard map icon as requested
          color: color,
          folderId: 'root',
          createdAt: Date.now()
        });
        importedPoints++;
      } 
      else if (type === 'LineString' || type === 'MultiLineString') {
        // LineString coordinates: [[lng, lat], [lng, lat]]
        // Store internally exactly as drawn arrays
        let mappedLatLngs = [];
        if (type === 'LineString') {
          mappedLatLngs = feature.geometry.coordinates.map(coord => ({ lat: coord[1], lng: coord[0] }));
        } else {
          // MultiLineString: flatten or grab first array
          mappedLatLngs = feature.geometry.coordinates[0].map(coord => ({ lat: coord[1], lng: coord[0] }));
        }
        await saveRoute({
          id: generateId(),
          name: meta.name,
          desc: meta.desc,
          color: color,
          latlngs: mappedLatLngs,
          folderId: 'root',
          createdAt: Date.now()
        });
        importedLines++;
      } 
      else if (type === 'Polygon' || type === 'MultiPolygon') {
        let mappedLatLngs = [];
        if (type === 'Polygon') {
          // GeoJSON Poly is array of rings [ [ [lng,lat], [lng,lat] ] ]
          mappedLatLngs = feature.geometry.coordinates[0].map(coord => ({ lat: coord[1], lng: coord[0] }));
        } else {
          // MultiPolygon: [ [ [ [lng,lat] ] ] ]
          mappedLatLngs = feature.geometry.coordinates[0][0].map(coord => ({ lat: coord[1], lng: coord[0] }));
        }
        await saveZone({
          id: generateId(),
          name: meta.name,
          desc: meta.desc,
          color: color,
          latlngs: mappedLatLngs,
          folderId: 'root',
          createdAt: Date.now()
        });
        importedZones++;
      }
    }

    // Force map to redraw components 
    await loadAllFeatures();
    
    showToast(`External Import Complete: ${importedPoints} Pins, ${importedLines} Routes, ${importedZones} Zones.`, 'success');

  } catch (err) {
    console.error('Import Ext Error:', err);
    showToast(`External Import Failed: ${err.message}`, 'error');
  }
}
