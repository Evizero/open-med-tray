// Direct manipulation of the specimen's size dimensions. The drafting pass
// (render/annotations.js) publishes where each size dimension is drawn and
// draws every visible affordance itself (grips, hot dimension, drag guide) in
// its depth-tested MSAA overlay; this module only decides what is hot or
// active (stage.dimUI) and handles the pointer. There are no DOM hit nodes:
// a capture-phase pointerdown tests grips and dimension lines in screen space
// and against the pill (a grip hidden behind the object cannot be grabbed),
// and claims the pointer only for a real hit, so orbit keeps every other press.
// A drag follows the dimension's own 3D axis: the pointer ray's closest point
// on the axis relative to where it was pressed (no jump), ×2 for symmetric
// length/width, ×1 for height (the pill stays on the table). Axes seen nearly
// end-on (drafting pass: usable = false) are not offered.
import * as THREE from 'three';
import { capsuleDims, softgelDims } from '../geo/shells.js';
import { paramLimits, clampStep } from './limits.js';
import { validate } from '../scene/catalog.js';

const FINE = .2;                 // Shift gain

// What each drawn dimension edits, per family. `value` is the resolved size the
// dimension shows; `write` maps a new shown size back to the spec parameter.
export function dimParam(spec, key) {
  spec = validate(structuredClone(spec));   // what the mesh was built from
  const Lm = paramLimits(spec);
  if (spec.kind === 'capsule') {
    const d = capsuleDims(spec), ov = spec.ovality ?? .99, w2 = 2 * d.wall;
    if (key === 'L') return { name: 'Closed length', hl: 'h-length', value: d.L, k: 2, step: .1, limits: Lm.length, write: (x, v) => { x.length = v; } };
    const f = key === 'H' ? ov : 1;
    return { name: 'Outer diameter', hl: 'h-width', value: 2 * d.rc * f, k: key === 'H' ? 1 : 2, step: .05 * f, limits: Lm.width.map((w) => (w + w2) * f), write: (x, v) => { x.width = +(v / f - w2).toFixed(3); } };
  }
  if (spec.kind === 'softgel') {
    const d = softgelDims(spec);
    if (key === 'L') return { name: 'Length', hl: 'h-length', value: d.L, k: 2, step: .1, limits: Lm.length, write: (x, v) => { x.length = v; } };
    if (key === 'W') return { name: 'Width', hl: 'h-width', value: d.W, k: 2, step: .1, limits: Lm.width, write: (x, v) => { x.width = v; } };
    return { name: 'Height', hl: 'h-thickness', value: d.H, k: 1, step: .1, limits: Lm.thickness, write: (x, v) => { x.thickness = v; } };
  }
  const round = ['round', 'ring'].includes(spec.outline);
  if (key === 'L') return { name: round ? 'Diameter' : 'Length', hl: 'h-length', value: spec.length, k: 2, step: .1, limits: Lm.length, write: (x, v) => { x.length = v; if (round) x.width = v; } };
  if (key === 'W') return { name: 'Width', hl: 'h-width', value: spec.width, k: 2, step: .1, limits: Lm.width, write: (x, v) => { x.width = v; } };
  return { name: 'Thickness', hl: 'h-thickness', value: spec.thickness, k: 1, step: .05, limits: Lm.thickness, write: (x, v) => { x.thickness = v; } };
}

const cursorFor = (dx, dy) => { const a = ((Math.atan2(dy, dx) * 180 / Math.PI) + 180) % 180; return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize'; };
const segDist = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)); return [Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy), t]; };

