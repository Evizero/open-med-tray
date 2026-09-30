import assert from 'node:assert/strict';
// Dataset export end-to-end: generate N scenes, download ZIP, verify contents;
// then start another batch and cancel it; check the app state is restored.
import { withPage } from './harness.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePNG } from '../src/util/png.js';
mkdirSync('qa/dataset', { recursive: true });
const report = {};
await withPage(async (page, log) => {
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.__atelier.api.setMode('tray'));
  await page.waitForTimeout(3000);
  const before = await page.evaluate(() => { const s = window.__atelier.stage; return { cam: s.trayCam.position.toArray(), scene: s.pipe.scene === s.trayWorld, rigParent: s.rig.group.parent === s.trayWorld, seed: s.tray.config.seed }; });
  await page.evaluate(() => window.__atelier.api.setMode('dataset'));
  await page.evaluate(() => { const d = window.__atelier.state.dataset; d.count = 4; d.res = '768x384'; d.samples = 8; d.seed = 1000; });
  const t0 = Date.now();
  await page.evaluate(() => window.__atelier.api.datasetActions.generate());
  await page.waitForFunction(() => !window.__atelier.state.dataset.running && window.__atelier.state.dataset.scenes.length === 4, null, { timeout: 240000, polling: 500 });
  report.generateSeconds = (Date.now() - t0) / 1000;
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'qa/screens/dataset-sheet.png' });
  const dl = page.waitForEvent('download');
  await page.click('#dsZip');
  const d = await dl; await d.saveAs('qa/dataset/export.zip');
  report.status = await page.evaluate(() => window.__atelier.state.dataset.status);
  // Cancel test
  await page.evaluate(() => { const d = window.__atelier.state.dataset; d.count = 12; d.seed = 2000; });
  await page.evaluate(() => { window.__atelier.api.datasetActions.generate(); });
  await page.waitForFunction(() => window.__atelier.state.dataset.scenes.length > 4, null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => window.__atelier.api.datasetActions.cancel());
  await page.waitForFunction(() => !window.__atelier.state.dataset.running, null, { timeout: 120000, polling: 300 });
  report.cancel = await page.evaluate(() => ({ status: window.__atelier.state.dataset.status, scenes: window.__atelier.state.dataset.scenes.length, zip: window.__atelier.state.dataset.scenes.every(s => !!s.archive || s.persisted) }));
  await page.evaluate(() => window.__atelier.api.setMode('tray'));
  await page.waitForTimeout(2500);
  report.restored = { before, after: await page.evaluate(() => { const s = window.__atelier.stage; return { cam: s.trayCam.position.toArray(), scene: s.pipe.scene === s.trayWorld, rigParent: s.rig.group.parent === s.trayWorld, seed: s.tray.config.seed, controls: s.controls.enabled, busyExport: !!s.busyExport, running: s.running }; }) };
  await page.screenshot({ path: 'qa/screens/dataset-after-restore.png' });
  report.log = { errors: log.errors, console: log.console.filter((c) => !c.includes('maxLeafSize')), requests: log.requests.filter((r) => !r.startsWith('file:') && !r.startsWith('blob:') && !r.startsWith('data:')) };
}, { timeout: 600000 });
// Independent verification of the archive.
const z = unzipSync(readFileSync('qa/dataset/export.zip'));
const names = Object.keys(z).sort();
report.files = names.length; report.names = names.slice(0, 12);
const scenes = names.filter((n) => n.endsWith('metadata.json'));
report.scenes = [];
for (const m of scenes) {
  const meta = JSON.parse(strFromU8(z[m]));
  const dir = m.replace('metadata.json', '');
  const inst = decodePNG(z[dir + 'instance_ids.png']), sem = decodePNG(z[dir + 'semantic_ids.png']), rgb = decodePNG(z[dir + 'rgb.png']);
  const ordinal=Number(meta.scene.slice(-4))-1,stem=`pill-atelier-dataset/blender/train/${String(ordinal).padStart(6,'0')}`;
  assert.deepEqual(inst.data,decodePNG(z[stem+'_instance.png']).data,'one instance convention in both layouts');
  assert.deepEqual(sem.data,decodePNG(z[stem+'_semantic.png']).data,'one semantic convention in both layouts');
  const training=JSON.parse(strFromU8(z[stem+'.json']));
  assert.deepEqual(meta.pills.map(p=>p.instance_id),training.objects.map(o=>o.instance_id));
  assert.deepEqual(meta.pills.map(p=>p.semantic_id),training.objects.map(o=>o.class_id));
  assert.equal(meta.label_schema,'medtray/classes-v1');
  assert(training.lighting_parameters?.sources?.length>=2);
  // Recompute boxes from the raw instance PNG and compare with metadata.
  const boxes = new Map();
  for (let i = 0; i < inst.data.length; i++) { const id = inst.data[i]; if (!id) continue; const x = i % inst.width, y = (i / inst.width) | 0; const b = boxes.get(id) || [x, y, x, y, 0]; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); b[4]++; boxes.set(id, b); }
  let boxMatch = true, pixMatch = true, semPill = true;
  for (const p of meta.pills) {
    const b = boxes.get(p.instance_id);
    if (!b) { if (!p.fully_hidden) boxMatch = false; continue; }
    const exp = [b[0], b[1], b[2] + 1, b[3] + 1];
    if (JSON.stringify(exp) !== JSON.stringify(p.bbox_xyxy_px)) boxMatch = false;
    if (b[4] !== p.visible_pixels) pixMatch = false;
  }
  for (let i = 0; i < inst.data.length; i++) if (inst.data[i]>=10 && inst.data[i]<500 && !(sem.data[i] >= 2 && sem.data[i] <= 13)) { semPill = false; break; }
  const capsules = meta.pills.filter((p) => p.family === 'hard_capsule').length;
  const semCounts = {}; for (const v of sem.data) semCounts[v] = (semCounts[v] || 0) + 1;
  report.scenes.push({ scene: meta.scene, seed: meta.seed, style: meta.container.style, cover: meta.cover.kind, rgb: [rgb.width, rgb.height, rgb.colorType], inst: [inst.width, inst.height, inst.bitDepth], pills: meta.pills.length, visible: [...boxes.keys()].filter(id=>id>=10&&id<500).length, capsules, boxMatch, pixMatch, instanceOnlyOnPillClasses: semPill, verification: meta.verification, semClasses: Object.keys(semCounts).join(','), camera: meta.camera.resolution_px });
}
const manifest = JSON.parse(strFromU8(z['pill-atelier-dataset/manifest.json']));
report.manifestScenes = manifest.scenes.length;
report.readmeHasCoverPolicy = strFromU8(z['pill-atelier-dataset/README.md']).includes('Transparent covers');
writeFileSync('qa/dataset/report.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));

assert.equal(report.scenes.length,4);
assert(report.scenes.every(s=>s.boxMatch&&s.pixMatch&&s.instanceOnlyOnPillClasses&&Object.values(s.verification).every(Boolean)));
assert.deepEqual(report.log.errors,[]);assert.deepEqual(report.log.console,[]);
assert(report.cancel.zip&&report.cancel.scenes>4&&report.cancel.scenes<16);
assert.deepEqual(report.restored.before.cam,report.restored.after.cam);
assert.equal(report.restored.after.busyExport,false);assert.equal(report.restored.after.rigParent,true);
