// Startup cover QA: slow streamed HTTP (cover painted before the bulk
// arrives), intro / no-intro handoff, phone and short-landscape layouts,
// reduced motion, induced WebGL / init / script failures, no-JS, offline
// file:// with zero network. Screenshots and boot-loader.json go to
// artifacts/opus-lite-loader/.
//
//   node qa/boot-loader.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const FILE = new URL('../index.html', import.meta.url).pathname;
const OUT = new URL('../../artifacts/opus-lite-loader/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BODY = readFileSync(FILE);
const text = BODY.toString('utf8');
const byteAt = (s) => Buffer.byteLength(text.slice(0, text.indexOf(s)));
const OFF = { coverEnd: byteAt('<style>@font-face'), cssEnd: byteAt('<div id="app"'), scriptStart: byteAt('<script>/*!'), total: BODY.length };
const report = { file: FILE, offsets: OFF, cases: {}, failures: [] };
const check = (ok, msg) => { if (!ok) { report.failures.push(msg); console.log('FAIL', msg); } return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- server
// /stream: chunked, gated by the test (send(n) releases bytes up to n).
// /broken: the page with a syntax error at the start of the bundle.
let stream = null;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://h').pathname;
  if (path === '/favicon.ico') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  if (path === '/broken') { res.end(text.replace('<script>/*!', '<script>)(/*!')); return; }
  stream = { res, sent: 0, t0: Date.now(), marks: [] };
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
async function send(n, { chunk = 65536, gap = 25 } = {}) {
  const s = stream;
  while (s.sent < Math.min(n, BODY.length)) {
    const end = Math.min(n, BODY.length, s.sent + chunk);
    s.res.write(BODY.subarray(s.sent, end)); s.sent = end;
    if (gap) await sleep(gap);
  }
  s.marks.push({ bytes: s.sent, epochMs: Date.now() });
  if (s.sent >= BODY.length) s.res.end();
}

// ---------------------------------------------------------------- browser
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
// Timeline recorder: cover insertion, paints, step labels, cover exit, handoff boxes.
const recorder = () => {
  const T = window.__qa = { labels: [], coverAt: null, goneAt: null, handoff: null, paints: [], epoch: performance.timeOrigin };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) T.paints.push([e.name, Math.round(e.startTime)]); }).observe({ type: 'paint', buffered: true });
  new MutationObserver(() => {
    const b = document.getElementById('boot'), l = document.getElementById('bootLabel');
    if (b && T.coverAt === null) T.coverAt = Math.round(performance.now());
    const t = l?.textContent, m = document.getElementById('bootMeta')?.textContent;
    if (t && T.labels.at(-1)?.[1] !== t) T.labels.push([Math.round(performance.now()), t, m]);
    if (b?.classList.contains('gone') && T.goneAt === null) {
      T.goneAt = Math.round(performance.now());
      const box = (e) => { const r = e?.getBoundingClientRect(); return r && [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; };
      T.handoff = { introOpen: !!document.getElementById('intro')?.open, appInert: document.getElementById('app').inert, boot: box(b.querySelector('.boot-lockup')), intro: box(document.querySelector('#intro .intro-lockup')) };
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], characterData: true });
};
async function open({ w = 1440, h = 900, mobile = false, reduced = false, js = true, init = null, dpr = 2 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference', javaScriptEnabled: js });
  if (js) { await ctx.addInitScript(recorder); if (init) await ctx.addInitScript(init); }
  const page = await ctx.newPage(), log = { errors: [], console: [], requests: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) log.requests.push(r.url()); });
  return { ctx, page, log };
}
const coverState = (page) => page.evaluate(() => {
  const b = document.getElementById('boot'), cs = b && getComputedStyle(b);
  const anims = document.getAnimations().filter((a) => b?.contains(a.effect?.target)).map((a) => `${a.animationName}:${a.playState}`);
  return b && { visible: cs.display !== 'none' && +cs.opacity > .99, label: document.getElementById('bootLabel')?.textContent, meta: document.getElementById('bootMeta')?.textContent, font: getComputedStyle(b.querySelector('.boot-lockup')).fontFamily, fontsReady: document.fonts.check('600 15px "IBM Plex Sans"'), anims, failed: b.classList.contains('failed'), failTitle: document.getElementById('bootFailTitle')?.textContent, failText: document.getElementById('bootFailText')?.textContent, failDetail: document.getElementById('bootFailDetail')?.textContent, focus: document.activeElement?.id, inert: document.getElementById('app')?.inert };
});
const qa = (page) => page.evaluate(() => ({ ...window.__qa, marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('lite-boot')).map((m) => [m.name, Math.round(m.startTime)]) }));

