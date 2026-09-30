// Focused regressions for superseded sampling, overlapping specimen swaps,
// rapid tray sampling, and deliberate taps immediately after a sheet drag.
import assert from 'node:assert/strict';
import { withPage } from './harness.mjs';

await withPage(async (page, log) => {
  const result = await page.evaluate(async () => {
    const a = window.__atelier, api = a.api, stage = a.stage;
    const sample = api.resample();
    const newerPreset = api.applyPresetById('amber');
    const superseded = await sample;
    await newerPreset;
    const intent = { superseded, id: a.state.presetId, sampled: a.state.sampled };

    await api.applyPresetById('cap22');
    const groupCount = () => stage.studio.children.filter((x) => x.type === 'Group').length;
    const before = groupCount();
    const first = api.applyPresetById('p10');
    const replaced = stage.section.old.group;
    await new Promise((r) => setTimeout(r, 70));
    await Promise.all([first, api.resample()]);
    const afterSample = groupCount();
    const replacedRemoved = replaced.parent === null;

    // A newer preset can also interrupt a sample after its build starts.
    const nextSample = api.resample();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    await Promise.all([nextSample, api.applyPresetById('amber')]);
    const afterPreset = groupCount();
    const finalKind = stage.pill.spec.kind;

    // A disposed morph must also release the promise watching its target.
    await api.applyPresetById('cap22');
    const morph = api.applyPresetById('capred');
    const old = stage.pill, morphStarted = !!old.morph;
    const section = api.applyPresetById('amber');
    const final = api.applyPresetById('p10');
    const tripleSettled = await Promise.race([
      Promise.all([morph, section, final]).then(() => true),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]);
    const triple = { morphStarted, settled: tripleSettled, oldMorph: !!old.morph, oldAttached: !!old.group.parent, groups: groupCount() };

    const modeSample = api.resample();
    await api.setMode('tray');
    await api.setMode('specimen');
    const modeSuperseded = await modeSample;
    await api.setMode('tray');
    const seeds = [];
    for (let i = 0; i < 4; i++) {
      await api.resample();
      seeds.push({ state: a.state.tray.seed, built: stage.tray.config.seed });
    }
    const trayGroups = stage.trayWorld.children.filter((x) => x.type === 'Group').length;
    return { intent, before, afterSample, afterPreset, replacedRemoved, finalKind, triple, modeSuperseded, seeds, trayGroups };
  });
  assert.deepEqual(result.intent, { superseded: false, id: 'amber', sampled: false });
  assert.equal(result.afterSample, result.before, 'Resample must release the prior sweep');
  assert.equal(result.afterPreset, result.before, 'preset after a sample must leave one pill');
  assert.equal(result.replacedRemoved, true);
  assert.equal(result.finalKind, 'softgel');
  assert.deepEqual(result.triple, { morphStarted: true, settled: true, oldMorph: false, oldAttached: false, groups: result.before });
  assert.equal(result.modeSuperseded, false, 'switching away and back invalidates delayed sample');
  for (const { state, built } of result.seeds) assert.equal(state, built);
  for (let i = 1; i < result.seeds.length; i++) assert.notEqual(result.seeds[i].state, result.seeds[i - 1].state);
  assert.equal(result.trayGroups, 2, 'rapid tray samples must leave only scene and lighting groups');
  assert.deepEqual(log.errors, []);
  console.log('PASS: newer intent wins; interrupted pill swaps and rapid tray samples release old scenes');
}, { timeout: 90000 });

await withPage(async (page, log) => {
  const cdp = await page.context().newCDPSession(page);
  await page.waitForTimeout(1200);
  const drag = async () => {
    const [x, y] = await page.evaluate(() => {
      const r = document.getElementById('sheetHandle').getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    const touchPoints = (dy) => [{ x, y: y + dy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(0) });
    for (const dy of [-10, -20, -30]) {
      await page.waitForTimeout(30);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(dy) });
    }
    await page.waitForTimeout(110);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await drag();
  await page.waitForTimeout(130);
  await page.tap('#inspTabs [data-tab="form"]');
  assert.equal(await page.evaluate(() => window.__atelier.api.tabState.specimen), 'form', 'new tap inside suppression window must select its tab');
  await page.evaluate(() => window.__atelier.api.setSheet(false));
  await page.waitForTimeout(350);
  await drag();
  await page.evaluate(() => document.getElementById('sheetHandle').focus());
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.getElementById('inspector').classList.contains('open')), true, 'keyboard click after drag must work');
  assert.deepEqual(log.errors, []);
  console.log('PASS: deliberate new touch and keyboard activations work immediately after sheet drag');
}, { width: 390, height: 844, mobile: true, timeout: 60000 });
