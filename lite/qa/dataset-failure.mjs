// Tiny controlled failures exercise Safari-compatible JPEG decoding and keep
// actionable generation errors available after the queue finishes.
import assert from 'node:assert/strict';
import { withPage } from './harness.mjs';

await withPage(async (page, log) => {
  await page.waitForFunction(() => window.__atelier.state.dataset.storage === 'saved');
  for (const kind of ['missing', 'rejected']) {
    const result = await page.evaluate(async (kind) => {
      const a = window.__atelier, api = a.api, d = a.state.dataset;
      await api.setMode('dataset');
      Object.assign(d, { count: 1, res: '384x192', samples: 1, cameraProfile: 'phone_clean' });
      const before = d.scenes.length, bitmap = globalThis.createImageBitmap;
      const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL, create = document.createElement;
      const urls = new Set(), canvases = [];
      globalThis.createImageBitmap = kind === 'missing' ? undefined : () => Promise.reject(new Error('Injected ImageBitmap rejection'));
      URL.createObjectURL = (blob) => { const url = createURL.call(URL, blob); urls.add(url); return url; };
      URL.revokeObjectURL = (url) => { urls.delete(url); revokeURL.call(URL, url); };
      document.createElement = function (tag, ...args) { const node = create.call(this, tag, ...args); if (tag === 'canvas') canvases.push(node); return node; };
      try {
        await api.datasetActions.generate();
        const record = d.scenes.at(-1);
        return { before, after: d.scenes.length, failure: d.failure, urls: urls.size, clearedCanvases: canvases.filter((c) => !c.width && !c.height).length, profile: record.meta.camera_response.profile, jpegQuality: record.meta.camera_response.jpeg_quality, verified: Object.values(record.meta.verification).every(Boolean) };
      } finally {
        globalThis.createImageBitmap = bitmap; URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL; document.createElement = create;
      }
    }, kind);
    assert.equal(result.after, result.before + 1, kind);
    assert.equal(result.failure, null);
    assert.equal(result.urls, 0, 'temporary JPEG Blob URLs must be released');
    assert.ok(result.clearedCanvases >= 5, 'JPEG and thumbnail canvases release backing stores');
    assert.equal(result.profile, 'phone_clean');
    assert.ok(result.jpegQuality < 100, 'test must actually encode/decode JPEG');
    assert.equal(result.verified, true);
    console.log(`PASS: ${kind} ImageBitmap uses JPEG fallback and releases temporary resources`);
  }

  const beforeFailure = await page.evaluate(async () => {
    const api = window.__atelier.api, d = window.__atelier.state.dataset;
    const before = d.scenes.length, put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'archives') throw new DOMException('Injected storage quota failure', 'QuotaExceededError');
      return put.apply(this, args);
    };
    try { await api.datasetActions.generate(); } finally { IDBObjectStore.prototype.put = put; }
    return { before, after: d.scenes.length, failure: d.failure, status: d.status };
  });
  assert.equal(beforeFailure.before, beforeFailure.after, 'quota failure must not pretend a scene was saved');
  assert.equal(beforeFailure.failure.name, 'QuotaExceededError');
  assert.equal(beforeFailure.failure.stage, 'saving');
  assert.equal(beforeFailure.failure.message, 'Injected storage quota failure');
  assert.equal(beforeFailure.failure.contextLost, false);
  assert.match(beforeFailure.status, /saving.*QuotaExceededError.*Injected storage quota failure/);
  await page.waitForTimeout(1500);
  const retained = await page.evaluate(() => {
    const card = document.querySelector('.slot.failed');
    return { count: document.querySelectorAll('.slot.failed').length, text: card?.innerText, title: card?.title, aria: card?.getAttribute('aria-label'), inputLocked: document.getElementById('dockCount').disabled, completedDeletes: [...document.querySelectorAll('.tile[data-scene] [data-act="delete"]')].map((b) => b.disabled) };
  });
  assert.equal(retained.count, 1, 'failed card remains after old removal timeout');
  for (const value of [retained.text, retained.title, retained.aria]) assert.match(value, /saving.*QuotaExceededError.*Injected storage quota failure/);
  assert.equal(retained.inputLocked, false);
  assert.deepEqual(retained.completedDeletes, [false, false]);
  console.log('PASS: quota failure retains exact stage/error and keeps completed scenes usable');

  await page.evaluate(() => window.__atelier.api.datasetActions.generate());
  assert.equal(await page.evaluate(() => window.__atelier.state.dataset.failure), null);
  assert.equal(await page.locator('.slot.failed').count(), 0);
  assert.equal(await page.evaluate(() => window.__atelier.state.dataset.scenes.length), beforeFailure.before + 1);
  await page.evaluate(() => { const a = window.__atelier; a.api.datasetActions.inspect(a.state.dataset.scenes[0].name); });
  await page.waitForFunction(() => window.__atelier.api.inspector.state().loaded, null, { timeout: 15000 });
  await page.evaluate(async () => { const a = window.__atelier; a.api.inspector.close({ instant: true }); await a.api.datasetActions.remove(a.state.dataset.scenes[0].name); });
  assert.equal(await page.evaluate(() => window.__atelier.state.dataset.scenes.length), beforeFailure.before);
  assert.deepEqual(log.errors, []);
  assert.equal(log.console.filter((m) => m.startsWith('error:') && !m.includes('Injected storage quota failure')).length, 0);
  console.log('PASS: successful retry clears failure; inspect/delete still work');
}, { width: 390, height: 844, mobile: true, timeout: 90000 });
