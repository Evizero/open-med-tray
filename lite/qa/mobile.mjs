import { withPage, settle } from './harness.mjs';
const out = {};
await withPage(async (page, log) => {
  const t0 = Date.now();
  await page.waitForFunction(() => document.getElementById('boot').classList.contains('gone'), null, { timeout: 30000 });
  out.firstFrameMs = Date.now() - t0;
  await page.waitForTimeout(4200);
  await settle(page).catch(() => {});
  await page.screenshot({ path: 'qa/screens/mobile-specimen.png' });
  await page.tap('#sheetHandle'); await page.waitForTimeout(900);
  out.sheetOpen = await page.evaluate(() => ({ open: document.getElementById('inspector').classList.contains('open'), expanded: document.getElementById('sheetHandle').getAttribute('aria-expanded') }));
  await page.screenshot({ path: 'qa/screens/mobile-sheet-open.png' });
  await page.tap('.preset[data-preset="amber"]'); await page.waitForTimeout(600);
  await page.tap('#sheetHandle'); await page.waitForTimeout(2500);
  await settle(page).catch(() => {});
  await page.screenshot({ path: 'qa/screens/mobile-softgel.png' });
  out.softgel = await page.evaluate(() => ({ kind: window.__atelier.state.spec.kind, open: document.getElementById('inspector').classList.contains('open') }));
  // Tapping a tab in the collapsed peek opens the sheet on that tab.
  await page.tap('#inspTabs button[data-tab="surface"]'); await page.waitForTimeout(700);
  out.tabTapOpens = await page.evaluate(() => ({ open: document.getElementById('inspector').classList.contains('open'), tab: window.__atelier.api.tabState.specimen }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.tap('.modes button[data-mode="tray"]'); await page.waitForTimeout(5000);
  await settle(page).catch(() => {});
  await page.screenshot({ path: 'qa/screens/mobile-tray.png' });
  await page.tap('.modes button[data-mode="dataset"]'); await page.waitForTimeout(1500);
  await page.screenshot({ path: 'qa/screens/mobile-dataset.png' });
  // Touch target sizes and text overflow checks (collapsed sheet, dataset mode).
  out.smallTargets = await page.evaluate(() => [...document.querySelectorAll('button, input[type=range]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden' && r.top < innerHeight && (r.height < 24 || r.width < 24); }).map((b) => b.className + ':' + (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 20) + ':' + Math.round(b.getBoundingClientRect().height)));
  out.overflow = await page.evaluate(() => [...document.querySelectorAll('.wordmark, .modes button, .tabs button, .insp-title, .btn, .seg button, .preset .pn')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 24)));
  // Same check with the sheet expanded on the Form tab (the densest controls).
  await page.tap('.modes button[data-mode="specimen"]'); await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__atelier.api.setTab('form'); window.__atelier.api.setSheet(true); }); await page.waitForTimeout(700);
  out.smallTargetsOpenForm = await page.evaluate(() => [...document.querySelectorAll('#inspector button, #inspector input[type=range]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && (r.height < 24 || r.width < 24); }).map((b) => b.className + ':' + (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 20) + ':' + Math.round(b.getBoundingClientRect().height)));
  out.canvas = await page.evaluate(() => { const s = window.__atelier.stage; return { w: s.pipe.width, h: s.pipe.height, css: [s.cssW, s.cssH], keys: s.rig.keys.length, maxSamples: s.pipe.maxSamples }; });
  out.log = { errors: log.errors, console: log.console.filter((c) => !c.includes('maxLeafSize')) };
}, { width: 390, height: 844, mobile: true, dpr: 2, timeout: 240000 });
await withPage(async (page, log) => {
  await page.waitForTimeout(1500);
  out.reducedMotion = await page.evaluate(() => ({ macroIntroSkipped: !window.__atelier.stage.animations.size, damping: window.__atelier.stage.controls.enableDamping }));
  await page.evaluate(() => { window.__atelier.api.applyPresetById('cap22'); });
  await page.waitForTimeout(250);
  out.reducedMotion.sectionDone = await page.evaluate(() => !window.__atelier.stage.section && window.__atelier.stage.pill.spec.kind === 'capsule');
  out.reducedMotion.uiTransitions = await page.evaluate(() => ({ tabs: getComputedStyle(document.getElementById('inspTabs'), '::after').transitionDuration, sheet: getComputedStyle(document.getElementById('inspector')).transitionDuration, tour: getComputedStyle(document.getElementById('tourCap')).transitionDuration }));
  out.reducedLog = log.errors;
}, { reducedMotion: 'reduce', timeout: 120000 });
console.log(JSON.stringify(out, null, 1));
