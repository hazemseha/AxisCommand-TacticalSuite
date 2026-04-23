import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

// Custom plugin to serve tiles-cache from an external directory during dev
function tilesPlugin() {
  const tilesRoot = path.resolve(__dirname, '..', 'tiles-cache');
  return {
    name: 'serve-tiles',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Intercept requests like /tiles-cache/satellite/12/2194/1650.jpg
        if (req.url && req.url.startsWith('/tiles-cache/')) {
          const filePath = path.join(tilesRoot, req.url.replace('/tiles-cache/', ''));
          if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });
    }
  };
}

export default defineConfig({
  base: './', // Makes the build completely portable (relative paths)
  plugins: [tilesPlugin()],
  server: {
    fs: {
      allow: ['..']
    }
  },
  build: {
    // ENSURE ALL CAPACITOR PLUGINS ARE BUNDLED
    // Previous configuration was incorrectly marking them as external,
    // causing "Bare Specifier" errors in the Android WebView.
    rollupOptions: {
      external: [] 
    }
  },
  resolve: {
    dedupe: ['leaflet']
  }
});
