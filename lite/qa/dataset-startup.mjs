// A batch owns its UI while waiting for storage/locks as well as rendering.
// Delayed locks exercise that window without timing guesses or large batches.
import assert from 'node:assert/strict';
import { withPage } from './harness.mjs';

await withPage(async (page, log) => {
  await page.waitForFunction(() => window.__atelier.state.dataset.storage === 'saved');
  const result = await page.evaluate(async () => {
    const a = window.__atelier, api = a.api, d = a.state.dataset;
    await api.setMode('dataset');
    Object.assign(d, { count: 1, res: '768x384', samples: 1 });
    const buttons = () => ({
      countLocked: document.getElementById('dockCount').disabled,
      deleteLocked: document.querySelector('.tile [data-act="delete"]')?.disabled,
      inspectorDeleteLocked: document.getElementById('sciDelete').disabled,
    });
    await api.datasetActions.generate();
    const afterSuccess = buttons(), name = d.scenes[0].name;
    const original = navigator.locks.request;
    const holdLock = () => {
      let release, entered;
      const ready = new Promise((r) => { entered = r; });
      navigator.locks.request = (_name, _options, fn) => new Promise((resolve) => {
        release = (lock) => resolve(fn(lock)); entered();
      });
      return { ready, release: (lock) => release(lock) };
    };
    try {
      const held = holdLock();
      const generation = api.datasetActions.generate();
      await held.ready;
      await api.setMode('specimen');
      await api.datasetActions.remove(name);
      api.datasetActions.inspect(name);
      const pending = { ...buttons(), mode: a.state.mode, names: d.scenes.map((s) => s.name), running: d.running };
      api.inspector.close({ instant: true });
      const stop = setInterval(() => { if (d.running) api.datasetActions.cancel(); }, 0);
      try { held.release({}); await generation; } finally { clearInterval(stop); }
      const afterAcquired = { ...buttons(), mode: a.state.mode, names: d.scenes.map((s) => s.name), running: d.running };

      const refused = holdLock();
      const refusal = api.datasetActions.generate();
      await refused.ready;
      const refusalLocked = buttons();
      refused.release(null); await refusal;
      const afterRefusal = { ...buttons(), status: document.getElementById('sheetStatus').textContent };

      navigator.locks.request = () => Promise.reject(new Error('Injected lock failure'));
      const error = await api.datasetActions.generate().then(() => null, (e) => e.message);
      const afterError = buttons();
      await api.setMode('specimen');
      return { name, afterSuccess, pending, afterAcquired, refusalLocked, afterRefusal, afterError, error, finalMode: a.state.mode };
    } finally { navigator.locks.request = original; }
  });
  assert.equal(result.afterSuccess.countLocked, false);
  assert.equal(result.afterSuccess.deleteLocked, false);
  assert.equal(result.pending.running, false, 'probe must target startup before rendering');
  assert.equal(result.pending.mode, 'dataset');
  assert.deepEqual(result.pending.names, [result.name]);
  assert.equal(result.pending.countLocked, true);
  assert.equal(result.pending.deleteLocked, true);
  assert.equal(result.pending.inspectorDeleteLocked, true);
  assert.equal(result.afterAcquired.mode, 'dataset');
  assert.deepEqual(result.afterAcquired.names, [result.name]);
  assert.equal(result.afterAcquired.running, false);
  assert.equal(result.afterAcquired.countLocked, false);
  assert.equal(result.afterAcquired.deleteLocked, false);
  assert.equal(result.refusalLocked.countLocked, true);
  assert.equal(result.refusalLocked.deleteLocked, true);
  assert.equal(result.afterRefusal.countLocked, false);
  assert.equal(result.afterRefusal.deleteLocked, false);
  assert.match(result.afterRefusal.status, /Another tab/);
  assert.equal(result.error, 'Injected lock failure');
  assert.equal(result.afterError.countLocked, false);
  assert.equal(result.afterError.deleteLocked, false);
  assert.equal(result.finalMode, 'specimen');
  assert.deepEqual(log.errors, []);
  console.log('PASS: pending batch blocks mode/delete; count and delete controls unlock after success, cancellation, lock refusal and error');
}, { width: 390, height: 844, mobile: true, timeout: 90000 });
