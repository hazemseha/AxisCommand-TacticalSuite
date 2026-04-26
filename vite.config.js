import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Makes the build completely portable (relative paths)
  server: {
    // Allow serving tile files from parent directory (tiles-cache junction)
    fs: {
      allow: ['..']
    }
  },
  build: {
    // Skip copying public/ to dist/ — large HGT elevation files (50MB+)
    // cause build hangs. Static assets are copied manually post-build.
    copyPublicDir: false,
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