const ONLY = process.env.ONLY?.split(',');
async function run(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  const t = Date.now();
  try { report.cases[name] = await fn(); } catch (e) { check(false, `${name}: threw ${e.stack || e}`); }
  console.log(`${name} ${Date.now() - t} ms`);
}

// 1. Slow stream, desktop, full boot through the introduction.
await run('stream-desktop-intro', async () => {
  const { ctx, page, log } = await open();
  const nav = page.goto(`${ORIGIN}/stream`, { waitUntil: 'commit' });
  await sleep(150); await send(OFF.coverEnd, { gap: 0 });
  await nav;
  await page.waitForFunction(() => window.__qa.paints.some((p) => p[0] === 'first-contentful-paint'), null, { timeout: 5000 });
  // Contentful: the lockup is fully opaque on the first frame (no fade from 0).
  await sleep(250);
  const r = { beforeBulk: await coverState(page), bytesSentAtFirstPaint: stream.sent };
  await page.screenshot({ path: OUT + '01-stream-cover-only-desktop.png' });
  check(r.beforeBulk?.visible && r.beforeBulk.label === 'Loading the workbench' && r.beforeBulk.anims.some((a) => a.startsWith('boot-sweep:running')), `stream: cover not painted from the first ${OFF.coverEnd} bytes ${JSON.stringify(r.beforeBulk)}`);
  await send(OFF.cssEnd, { gap: 5 }); await sleep(300);
  r.afterFonts = await coverState(page);
  await page.screenshot({ path: OUT + '02-stream-fonts-arrived-desktop.png' });
  await send(BODY.length, { chunk: 65536, gap: 25 });
  await page.waitForFunction(() => document.getElementById('intro').open, null, { timeout: 60000 });
  await sleep(120); await page.screenshot({ path: OUT + '03-handoff-desktop.png' });
  await sleep(1400); await page.screenshot({ path: OUT + '04-intro-desktop.png' });
  const q = await qa(page);
  const lastByte = stream.marks.at(-1).epochMs - q.epoch;
  r.timeline = { ...q, lastByteMs: Math.round(lastByte), fcpBeforeLastByteMs: Math.round(lastByte - (q.paints.find((p) => p[0] === 'first-contentful-paint')?.[1] ?? Infinity)) };
  r.hiddenAfter = await page.evaluate(() => document.getElementById('boot').hidden);
  r.log = log;
  check(r.timeline.fcpBeforeLastByteMs > 1000, `stream: first paint not well before the last byte ${JSON.stringify(r.timeline.paints)}`);
  check(JSON.stringify(q.labels.map((l) => l[1])) === JSON.stringify(['Loading the workbench', 'Decoding fonts and textures', 'Starting the WebGL renderer', 'Building the specimen', 'Drawing the first frame']), `stream: step sequence ${JSON.stringify(q.labels)}`);
  check(q.handoff?.introOpen && !q.handoff.appInert, `stream: handoff ${JSON.stringify(q.handoff)}`);
  check(q.handoff && Math.abs(q.handoff.boot[2] - q.handoff.intro[2]) < .6 && Math.abs(q.handoff.boot[3] - q.handoff.intro[3]) < .6, `stream: boot and intro lockups differ in size ${JSON.stringify(q.handoff)}`);
  check(r.hiddenAfter, 'stream: cover not removed after its fade');
  check(!log.errors.length && !log.console.length, `stream: console ${JSON.stringify(log)}`);
  // Workbench usable after the introduction (the app was inert under the cover).
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('intro').open, null, { timeout: 3000 });
  await page.click('.modes button[data-mode="tray"]', { timeout: 5000 });
  r.afterClose = await page.evaluate(() => ({ mode: window.__atelier.state.mode, inert: document.getElementById('app').inert }));
  check(r.afterClose.mode === 'tray' && !r.afterClose.inert, `stream: workbench not usable ${JSON.stringify(r.afterClose)}`);
  await ctx.close();
  return r;
});

