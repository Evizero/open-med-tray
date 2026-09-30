// Captures genuine Open Med Tray Lite dataset exports for the landing page:
// runs the app's own Dataset batch (1536 x 768, 32 samples) and saves the
// collection ZIP it downloads. build-brand.mjs reads the chosen scene's
// rgb.png and instance_ids.png from it. Writes to $OMT_SOURCES
// (default $TMPDIR/omt-brand-sources/).
//
//   node brand/tools/capture-landing.mjs [count] [seed]
import { pathToFileURL } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const APP = ROOT + (existsSync(ROOT + 'lite/package.json') ? 'lite/' : (existsSync(ROOT + 'app/package.json') ? 'app/' : 'artifacts/web-parity-v3/'));
const { chromium } = await import(APP + 'node_modules/playwright-core/index.mjs');
const OUT = process.env.OMT_SOURCES || (process.env.TMPDIR || '/tmp/') + 'omt-brand-sources/';
const [count = 6, seed = 4100] = process.argv.slice(2).map(Number);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', offline: true, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(APP + 'index.html').href + '?no-intro');
  await page.waitForFunction(() => window.__atelier?.stage?.pill, null, { timeout: 60000 });
  await page.evaluate(async ({ count, seed }) => {
    const a = window.__atelier.api; await a.setMode('dataset');
    Object.assign(a.state.dataset, { count, seed, res: '1536x768', samples: 32, sampling: 'ordinary', stressProbability: 0 });
    await a.datasetActions.generate();
  }, { count, seed });
  await page.waitForFunction((n) => { const d = window.__atelier.state.dataset; return !d.running && d.scenes.length >= n; }, count, { timeout: 600000, polling: 1000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.__atelier.api.datasetActions.download())]);
  await dl.saveAs(OUT + 'lite-collection.zip');
  execFileSync('unzip', ['-o', '-q', OUT + 'lite-collection.zip', '-d', OUT + 'lite-collection']);
  console.log('saved and unpacked', OUT + 'lite-collection.zip');
} finally { await browser.close(); }
