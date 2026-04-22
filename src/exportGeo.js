import L from 'leaflet';
import { getAllPins, getAllRoutes, getAllZones, getAllFolders } from './db.js';
import { getComputedVisibility } from './features.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

function circleToPolygon(lat, lng, radius, points = 64) {
    const coords = [];
    const earthRadius = 6378137;
    for (let i = 0; i < points; i++) {
        const theta = (i / points) * (2 * Math.PI);
        const latOffset = (radius * Math.cos(theta)) / earthRadius;
        const lngOffset = (radius * Math.sin(theta)) / (earthRadius * Math.cos(Math.PI * lat / 180));
        coords.push([lng + lngOffset * 180 / Math.PI, lat + latOffset * 180 / Math.PI]);
    }
    coords.push(coords[0]);
    return coords;
}

function extractGeometryAndStyle(rec) {
    const color = rec.color || '#ff0000';
    let type = 'Point';
    let coords = [];
    
    if (rec.collType === 'pins' || (rec.lat && !rec.radius)) {
        type = 'Point';
        coords = [rec.lng, rec.lat]; // GeoJSON format
    } else if (rec.collType === 'routes' || rec.type === 'polyline') {
        type = 'LineString';
        coords = rec.latlngs.map(ll => [ll.lng, ll.lat]);
    } else {
        type = 'Polygon';
        if (rec.type === 'circle' || rec.radius) {
            coords = [circleToPolygon(rec.lat, rec.lng, rec.radius)];
        } else {
            coords = [rec.latlngs.map(ll => [ll.lng, ll.lat])];
        }
    }
    return { type, coords, color };
}

export async function exportKML(visibleOnly = false) {
    try {
        let pins = await getAllPins();
        let routes = await getAllRoutes();
        let zones = await getAllZones();
        
        if (visibleOnly) {
            const folders = await getAllFolders();
            const fHash = {};
            folders.forEach(f => fHash[f.id] = f);
            const isVisible = (rec) => getComputedVisibility(rec.folderId, fHash);
            pins = pins.filter(isVisible);
            routes = routes.filter(isVisible);
            zones = zones.filter(isVisible);
        }
        
        const all = [...pins, ...routes, ...zones];
        
        let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n  <name>PinVault Export</name>\n`;

        all.forEach(rec => {
            const { type, coords, color } = extractGeometryAndStyle(rec);
            const hexColor = color.replace('#', '');
            
            kml += `<Placemark>\n  <name><![CDATA[${rec.name || 'Unnamed'}]]></name>\n`;
            if (rec.desc) kml += `  <description><![CDATA[${rec.desc}]]></description>\n`;
            
            if (type === 'Point') {
                kml += `  <Point><coordinates>${coords[0]},${coords[1]},0</coordinates></Point>\n`;
            } else if (type === 'LineString') {
                kml += `  <Style><LineStyle><color>ff${hexColor}</color><width>4</width></LineStyle></Style>\n`;
                kml += `  <LineString><coordinates>${coords.map(c => c[0] + ',' + c[1] + ',0').join(' ')}</coordinates></LineString>\n`;
            } else if (type === 'Polygon') {
                kml += `  <Style>\n    <LineStyle><color>ff${hexColor}</color></LineStyle>\n    <PolyStyle><color>30${hexColor}</color></PolyStyle>\n  </Style>\n`;
                kml += `  <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords[0].map(c => c[0] + ',' + c[1] + ',0').join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>\n`;
            }
            kml += `</Placemark>\n`;
        });
        
        kml += `</Document>\n</kml>`;
        
        const suffix = visibleOnly ? '_visible' : '';
        triggerBlobDownload(kml, 'application/vnd.google-earth.kml+xml;charset=utf-8', `kml`, suffix);
    } catch (err) {
        showToast('KML Export failed: ' + err.message, 'error');
    }
}

export async function exportGeoJSON(visibleOnly = false) {
    try {
        let pins = await getAllPins();
        let routes = await getAllRoutes();
        let zones = await getAllZones();
        
        if (visibleOnly) {
            const folders = await getAllFolders();
            const fHash = {};
            folders.forEach(f => fHash[f.id] = f);
            const isVisible = (rec) => getComputedVisibility(rec.folderId, fHash);
            pins = pins.filter(isVisible);
            routes = routes.filter(isVisible);
            zones = zones.filter(isVisible);
        }
        
        const all = [...pins, ...routes, ...zones];
        
        const geojson = {
            type: "FeatureCollection",
            features: all.map(rec => {
                const { type, coords, color } = extractGeometryAndStyle(rec);
                return {
                    type: "Feature",
                    properties: {
                        name: rec.name || 'Unnamed',
                        description: rec.desc || '',
                        stroke: color,
                        fill: color
                    },
                    geometry: {
                        type: type,
                        coordinates: coords
                    }
                };
            })
        };
        
        const suffix = visibleOnly ? '_visible' : '';
        triggerBlobDownload(JSON.stringify(geojson, null, 2), 'application/geo+json;charset=utf-8', `geojson`, suffix);
    } catch (err) {
        showToast('GeoJSON Export failed: ' + err.message, 'error');
    }
}

async function triggerBlobDownload(data, mime, ext, suffix = '') {
    const date = new Date().toISOString().split('T')[0];
    const filename = `PV_Export_${date}${suffix}.${ext}`;

    // CAPACITOR NATIVE SAVE (Android APK only - @vite-ignore for Electron compatibility)
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const { Filesystem } = await import(/* @vite-ignore */ '@capacitor/filesystem');
            const { Directory } = await import(/* @vite-ignore */ '@capacitor/filesystem');
            
            await Filesystem.writeFile({
                path: filename,
                data: data,
                directory: Directory.Documents,
                encoding: 'utf8'
            });
            showToast(`Saved to Documents/${filename}`, 'success');
            return;
        } catch (err) {
            console.error('Capacitor Save Failed:', err);
        }
    }

    // BROWSER / ELECTRON FALLBACK
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 2000); 
    showToast(`Exported ${filename} successfully`, 'success');
}
