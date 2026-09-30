// Introduction sheet QA (ui/intro.js): per viewport, checks that the sheet
// opens before the workbench is revealed, fits or scrolls with its last line
// visible, traps focus, blocks workbench shortcuts and pointer input, closes
// on Escape without a camera jump, leaves the workbench usable, reopens from
// the rail mark with focus restored, enters the tour, and honours reduced
// motion. No console errors, no network. Screenshots, a recording of the
// entrance and exit and intro-qa.json go to qa/intro/shots/.
//
//   node qa/intro/intro-qa.mjs [path/to/open-med-tray-lite.html]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HERE = new URL('.', import.meta.url).pathname, OUT = HERE + 'shots/';
const FILE = process.argv[2] || new URL('../../index.html', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const V = [['desktop-1440', 1440, 900], ['macbook-1280', 1280, 720], ['phone-390', 390, 844], ['phone-320', 320, 568], ['landscape-844', 844, 390]];
const report = { file: FILE, viewports: {}, failures: [] };
const check = (ok, msg) => { if (!ok) { report.failures.push(msg); console.log('FAIL', msg); } return ok; };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function open(w, h, { reduced = false, video = null } = {}) {
  const mobile = w < 900 && h > w;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference', offline: true, ...(video ? { recordVideo: { dir: video, size: { width: w, height: h } } } : {}) });
  // Record the moment the boot cover goes: the sheet must already be open.
  await ctx.addInitScript(() => {
    window.__introBoot = null;
    new MutationObserver(() => { const b = document.getElementById('boot'); if (b?.classList.contains('gone') && !window.__introBoot) window.__introBoot = { introOpen: !!document.getElementById('intro')?.open }; }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const page = await ctx.newPage(), log = { errors: [], requests: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('maxLeafSize')) log.errors.push(m.type() + ': ' + m.text()); });
  page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) log.requests.push(r.url()); });
  await page.goto(pathToFileURL(FILE).href);
  await page.waitForFunction(() => window.__atelier?.api?.intro?.open && document.getElementById('intro').open, null, { timeout: 60000 });
  return { page, ctx, log };
}
const inDialog = (page) => page.evaluate(() => document.getElementById('intro').contains(document.activeElement));
const cam = (page) => page.evaluate(() => { const s = window.__atelier.stage, p = s.studioCam.position; return { p: [p.x, p.y, p.z], d: p.distanceTo(s.controls.target), flying: s.animations.size, controls: s.controls.enabled }; });

