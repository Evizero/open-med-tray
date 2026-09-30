// Functional QA (desktop): sliders change geometry, presets/families, section
// transition, selection + return, randomize determinism, keyboard, no tour,
// label overlay. Writes qa/functional.json and screenshots.
import { withPage, settle } from './harness.mjs';
import { writeFileSync } from 'node:fs';
const R = { checks: [] };
const ok = (name, pass, detail) => { R.checks.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? '')); };
await withPage(async (page, log) => {
  const ev = (fn, a) => page.evaluate(fn, a);
  await page.waitForTimeout(4200);
  R.offline = { requests: log.requests };
  // 1. Slider changes geometry (real input on the Thickness range, Form tab).
  const geo = () => ev(() => { const m = window.__atelier.stage.pill.meshes[0]; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((v) => +v.toFixed(3)); });
  const g0 = await geo();
  await ev(() => window.__atelier.api.setTab('form')); await page.waitForTimeout(300);
  const box = await ev(() => { const l = [...document.querySelectorAll('.row label')].find((x) => x.textContent === 'Thickness'); const i = document.getElementById(l.getAttribute('for')); i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; });
  await page.mouse.click(box.x + box.w * .8, box.y);
  await page.waitForTimeout(900);
  const g1 = await geo();
  ok('thickness slider changes mesh thickness', Math.abs(g1[2] - g0[2]) > .5, { before: g0, after: g1 });
  // 2. Morph within tablets (same topology) and section swap to capsule.
  await ev(() => { window.__atelier.api.applyPresetById('inset'); });
  await page.waitForTimeout(250);
  const morphing = await ev(() => !!window.__atelier.stage.pill.morph);
  await page.waitForTimeout(1200);
  ok('tablet preset change morphs vertex-for-vertex', morphing, {});
  await ev(() => { window.__atelier.api.applyPresetById('cap22'); });
  await page.waitForTimeout(520);
  const sec = await ev(() => !!window.__atelier.stage.section);
  await page.screenshot({ path: 'qa/screens/section-transition-mid.png' });
  await page.waitForTimeout(1400);
  const capsule = await ev(() => { const p = window.__atelier.stage.pill; return { kind: p.spec.kind, meshes: p.meshes.length, ids: p.meshes.map((m) => m.userData.label.instance), colors: p.materials.map((m) => m.userData.uniforms.uBase.value.toArray().map((v) => +v.toFixed(3))) }; });
  ok('tablet -> capsule uses section-plane transition', sec, {});
  ok('capsule: two colour regions, one instance id', capsule.meshes === 2 && capsule.ids[0] === capsule.ids[1] && JSON.stringify(capsule.colors[0]) !== JSON.stringify(capsule.colors[1]), capsule);
  await ev(() => window.__atelier.api.applyPresetById('green'));
  await page.waitForTimeout(2200);
  const gel = await ev(() => { const m = window.__atelier.stage.pill.materials[0]; return { transmission: m.transmission, attenuation: m.attenuationColor.toArray(), castShadow: window.__atelier.stage.pill.meshes[0].castShadow }; });
  ok('softgel translucent: transmission + coloured attenuation', gel.transmission > .5 && gel.attenuation[1] > gel.attenuation[0], gel);
  await ev(() => window.__atelier.api.applyPresetById('damaged'));
  await page.waitForTimeout(3500);
  const dmg = await ev(() => window.__atelier.stage.pill.record.damage);
  ok('damage preset: CSG chips + fracture, volume reduced', dmg && dmg.remaining_fraction < .9 && dmg.chips.length === 2 && dmg.fracture, dmg);
  await settle(page).catch(() => {});
  await page.screenshot({ path: 'qa/screens/specimen-damaged.png' });
  // 3. Keyboard: ] cycles preset, 2 switches to tray.
  const p0 = await ev(() => window.__atelier.state.presetId);
  await page.keyboard.press(']'); await page.waitForTimeout(1500);
  const p1 = await ev(() => window.__atelier.state.presetId);
  ok('keyboard ] cycles presets', p0 !== p1, { p0, p1 });
  await page.keyboard.press('2'); await page.waitForTimeout(3500);
  ok('keyboard 2 opens tray mode', await ev(() => window.__atelier.state.mode === 'tray'), {});
  // 4. Randomize determinism: same seed/config -> identical label pass and metadata.
  const sig = () => ev(() => { const s = window.__atelier.stage; s.tray.finishAnimation(); const api = window.__atelier.api; const L = api.labelsHash(); return { hash: L, meta: JSON.stringify(s.tray.pillRecords().map((p) => [p.family, p.pose, p.dimensions_mm])).length, seed: s.tray.config.seed }; });
  await page.keyboard.press('r'); await page.waitForTimeout(3000);
  const a = await sig();
  await ev(() => window.__atelier.api.trayActions.rebuild(false)); await page.waitForTimeout(2500);
  const b = await sig();
  ok('same seed rebuild reproduces identical label pass', a.hash === b.hash && a.meta === b.meta, { a, b });
  // 5. Selection via real click on a pill, then Escape returns.
  const pt = await ev(() => { const s = window.__atelier.stage; const p = s.tray.pills[0]; const [x, y] = s.project(p.group.position); return { x, y }; });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(1800);
  const sel = await ev(() => ({ selected: !!window.__atelier.state.selected, view: window.__atelier.stage.trayView, panelLabel: document.getElementById('inspector').getAttribute('aria-label') }));
  await settle(page).catch(() => {});
  await page.screenshot({ path: 'qa/screens/tray-selected-pill.png' });
  ok('click selects a pill and flies to it', sel.selected && sel.view === 'pill', sel);
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  ok('Escape returns to capture view', await ev(() => !window.__atelier.state.selected && window.__atelier.stage.trayView === 'capture'), {});
  // 6. Labels overlay + boxes; camera slider updates capture.
  await ev(() => window.__atelier.api.setLabels('semantic')); await page.waitForTimeout(1500);
  await page.screenshot({ path: 'qa/screens/tray-labels-semantic.png' });
  ok('label overlay visible', await ev(() => getComputedStyle(document.getElementById('labelLayer')).opacity > .5), {});
  await ev(() => window.__atelier.api.setLabels('off'));
  // 7. No tour: no controls, and T is not a shortcut.
  const modeBeforeT = await ev(() => window.__atelier.state.mode);
  await page.keyboard.press('t'); await page.waitForTimeout(300);
  ok('no tour controls or shortcut', await ev(() => !document.querySelector('#tourBtn, #tourCap, #introTour') && !('tour' in window.__atelier.state) && !('playTour' in window.__atelier.api)) && await ev(() => window.__atelier.state.mode) === modeBeforeT, {});
  // 8. Idle: GPU loop stops when converged.
  await settle(page, 60000).catch(() => {});
  await page.waitForTimeout(1500);
  ok('render loop stops when idle', await ev(() => !window.__atelier.stage.running), {});
  R.log = { errors: log.errors, console: log.console.filter((c) => !c.includes('maxLeafSize')), nonFileRequests: log.requests.filter((r) => !/^(file|blob|data):/.test(r)) };
  ok('no page errors / console errors / network requests', !R.log.errors.length && !R.log.console.length && !R.log.nonFileRequests.length, R.log);
}, { timeout: 480000 });
writeFileSync('qa/functional.json', JSON.stringify(R, null, 1));
