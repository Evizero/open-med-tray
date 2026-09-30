// Focused check: after switching to a capsule and resizing, reopening the
// introduction still shows the fixed example drawing (scored round, P10).
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const FILE = process.argv[2] || new URL('../../index.html', import.meta.url).pathname;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, offline: true })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(pathToFileURL(FILE).href);
await p.waitForFunction(() => window.__atelier?.api?.intro?.open, null, { timeout: 60000 });
await p.waitForTimeout(1500); await p.keyboard.press('Escape'); await p.waitForTimeout(800);
await p.evaluate(() => window.__atelier.api.applyPresetById('cap22')); await p.waitForTimeout(1500);
const shot = async (tag) => {
  const r = await p.evaluate(() => { const s = document.querySelector('#introPlate svg'); return { kind: window.__atelier.state.spec.kind, svg: !!s, label: s?.getAttribute('aria-label'), imprint: s?.querySelector('.bp-imp')?.textContent, dims: [...(s?.querySelectorAll('.bp-tx') ?? [])].map((t) => t.textContent), caption: document.querySelector('.intro-plate-cap').textContent }; });
  await p.screenshot({ path: new URL(`shots/reopen-example-${tag}.png`, import.meta.url).pathname }); return r;
};
await p.click('#brandBtn'); await p.waitForTimeout(1600);
const a = await shot('capsule');
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
const c = await shot('capsule-resized');
await b.close();
const ok = (r) => r.kind === 'capsule' && r.svg && r.imprint === 'P10' && r.label.startsWith('Example drawing of a scored round') && r.dims.includes('Ø 8.60') && r.caption.startsWith('Example drawing');
console.log(JSON.stringify({ a, c, errors }));
console.log(ok(a) && ok(c) && !errors.length ? 'PASS fixed example after capsule + resize' : 'FAIL');
process.exitCode = ok(a) && ok(c) && !errors.length ? 0 : 1;
