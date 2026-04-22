import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Makes the build completely portable (relative paths)
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
