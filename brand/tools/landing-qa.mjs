// Landing-page QA: layout bounds, hero label alignment (numerical), contour
// fidelity against the raw Lite ID map, target-stack layer registration and
// scroll stages, reduced motion, links, requests and errors. Screenshots and a
// JSON report go to brand/qa/landing/.
//
//   node brand/tools/landing-qa.mjs [before.html]
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readPNG } from './png-read.mjs';
import { HERO_SCENE } from './landing-assets.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const APP = ROOT + (existsSync(ROOT + 'app/package.json') ? 'app/' : existsSync(ROOT + 'lite/package.json') ? 'lite/' : 'artifacts/web-parity-v3/');
const { chromium } = await import(APP + 'node_modules/playwright-core/index.mjs');
const OUT = ROOT + 'brand/qa/landing/'; mkdirSync(OUT, { recursive: true });
const PAGE = pathToFileURL(ROOT + 'index.html').href, BEFORE = process.argv[2];
const SOURCES = process.env.OMT_SOURCES || (process.env.TMPDIR || '/tmp/') + 'omt-brand-sources/';
const V = [['desktop-1440', 1440, 900], ['macbook-1280', 1280, 720], ['phone-390', 390, 844], ['phone-320', 320, 568], ['landscape-844', 844, 390]];
const report = { page: 'index.html', viewports: {}, failures: [] };
const fail = (m) => { report.failures.push(m); console.log('FAIL', m); };

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
async function open(w, h, { reduced = false, url = PAGE } = {}) {
  const mobile = w < 900 && h > w;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference', offline: true });
  const page = await ctx.newPage(), log = { errors: [], requests: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(file|data):/.test(r.url())) log.requests.push(r.url()); });
  await page.goto(url);
  return { page, ctx, log };
}

// Hero: every label centroid mapped through the SVG's screen CTM must land on
// the same CSS pixel as the image's own pixel grid, and the image must be the
// expected cover fit of the figure. Divider and clip must agree too.
const alignment = (page) => page.evaluate(() => {
  const svg = document.getElementById('scanSvg'), img = document.getElementById('heroImg'), fig = document.getElementById('scan');
  const L = JSON.parse(document.getElementById('heroLabels').textContent), m = svg.getScreenCTM(), ir = img.getBoundingClientRect(), fr = fig.getBoundingClientRect();
  let worst = 0;
  const pts = [[0, 0], [L.w, L.h], [L.w / 2, L.h / 2], ...L.items.map((i) => [i.cx, i.cy])];
  for (const [x, y] of pts) {
    const p = new DOMPoint(x, y).matrixTransform(m), q = [ir.left + x / L.w * ir.width, ir.top + y / L.h * ir.height];
    worst = Math.max(worst, Math.abs(p.x - q[0]), Math.abs(p.y - q[1]));
  }
  const s = Math.max(fr.width / L.w, fr.height / L.h), exp = [fr.left + (fr.width - L.w * s) / 2, fr.top + (fr.height - L.h * s) / 2, L.w * s, L.h * s];
  const fitErr = Math.max(Math.abs(ir.left - exp[0]), Math.abs(ir.top - exp[1]), Math.abs(ir.width - exp[2]), Math.abs(ir.height - exp[3]));
  const clip = document.querySelector('#split rect'), dr = document.getElementById('divider').getBoundingClientRect();
  const clipEdge = new DOMPoint(+clip.getAttribute('width'), 0).matrixTransform(m).x;
  return { points: pts.length, ctmVsImagePx: +worst.toFixed(3), coverFitPx: +fitErr.toFixed(3), dividerVsClipPx: +Math.abs(clipEdge - dr.left).toFixed(3) };
});
// Target stack: all layers share one box, one natural size and one fit.
const stackReg = (page) => page.evaluate(() => {
  const im = [...document.querySelectorAll('#plate img')], r0 = im[0].getBoundingClientRect(), c0 = getComputedStyle(im[0]);
  return { layers: im.length, sameBox: im.every((i) => { const r = i.getBoundingClientRect(); return Math.abs(r.left - r0.left) < .01 && Math.abs(r.top - r0.top) < .01 && Math.abs(r.width - r0.width) < .01 && Math.abs(r.height - r0.height) < .01; }),
    sameNatural: im.every((i) => i.naturalWidth === im[0].naturalWidth && i.naturalHeight === im[0].naturalHeight), natural: [im[0].naturalWidth, im[0].naturalHeight],
    sameFit: im.every((i) => { const c = getComputedStyle(i); return c.objectFit === c0.objectFit && c.objectPosition === c0.objectPosition; }), fit: c0.objectFit + ' ' + c0.objectPosition };
});
// Visible text must sit inside the viewport and not overflow its own box.
const bounds = (page) => page.evaluate(() => {
  const bad = [];
  for (const e of document.querySelectorAll('h1, h1 span, h2, h3, p, a, button, dt, dd, figcaption, .legend span, .ticker b, .ticker span')) {
    const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).visibility === 'hidden') continue;
    if (r.left < -.5 || r.right > innerWidth + .5 || e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') bad.push(`${e.tagName}.${e.className}:${e.textContent.trim().slice(0, 28)} [${Math.round(r.left)},${Math.round(r.right)}]`);
  }
  return { docOverflow: document.documentElement.scrollWidth - innerWidth, bad };
});

