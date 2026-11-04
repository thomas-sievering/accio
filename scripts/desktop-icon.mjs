// Renders apps/web/public/favicon.svg into apps/desktop/icon.ico (PNG-in-ICO, one image per size).
// Run after changing the favicon: node scripts/desktop-icon.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const sizes = [16, 24, 32, 48, 64, 128, 256];
const svg = await readFile(new URL('../apps/web/public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = [];
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  pngs.push(await page.screenshot({ omitBackground: true }));
}
await browser.close();

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size % 256, 0); // 0 means 256
  entry.writeUInt8(size % 256, 1);
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngs[i].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return entry;
});
await writeFile(new URL('../apps/desktop/icon.ico', import.meta.url), Buffer.concat([header, ...entries, ...pngs]));
console.log(`apps/desktop/icon.ico: ${sizes.join(', ')}px`);
