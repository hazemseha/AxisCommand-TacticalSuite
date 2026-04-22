const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = 'C:\\Users\\hazem\\.gemini\\antigravity\\brain\\5ddaaf55-b6ed-4654-9a14-b76a7d3c7c8a\\media__1776715654232.png';
const RES_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function main() {
  for (const [dir, size] of Object.entries(SIZES)) {
    const outDir = path.join(RES_DIR, dir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    // ic_launcher.png
    await sharp(SOURCE)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(outDir, 'ic_launcher.png'));
    
    // ic_launcher_round.png (same image, Android handles masking)
    await sharp(SOURCE)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(outDir, 'ic_launcher_round.png'));
    
    // ic_launcher_foreground.png (slightly larger for adaptive icon)
    const fgSize = Math.round(size * 1.5);
    await sharp(SOURCE)
      .resize(fgSize, fgSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(outDir, 'ic_launcher_foreground.png'));
    
    console.log(`✅ ${dir}: ${size}px`);
  }
  console.log('Done!');
}

main().catch(console.error);
