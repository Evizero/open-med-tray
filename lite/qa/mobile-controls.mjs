// Mobile controls: quiet top bar, the floating Resample card, the draggable
// bottom sheet, and the desktop Resample footer. Touch gestures are real CDP
// touch sequences (pointer events of type touch), not synthetic handlers.
// Writes qa-results.json and screenshots to artifacts/opus-mobile-controls/.
import { withPage, settle } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const DIR = process.argv[2] || new URL('../../artifacts/opus-mobile-controls/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const results = { checks: [], runs: {} };
let failed = 0;
function ok(name, pass, detail) {
  results.checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
}
const shot = (page, name) => page.screenshot({ path: `${DIR}/${name}.png` });
const quietLog = (log) => ({ errors: log.errors, console: log.console.filter((c) => !c.includes('maxLeafSize')) });

// ------------------------------------------------------------ page probes
const probe = (page) => page.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05 && b.width > 0 && b.height > 0; };
  const a = window.__atelier, st = a.state, insp = $('inspector');
  return {
    vw: innerWidth, vh: innerHeight, open: insp.classList.contains('open'), inline: insp.style.transform,
    panel: r(insp), panelTop: insp.getBoundingClientRect().top,
    fabOn: document.getElementById('app').classList.contains('fab-on'), fabVisible: vis($('fab')), fab: r($('fab')),
    fabGo: r($('fabResample')), fabReset: vis($('fabReset')) ? r($('fabReset')) : null, fabLabel: $('fabResample').textContent.trim(), fabAria: $('fabResample').getAttribute('aria-label'),
    readout: r($('readout')), readoutVisible: vis($('readout')),
    free: a.stage.free, mode: st.mode, presetId: st.presetId, sampled: st.sampled, counter: $('inspFoot').querySelector('.counter')?.textContent ?? null,
    spec: (({ kind, outline, shape, length, width, thickness, colorName, capColorName, finish, opacity }) => ({ kind, outline, shape, length, width, thickness, colorName, capColorName, finish, opacity }))(st.spec),
    traySeed: st.tray.seed, builtSeed: a.stage.tray?.config.seed ?? null,
    footResample: [...document.querySelectorAll('#inspFoot .resample')].map((b) => ({ text: b.textContent.trim(), cls: b.className, first: b === b.parentElement.firstElementChild, visible: vis(b) })),
    anyNewScene: document.body.innerText.includes('New scene'),
    cam: a.stage.camera.position.toArray().map((v) => +v.toFixed(4)),
    tour: st.tour.playing, busy: document.getElementById('app').classList.contains('resampling') || a.stage.animations.size > 0 || !!a.stage.section,
  };
});
const navProbe = (page) => page.evaluate(() => {
  const vis = (e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
  const rail = document.getElementById('rail'), rr = rail.getBoundingClientRect();
  const btns = [...rail.querySelectorAll('button')].filter(vis);
  const boxes = btns.map((b) => { const x = b.getBoundingClientRect(); return { id: b.id || b.dataset.mode, x: x.x, r: x.right, w: x.width, h: x.height, cy: x.y + x.height / 2 }; });
  const gaps = boxes.slice(1).map((b, i) => +(b.x - boxes[i].r).toFixed(2));
  const icons = btns.slice(1).map((b) => { const s = b.querySelector('svg').getBoundingClientRect(), x = b.getBoundingClientRect(); return +((s.x + s.width / 2) - (x.x + x.width / 2)).toFixed(2); });
  return { ids: boxes.map((b) => b.id), gaps, widths: boxes.map((b) => +b.w.toFixed(2)), heights: boxes.map((b) => +b.h.toFixed(2)), padL: +(boxes[0].x - rr.x).toFixed(2), padR: +(rr.right - boxes.at(-1).r).toFixed(2), iconOffsets: icons, centres: boxes.map((b) => +b.cy.toFixed(1)), railH: rr.height };
});
const waitIdle = (page, ms = 15000) => page.waitForFunction(() => { const a = window.__atelier, app = document.getElementById('app'); return !app.classList.contains('resampling') && !a.stage.animations.size && !a.stage.section; }, null, { timeout: ms, polling: 50 });

// Touch gesture through CDP. `points` are [x, y]; dt ms between moves.
async function touch(page, cdp, points, { dt = 16, hold = 0, cancel = false, midway = null } = {}) {
  const tp = ([x, y]) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(points[0]) });
  let mid = null;
  for (let i = 1; i < points.length; i++) {
    await page.waitForTimeout(dt);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(points[i]) });
    if (midway && i === Math.floor(points.length / 2)) mid = await midway();
  }
  if (hold) await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  return mid;
}
const line = (x, y0, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x, y0 + (y1 - y0) * i / n]);
// A point on the tab strip, on a tab that is not selected (so a drag that
// switched tabs would show).
const stripPoint = (page) => page.evaluate(() => { const b = document.querySelector('#inspTabs [role=tab][aria-selected="false"]').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
const activeTab = (page) => page.evaluate(() => document.querySelector('#inspTabs [aria-selected="true"]')?.dataset.tab);
// The panel is selection and editing only: no summary head (miniature, name,
// description, dimensions), the tab strip is its first band, the body follows.
const panelProbe = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), r = (e) => e.getBoundingClientRect();
  const insp = q('#inspector'), tabs = q('#inspTabs'), body = q('#inspBody'), handle = q('#sheetHandle');
  const cs = getComputedStyle(insp), hv = getComputedStyle(handle).display !== 'none';
  const summary = [...document.querySelectorAll('.insp-head, #inspTitle, #inspSub, #inspIcon, .insp-title, .insp-sub, .insp-icon')].length;
  const kids = [...insp.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.className);
  const pr = r(insp), tr = r(tabs), br = r(body);
  return { summary, kids, tabsOffset: +(tr.top - pr.top - parseFloat(cs.borderTopWidth) - (hv ? r(handle).height : 0)).toFixed(2), handleH: hv ? r(handle).height : 0,
    bodyGap: +(br.top - tr.bottom).toFixed(2), tabsH: tr.height, tabBtnH: Math.min(...[...tabs.querySelectorAll('[role=tab]')].map((b) => r(b).height)),
    peekVisible: +(innerHeight - pr.top).toFixed(2), tabsBottom: tr.bottom, vh: innerHeight, open: insp.classList.contains('open'),
    label: insp.getAttribute('aria-label'), presetMinis: document.querySelectorAll('#inspBody .preset svg').length };
});
function checkPanel(tag, p, { mobile, peek = 70 }) {
  ok(`${tag}: no summary head (miniature, name, description, dimensions)`, p.summary === 0, p.summary);
  ok(`${tag}: panel is ${mobile ? 'handle, ' : ''}tabs, body, footer`, JSON.stringify(p.kids) === JSON.stringify([...(mobile ? ['sheetHandle'] : []), 'inspTabs', 'inspBody', 'inspFoot']), p.kids);
  ok(`${tag}: tab strip is the first band (no empty header space)`, Math.abs(p.tabsOffset) <= .5 && Math.abs(p.bodyGap) <= .5, { tabsOffset: p.tabsOffset, bodyGap: p.bodyGap });
  ok(`${tag}: panel still named for assistive tech`, /controls/.test(p.label ?? ''), p.label);
  if (mobile) {
    ok(`${tag}: tabs are 44 px touch targets; handle >= 24 px`, p.tabBtnH >= 44 && p.handleH >= 24, { tab: p.tabBtnH, handle: p.handleH });
    if (!p.open) ok(`${tag}: collapsed peek is the compact ${peek} px (handle + tabs), tabs not clipped`, Math.abs(p.peekVisible - peek) <= 1 && p.tabsBottom <= p.vh + .5, { peek: p.peekVisible, tabsBottom: p.tabsBottom, vh: p.vh });
  }
}
const handlePoint = (page) => page.evaluate(() => { const b = document.getElementById('sheetHandle').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
const translateY = (page) => page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('inspector')).transform).m42);