for (const [name, w, h] of V) {
  const { page, ctx, log } = await open(w, h), r = {};
  await page.waitForTimeout(3800);
  r.bounds = await bounds(page);
  if (r.bounds.docOverflow > 0 || r.bounds.bad.length) fail(`${name} text bounds ${JSON.stringify(r.bounds)}`);
  r.brand = await page.evaluate(() => { const b = document.querySelector('.brand span').getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), fontPx: parseFloat(getComputedStyle(document.querySelector('.brand')).fontSize) }; });
  r.alignment = await alignment(page);
  await page.screenshot({ path: OUT + `${name}-hero.png` });
  // Full labels, then resize and re-check the same numbers.
  await page.focus('#knob'); await page.keyboard.press('End'); await page.waitForTimeout(100);
  r.alignmentFull = await alignment(page);
  await page.setViewportSize({ width: Math.round(w * .82), height: Math.round(h * .9) }); await page.waitForTimeout(250);
  r.alignmentResized = await alignment(page);
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
  for (const k of ['alignment', 'alignmentFull', 'alignmentResized']) { const a = r[k]; if (a.ctmVsImagePx >= 1 || a.coverFitPx >= 1 || a.dividerVsClipPx >= 1) fail(`${name} ${k} ${JSON.stringify(a)}`); }
  await page.keyboard.press('Home'); await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80);
  r.sliderKeys = await page.$eval('#knob', (k) => k.getAttribute('aria-valuenow'));
  // Scroll through every target stage.
  r.stages = [];
  const N = await page.$$eval('#plate img', (a) => a.length);
  for (let k = 0; k < N; k++) {
    await page.evaluate((f) => { const s = document.getElementById('targets'); scrollTo(0, s.getBoundingClientRect().top + scrollY + (s.offsetHeight - innerHeight) * f); }, k / (N - 1));
    await page.waitForTimeout(260);
    const st = await page.evaluate(() => ({ active: document.querySelector('#targetList [aria-current="true"]')?.textContent.trim().split(/\s+/)[0] ?? document.getElementById('tickName').textContent, tick: document.getElementById('tickName').textContent, legend: document.getElementById('legend').textContent.trim().slice(0, 40), clips: [...document.querySelectorAll('#plate img')].map((i) => i.style.clipPath) }));
    r.stages.push(st);
    if (k === 1 || k === 3 || k === 4) await page.screenshot({ path: OUT + `${name}-stack-${k}.png` });
  }
  r.stack = await stackReg(page);
  if (!r.stack.sameBox || !r.stack.sameNatural || !r.stack.sameFit) fail(`${name} stack registration ${JSON.stringify(r.stack)}`);
  r.stackBounds = await bounds(page);
  if (r.stackBounds.bad.length) fail(`${name} stack text bounds ${JSON.stringify(r.stackBounds.bad)}`);
  await page.evaluate(() => document.getElementById('editions').scrollIntoView()); await page.waitForTimeout(1300);
  await page.screenshot({ path: OUT + `${name}-editions.png` });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + `${name}-close.png` });
  r.log = log;
  if (log.errors.length || log.requests.length) fail(`${name} errors/requests ${JSON.stringify(log)}`);
  report.viewports[name] = r; await ctx.close();
  console.log(name, JSON.stringify({ align: r.alignment, full: r.alignmentFull, resized: r.alignmentResized, brand: r.brand, stack: r.stack.fit }));
}

// Reduced motion: no sweep or settle; divider rests at once; reveals shown.
{
  const { page, ctx, log } = await open(1440, 900, { reduced: true });
  await page.waitForTimeout(150);
  report.reducedMotion = await page.evaluate(() => ({ divider: document.getElementById('knob').getAttribute('aria-valuenow'), svgAnimations: document.getElementById('scanSvg').getAnimations().length, riseAnimations: document.querySelector('.brand').getAnimations().length, revealed: [...document.querySelectorAll('.reveal')].every((e) => e.classList.contains('in')) }));
  if (report.reducedMotion.divider !== '56' || report.reducedMotion.svgAnimations || report.reducedMotion.riseAnimations || !report.reducedMotion.revealed) fail('reduced motion ' + JSON.stringify(report.reducedMotion));
  await page.screenshot({ path: OUT + 'reduced-motion-hero.png' });
  if (log.errors.length) fail('reduced errors ' + log.errors);
  await ctx.close();
}

