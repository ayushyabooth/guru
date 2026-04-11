#!/usr/bin/env node
/**
 * post-export-fonts.js
 *
 * After `npx expo export --platform web`, copies icon font .ttf files from
 * dist/assets/node_modules/... paths to dist/assets/fonts/ so they are
 * accessible on Vercel (which strips node_modules/ from deployments).
 *
 * Also patches the JS bundle to reference the new paths.
 */

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');
const FONTS_SRC = path.join(
  DIST,
  'assets',
  'node_modules',
  '@expo',
  'vector-icons',
  'build',
  'vendor',
  'react-native-vector-icons',
  'Fonts'
);
const FONTS_DEST = path.join(DIST, 'assets', 'fonts');

// Font files we care about
const ICON_FONTS = ['MaterialCommunityIcons', 'MaterialIcons'];

function main() {
  if (!fs.existsSync(FONTS_SRC)) {
    console.log('[post-export-fonts] No node_modules font dir in dist — skipping (fonts likely bundled via useFonts)');
    return;
  }

  fs.mkdirSync(FONTS_DEST, { recursive: true });

  const files = fs.readdirSync(FONTS_SRC);
  const copied = [];

  for (const file of files) {
    const isIconFont = ICON_FONTS.some((name) => file.startsWith(name));
    if (!isIconFont) continue;

    const src = path.join(FONTS_SRC, file);
    const dest = path.join(FONTS_DEST, file);
    fs.copyFileSync(src, dest);
    copied.push(file);
    console.log(`[post-export-fonts] Copied ${file} -> assets/fonts/`);
  }

  if (copied.length === 0) {
    console.log('[post-export-fonts] No icon font files found to copy');
    return;
  }

  // Patch JS bundles to reference new path
  const jsDir = path.join(DIST, '_expo', 'static', 'js', 'web');
  if (!fs.existsSync(jsDir)) {
    console.log('[post-export-fonts] No JS bundle dir found — skipping patching');
    return;
  }

  const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
  const oldPrefix =
    'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/';
  const newPrefix = 'fonts/';

  for (const jsFile of jsFiles) {
    const filePath = path.join(jsDir, jsFile);
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(oldPrefix)) {
      content = content.split(oldPrefix).join(newPrefix);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[post-export-fonts] Patched ${jsFile}`);
    }
  }

  console.log('[post-export-fonts] Done!');
}

main();