function checkNav(tag, n) {
  ok(`${tag}: top bar shows only the mark and three modes`, JSON.stringify(n.ids) === JSON.stringify(['brandBtn', 'specimen', 'tray', 'dataset']), n.ids);
  ok(`${tag}: even gaps between mark and modes`, Math.max(...n.gaps) - Math.min(...n.gaps) <= 1, n.gaps);
  ok(`${tag}: modes share one width`, Math.max(...n.widths.slice(1)) - Math.min(...n.widths.slice(1)) <= 1, n.widths);
  ok(`${tag}: symmetric bar padding`, Math.abs(n.padL - n.padR) <= 1, { padL: n.padL, padR: n.padR });
  ok(`${tag}: nav targets at least 44 px tall, on one centre line`, n.heights.every((h) => h >= 44) && Math.max(...n.centres) - Math.min(...n.centres) <= 1, { heights: n.heights, centres: n.centres });
  ok(`${tag}: mode icons centred in their buttons`, n.iconOffsets.every((d) => Math.abs(d) <= 1), n.iconOffsets);
}
function checkFabGeometry(tag, s, { landscape = false } = {}) {
  ok(`${tag}: Resample card visible with the sheet collapsed`, s.fabOn && s.fabVisible && !s.open, { fabOn: s.fabOn, vis: s.fabVisible, open: s.open });
  ok(`${tag}: card reads "Resample"`, s.fabLabel === 'Resample', s.fabLabel);
  ok(`${tag}: card inside the viewport, above the sheet peek`, s.fab.x >= 0 && s.fab.r <= s.vw && s.fab.b <= s.panelTop - 4, { fab: s.fab, panelTop: s.panelTop });
  const overlap = !(s.fab.r <= s.readout.x || s.readout.r <= s.fab.x || s.fab.b <= s.readout.y || s.readout.b <= s.fab.y);
  ok(`${tag}: card clear of the readout line`, !overlap, { fab: s.fab, readout: s.readout });
  ok(`${tag}: card touch targets >= 44 px`, s.fabGo.h >= 44 && s.fabGo.w >= 44 && (!s.fabReset || (s.fabReset.h >= 44 && s.fabReset.w >= 44)), { go: s.fabGo, reset: s.fabReset });
  if (!landscape) ok(`${tag}: card centred horizontally`, Math.abs(s.fab.x + s.fab.w / 2 - s.vw / 2) <= 1, s.fab);
  // Annotation area = free render minus the 34 px readout band (main.js annotArea).
  const annotBottom = s.free.y + s.free.h - 34;
  ok(`${tag}: framed render / annotation area ends above the card`, annotBottom <= s.fab.y + 1, { annotBottom, fabTop: s.fab.y });
}
async function specimenInFrame(page) {
  return page.evaluate(() => {
    const a = window.__atelier, st = a.stage, p = st.pill;
    const box = new a.THREE.Vector3(), pts = [];
    p.group.updateMatrixWorld(true);
    for (const m of p.meshes) { m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { box.set(x, y, z).applyMatrix4(m.matrixWorld); pts.push(st.project(box)); } }
    const ys = pts.map((q) => q[1]), xs = pts.map((q) => q[0]);
    return { top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs), right: Math.max(...xs), fabTop: document.getElementById('fab').getBoundingClientRect().top, freeTop: st.free.y };
  });
}

