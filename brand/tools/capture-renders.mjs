// Captures the genuine Open Med Tray Lite renders used by the brand pages and
// social preview: the default tray scene and the two-piece capsule preset,
// with the interface hidden. Writes full-resolution PNGs to $OMT_SOURCES
// (default $TMPDIR/omt-brand-sources/); build-brand.mjs crops them to JPEG.
//
//   node brand/tools/capture-renders.mjs [path/to/open-med-tray-lite.html]
import { pathToFileURL } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname;
const APP = ROOT + (existsSync(ROOT + 'lite/package.json') ? 'lite/' : (existsSync(ROOT + 'app/package.json') ? 'app/' : 'artifacts/web-parity-v3/'));
const { chromium } = await import(APP + 'node_modules/playwright-core/index.mjs');
const FILE = process.argv[2] || APP + 'index.html';
const OUT = process.env.OMT_SOURCES || (process.env.TMPDIR || '/tmp/') + 'omt-brand-sources/';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce', offline: true });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(FILE).href);
  await page.waitForFunction(() => window.__atelier?.stage?.pill, null, { timeout: 60000 });
  const settle = () => page.waitForFunction(() => { const s = window.__atelier.stage; return s && !s.running && s.pipe.converged; }, null, { timeout: 90000, polling: 250 });
  await page.addStyleTag({ content: '#annot,#labelLayer,.readout,.tour-cap,.toast{visibility:hidden!important}' });
  const left = await page.evaluate(() => document.getElementById('inspector').getBoundingClientRect().right);
  const clip = { x: left, y: 0, width: 1600 - left, height: 900 };
  await page.evaluate(() => window.__atelier.api.applyPresetById('cap22'));
  await page.waitForTimeout(2500); await settle();
  await page.screenshot({ path: OUT + 'lite-specimen.png', clip });
  await page.evaluate(() => window.__atelier.api.setMode('tray'));
  await page.waitForTimeout(5000); await settle();
  await page.screenshot({ path: OUT + 'lite-tray.png', clip });
  console.log('captured to', OUT);
} finally { await browser.close(); }
