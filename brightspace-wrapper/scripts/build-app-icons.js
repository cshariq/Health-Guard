// Renders the extension's PNG icons from the Material "school" glyph. Run: node scripts/build-app-icons.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/icons.js'), 'utf8');
const d = JSON.parse(src.slice(src.indexOf('ICONS = ') + 8, src.lastIndexOf('}') + 1))['school-fill'];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const size of [16, 32, 48, 128]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">
      <svg width="${size}" height="${size}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="oklch(0.55 0.17 270)"/><stop offset="1" stop-color="oklch(0.42 0.16 290)"/></linearGradient></defs>
        <rect x="4" y="4" width="120" height="120" rx="36" fill="url(#g)"/>
        <svg x="22" y="22" width="84" height="84" viewBox="0 -960 960 960"><path fill="#fff" d="${d}"/></svg>
      </svg></body></html>`);
    await p.screenshot({ path: path.join(__dirname, `../assets/icon-${size}.png`), omitBackground: true });
  }
  await b.close();
})();