// ------------------------------------------------------------ 390 x 844 phone
async function phoneRun(w, h, tag, { full }) {
  await withPage(async (page, log) => {
    const cdp = await page.context().newCDPSession(page);
    await page.waitForFunction(() => document.getElementById('boot').classList.contains('gone'), null, { timeout: 30000 });
    await page.waitForTimeout(4200); await settle(page).catch(() => {});
    checkNav(tag, await navProbe(page));
    let s = await probe(page);
    checkFabGeometry(tag, s);
    ok(`${tag}: reset-view is the card's secondary action in Specimen`, !!s.fabReset && s.fabAria === 'Resample pill', { reset: s.fabReset, aria: s.fabAria });
    const fr = await specimenInFrame(page);
    ok(`${tag}: specimen sits between the top bar and the card`, fr.top >= fr.freeTop && fr.bottom <= fr.fabTop - 8, fr);
    checkPanel(`${tag} collapsed`, await panelProbe(page), { mobile: true });
    await shot(page, `after-${w}x${h}-specimen`);

    // Resample: new random pills from the priors, not presets.
    const seen = [], before = s.spec;
    for (let i = 0; i < (full ? 6 : 3); i++) {
      await page.tap('#fabResample');
      await page.waitForTimeout(80); await waitIdle(page);
      const t = await probe(page);
      seen.push(t.spec);
      if (i === 0) {
        ok(`${tag}: Resample changes the pill's parameters`, JSON.stringify(t.spec) !== JSON.stringify(before), { before, after: t.spec });
        // Validated through app state and the footer counter (there is no title to read).
        ok(`${tag}: sampled pill is not a preset`, t.presetId === null && t.sampled === true && t.counter === 'Sampled', { presetId: t.presetId, sampled: t.sampled, counter: t.counter });
      }
    }
    const distinct = new Set(seen.map((x) => JSON.stringify(x))).size;
    ok(`${tag}: consecutive samples all differ`, distinct === seen.length, seen);
    results.runs[tag] = { samples: seen };
    await settle(page).catch(() => {});
    await shot(page, `after-${w}x${h}-sampled`);

    // Repeated taps while a build is in flight start exactly one build.
    await page.evaluate(() => { const st = window.__atelier.stage; st.__calls = 0; const f = st.setSpecimen.bind(st); st.setSpecimen = (...a) => { st.__calls++; return f(...a); }; });
    await page.evaluate(() => { for (let i = 0; i < 5; i++) document.getElementById('fabResample').click(); });
    await page.waitForTimeout(120);
    await page.evaluate(() => document.getElementById('fabResample').click());
    await waitIdle(page);
    const calls = await page.evaluate(() => { const st = window.__atelier.stage; const n = st.__calls; delete st.setSpecimen; return n; });
    ok(`${tag}: rapid repeated taps start one specimen build`, calls === 1, { calls });

    // Sheet: swipe up from the tab strip (not the handle), finger-follow, camera still.
    const [tx, ty] = await stripPoint(page);
    const tab0 = await activeTab(page);
    const y0 = await translateY(page);
    const cam0 = (await probe(page)).cam, free0 = (await probe(page)).free;
    const mid = await touch(page, cdp, line(tx, ty, ty - 320, 20), { dt: 18, midway: async () => ({ ty: await translateY(page), p: await probe(page) }) });
    await page.waitForTimeout(500);
    s = await probe(page);
    ok(`${tag}: swipe up on the tab strip expands the sheet`, s.open && !s.inline, { open: s.open, inline: s.inline });
    ok(`${tag}: a drag that starts on a tab does not switch tabs`, (await activeTab(page)) === tab0, { before: tab0, after: await activeTab(page) });
    ok(`${tag}: sheet follows the finger mid-drag`, mid.ty < y0 - 80 && mid.ty > 0, { start: y0, mid: mid.ty });
    ok(`${tag}: camera and framing hold still during the drag`, JSON.stringify(mid.p.cam) === JSON.stringify(cam0) && JSON.stringify(mid.p.free) === JSON.stringify(free0), { cam0, mid: mid.p.cam });
    ok(`${tag}: card hides with the sheet expanded; footer carries Resample`, !s.fabOn && !s.fabVisible && s.footResample.length === 1 && s.footResample[0].visible && s.footResample[0].text === 'Resample', { fabOn: s.fabOn, foot: s.footResample });
    ok(`${tag}: framing refit once the sheet settled`, s.free.h < free0.h - 100, { before: free0, after: s.free });
    const pOpen = await panelProbe(page);
    checkPanel(`${tag} expanded`, pOpen, { mobile: true });
    ok(`${tag}: preset list keeps its miniatures`, pOpen.presetMinis === 16, pOpen.presetMinis);
    await settle(page).catch(() => {});
    await shot(page, `after-${w}x${h}-expanded`);
    await page.tap('#inspTabs [data-tab="form"]'); await page.waitForTimeout(500);
    const formCue = await page.evaluate(() => ({ tab: window.__atelier.api.tabState.specimen, cue: !!document.querySelector('#inspBody .cue svg'), open: document.getElementById('inspector').classList.contains('open') }));
    ok(`${tag}: tab tap in the open sheet selects it; Form keeps its drawing`, formCue.tab === 'form' && formCue.cue && formCue.open, formCue);
    await shot(page, `after-${w}x${h}-expanded-form`);
    await page.tap('#inspTabs [data-tab="presets"]'); await page.waitForTimeout(400);

    const [tx2, ty2] = await stripPoint(page);
    await touch(page, cdp, line(tx2, ty2, ty2 + 320, 20), { dt: 18 });
    await page.waitForTimeout(500);
    s = await probe(page);
    ok(`${tag}: swipe down on the tab strip collapses the sheet`, !s.open && !s.inline && s.fabOn, { open: s.open, fabOn: s.fabOn });
    const pClosed = await panelProbe(page);
    ok(`${tag}: collapsed again to the same compact peek`, Math.abs(pClosed.peekVisible - 70) <= 1, pClosed.peekVisible);

    if (full) {
      // Distance vs velocity snapping.
      let [px, py] = await stripPoint(page);
      await touch(page, cdp, line(px, py, py - 45, 6), { dt: 30, hold: 180 });
      await page.waitForTimeout(450);
      ok(`${tag}: short slow drag springs back`, !(await probe(page)).open);
      [px, py] = await stripPoint(page);
      await touch(page, cdp, line(px, py, py - 70, 3), { dt: 8 });
      await page.waitForTimeout(450);
      ok(`${tag}: short fast flick expands`, (await probe(page)).open);
      [px, py] = await stripPoint(page);
      await touch(page, cdp, line(px, py, py + 70, 3), { dt: 8 });
      await page.waitForTimeout(450);
      ok(`${tag}: short fast flick down collapses`, !(await probe(page)).open);

      // Handle drag: the click that ends it must not toggle back.
      let [hx, hy] = await handlePoint(page);
      await touch(page, cdp, line(hx, hy, hy - 300, 16), { dt: 16 });
      await page.waitForTimeout(700);
      ok(`${tag}: handle drag expands and the trailing click is swallowed`, (await probe(page)).open);
      [hx, hy] = await handlePoint(page);
      await touch(page, cdp, line(hx, hy, hy + 300, 16), { dt: 16 });
      await page.waitForTimeout(700);
      ok(`${tag}: handle drag collapses`, !(await probe(page)).open);

      // Horizontal movement along the tabs is not a sheet gesture.
      [px, py] = await stripPoint(page);
      const tabH = await activeTab(page);
      await touch(page, cdp, Array.from({ length: 11 }, (_, i) => [px - 60 + i * 12, py + (i % 2 ? 2 : -2)]), { dt: 16 });
      await page.waitForTimeout(450);
      s = await probe(page);
      ok(`${tag}: horizontal swipe along the tabs leaves the sheet and tab alone`, !s.open && !s.inline && (await activeTab(page)) === tabH, { open: s.open, inline: s.inline });

      // Taps on the handle and the keyboard fallback.
      await page.tap('#sheetHandle'); await page.waitForTimeout(450);
      ok(`${tag}: tap on the handle toggles open`, (await probe(page)).open);
      await page.tap('#sheetHandle'); await page.waitForTimeout(450);
      ok(`${tag}: tap on the handle toggles closed`, !(await probe(page)).open);
      await page.focus('#sheetHandle'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
      const kOpen = (await probe(page)).open;
      await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400);
      const kDown = (await probe(page)).open;
      await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400);
      const kUp = (await probe(page)).open;
      const aria = await page.getAttribute('#sheetHandle', 'aria-expanded');
      ok(`${tag}: keyboard Enter / ArrowDown / ArrowUp on the handle`, kOpen && !kDown && kUp && aria === 'true', { kOpen, kDown, kUp, aria });
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      ok(`${tag}: Esc collapses`, !(await probe(page)).open);

      // Pointer cancellation returns to the starting state.
      [px, py] = await stripPoint(page);
      await touch(page, cdp, line(px, py, py - 220, 10), { dt: 16, cancel: true });
      await page.waitForTimeout(450);
      s = await probe(page);
      ok(`${tag}: cancelled drag returns to collapsed`, !s.open && !s.inline, { open: s.open, inline: s.inline });

      // Body scrolling and sliders are never taken by the sheet.
      await page.evaluate(() => { window.__atelier.api.setTab('presets'); window.__atelier.api.setSheet(true); });
      await page.waitForTimeout(500);
      const bb = await page.evaluate(() => { const b = document.getElementById('inspBody').getBoundingClientRect(); b.st = document.getElementById('inspBody').scrollTop; return { x: b.x + b.width / 2, y: b.y + b.height * .75, h: b.height }; });
      await touch(page, cdp, line(bb.x, bb.y, bb.y - bb.h * .5, 12), { dt: 16 });
      await page.waitForTimeout(600);
      const scrolled = await page.evaluate(() => document.getElementById('inspBody').scrollTop);
      s = await probe(page);
      ok(`${tag}: panel body scrolls natively, sheet stays put`, scrolled > 20 && s.open && !s.inline, { scrolled, open: s.open });
      await page.evaluate(() => { window.__atelier.api.setTab('form'); document.getElementById('inspBody').scrollTop = 0; });
      await page.waitForTimeout(400);
      const sl = await page.evaluate(() => { const i = document.querySelector('#inspBody input[type=range]'); if (!i) return null; i.scrollIntoView({ block: 'center' }); const b = i.getBoundingClientRect(); return { key: i.dataset.k, v: i.value, x: b.x, w: b.width, y: b.y + b.height / 2 }; });
      if (sl) {
        const pts = Array.from({ length: 13 }, (_, i) => [sl.x + sl.w * (.2 + .6 * i / 12), sl.y + (i % 2 ? 1.5 : -1.5)]);
        await touch(page, cdp, pts, { dt: 16 });
        await page.waitForTimeout(500);
        const v1 = await page.evaluate((k) => document.querySelector(`#inspBody input[data-k="${CSS.escape(k)}"]`)?.value, sl.key);
        s = await probe(page);
        ok(`${tag}: slider drag changes its value, sheet unaffected`, v1 !== sl.v && s.open && !s.inline, { key: sl.key, before: sl.v, after: v1, open: s.open });
      } else ok(`${tag}: slider available for the drag test`, false);
      // Tab tap still selects (and a tap in the collapsed peek opens on that tab).
      await page.keyboard.press('Escape'); await page.waitForTimeout(450);
      await page.tap('#inspTabs button[data-tab="surface"]'); await page.waitForTimeout(500);
      s = await probe(page);
      const tab = await page.evaluate(() => window.__atelier.api.tabState.specimen);
      ok(`${tag}: tab tap opens the sheet on that tab`, s.open && tab === 'surface', { open: s.open, tab });
      await page.keyboard.press('Escape'); await page.waitForTimeout(450);

      // Mid-drag resize aborts the drag cleanly.
      [px, py] = await stripPoint(page);
      const tp = ([x, y]) => [{ x, y, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([px, py]) });
      for (let i = 1; i <= 6; i++) { await page.waitForTimeout(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([px, py - i * 25]) }); }
      await page.setViewportSize({ width: h > 700 ? 393 : 320, height: h > 700 ? 852 : 560 });
      await page.waitForTimeout(300);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(500);
      s = await probe(page);
      ok(`${tag}: resize mid-drag settles without a stuck transform`, !s.inline && !s.open, { inline: s.inline, open: s.open });
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(600);

      // Tour: no card while it plays; Resample (R) stops it.
      await page.evaluate(() => { window.__atelier.api.playTour(); });
      await page.waitForTimeout(3000);
      s = await probe(page);
      ok(`${tag}: card hidden while the tour plays`, s.tour && !s.fabVisible, { tour: s.tour, fab: s.fabVisible });
      const specT = s.spec;
      await page.keyboard.press('r');
      await page.waitForTimeout(100); await waitIdle(page, 20000);
      s = await probe(page);
      ok(`${tag}: Resample stops the tour and samples`, !s.tour && s.fabOn && s.sampled && JSON.stringify(s.spec) !== JSON.stringify(specT), { tour: s.tour, fabOn: s.fabOn, sampled: s.sampled });

      // Introduction: the mark opens it (and its tour); no card under it.
      await page.tap('#brandBtn'); await page.waitForTimeout(900);
      s = await probe(page);
      const introOpen = await page.evaluate(() => window.__atelier.api.intro.open);
      ok(`${tag}: mark opens the introduction, card hidden`, introOpen && !s.fabOn, { introOpen, fabOn: s.fabOn });
      await page.keyboard.press('Escape'); await page.waitForTimeout(900);
      ok(`${tag}: card returns after the introduction`, (await probe(page)).fabOn);
    }

    // Tray: a whole new scene with a new seed.
    await page.tap('.modes button[data-mode="tray"]'); await page.waitForTimeout(4500); await settle(page).catch(() => {});
    s = await probe(page);
    checkFabGeometry(`${tag} tray`, s);
    ok(`${tag} tray: card labelled for the tray, no reset (fixed capture camera)`, s.fabAria === 'Resample tray scene' && !s.fabReset, { aria: s.fabAria, reset: s.fabReset });
    const seeds = [s.traySeed];
    for (let i = 0; i < 2; i++) {
      await page.tap('#fabResample'); await page.waitForTimeout(3500);
      const t = await probe(page);
      seeds.push(t.traySeed);
      if (t.builtSeed !== t.traySeed) ok(`${tag} tray: built scene uses the new seed`, false, t);
    }
    ok(`${tag} tray: each Resample builds a new seed`, new Set(seeds).size === seeds.length, seeds);
    await settle(page).catch(() => {});
    await shot(page, `after-${w}x${h}-tray`);

    // Pill inspection: no card (the footer offers Back to tray).
    const picked = await page.evaluate(() => { const a = window.__atelier, p = a.stage.tray.pills[0]; a.api.select(p); return !!p; });
    await page.waitForTimeout(900);
    s = await probe(page);
    ok(`${tag} tray: no card during pill inspection`, picked && !s.fabOn, { fabOn: s.fabOn });
    const pInsp = await panelProbe(page);
    checkPanel(`${tag} tray pill`, pInsp, { mobile: true });
    ok(`${tag} tray pill: tabs lead straight into Instance`, (await activeTab(page)) === 'instance' && pInsp.open, { tab: await activeTab(page), open: pInsp.open });
    await settle(page).catch(() => {});
    await shot(page, `after-${w}x${h}-tray-pill`);
    await page.evaluate(() => { window.__atelier.api.deselect(); window.__atelier.api.setSheet(false); });
    await page.waitForTimeout(900);
    ok(`${tag} tray: card back after inspection`, (await probe(page)).fabOn);

    // Dataset: no sampling control at all.
    await page.tap('.modes button[data-mode="dataset"]'); await page.waitForTimeout(1500);
    s = await probe(page);
    ok(`${tag} dataset: no Resample card or footer action`, !s.fabOn && !s.fabVisible && s.footResample.length === 0, { fabOn: s.fabOn, foot: s.footResample });
    ok(`${tag}: no "New scene" label anywhere`, !s.anyNewScene);
    await shot(page, `after-${w}x${h}-dataset`);
    await page.tap('.modes button[data-mode="specimen"]'); await page.waitForTimeout(1500);

    // Orientation: landscape (short) and back.
    await page.setViewportSize({ width: h, height: w });
    await page.waitForTimeout(1200); await settle(page).catch(() => {});
    s = await probe(page);
    const n = await navProbe(page);
    if (h <= 760) {
      checkFabGeometry(`${tag} landscape ${h}x${w}`, s, { landscape: true });
      checkPanel(`${tag} landscape`, await panelProbe(page), { mobile: true });
      const geom = await page.evaluate(() => { const top = document.getElementById('rail').offsetHeight; const p = document.getElementById('inspector').getBoundingClientRect(); return { top, sheetH: p.height }; });
      ok(`${tag} landscape: expanded sheet fits below the bar`, geom.sheetH <= s.vh - geom.top - 8 && geom.sheetH >= s.vh * .6, geom);
      const [lx, ly] = await stripPoint(page);
      await touch(page, cdp, line(lx, ly, ly - 180, 12), { dt: 16 });
      await page.waitForTimeout(500);
      ok(`${tag} landscape: swipe up on the tab strip expands`, (await probe(page)).open);
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      await settle(page).catch(() => {});
      await shot(page, `after-${h}x${w}-landscape`);
    } else {
      ok(`${tag} landscape ${h}x${w}: desktop layout, no card, rail keeps Tour and Reset`, !s.fabVisible && n.ids.includes('tourBtn') && n.ids.includes('resetBtn'), { fab: s.fabVisible, ids: n.ids });
      await settle(page).catch(() => {});
      await shot(page, `after-${h}x${w}-landscape`);
    }
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1200);
    s = await probe(page);
    checkFabGeometry(`${tag} back to portrait`, s);
    ok(`${tag} portrait again: sheet collapsed and no stuck transform`, !s.open && !s.inline);
    results.runs[tag] = { ...results.runs[tag], log: quietLog(log) };
    ok(`${tag}: no page errors or console errors`, !log.errors.length && !quietLog(log).console.some((c) => c.startsWith('error')), quietLog(log));
  }, { width: w, height: h, mobile: true, dpr: 2, timeout: 420000 });
}