// 2. Cover layouts while streaming: phone, narrow phone, short landscape, reduced motion.
for (const [name, w, h, opt] of [['phone-390', 390, 844, { mobile: true, dpr: 3 }], ['phone-320', 320, 568, { mobile: true }], ['landscape-844x390', 844, 390, { mobile: true }], ['desktop-reduced', 1440, 900, { reduced: true }]]) {
  await run(`stream-cover-${name}`, async () => {
    const { ctx, page } = await open({ w, h, ...opt });
    const nav = page.goto(`${ORIGIN}/stream`, { waitUntil: 'commit' });
    await sleep(100); await send(OFF.cssEnd, { gap: 0 }); await nav;
    await page.waitForFunction(() => window.__qa.paints.length, null, { timeout: 5000 }); await sleep(700);
    const s = await coverState(page);
    const fit = await page.evaluate(() => { const c = document.querySelector('.boot-col').getBoundingClientRect(), l = document.getElementById('bootLabel'); return { col: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], inside: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, labelClipped: l.scrollWidth > l.clientWidth + 1 }; });
    await page.screenshot({ path: OUT + `05-cover-${name}.png` });
    check(s.visible && fit.inside && !fit.labelClipped, `${name}: cover fit ${JSON.stringify({ s, fit })}`);
    if (opt.reduced) check(!s.anims.length, `${name}: animations under reduced motion ${s.anims}`);
    stream.res.destroy(); await ctx.close();
    return { ...s, fit };
  });
}

// 3. Offline file:// boots (no network): intro on phone, no-intro desktop, reduced motion intro.
for (const [name, query, opt] of [['file-phone-intro', '', { w: 390, h: 844, mobile: true, dpr: 3 }], ['file-desktop-no-intro', '?no-intro', {}], ['file-desktop-reduced-intro', '', { reduced: true }]]) {
  await run(name, async () => {
    const { ctx, page, log } = await open(opt);
    await ctx.setOffline(true);
    await page.goto(pathToFileURL(FILE).href + query);
    await page.waitForFunction(() => window.__qa.goneAt !== null, null, { timeout: 60000 });
    await sleep(query ? 900 : 1500);
    const q = await qa(page), r = { timeline: q, state: await coverState(page), intro: await page.evaluate(() => document.getElementById('intro').open), log };
    await page.screenshot({ path: OUT + `06-${name}.png` });
    check(!log.requests.length, `${name}: network requests ${log.requests}`);
    check(!log.errors.length && !log.console.length, `${name}: console ${JSON.stringify(log)}`);
    check(r.intro === !query && q.handoff.introOpen === !query && !q.handoff.appInert, `${name}: handoff ${JSON.stringify(q.handoff)}`);
    if (!query) check(Math.abs(q.handoff.boot[2] - q.handoff.intro[2]) < .6 && Math.abs(q.handoff.boot[3] - q.handoff.intro[3]) < .6 && Math.abs(q.handoff.boot[3] - 24) < .6, `${name}: lockup boxes ${JSON.stringify(q.handoff)}`);
    await ctx.close();
    return r;
  });
}

