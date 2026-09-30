// Phone Dataset dock: "Scenes to add" above Generate & add over the collapsed
// sheet. Count sync with the panel footer, requested count and append, the
// running / cancel state and duplicate-start guard, scene-inspector priority,
// last-tile reachability, and layout at 320 / 390 px, short landscape, the
// expanded sheet and desktop. One touch page resized through every size so
// the same IndexedDB collection is reused (768 × 384, 4 spp, 1–2 scenes per
// batch). Writes checks and screenshots to artifacts/opus-dataset-actions/.
import { withPage } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const DIR = process.argv[2] || new URL('../../artifacts/opus-dataset-actions/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const checks = [];
let failed = 0;
function ok(name, pass, detail) {
  checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
}
const shot = (page, name) => page.screenshot({ path: `${DIR}/${name}.png` });

const probe = (page) => page.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
  const vis = (e) => { const cs = getComputedStyle(e), b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05 && b.width > 0; };
  const d = window.__atelier.state.dataset, dock = $('dsDock');
  const fits = (e) => !vis(e) || e.scrollWidth <= e.clientWidth + .5;
  return {
    vw: innerWidth, vh: innerHeight, on: $('app').classList.contains('dock-on'), visible: vis(dock), running: dock.classList.contains('running'),
    dock: r(dock), row: r(dock.querySelector('.dock-row')), go: r($('dockGo')), minus: r($('dockMinus')), plus: r($('dockPlus')), input: r($('dockCount')),
    panelTop: $('inspector').getBoundingClientRect().top, headBottom: document.querySelector('.sheet-head').getBoundingClientRect().bottom,
    count: d.count, dockValue: $('dockCount').value, footValue: $('dsBatchCount')?.value ?? null,
    dockDisabled: [$('dockCount').disabled, $('dockMinus').disabled, $('dockPlus').disabled], footDisabled: $('dsBatchCount') ? [$('dsBatchCount').disabled, $('dsCountMinus').disabled, $('dsCountPlus').disabled] : null,
    goText: $('dockGoText').textContent, goAria: $('dockGo').getAttribute('aria-disabled'), state: $('dockState').textContent,
    textFits: fits(dock.querySelector('.dock-lbl')) && fits($('dockState')) && fits($('dockGoText')),
    names: { group: dock.getAttribute('aria-label'), input: $('dockCount').getAttribute('aria-label'), minus: $('dockMinus').getAttribute('aria-label'), plus: $('dockPlus').getAttribute('aria-label'), go: $('dockGo').textContent.trim() },
    mode: window.__atelier.state.mode, scenes: d.scenes.length, dsRunning: d.running, status: d.status, slots: document.querySelectorAll('#sheetGrid .slot').length,
  };
});
// No collected tile may sit under the dock (short landscape: the gutter).
const tileOverlap = (page) => page.evaluate(() => {
  const d = document.getElementById('dsDock').getBoundingClientRect();
  return [...document.querySelectorAll('#sheetGrid .tile')].map((t) => t.getBoundingClientRect()).filter((t) => t.right > d.left + .5 && t.left < d.right - .5 && t.bottom > d.top + .5 && t.top < d.bottom - .5).length;
});
const idle = (page, n) => page.waitForFunction((n) => { const d = window.__atelier.state.dataset; return !d.running && d.scenes.length === n && !document.getElementById('dsDock').classList.contains('running'); }, n, { timeout: 120000, polling: 100 });
const setup = async (page) => {
  // Bounded runtime: small frames, 4 spp beauty and a 4-sample live view.
  await page.evaluate(() => { const a = window.__atelier; a.stage.pipe.maxSamples = 4; Object.assign(a.state.dataset, { res: '768x384', samples: 4, seed: 5100 }); });
};
const layoutChecks = (p, label) => {
  ok(`${label}: dock shown with the sheet collapsed`, p.on && p.visible);
  ok(`${label}: count sits above Generate & add`, p.row.b <= p.go.y + .5 && Math.abs((p.row.x + p.row.w / 2) - (p.go.x + p.go.w / 2)) < 1.5, { row: p.row, go: p.go });
  ok(`${label}: dock clear of the collapsed sheet and the collection head`, p.dock.b <= p.panelTop - 6 && p.dock.y >= p.headBottom + 6, { dock: p.dock, panelTop: p.panelTop, head: p.headBottom });
  ok(`${label}: dock inside the viewport with 12 px margins`, p.dock.x >= 11.5 && p.dock.r <= p.vw - 11.5, p.dock);
  ok(`${label}: taps are at least 44 px`, [p.go, p.minus, p.plus, p.input].every((b) => b.w >= 43.9 && b.h >= 43.9), [p.go, p.minus, p.plus, p.input]);
  ok(`${label}: labels are not truncated`, p.textFits);
};