await phoneRun(390, 844, 'phone 390x844', { full: true });
await phoneRun(320, 568, 'phone 320x568', { full: false });

// ------------------------------------------------------------ breadth and frame cost (phone)
// Many samples in a row: every family renders without errors, and the main
// thread cost of a sampled build is compared with stepping presets (the
// existing baseline for the same morph / section transitions).
await withPage(async (page, log) => {
  await page.waitForTimeout(1500); await waitIdle(page);
  const run = (fn, n) => page.evaluate(async ([fn, n]) => {
    const a = window.__atelier, out = [];
    for (let i = 0; i < n; i++) {
      let last = performance.now(), worst = 0, frames = 0, going = true;
      const tick = (t) => { worst = Math.max(worst, t - last); last = t; frames++; if (going) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const t0 = performance.now();
      if (fn === 'resample') await a.api.resample();
      else { const ids = a.presetIds; await a.api.applyPresetById(ids[(ids.indexOf(a.state.presetId) + 1) % ids.length]); }
      while (a.stage.animations.size || a.stage.section) await new Promise((r) => setTimeout(r, 30));
      going = false;
      const s = a.state.spec;
      out.push({ ms: Math.round(performance.now() - t0), worstFrameMs: Math.round(worst), frames, kind: s.kind + ':' + (s.outline ?? s.shape ?? ''), damaged: !!(s.damage?.chips || s.damage?.fracture) });
    }
    return out;
  }, [fn, n]);
  const presets = await run('preset', 8);
  const samples = await run('resample', 18);
  const med = (xs) => { const v = xs.slice().sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
  const summary = {
    presetWorstFrameMedian: med(presets.map((x) => x.worstFrameMs)), presetWorstFrameMax: Math.max(...presets.map((x) => x.worstFrameMs)),
    resampleWorstFrameMedian: med(samples.map((x) => x.worstFrameMs)), resampleWorstFrameMax: Math.max(...samples.map((x) => x.worstFrameMs)),
    kinds: [...new Set(samples.map((x) => x.kind))], damaged: samples.filter((x) => x.damaged).length,
  };
  results.runs.breadth = { summary, presets, samples };
  ok('breadth: 18 samples span several families and outlines', summary.kinds.length >= 4, summary.kinds);
  ok('breadth: sampled builds cost about what preset steps cost (median worst frame within 2x + 50 ms)', summary.resampleWorstFrameMedian <= summary.presetWorstFrameMedian * 2 + 50, summary);
  ok('breadth: no errors across samples', !log.errors.length && !quietLog(log).console.some((c) => c.startsWith('error')), quietLog(log));
}, { width: 390, height: 844, mobile: true, dpr: 2, timeout: 300000 });

// ------------------------------------------------------------ reduced motion (phone)
await withPage(async (page, log) => {
  const cdp = await page.context().newCDPSession(page);
  await page.waitForTimeout(1500);
  const [tx, ty] = await stripPoint(page);
  await touch(page, cdp, line(tx, ty, ty - 300, 12), { dt: 16 });
  await page.waitForTimeout(150);
  let s = await probe(page);
  ok('reduced motion: drag still expands, settles immediately', s.open && !s.inline, { open: s.open, inline: s.inline });
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  const before = (await probe(page)).spec;
  await page.tap('#fabResample'); await page.waitForTimeout(100); await waitIdle(page);
  s = await probe(page);
  ok('reduced motion: Resample swaps the pill', JSON.stringify(s.spec) !== JSON.stringify(before));
  ok('reduced motion: no errors', !log.errors.length, quietLog(log));
}, { width: 390, height: 844, mobile: true, dpr: 2, reducedMotion: 'reduce', timeout: 120000 });

// ------------------------------------------------------------ desktop regression
await withPage(async (page, log) => {
  await page.waitForTimeout(4200); await settle(page).catch(() => {});
  const n = await navProbe(page);
  let s = await probe(page);
  ok('desktop: rail keeps mark, modes, Tour and Reset', JSON.stringify(n.ids) === JSON.stringify(['brandBtn', 'specimen', 'tray', 'dataset', 'tourBtn', 'resetBtn']), n.ids);
  checkPanel('desktop specimen', await panelProbe(page), { mobile: false });
  ok('desktop specimen: preset list keeps its miniatures', (await panelProbe(page)).presetMinis === 16);
  ok('desktop: no floating card', !s.fabVisible && (await page.evaluate(() => getComputedStyle(document.getElementById('fab')).display)) === 'none');
  ok('desktop specimen: Resample is the first, accent footer action', s.footResample.length === 1 && s.footResample[0].first && /accent/.test(s.footResample[0].cls) && s.footResample[0].text === 'Resample', s.footResample);
  const pager = await page.evaluate(() => ({ counter: document.querySelector('#inspFoot .counter')?.textContent, prev: !!document.querySelector('#inspFoot [data-k="btn:prev"]'), next: !!document.querySelector('#inspFoot [data-k="btn:next"]'), overflow: [...document.querySelectorAll('#inspFoot > *')].some((e) => e.getBoundingClientRect().right > document.getElementById('inspFoot').getBoundingClientRect().right + .5) }));
  ok('desktop specimen: preset pager beside it, nothing overflows', pager.prev && pager.next && pager.counter === '1 / 16' && !pager.overflow, pager);
  await shot(page, 'desktop-specimen');
  await page.click('#inspFoot .resample'); await page.waitForTimeout(100); await waitIdle(page);
  const t = await probe(page);
  ok('desktop specimen: Resample samples a new pill (state + footer counter)', JSON.stringify(t.spec) !== JSON.stringify(s.spec) && t.sampled === true && t.presetId === null && t.counter === 'Sampled', { sampled: t.sampled, counter: t.counter });
  await page.keyboard.press(']'); await page.waitForTimeout(100); await waitIdle(page);
  ok('desktop specimen: ] still steps presets after sampling', (await probe(page)).presetId === 'p10' || (await probe(page)).presetId !== null);
  await page.keyboard.press('r'); await page.waitForTimeout(100); await waitIdle(page);
  ok('desktop specimen: R resamples', (await probe(page)).sampled);
  await settle(page).catch(() => {});
  await shot(page, 'desktop-specimen-sampled');
  await page.click('#inspTabs [data-tab="form"]'); await page.waitForTimeout(400);
  ok('desktop specimen: Form keeps its drawing', await page.evaluate(() => !!document.querySelector('#inspBody .cue svg')));
  await shot(page, 'desktop-specimen-form');
  await page.click('#inspTabs [data-tab="presets"]'); await page.waitForTimeout(300);
  await page.click('.modes button[data-mode="tray"]'); await page.waitForTimeout(4500); await settle(page).catch(() => {});
  s = await probe(page);
  ok('desktop tray: Resample replaces New scene as the first, accent action', s.footResample.length === 1 && s.footResample[0].first && /accent/.test(s.footResample[0].cls) && !s.anyNewScene, s.footResample);
  await page.click('#inspFoot .resample'); await page.waitForTimeout(3500);
  const t2 = await probe(page);
  ok('desktop tray: Resample builds a new seed', t2.traySeed !== s.traySeed && t2.builtSeed === t2.traySeed, { from: s.traySeed, to: t2.traySeed });
  await settle(page).catch(() => {});
  checkPanel('desktop tray', await panelProbe(page), { mobile: false });
  await shot(page, 'desktop-tray');
  await page.evaluate(() => { const a = window.__atelier; a.api.select(a.stage.tray.pills[0]); });
  await page.waitForTimeout(1400); await settle(page).catch(() => {});
  checkPanel('desktop tray pill', await panelProbe(page), { mobile: false });
  await shot(page, 'desktop-tray-pill');
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  await page.click('.modes button[data-mode="dataset"]'); await page.waitForTimeout(1500);
  s = await probe(page);
  ok('desktop dataset: no Resample', s.footResample.length === 0 && !s.fabVisible);
  checkPanel('desktop dataset', await panelProbe(page), { mobile: false });
  const band = await page.evaluate(() => ({ tabs: document.getElementById('inspTabs').getBoundingClientRect().bottom, head: document.querySelector('.sheet-head').getBoundingClientRect().bottom }));
  ok('desktop dataset: tab strip and collection head share one band', Math.abs(band.tabs - band.head) <= .5, band);
  await shot(page, 'desktop-dataset');
  // The scene inspector's head shares the 48 px band: nothing in it may clip.
  await page.evaluate(() => { const d = window.__atelier.state.dataset; Object.assign(d, { count: 1, res: '768x384', samples: 4 }); window.__atelier.api.datasetActions.generate(); });
  await page.waitForFunction(() => { const d = window.__atelier.state.dataset; return d.scenes.length >= 1 && !d.running; }, null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const d = window.__atelier.state.dataset; window.__atelier.api.datasetActions.inspect(d.scenes[0].name); });
  await page.waitForTimeout(1500);
  const sci = await page.evaluate(() => {
    const head = document.querySelector('.sci-head'), hr = head.getBoundingClientRect();
    const clipped = [...head.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.top < hr.top - .5 || r.bottom > hr.bottom + .5); }).map((e) => e.className || e.tagName);
    return { h: hr.height, bottom: hr.bottom, tabs: document.getElementById('inspTabs').getBoundingClientRect().bottom, clipped };
  });
  ok('desktop scene inspector: head shares the band, nothing clipped', Math.abs(sci.bottom - sci.tabs) <= .5 && !sci.clipped.length, sci);
  await shot(page, 'desktop-scene-inspector');
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  ok('desktop: no page errors or console errors', !log.errors.length && !quietLog(log).console.some((c) => c.startsWith('error')), quietLog(log));
}, { width: 1440, height: 900, timeout: 240000 });

results.failed = failed;
results.passed = results.checks.length - failed;
writeFileSync(`${DIR}/qa-results.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.passed}/${results.checks.length} checks passed`);
process.exit(failed ? 1 : 0);