// Links: in-page anchors resolve; relative targets exist in the final layout
// (lite/index.html is produced by the parent's relocation of the app build);
// GitHub targets are listed for verification after the push.
{
  const { page, ctx } = await open(1440, 900);
  report.links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href'), anchorOk: a.getAttribute('href').startsWith('#') ? !!document.querySelector(a.getAttribute('href')) : null })));
  for (const l of report.links) if (l.anchorOk === false) fail('dead anchor ' + l.href);
  report.linkTargets = [...new Set(report.links.map((l) => l.href))];
  await ctx.close();
}

// Contour fidelity at native resolution: rasterise each simplified outline and
// compare it with its region in the raw 16-bit ID map of the same export.
{
  const dir = SOURCES + 'lite-collection/pill-atelier-dataset/' + HERO_SCENE + '/';
  if (existsSync(dir + 'instance_ids.png')) {
    const inst = readPNG(dir + 'instance_ids.png');
    const { page, ctx } = await open(1440, 900);
    const L = JSON.parse(await page.$eval('#heroLabels', (e) => e.textContent));
    if (L.w !== inst.width || L.h !== inst.height) fail('label grid differs from ID map');
    const masks = await page.evaluate((L) => L.items.map((it) => {
      const c = new OffscreenCanvas(L.w, L.h), x = c.getContext('2d'); x.fill(new Path2D(it.d), 'evenodd');
      const a = x.getImageData(0, 0, L.w, L.h).data, on = []; for (let i = 3; i < a.length; i += 4) if (a[i] >= 128) on.push((i - 3) / 4); return on;
    }), L);
    report.contours = L.items.map((it, k) => {
      const truth = new Set(); for (let i = 0; i < inst.data.length; i++) if (inst.data[i] === it.id) truth.add(i);
      const drawn = new Set(masks[k]); let inter = 0; for (const i of drawn) if (truth.has(i)) inter++;
      const iou = inter / (truth.size + drawn.size - inter), perim = 2 * Math.PI * Math.sqrt(truth.size / Math.PI);
      return { id: it.id, cls: it.cls, pixels: truth.size, iou: +iou.toFixed(4), meanEdgeErrorPx: +((truth.size + drawn.size - 2 * inter) / perim).toFixed(3) };
    });
    for (const c of report.contours) if (c.iou < .95 || c.meanEdgeErrorPx > .6) fail('contour fidelity ' + JSON.stringify(c));
    // Native-resolution overlay of outlines on the export's own render.
    const rgb = 'data:image/png;base64,' + (await import('node:fs')).readFileSync(dir + 'rgb.png').toString('base64');
    const p2 = await ctx.newPage(); await p2.setViewportSize({ width: L.w, height: L.h });
    await p2.setContent(`<body style="margin:0"><svg width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}"><image href="${rgb}" width="${L.w}" height="${L.h}"/>${L.items.map((i) => `<path d="${i.d}" fill="none" stroke="#1B64BE" stroke-width="1.5"/>`).join('')}</svg>`);
    await p2.screenshot({ path: OUT + 'contours-native-overlay.png' });
    await ctx.close();
  } else report.contours = 'skipped: Lite source export not present (' + dir + ')';
}

// Before/after: the same phone view with the divider at full labels.
for (const [tag, url] of [['after', PAGE], ...(BEFORE ? [['before', pathToFileURL(BEFORE).href]] : [])]) {
  for (const [name, w, h] of [['phone-390', 390, 844], ['landscape-844', 844, 390]]) {
    const { page, ctx } = await open(w, h, { url });
    await page.waitForTimeout(3800); await page.focus('#knob'); await page.keyboard.press('End'); await page.waitForTimeout(150);
    await page.evaluate(() => document.getElementById('scan').scrollIntoView({ block: 'end' })); await page.waitForTimeout(100);
    await page.screenshot({ path: OUT + `${tag}-alignment-${name}.png` });
    await ctx.close();
  }
}

await browser.close();
report.pass = report.failures.length === 0;
writeFileSync(OUT + 'landing-qa.json', JSON.stringify(report, null, 1));
console.log(report.pass ? 'PASS landing QA' : `FAIL landing QA (${report.failures.length})`);
process.exitCode = report.pass ? 0 : 1;