// 4. Failures: no WebGL, an unexpected init error, a bundle that cannot run, no JavaScript.
const noWebGL = () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; };
const badTexture = () => { const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src'); Object.defineProperty(HTMLImageElement.prototype, 'src', { ...d, set(v) { if (String(v).startsWith('data:image/png')) { setTimeout(() => this.onerror?.(new Event('error'))); return; } d.set.call(this, v); } }); };
// The first rendered sample throws (the render loop fails while the cover is up).
const renderThrows = () => {
  let rafs = 0; const raf = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { rafs++; return raf.call(window, f); }; window.__rafs = () => rafs;
  let at; Object.defineProperty(window, '__atelier', { configurable: true, get: () => at, set(v) {
    at = v; let st; Object.defineProperty(v, 'stage', { configurable: true, get: () => st, set(x) { st = x; x.pipe.renderSample = () => { throw new Error('Injected render failure'); }; } });
  } });
};
for (const [name, target, init, want, view = {}] of [
  ['fail-no-webgl', 'file', noWebGL, { title: "This browser can't draw the 3D workbench", detail: '' }],
  ['fail-render-loop-phone', 'file', renderThrows, { title: "The workbench didn't start", detail: 'Error: Injected render failure', text: 'Startup stopped at: building the specimen.' }, { w: 390, h: 844, mobile: true }],
  ['fail-init-error', 'file', badTexture, { title: "The workbench didn't start", detail: 'Error: Embedded worktop texture could not load', text: 'Startup stopped at: decoding fonts and textures.' }],
  ['fail-script', 'broken', null, { title: "The workbench didn't start", detailHas: 'SyntaxError' }],
]) {
  await run(name, async () => {
    const { ctx, page, log } = await open({ w: 1280, h: 800, init, ...view });
    await page.goto(target === 'file' ? pathToFileURL(FILE).href : `${ORIGIN}/broken`);
    await page.waitForFunction(() => document.getElementById('boot').classList.contains('failed'), null, { timeout: 30000 });
    await sleep(200);
    const s = await coverState(page);
    await page.screenshot({ path: OUT + `07-${name}.png` });
    // Nothing keeps polling or dismisses the failure afterwards; Retry is a full touch target.
    const rafs0 = await page.evaluate(() => window.__rafs?.() ?? null);
    await sleep(800);
    s.after = await page.evaluate(() => ({ failed: document.getElementById('boot').classList.contains('failed'), gone: document.getElementById('boot').classList.contains('gone'), hidden: document.getElementById('boot').hidden, intro: document.getElementById('intro').open, inert: document.getElementById('app').inert }));
    s.rafsWhileFailed = rafs0 === null ? null : (await page.evaluate(() => window.__rafs())) - rafs0;
    s.retryBox = await page.evaluate(() => { const r = document.getElementById('bootRetry').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    check(s.after.failed && !s.after.gone && !s.after.hidden && !s.after.intro && s.after.inert && (s.rafsWhileFailed === null || s.rafsWhileFailed === 0), `${name}: failure not stable ${JSON.stringify(s.after)} rafs ${s.rafsWhileFailed}`);
    check(s.retryBox[0] >= 44 && s.retryBox[1] >= 44, `${name}: retry ${s.retryBox}`);
    check(s.failTitle === want.title && (want.detail === undefined || s.failDetail === want.detail) && (!want.text || s.failText.startsWith(want.text)) && (!want.detailHas || s.failDetail.includes(want.detailHas)), `${name}: copy ${JSON.stringify(s)}`);
    check(!s.anims.some((a) => a.includes('running') && a.startsWith('boot-sweep')) && s.focus === 'bootRetry', `${name}: still animating or retry not focused ${JSON.stringify(s)}`);
    check(log.console.some((c) => c.startsWith('error')) || log.errors.length, `${name}: nothing in the console`);
    // Try again reloads the page.
    const reloaded = page.waitForEvent('framenavigated', { timeout: 5000 }).then(() => true, () => false);
    await page.click('#bootRetry');
    const r = { ...s, console: log.console.slice(0, 3), pageErrors: log.errors.slice(0, 2), retryReloads: await reloaded };
    check(r.retryReloads, `${name}: retry did not reload`);
    await ctx.close();
    return r;
  });
}
await run('no-js', async () => {
  const { ctx, page } = await open({ w: 390, h: 844, mobile: true, js: false });
  await page.goto(pathToFileURL(FILE).href);
  const s = await page.evaluate(() => ({ note: document.querySelector('.boot-nojs')?.getBoundingClientRect().height > 0, track: getComputedStyle(document.querySelector('.boot-track')).display, text: document.querySelector('.boot-nojs')?.textContent }));
  await page.screenshot({ path: OUT + '08-no-js-phone.png' });
  check(s.note && s.track === 'none', `no-js: ${JSON.stringify(s)}`);
  await ctx.close();
  return s;
});

await browser.close(); server.close();
writeFileSync(OUT + 'boot-loader.json', JSON.stringify(report, null, 2));
console.log(report.failures.length ? `${report.failures.length} FAILURES` : 'ALL PASS');
process.exit(report.failures.length ? 1 : 0);