for (const [name, w, h] of V) {
  const { page, ctx, log } = await open(w, h), r = {};
  await page.waitForTimeout(2200);
  r.boot = await page.evaluate(() => window.__introBoot);
  check(r.boot?.introOpen === true, `${name}: sheet not open when the boot cover left`);
  r.dialog = await page.evaluate(() => { const d = document.getElementById('intro'); return { name: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent, focus: document.activeElement?.id }; });
  check(r.dialog.name?.startsWith('Build pills') && r.dialog.focus === 'introGo', `${name}: dialog name/initial focus ${JSON.stringify(r.dialog)}`);
  // Fit: sheet inside the viewport; text inside the sheet; copy scrolls if needed, last line reachable.
  r.fit = await page.evaluate(async () => {
    const sh = document.getElementById('introSheet').getBoundingClientRect(), sc = document.querySelector('.intro-scroll');
    const out = []; for (const e of document.querySelectorAll('#introSheet h2, #introSheet p, #introSheet li, #introSheet button, .intro-lockup')) { const r = e.getBoundingClientRect(); if (r.width && (r.right > sh.right + .5 || r.left < sh.left - .5 || e.scrollWidth > e.clientWidth + 1)) out.push(e.className || e.tagName); }
    const scrolls = sc.scrollHeight > sc.clientHeight + 1; sc.scrollTop = sc.scrollHeight; await new Promise((f) => setTimeout(f, 60));
    const last = document.querySelector('.intro-lite').getBoundingClientRect(), box = sc.getBoundingClientRect();
    const res = { sheet: [Math.round(sh.left), Math.round(sh.top), Math.round(sh.width), Math.round(sh.height)], inViewport: sh.left >= -.5 && sh.top >= -.5 && sh.right <= innerWidth + .5 && sh.bottom <= innerHeight + .5, overflowingText: out, scrolls, lastLineVisible: last.bottom <= box.bottom + .5, footerRuleWhenScrolled: document.querySelector('.intro-main').classList.contains('scrolls') };
    sc.scrollTop = 0; return res;
  });
  check(r.fit.inViewport && !r.fit.overflowingText.length && r.fit.lastLineVisible, `${name}: fit ${JSON.stringify(r.fit)}`);
  await page.screenshot({ path: OUT + `${name}-open.png` });
  if (r.fit.scrolls) { await page.evaluate(() => { const s = document.querySelector('.intro-scroll'); s.scrollTop = s.scrollHeight; }); await page.waitForTimeout(120); await page.screenshot({ path: OUT + `${name}-open-scrolled.png` }); await page.evaluate(() => { document.querySelector('.intro-scroll').scrollTop = 0; }); }
  // Focus trap in both directions.
  let trapped = true; for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); trapped &&= await inDialog(page); }
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Shift+Tab'); trapped &&= await inDialog(page); }
  r.focusTrap = trapped; check(trapped, `${name}: focus left the dialog`);
  // Workbench shortcuts and pointer are blocked.
  const before = await page.evaluate(() => ({ mode: window.__atelier.state.mode, tour: window.__atelier.state.tour.playing, presetId: window.__atelier.state.presetId }));
  for (const k of ['2', '3', 't', 'r', 'l', ']', '0']) await page.keyboard.press(k);
  await page.waitForTimeout(150);
  const afterKeys = await page.evaluate(() => ({ mode: window.__atelier.state.mode, tour: window.__atelier.state.tour.playing, presetId: window.__atelier.state.presetId }));
  r.shortcutsBlocked = JSON.stringify(before) === JSON.stringify(afterKeys); check(r.shortcutsBlocked, `${name}: shortcut reached the workbench ${JSON.stringify(afterKeys)}`);
  r.pointerBlocked = await page.evaluate(() => { const t = document.querySelector('.modes button[data-mode="tray"]').getBoundingClientRect(), e = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return document.getElementById('intro').contains(e); });
  check(r.pointerBlocked, `${name}: workbench control reachable by pointer`);
  // Escape: the camera starts its pull-back from exactly the held pose.
  const held = await cam(page);
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);
  const start = await cam(page);
  r.camera = { heldDistance: +held.d.toFixed(2), jumpAtCloseMm: +Math.hypot(...start.p.map((v, i) => v - held.p[i])).toFixed(3), flying: start.flying };
  await page.waitForFunction(() => !document.getElementById('intro').open, null, { timeout: 3000 });
  await page.waitForFunction(() => !window.__atelier.stage.animations.size && window.__atelier.stage.controls.enabled, null, { timeout: 8000 });
  const settled = await cam(page); r.camera.pulledBackMm = +Math.hypot(...settled.p.map((v, i) => v - held.p[i])).toFixed(2);
  check(r.camera.jumpAtCloseMm < held.d * .03 && r.camera.flying > 0 && r.camera.pulledBackMm > 1, `${name}: camera ${JSON.stringify(r.camera)}`);
  r.afterClose = await page.evaluate(() => ({ inert: document.querySelectorAll('[inert]').length, focusInDialog: document.getElementById('intro').contains(document.activeElement), open: window.__atelier.api.intro.open }));
  check(!r.afterClose.inert && !r.afterClose.focusInDialog && !r.afterClose.open, `${name}: after close ${JSON.stringify(r.afterClose)}`);
  // The workbench works: shortcut, orbit by drag.
  await page.keyboard.press('2'); await page.waitForTimeout(400); const modeTray = await page.evaluate(() => window.__atelier.state.mode);
  await page.keyboard.press('1'); await page.waitForTimeout(600);
  const c0 = await cam(page), box = await page.evaluate(() => { const f = window.__atelier.stage.free; return { x: f.x + f.w / 2, y: f.y + f.h / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 10, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
  const c1 = await cam(page);
  r.workbench = { shortcut: modeTray, orbitMovedMm: +Math.hypot(...c1.p.map((v, i) => v - c0.p[i])).toFixed(2) };
  check(modeTray === 'tray' && r.workbench.orbitMovedMm > .5, `${name}: workbench after close ${JSON.stringify(r.workbench)}`);
  await page.screenshot({ path: OUT + `${name}-after-close.png` });
  // Reopen from the rail mark; close with the primary action; focus returns to the mark.
  await page.click('#brandBtn'); await page.waitForTimeout(900);
  const reopened = await page.evaluate(() => ({ open: window.__atelier.api.intro.open, focus: document.getElementById('intro').contains(document.activeElement) }));
  await page.click('#introGo'); await page.waitForTimeout(700);
  r.reopen = { ...reopened, returned: await page.evaluate(() => document.activeElement?.id) };
  check(reopened.open && reopened.focus && r.reopen.returned === 'brandBtn', `${name}: reopen ${JSON.stringify(r.reopen)}`);
  // Tour from the sheet.
  await page.click('#brandBtn'); await page.waitForTimeout(900); await page.click('#introTour'); await page.waitForTimeout(700);
  r.tour = await page.evaluate(() => window.__atelier.state.tour.playing); check(r.tour, `${name}: tour did not start`);
  await page.evaluate(() => window.__atelier.api.stopTour());
  r.log = log; check(!log.errors.length && !log.requests.length, `${name}: errors/requests ${JSON.stringify(log)}`);
  report.viewports[name] = r; await ctx.close();
  console.log(name, JSON.stringify({ fit: r.fit, camera: r.camera, workbench: r.workbench }));
}

// Reduced motion: no animations; Escape closes at once; no camera flight.
{
  const { page, ctx, log } = await open(1440, 900, { reduced: true });
  await page.waitForTimeout(600);
  const a = await page.evaluate(() => ({ animations: document.getElementById('intro').getAnimations({ subtree: true }).filter((x) => x.playState === 'running').length, flying: window.__atelier.stage.animations.size }));
  await page.screenshot({ path: OUT + 'reduced-motion-open.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(60);
  report.reducedMotion = { ...a, closedAfter60ms: await page.evaluate(() => !document.getElementById('intro').open), flyingAfterClose: await page.evaluate(() => window.__atelier.stage.animations.size), errors: log.errors };
  check(!a.animations && report.reducedMotion.closedAfter60ms && !report.reducedMotion.flyingAfterClose && !log.errors.length, 'reduced motion ' + JSON.stringify(report.reducedMotion));
  await ctx.close();
}

// Recording: load, entrance, a beat, primary action, exit into the bench.
for (const [name, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  const dir = OUT + 'video-tmp/'; rmSync(dir, { recursive: true, force: true });
  const { page, ctx } = await open(w, h, { video: dir });
  await page.waitForTimeout(2600); await page.click('#introGo'); await page.waitForTimeout(3800);
  await ctx.close();
  const webm = dir + readdirSync(dir)[0];
  try { execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-vf', `scale=${Math.min(w, 960)}:-2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', OUT + `intro-${name}.mp4`]); } catch { renameSync(webm, OUT + `intro-${name}.webm`); }
  rmSync(dir, { recursive: true, force: true });
}

await browser.close();
report.pass = !report.failures.length;
writeFileSync(OUT + 'intro-qa.json', JSON.stringify(report, null, 1));
console.log(report.pass ? 'PASS intro QA' : `FAIL intro QA (${report.failures.length})`);
process.exitCode = report.pass ? 0 : 1;
