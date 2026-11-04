// Records one UI transition: a video plus a per-frame layout log of every visible element.
// Usage: node .agents/skills/smooth-ui/scripts/record.mjs <url> <journey.mjs> <tag> [samplingMs=3000]
// The journey module exports `setup(page)` (reach the state before the change) and
// `trigger(page)` (the one user action that starts it). Evidence lands in out/smooth/<tag>/.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [url, journeyPath, tag = 'run', windowMs = '3000'] = process.argv.slice(2);
if (!url || !journeyPath) throw new Error('Usage: record.mjs <url> <journey.mjs> <tag> [samplingMs]');
const journey = await import(pathToFileURL(resolve(journeyPath)).href);
const dir = resolve('out/smooth', tag);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
await page.goto(url);
await journey.setup(page);
await page.waitForTimeout(600);
await page.screenshot({ path: `${dir}/0-before.png` });

// Sample every element's box and opacity on each animation frame. Keyed by tag+classes, first match wins.
await page.evaluate((limit) => {
  window.__frames = [];
  const t0 = performance.now();
  const key = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '');
  const snap = () => {
    const m = {};
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const k = key(el);
      if (m[k]) continue;
      m[k] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), +getComputedStyle(el).opacity];
    }
    window.__frames.push({ t: Math.round(performance.now() - t0), m });
    if (performance.now() - t0 < limit) requestAnimationFrame(snap);
  };
  requestAnimationFrame(snap);
}, Number(windowMs));
const triggeredAt = Date.now();
await journey.trigger(page);
await page.waitForTimeout(Number(windowMs) + 300);
await page.screenshot({ path: `${dir}/9-after.png` });

const frames = await page.evaluate(() => window.__frames);
const changes = [];
for (let i = 1; i < frames.length; i++) {
  const prev = frames[i - 1].m, next = frames[i].m;
  const added = Object.keys(next).filter((k) => !prev[k]);
  const removed = Object.keys(prev).filter((k) => !next[k]);
  const moved = Object.keys(next).filter((k) => prev[k] && next[k].join() !== prev[k].join()).map((k) => `${k} ${prev[k]} -> ${next[k]}`);
  if (added.length || removed.length || moved.length) changes.push({ t: frames[i].t, added, removed, moved });
}
writeFileSync(`${dir}/changes.json`, JSON.stringify(changes, null, 1));
const video = await page.video()?.path();
await context.close();
await browser.close();
writeFileSync(`${dir}/run.json`, JSON.stringify({ url, journey: journeyPath, video, frames: frames.length, triggeredAt }, null, 1));
console.log(`${dir}\n${frames.length} frames sampled, ${changes.length} with changes; video ${video}`);