await withPage(async (page, log) => {
  await setup(page);
  await page.evaluate(() => window.__atelier.api.setMode('dataset'));
  await page.waitForTimeout(400);

  // ---------------------------------------------------------------- 320 px: count editing
  let p = await probe(page);
  layoutChecks(p, '320×568 empty');
  ok('accessible names', p.names.group === 'Generate scenes' && p.names.input === 'Scenes to add' && p.names.minus === 'Fewer scenes' && p.names.plus === 'More scenes' && p.names.go === 'Generate & add', p.names);
  await page.tap('#dockPlus');
  p = await probe(page);
  ok('dock + raises the count and the footer follows', p.count === 9 && p.dockValue === '9' && p.footValue === '9', p);
  await page.tap('#dockMinus'); await page.tap('#dockMinus');
  p = await probe(page);
  ok('dock − lowers the count and the footer follows', p.count === 7 && p.footValue === '7');
  await page.tap('#dockCount');
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('12');
  p = await probe(page);
  ok('typing 12 applies live and stays in Dataset (digits are not mode keys)', p.count === 12 && p.footValue === '12' && p.mode === 'dataset', { count: p.count, foot: p.footValue, mode: p.mode });
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('99'); await page.keyboard.press('Enter');
  p = await probe(page);
  ok('Enter clamps to 64 and disables +', p.count === 64 && p.dockValue === '64' && p.footValue === '64' && p.dockDisabled[2] && p.footDisabled[2], p);
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('0'); await page.keyboard.press('Tab');
  p = await probe(page);
  ok('commit of 0 clamps to 1 and disables −', p.count === 1 && p.dockValue === '1' && p.dockDisabled[1] && p.footDisabled[1], p);
  // Footer edit in the expanded sheet reaches the dock; the dock steps aside meanwhile.
  await page.evaluate(() => window.__atelier.api.setSheet(true));
  await page.waitForTimeout(400);
  p = await probe(page);
  ok('expanded sheet hides the dock (footer carries the action)', !p.on && !p.visible);
  await shot(page, '320-expanded-footer');
  await page.fill('#dsBatchCount', '5'); await page.locator('#dsBatchCount').blur();
  await page.evaluate(() => window.__atelier.api.setSheet(false));
  await page.waitForTimeout(400);
  p = await probe(page);
  ok('footer edit shows in the dock after collapsing', p.on && p.visible && p.count === 5 && p.dockValue === '5', p);
  await page.evaluate(() => { window.__atelier.state.dataset.count = 3; window.__atelier.api.setMode('dataset'); });
  p = await probe(page);
  ok('panel rebuild re-syncs the dock', p.dockValue === '3' && p.footValue === '3');

  // ---------------------------------------------------------------- generate: requested count, double tap
  await page.tap('#dockMinus');
  p = await probe(page);
  ok('requested count set to 2 in the dock', p.count === 2);
  // A real double tap: two CDP touches 120 ms apart, then a programmatic start.
  // The scene build blocks the main thread, so the second tap is delivered
  // late (after the arming delay by the clock); it must still not cancel.
  await page.evaluate(() => { const go = document.getElementById('dockGo'), seen = window.__armSeen = []; new MutationObserver(() => seen.push([document.getElementById('dockGoText').textContent, go.getAttribute('aria-disabled')])).observe(go, { subtree: true, childList: true, characterData: true, attributes: true }); });
  await page.evaluate(() => { const t = document.getElementById('dockState'), l = document.querySelector('.dock-lbl'), seen = window.__stateSeen = []; new MutationObserver(() => { if (t.textContent) seen.push({ text: t.textContent, fits: t.scrollWidth <= t.clientWidth + .5, label: getComputedStyle(l).display }); }).observe(t, { childList: true, characterData: true, subtree: true }); });
  const cdp = await page.context().newCDPSession(page);
  const [gx, gy] = await page.evaluate(() => { const r = document.getElementById('dockGo').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const t0 = Date.now();
  for (let i = 0; i < 2; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gx, y: gy, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (!i) await page.waitForTimeout(120);
  }
  const gap = Date.now() - t0;
  await page.evaluate(() => window.__atelier.api.datasetActions.generate());
  await page.waitForFunction(() => window.__atelier.state.dataset.running, null, { timeout: 20000 });
  p = await probe(page);
  ok('double tap starts one batch; Cancel shown, no cross-tab refusal', p.running && p.goText === 'Cancel' && !/another tab/i.test(p.status), { goText: p.goText, status: p.status, gap });
  ok('count locks while running (dock and footer)', p.dockDisabled.every(Boolean) && p.footDisabled.every(Boolean), { dock: p.dockDisabled, foot: p.footDisabled });
  await page.waitForTimeout(700);
  const arm = await page.evaluate(() => window.__armSeen);
  const firstCancel = arm.findIndex(([t]) => t === 'Cancel');
  ok('Cancel appears disarmed, then arms after the double-tap window', firstCancel >= 0 && arm[firstCancel][1] === 'true' && arm.slice(firstCancel).some(([t, a]) => t === 'Cancel' && a === 'false'), arm.slice(0, 8));
  await shot(page, '320-running');
  await idle(page, 2);
  const progress = await page.evaluate(() => window.__stateSeen);
  ok('running dock reports progress in place of its label', ['Adding 1 of 2', 'Adding 2 of 2'].every((x) => progress.some((s) => s.text === x)) && progress.every((s) => s.fits && s.label === 'none'), progress);
  await page.waitForTimeout(500);
  p = await probe(page);
  ok('late second tap did not cancel: exactly the requested scenes', p.scenes === 2 && /^Finished: added 2 scenes/.test(p.status) && !p.running && p.goText === 'Generate & add' && p.goAria === 'false', p.status);
  ok('count unlocks after the batch', p.dockDisabled.slice(0, 2).every((x) => !x) && p.dockValue === '2');

  // ---------------------------------------------------------------- append on the next batch
  await page.tap('#dockMinus');
  await page.tap('#dockGo');
  await idle(page, 3);
  const names = await page.evaluate(() => window.__atelier.state.dataset.scenes.map((s) => [s.name, s.seed]));
  ok('next batch uses the new count and appends', JSON.stringify(names) === JSON.stringify([['scene_0001', 5100], ['scene_0002', 5101], ['scene_0003', 5102]]), names);

  // ---------------------------------------------------------------- cancel
  // Six requested; Cancel after arming stops after the scene in progress.
  await page.tap('#dockCount'); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('6'); await page.keyboard.press('Enter');
  await page.tap('#dockGo');
  await page.waitForFunction(() => document.getElementById('dockGo').getAttribute('aria-disabled') === 'false' && window.__atelier.state.dataset.running, null, { timeout: 20000 });
  await page.evaluate(() => { const go = document.getElementById('dockGo'), seen = window.__goSeen = []; new MutationObserver(() => seen.push([document.getElementById('dockGoText').textContent, go.getAttribute('aria-disabled')])).observe(go, { subtree: true, childList: true, characterData: true, attributes: true }); });
  await page.tap('#dockGo');
  const seen = await page.evaluate(() => window.__goSeen);
  ok('Cancel switches to Stopping… and is disabled meanwhile', seen.some(([t, a]) => t === 'Stopping…' && a === 'true') && !seen.some(([t, a]) => t === 'Stopping…' && a === 'false'), seen.slice(0, 6));
  await page.waitForFunction(() => !window.__atelier.state.dataset.running, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  p = await probe(page);
  ok('cancel keeps completed scenes and restores the dock', p.scenes >= 4 && p.scenes < 9 && /^Stopped/.test(p.status) && p.goText === 'Generate & add' && p.dockValue === '6', { scenes: p.scenes, status: p.status });
  // Top up so the 320 grid scrolls (three rows of tiles).
  if (p.scenes < 5) {
    await page.evaluate(() => { const d = window.__atelier.state.dataset; d.count = 5 - d.scenes.length; window.__atelier.api.setMode('dataset'); });
    await page.tap('#dockGo');
    await idle(page, 5);
  }

  // ---------------------------------------------------------------- reachability at 320
  await page.waitForTimeout(600);
  const reach = await page.evaluate(() => {
    const g = document.getElementById('sheetGrid'); g.scrollTop = g.scrollHeight;
    const dock = document.getElementById('dsDock').getBoundingClientRect(), tiles = [...g.querySelectorAll('.tile[data-scene]')], last = tiles.at(-1);
    const acts = [...last.querySelectorAll('.tile-actions .act')].map((b) => { const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return b.contains(hit); });
    return { scrolls: g.scrollHeight > g.clientHeight, lastBottom: last.getBoundingClientRect().bottom, dockTop: dock.top, acts, name: last.dataset.scene };
  });
  ok('collection scrolls at 320 px with five scenes', reach.scrolls);
  ok('scrolled to the end, the last tile clears the dock', reach.lastBottom <= reach.dockTop - 8, reach);
  ok('last tile download and delete are hit-testable', reach.acts.length === 2 && reach.acts.every(Boolean), reach.acts);
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.tap(`.tile[data-scene="${reach.name}"] [data-act="download"]`);
  ok('last tile download works under the dock', (await dl).suggestedFilename() === `${reach.name}.zip`);
  await shot(page, '320-scrolled-end');

  // ---------------------------------------------------------------- scene inspector takes priority
  await page.tap(`.tile[data-scene="${reach.name}"] .pic`);
  const opened = await page.evaluate(() => document.getElementById('app').classList.contains('dock-on'));
  await page.waitForFunction(() => window.__atelier.api.inspector.state().loaded, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  p = await probe(page);
  ok('opening a scene hides the dock at once', !opened && !p.on && !p.visible, { opened, on: p.on, visible: p.visible });
  await shot(page, '320-inspector');
  await page.keyboard.press('Escape');
  const during = await page.evaluate(() => ({ closing: !document.getElementById('sceneInspector').hidden, on: document.getElementById('app').classList.contains('dock-on') }));
  ok('dock stays hidden while the scene closes', !during.closing || !during.on, during);
  await page.waitForFunction(() => document.getElementById('sceneInspector').hidden, null, { timeout: 5000 });
  await page.waitForTimeout(350);
  p = await probe(page);
  const tileAfter = await page.evaluate((n) => { const t = document.querySelector(`.tile[data-scene="${n}"]`).getBoundingClientRect(); return t.bottom <= document.getElementById('dsDock').getBoundingClientRect().top; }, reach.name);
  ok('closing the scene restores the dock, returned tile clear of it', p.on && p.visible && tileAfter);
  // Delete the last tile from under the dock position: always allowed.
  await page.tap(`.tile[data-scene="${reach.name}"] [data-act="delete"]`);
  await page.waitForFunction((n) => !window.__atelier.state.dataset.scenes.some((s) => s.name === n), reach.name, { timeout: 10000 });
  ok('last tile delete works', true);

  // ---------------------------------------------------------------- introduction claims focus
  await page.tap('#brandBtn');
  await page.waitForTimeout(300);
  p = await probe(page);
  ok('introduction hides the dock', !p.on && !p.visible);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__atelier.api.intro.open, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  p = await probe(page);
  ok('closing the introduction restores the dock', p.on && p.visible);

  // ---------------------------------------------------------------- keyboard
  await page.evaluate(() => { window.__atelier.state.dataset.count = 3; window.__atelier.api.setMode('dataset'); });
  p = await probe(page);
  await page.focus('#dockMinus');
  await page.keyboard.press('Enter');
  const kb = await probe(page);
  await page.keyboard.press('Tab');
  const nextFocus = await page.evaluate(() => document.activeElement.id);
  ok('keyboard: Enter on − steps, Tab reaches the count field', kb.count === p.count - 1 && nextFocus === 'dockCount', { count: kb.count, nextFocus });

  // ---------------------------------------------------------------- other sizes (same collection)
  await page.evaluate(() => document.activeElement?.blur());
  for (const [w, h, name] of [[390, 844, '390-collapsed'], [667, 375, '667x375-landscape'], [568, 320, '568x320-landscape']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById('sheetGrid').scrollTop = 0; });
    p = await probe(page);
    const landscape = h < 500;
    layoutChecks(p, `${w}×${h}`);
    if (landscape) ok(`${w}×${h}: no tile under the dock`, (await tileOverlap(page)) === 0);
    await shot(page, name);
    if (landscape) {
      const end = await page.evaluate(() => { const g = document.getElementById('sheetGrid'); g.scrollTop = g.scrollHeight; const t = [...g.querySelectorAll('.tile[data-scene]')].at(-1).getBoundingClientRect(); return t.bottom <= g.getBoundingClientRect().bottom + .5; });
      ok(`${w}×${h}: last tile reachable`, end && (await tileOverlap(page)) === 0);
    }
  }
  // Running state at 390, then expanded sheet shows the footer's Cancel instead.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__atelier.state.dataset.count = 3; window.__atelier.api.setMode('dataset'); });
  const n0 = await page.evaluate(() => window.__atelier.state.dataset.scenes.length);
  await page.tap('#dockGo');
  await page.waitForFunction(() => /Adding/.test(document.getElementById('dockState').textContent), null, { timeout: 30000 });
  await shot(page, '390-running');
  await page.evaluate(() => window.__atelier.api.setSheet(true));
  await page.waitForTimeout(400);
  const exp = await page.evaluate(() => ({ on: document.getElementById('app').classList.contains('dock-on'), cancel: !document.getElementById('dsCancel').classList.contains('hidden'), go: document.getElementById('dsGo').classList.contains('hidden') }));
  ok('expanded while running: dock hidden, footer shows Cancel', !exp.on && exp.cancel && exp.go, exp);
  await shot(page, '390-expanded-running');
  await idle(page, n0 + 3);
  await page.evaluate(() => window.__atelier.api.setSheet(false));
  await page.waitForTimeout(400);
  await shot(page, '390-after-batch');

  // Desktop: no dock; the footer keeps the one count and Generate & add.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  const desk = await page.evaluate(() => ({ dock: getComputedStyle(document.getElementById('dsDock')).display, on: document.getElementById('app').classList.contains('dock-on'), go: document.querySelectorAll('button').length && [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Generate & add' && b.getBoundingClientRect().width > 0).length, counts: [...document.querySelectorAll('input[type=number]')].filter((i) => i.getBoundingClientRect().width > 0).length }));
  ok('desktop: dock absent, one visible count and one Generate & add', desk.dock === 'none' && !desk.on && desk.go === 1 && desk.counts === 1, desk);
  await shot(page, 'desktop-1280');
  // Back to a phone after desktop: the dock returns.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  p = await probe(page);
  ok('resize back to phone restores the dock', p.on && p.visible);

  ok('no page errors', log.errors.length === 0, log.errors);
  ok('no console errors', !log.console.some((c) => c.startsWith('error')), log.console);
}, { width: 320, height: 568, dpr: 2, mobile: true, timeout: 420000 });

writeFileSync(`${DIR}/qa-results.json`, JSON.stringify({ failed, checks }, null, 2));
console.log(failed ? `${failed} FAILED of ${checks.length}` : `ALL ${checks.length} PASS`);
process.exit(failed ? 1 : 0);
