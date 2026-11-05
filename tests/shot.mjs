// Visual check helper:  node tests/shot.mjs "<query>" <out.png> [width] [height] [--js "<code run in page before shot>"]
// Starts nothing: expects `npm run dev:web` (port 5199) to be running, or pass BASE=http://... env var.
// Example: node tests/shot.mjs "?albums=1" /tmp/x.png 1440 900
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [, , query = '', out = '/tmp/shot.png', w = '1440', h = '900', ...rest] = process.argv;
const jsIdx = rest.indexOf('--js');
const js = jsIdx >= 0 ? rest[jsIdx + 1] : null;
const base = process.env.BASE || 'http://127.0.0.1:5199/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base + query, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(1200);
if (js) { await page.evaluate(js); await page.waitForTimeout(800); }
await page.screenshot({ path: out });
console.log(logs.filter((l) => !/Failed to load resource|net::ERR|tiles\.|openfreemap|cartocdn|arcgis/i.test(l)).slice(0, 20).join('\n') || 'no console errors');
await browser.close();
