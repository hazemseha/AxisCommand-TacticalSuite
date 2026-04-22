/**
 * copy-tiles.js — Copies the permanent tiles-cache into dist/tiles after build
 * This avoids re-downloading 500K+ tiles and keeps builds fast.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.resolve(__dirname, '../tiles-cache');
const distDir = path.resolve(__dirname, '../dist/tiles');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

console.log('[+] Copying tiles-cache → dist/tiles ...');
const start = Date.now();
const count = copyRecursive(cacheDir, distDir);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`[✓] Copied ${count} tiles in ${elapsed}s`);