export class DimHandles {
  // host: { stage, canvas, enabled(), getSpec(), begin(), update(fn), commit(fn), cancel(), hover(hl|null), hint(text|null) }
  constructor(host) {
    this.h = host;
    const st = host.stage, canvas = host.canvas;
    this.drag = null;
    this.hot = null;
    this.ui = st.dimUI = { enabled: () => this.available(), hot: null, active: null };
    this.raycaster = new THREE.Raycaster();
    // Before OrbitControls and the app's canvas handlers (capture phase on window).
    addEventListener('pointerdown', (e) => this.down(e), true);
    canvas.addEventListener('pointermove', (e) => { if (!this.drag && e.buttons === 0 && e.pointerType !== 'touch') this.queueHover(e); });
    canvas.addEventListener('pointerleave', () => { if (!this.drag) this.setHot(null); });
    this.onKey = (e) => { if (e.key === 'Escape' && this.drag) { e.preventDefault(); e.stopImmediatePropagation(); this.end(false); } };
    addEventListener('blur', () => this.cancel());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
  }

  available() {
    const st = this.h.stage;
    return !!(this.h.enabled() && st.mode === 'specimen' && st.pill && !st.pill.morph && !st.section && st.controls.enabled);
  }

  // Grips and dimension lines under a screen point, nearest first; each is
  // checked against the pill along the pointer ray (occluded parts do not count).
  pick(e) {
    if (!this.available()) return null;
    const st = this.h.stage, f = st.free, touch = e.pointerType === 'touch';
    const x = e.clientX, y = e.clientY;
    if (x < f.x || x > f.x + f.w || y < f.y || y > f.y + f.h) return null;
    const R = touch ? 22 : 12, B = touch ? 16 : 7;
    const cands = [];
    for (const it of st.annotations.handles) {
      if (!it.usable) continue;
      const pa = st.project(it.a), pb = st.project(it.b);
      for (const end of it.ends) { const p = end > 0 ? pb : pa, d = Math.hypot(x - p[0], y - p[1]); if (d <= R) cands.push({ it, end, score: d, world: (end > 0 ? it.b : it.a).clone(), pa, pb }); }
      const [d, t] = segDist(x, y, pa, pb);
      if (d <= B) {
        const end = it.key === 'H' ? 1 : (t >= .5 ? 1 : -1);
        cands.push({ it, end, score: d + 8, world: it.a.clone().lerp(it.b, t), pa, pb });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    const { o, dir } = this.ray(e);
    this.raycaster.set(o, dir);
    const hit = st.pill.meshes.length ? this.raycaster.intersectObjects(st.pill.meshes, false)[0] : null;
    for (const c of cands) {
      // Visible if the pill is not hit before the handle point along this ray.
      const along = c.world.clone().sub(o).dot(dir);
      if (!hit || hit.distance > along - .05) return c;
    }
    return null;
  }

  queueHover(e) {
    this.lastMove = e;
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => { this.hoverQueued = false; if (!this.drag) this.setHot(this.pick(this.lastMove)); });
  }

  setHot(c) {
    const key = c?.it.key ?? null, canvas = this.h.canvas;
    canvas.style.cursor = c ? cursorFor(c.pb[0] - c.pa[0], c.pb[1] - c.pa[1]) : '';
    if (key === this.hot) return;
    this.hot = key; this.ui.hot = key;
    const p = key ? dimParam(this.h.getSpec(), key) : null;
    this.h.hover(p?.hl ?? null);
    this.h.hint(p ? `${p.name} · drag along the dimension to resize · Shift for fine steps` : null);
    this.h.stage.requestOverlay();
  }

  ray(e) {
    const st = this.h.stage, cam = st.camera, rect = st.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3((e.clientX - rect.left) / st.cssW * 2 - 1, 1 - (e.clientY - rect.top) / st.cssH * 2, .5);
    const o = cam.position.clone(), dir = ndc.unproject(cam).sub(o).normalize();
    return { o, dir };
  }
  // Parameter along the axis line (P0 + t·A) closest to the pointer ray.
  axisT(e) {
    const { o, dir } = this.ray(e), d = this.drag;
    const w0 = d.P0.clone().sub(o), b = d.A.dot(dir), den = 1 - b * b;
    if (den < 1e-4) return d.t;   // excluded by the usable test; hold still
    return (b * dir.dot(w0) - d.A.dot(w0)) / den;
  }

  down(e) {
    if (e.target !== this.h.canvas || this.drag || e.button > 0 || (e.pointerType === 'mouse' && e.buttons !== 1)) return;
    const c = this.pick(e);
    if (!c) return;   // not ours: orbit / selection proceed untouched
    e.stopImmediatePropagation(); e.preventDefault();
    const p = dimParam(this.h.getSpec(), c.it.key);
    this.drag = { key: c.it.key, end: c.end, p, v0: p.value, last: p.value, A: c.it.b.clone().sub(c.it.a).normalize(), P0: (c.end > 0 ? c.it.b : c.it.a).clone(), changed: false, fine: e.shiftKey, id: e.pointerId };
    this.drag.t0 = this.drag.t = this.axisT(e);
    const canvas = this.h.canvas;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    this.moveH = (ev) => this.move(ev);
    this.upH = (ev) => { if (ev.pointerId === this.drag?.id) this.end(true); };
    this.cancelH = (ev) => { if (ev.pointerId === this.drag?.id) this.end(false); };
    canvas.addEventListener('pointermove', this.moveH);
    canvas.addEventListener('pointerup', this.upH);
    canvas.addEventListener('pointercancel', this.cancelH);
    canvas.addEventListener('lostpointercapture', this.cancelH);
    addEventListener('keydown', this.onKey, true);
    this.hot = c.it.key; this.ui.hot = c.it.key;
    this.ui.active = { key: c.it.key, end: c.end };
    const cursor = cursorFor(c.pb[0] - c.pa[0], c.pb[1] - c.pa[1]);
    canvas.style.cursor = cursor;
    document.documentElement.classList.add('dim-dragging');
    document.documentElement.style.cursor = cursor;
    this.h.hover(p.hl);
    this.h.hint(e.pointerType === 'touch' ? `${p.name} · lift to apply` : `${p.name} · release to apply · Esc to cancel`);
    this.h.stage.requestOverlay();
  }

  move(e) {
    const d = this.drag; if (!d || e.pointerId !== d.id) return;
    if (!this.available()) { this.end(false); return; }
    const t = this.axisT(e);
    // Shift changes the gain from the current position: re-anchor, no jump.
    if (e.shiftKey !== d.fine) { d.v0 = d.last; d.t0 = d.t; d.fine = e.shiftKey; }
    d.t = t;
    const v = clampStep(d.v0 + d.p.k * d.end * (t - d.t0) * (d.fine ? FINE : 1), d.p.limits, d.p.step);
    if (v === d.last) return;
    if (!d.changed) { d.changed = true; this.h.begin(); }
    d.last = v;
    this.h.update((x) => d.p.write(x, v));
  }

  // Abandon a gesture from outside (mode change, tour, blur): restore.
  cancel() { if (this.drag) this.end(false); }

  // commit = true on release; false for Escape, pointercancel, lost capture,
  // blur or a mode change (restores the starting shape exactly).
  end(commit) {
    const d = this.drag; if (!d) return;
    this.drag = null;
    const canvas = this.h.canvas;
    canvas.removeEventListener('pointermove', this.moveH);
    canvas.removeEventListener('pointerup', this.upH);
    canvas.removeEventListener('pointercancel', this.cancelH);
    canvas.removeEventListener('lostpointercapture', this.cancelH);
    removeEventListener('keydown', this.onKey, true);
    try { if (canvas.hasPointerCapture(d.id)) canvas.releasePointerCapture(d.id); } catch {}
    document.documentElement.classList.remove('dim-dragging');
    document.documentElement.style.cursor = '';
    canvas.style.cursor = '';
    this.ui.active = null; this.hot = null; this.ui.hot = null;
    this.h.hover(null); this.h.hint(null);
    if (d.changed) { if (commit) this.h.commit((x) => d.p.write(x, d.last)); else this.h.cancel(); }
    this.h.stage.requestOverlay();
  }
}
