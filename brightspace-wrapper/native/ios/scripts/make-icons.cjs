// Renders the app icon PNGs from the same Material "school" glyph the web app uses.
//   node scripts/make-icons.cjs      (needs Playwright)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../../src/icons.js'), 'utf8');
const glyph = JSON.parse(src.slice(src.indexOf('ICONS = ') + 8, src.lastIndexOf('}') + 1))['school-fill'];
const out = path.join(__dirname, '../Lumen/Assets.xcassets/AppIcon.appiconset');
// iOS wants a full-bleed square (the system rounds it); macOS icons carry their own rounded shape and margin.
const svg = (size, mac) => `<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B58E0"/><stop offset="1" stop-color="#3A2FA8"/></linearGradient></defs>
  ${mac ? '<rect x="100" y="100" width="824" height="824" rx="184" fill="url(#g)"/>' : '<rect width="1024" height="1024" fill="url(#g)"/>'}
  <svg x="${mac ? 262 : 212}" y="${mac ? 262 : 212}" width="${mac ? 500 : 600}" height="${mac ? 500 : 600}" viewBox="0 -960 960 960"><path fill="#fff" d="${glyph}"/></svg></svg>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const render = async (name, size, mac) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(size, mac)}</body></html>`);
    await p.screenshot({ path: path.join(out, name), omitBackground: mac });
  };
  await render('ios-1024.png', 1024, false);
  for (const s of [16, 32, 64, 128, 256, 512, 1024]) await render(`mac-${s}.png`, s, true);
  await b.close();
})();
