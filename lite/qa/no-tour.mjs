// Tour removal regression (desktop + phone): startup cover leaves into the
// introduction, the sheet offers one action and closes, the mode switch works
// by pointer and keys, T / Space do nothing, no tour markup or API, no page
// errors or network. Screenshots and no-tour.json go to artifacts/opus-remove-tour/.
//
//   node qa/no-tour.mjs
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const FILE = new URL('../index.html', import.meta.url).pathname;
const OUT = new URL('../../artifacts/opus-remove-tour/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const report = { file: FILE, cases: {}, failures: [] };
const check = (ok, msg) => { if (!ok) { report.failures.push(msg); console.log('FAIL', msg); } return ok; };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

for (const [name, w, h, mobile] of [['desktop-1440', 1440, 900, false], ['phone-390', 390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, offline: true });
  await ctx.addInitScript(() => {
    window.__gone = null;
    new MutationObserver(() => { const b = document.getElementById('boot'); if (b?.classList.contains('gone') && !window.__gone) window.__gone = { introOpen: !!document.getElementById('intro')?.open, inert: document.getElementById('app').inert }; }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const page = await ctx.newPage(), log = { errors: [], requests: [] }, r = {};
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('request', (q) => { if (!/^(file|data|blob):/.test(q.url())) log.requests.push(q.url()); });
  await page.goto(pathToFileURL(FILE).href);
  await page.waitForFunction(() => document.getElementById('intro').open && window.__gone, null, { timeout: 60000 });
  await page.waitForTimeout(1600);
  r.handoff = await page.evaluate(() => window.__gone);
  check(r.handoff.introOpen && !r.handoff.inert, `${name}: cover handoff ${JSON.stringify(r.handoff)}`);
  r.sheet = await page.evaluate(() => ({ actions: [...document.querySelectorAll('.intro-actions button')].map((b) => ({ id: b.id, h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })), focus: document.activeElement?.id }));
  check(r.sheet.actions.length === 1 && r.sheet.actions[0].id === 'introGo' && r.sheet.focus === 'introGo', `${name}: sheet actions ${JSON.stringify(r.sheet)}`);
  await page.screenshot({ path: OUT + `intro-${name}.png` });
  await page.click('#introGo');
  await page.waitForFunction(() => !document.getElementById('intro').open, null, { timeout: 3000 });
  await page.waitForTimeout(700);
  r.noTour = await page.evaluate(() => ({ markup: [...document.querySelectorAll('[id*="tour" i], [class*="tour" i]')].map((e) => e.id || e.className), state: 'tour' in window.__atelier.state, api: Object.keys(window.__atelier.api).filter((k) => /tour/i.test(k)), rail: [...document.querySelectorAll('#rail button')].filter((b) => b.getClientRects().length).map((b) => b.id || b.dataset.mode) }));
  check(!r.noTour.markup.length && !r.noTour.state && !r.noTour.api.length, `${name}: tour remnants ${JSON.stringify(r.noTour)}`);
  check(JSON.stringify(r.noTour.rail) === JSON.stringify(mobile ? ['brandBtn', 'specimen', 'tray', 'dataset'] : ['brandBtn', 'specimen', 'tray', 'dataset', 'resetBtn']), `${name}: rail ${JSON.stringify(r.noTour.rail)}`);
  // T and Space are not shortcuts: nothing changes.
  const snap = () => page.evaluate(() => ({ mode: window.__atelier.state.mode, preset: window.__atelier.state.presetId, intro: document.getElementById('intro').open, anims: window.__atelier.stage.animations.size }));
  const before = await snap();
  for (const k of ['t', 'T', ' ']) await page.keyboard.press(k);
  await page.waitForTimeout(300);
  r.keys = { before, after: await snap() };
  check(JSON.stringify(r.keys.before) === JSON.stringify(r.keys.after), `${name}: T/Space changed state ${JSON.stringify(r.keys)}`);
  // Mode switch by pointer, then by key.
  r.modes = [];
  for (const m of ['tray', 'dataset', 'specimen']) {
    const sel = `.modes button[data-mode="${m}"]`;
    if (mobile) await page.tap(sel); else await page.click(sel);
    await page.waitForTimeout(m === 'tray' ? 2500 : 900);
    r.modes.push([m, await page.evaluate(() => window.__atelier.state.mode)]);
  }
  await page.keyboard.press('2'); await page.waitForTimeout(1200);
  r.modes.push(['key 2', await page.evaluate(() => window.__atelier.state.mode)]);
  check(JSON.stringify(r.modes) === JSON.stringify([['tray', 'tray'], ['dataset', 'dataset'], ['specimen', 'specimen'], ['key 2', 'tray']]), `${name}: modes ${JSON.stringify(r.modes)}`);
  await page.screenshot({ path: OUT + `workbench-tray-${name}.png` });
  // The mark reopens the introduction; Esc closes it again.
  if (mobile) await page.tap('#brandBtn'); else await page.click('#brandBtn');
  await page.waitForTimeout(900);
  r.reopen = await page.evaluate(() => document.getElementById('intro').open);
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  r.reclosed = await page.evaluate(() => !document.getElementById('intro').open);
  check(r.reopen && r.reclosed, `${name}: reopen/close ${r.reopen} ${r.reclosed}`);
  r.log = log;
  check(!log.errors.length && !log.requests.length, `${name}: errors/requests ${JSON.stringify(log)}`);
  report.cases[name] = r;
  console.log(name, JSON.stringify({ handoff: r.handoff, sheet: r.sheet, rail: r.noTour.rail, modes: r.modes }));
  await ctx.close();
}
await browser.close();
writeFileSync(OUT + 'no-tour.json', JSON.stringify(report, null, 2));
console.log(report.failures.length ? `${report.failures.length} FAILURES` : 'ALL PASS');
process.exit(report.failures.length ? 1 : 0);
