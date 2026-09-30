// Scene inspector: one collected scene at native aspect with every target the
// export contains, decoded from the scene's own archive. Views are real files;
// colours are display mappings with legends, never the stored encodings.
import { el } from './controls.js';
import {CLASSES, CLASS_COLORS} from '../labels/schema.js';
import { TRAY_STYLES } from '../geo/tray.js';
import { LIGHTING } from '../render/lighting.js';
import { SURFACES } from '../render/surfaces.js';
import { loadScene } from './scene-data.js';
import { icon, ICONS, human } from './collection.js';

const EASE = 'cubic-bezier(.2,.7,.15,1)';
const DARK = [22, 21, 19];
const BG_DEPTH = 1e9;

export const VIEWS = [
  { id: 'rgb', label: 'RGB' },
  { id: 'instance', label: 'Instances' },
  { id: 'semantic', label: 'Classes' },
  { id: 'depth', label: 'Depth' },
  { id: 'film', label: 'Cover' },
  { id: 'glare', label: 'Glare' },
  { id: 'sticker', label: 'Sticker' },
  { id: 'print', label: 'Print ink' },
];
const MODES = [['overlay', 'Overlay'], ['target', 'Target'], ['split', 'Split']];
const MASKS = {
  film: ['cover pixels', 'Visible transparent cover (first geometric surface). Labels see through it.'],
  glare: ['glare pixels', null],
  sticker: ['sticker pixels', 'Opaque paper sticker; occludes what lies beneath in screen space.'],
};

// ---------------------------------------------------------------- colour
function hsl(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const hue = (id) => hsl((id * 0.61803398875) % 1, .68, .58);
function instanceColor(id) {
  if (!id) return null;
  if (id === 1) return [104, 102, 97];
  if (id === 500) return [238, 235, 226];
  if (id >= 1000 && id < 2000 && id % 2 === 0) return [226, 212, 172];
  return hue(id);
}
const VIRIDIS = (() => {
  const c = [[.2777273272234177, .005407344544966578, .3340998053353061], [.1050930431085774, 1.404613529898575, 1.384590162594685], [-.3308618287255563, .214847559468213, .09509516302823659], [-4.634230498983486, -5.799100973351585, -19.33244095627987], [6.228269936347081, 14.17993336680509, 56.69055260068105], [4.776384997670288, -13.74514537774601, -65.35303263337234], [-5.435455855934631, 4.645852612178535, 26.3124352495832]];
  return Array.from({ length: 256 }, (_, i) => { const t = i / 255; return [0, 1, 2].map((j) => { let v = c[6][j]; for (let k = 5; k >= 0; k--) v = c[k][j] + t * v; return Math.round(255 * Math.min(1, Math.max(0, v))); }); });
})();
const rgbCss = (c) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent');
const pct = (n, total) => { const p = (100 * n) / Math.max(1, total); return p === 0 ? '0 %' : p < .01 ? '< 0.01 %' : `${p < 1 ? p.toFixed(2) : p.toFixed(1)} %`; };
const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const fmtMM = (m) => `${(m * 1000).toFixed(3)} mm`;

// ---------------------------------------------------------------- analysis (memoised per scene)
function stats(d, key) {
  d.stats ??= {};
  if (d.stats[key]) return d.stats[key];
  let s;
  if (key === 'depth') {
    const a = d.array('depth'); let min = Infinity, max = -Infinity, bg = 0;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v >= BG_DEPTH) bg++; else { if (v < min) min = v; if (v > max) max = v; } }
    s = { min, max, bg, valid: a.length - bg };
  } else if (['film', 'glare', 'sticker'].includes(key)) {
    const a = d.array(key); let on = 0; for (let i = 0; i < a.length; i++) if (a[i]) on++;
    s = { on, total: a.length };
  } else {
    const a = d.array(key), m = new Map();
    for (let i = 0; i < a.length; i++) m.set(a[i], (m.get(a[i]) || 0) + 1);
    s = { counts: m, total: a.length };
  }
  return (d.stats[key] = s);
}

function compose(d, view, mode) {
  const w = d.width, h = d.height, n = w * h, out = new Uint8ClampedArray(n * 4), opaque = mode !== 'overlay';
  const put = (k, c, a) => { const o = k * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = a; };
  if (view === 'instance' || view === 'semantic') {
    const ids = d.array(view);
    for (let k = 0; k < n; k++) {
      const id = ids[k], c = view === 'instance' ? instanceColor(id) : id === 0 ? null : CLASS_COLORS[id] ?? [255, 0, 255];
      if (!c) put(k, DARK, opaque ? 255 : 0); else put(k, c, opaque ? 255 : id === 1 ? 70 : 200);
    }
  } else if (view === 'depth') {
    const a = d.array('depth'), { min, max } = stats(d, 'depth'), span = max - min || 1;
    for (let k = 0; k < n; k++) {
      const v = a[k];
      if (v >= BG_DEPTH) { const x = k % w, y = (k / w) | 0; put(k, ((x + y) & 7) === 0 ? [74, 71, 66] : DARK, opaque ? 255 : 170); }
      else put(k, VIRIDIS[255 - Math.round(((v - min) / span) * 255)], opaque ? 255 : 196);
    }
  } else if (MASKS[view]) {
    const m = d.array(view);
    for (let k = 0; k < n; k++) {
      if (opaque) put(k, m[k] ? [246, 244, 238] : DARK, 255);
      else if (m[k]) put(k, [255, 104, 38], 220); else put(k, [14, 13, 12], 128);
    }
  } else if (view === 'print') {
    const ids = d.array('print');
    for (let k = 0; k < n; k++) {
      const id = ids[k];
      if (id) put(k, hue(id), 255); else put(k, opaque ? DARK : [14, 13, 12], opaque ? 255 : 150);
    }
  }
  return new ImageData(out, w, h);
}

// ---------------------------------------------------------------- component
export function createInspector({ root, reduced, getScenes, isRunning, onDownloadScene, onDownloadFile, onDelete, tileRect, onClosed, isMobile, setInertBehind, readArchive = async r => r.archive }) {
  const st = { open: false, name: null, index: 0, view: 'rgb', mode: 'overlay', boxes: false, zoom: 'fit', pin: null, hover: null, split: .5, data: null, error: null, pushed: false, token: 0 };
  const cache = new Map();
  const animate = (node, frames, opts) => (reduced || !node?.animate ? null : node.animate(frames, { easing: EASE, ...opts }));
  const btn = (attrs, ...kids) => el('button', { type: 'button', ...attrs }, ...kids);
  const chev = (dir) => icon(dir < 0 ? '<path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>', 16);

  // --- head
  const title = el('h2', { id: 'sciTitle' }), sub = el('span', { class: 'sci-sub' }), note = el('span', { class: 'sci-note', role: 'status', 'aria-live': 'polite' });
  const back = btn({ class: 'sci-back', id: 'sciBack', 'aria-label': 'Back to collection (Esc)', title: 'Back to collection (Esc)', onclick: () => close() }, chev(-1), el('span', { text: 'Collection' }));
  const prev = btn({ class: 'sci-icon', id: 'sciPrev', 'aria-label': 'Previous scene (←)', title: 'Previous scene (←)', onclick: () => go(-1) }, chev(-1));
  const next = btn({ class: 'sci-icon', id: 'sciNext', 'aria-label': 'Next scene (→)', title: 'Next scene (→)', onclick: () => go(1) }, chev(1));
  const counter = el('span', { class: 'sci-count', id: 'sciCount' });
  const dlFile = btn({ class: 'btn ghost', id: 'sciDlFile', title: 'Download the file shown (exact bytes from the scene archive)', onclick: () => downloadCurrent() }, icon(ICONS.download, 14), el('span', { class: 'lbl', text: 'File' }));
  const dlScene = btn({ class: 'btn ghost', id: 'sciDlScene', title: 'Download this scene as a ZIP (image, all targets, metadata)', onclick: () => st.name && onDownloadScene(st.name) }, icon(ICONS.download, 14), el('span', { class: 'lbl', text: 'Scene ZIP' }));
  const del = btn({ class: 'btn ghost sci-del', id: 'sciDelete', title: 'Delete this scene and all of its paired targets', onclick: () => st.name && onDelete(st.name) }, icon(ICONS.trash, 14), el('span', { class: 'lbl', text: 'Delete' }));
  const head = el('header', { class: 'sci-head' }, back, el('div', { class: 'sci-title' }, title, sub, note), el('div', { class: 'sci-nav' }, prev, counter, next), el('div', { class: 'sci-acts' }, dlFile, dlScene, del));

  // --- toolbar
  const views = el('div', { class: 'sci-views', role: 'tablist', 'aria-label': 'Target view' });
  const viewBtns = VIEWS.map((v, i) => btn({ role: 'tab', 'data-view': v.id, id: `sciView-${v.id}`, title: `${v.label} (${i + 1})`, onclick: () => setView(v.id) }, el('span', { text: v.label }), el('kbd', { text: String(i + 1), 'aria-hidden': 'true' })));
  views.append(...viewBtns);
  views.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    const i = VIEWS.findIndex((v) => v.id === st.view), j = (i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length;
    setView(VIEWS[j].id); viewBtns[j].focus();
  });
  const segBtns = (items, set, id) => el('div', { class: 'seg sci-seg', id, role: 'group' }, items.map(([k, label]) => btn({ 'data-v': k, text: label, 'aria-pressed': 'false', onclick: () => set(k) })));
  const modeSeg = segBtns(MODES, (m) => setMode(m), 'sciMode');
  modeSeg.title = 'Display (M)';
  const boxes = btn({ class: 'sci-chip', id: 'sciBoxes', 'aria-pressed': 'false', title: 'Pill boxes from metadata (B)', onclick: () => { st.boxes = !st.boxes; draw(); } }, el('i', { class: 'box-glyph', 'aria-hidden': 'true' }), el('span', { text: 'Boxes' }));
  const zoom = btn({ class: 'sci-chip', id: 'sciZoom', 'aria-pressed': 'false', title: 'Fit or native pixels (Z)', onclick: () => setZoom(st.zoom === 'fit' ? 'native' : 'fit') }, el('span', { text: '1:1' }));
  const tools = el('div', { class: 'sci-tools' }, modeSeg, el('span', { class: 'spacer' }), boxes, zoom);

  // --- stage
  const thumb = el('img', { class: 'sci-thumb', alt: '', draggable: 'false' });
  const base = el('canvas', { class: 'sci-base' }), layer = el('canvas', { class: 'sci-layer' }), hl = el('canvas', { class: 'sci-hl' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'sci-boxes'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const boxTags = el('div', { class: 'sci-boxtags', 'aria-hidden': 'true' });
  const tagL = el('span', { class: 'sci-tag l', text: 'RGB' }), tagR = el('span', { class: 'sci-tag r' });
  const splitH = el('div', { class: 'sci-split', role: 'slider', tabindex: '0', 'aria-label': 'Split position', 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i'));
  const msg = el('div', { class: 'sci-msg', role: 'status' });
  const frame = el('div', { class: 'sci-frame', id: 'sciFrame' }, thumb, base, layer, hl, svg, boxTags, tagL, tagR, splitH, msg);
  const probe = el('div', { class: 'sci-probe', id: 'sciProbe' });
  const fileLine = el('div', { class: 'sci-file', id: 'sciFile' });
  // Plate: the image with its pixel readout and file line directly beneath it.
  const stageEl = el('div', { class: 'sci-stage', id: 'sciStage' }, el('div', { class: 'sci-plate' }, frame, probe, fileLine));
  const main = el('div', { class: 'sci-main' }, views, tools, stageEl);

  // --- side
  const legend = el('div', { class: 'sci-sec', id: 'sciLegend' }), objects = el('div', { class: 'sci-sec', id: 'sciObjects' }), facts = el('div', { class: 'sci-facts' });
  const side = el('aside', { class: 'sci-side', 'aria-label': 'Scene details' }, legend, objects, facts);
  const backdrop = el('div', { class: 'sci-backdrop' });
  root.append(backdrop, head, el('div', { class: 'sci-body' }, main, side));

  // ------------------------------------------------------------ helpers
  const scenes = () => getScenes();
  const record = () => scenes().find((r) => r.name === st.name);
  const arrayKey = view => view;
  const instKey = () => 'instance';
  async function dataFor(rec) {
    let d = cache.get(rec.name);
    if (!d) { d = loadScene({...rec, archive: await readArchive(rec)}); cache.set(rec.name, d); while (cache.size > 3) cache.delete(cache.keys().next().value); }
    return d;
  }
  function objectsOf(d) {

    return d.train.objects.map((o) => ({ id: o.instance_id, family: o.family, cls: o.class_id, L: o.length_mm, W: o.width_mm, H: o.height_mm, px: o.visible_pixels, bbox: o.bbox_xyxy, stacked: o.stacked, down: !o.face_up, frac: o.dose_fraction ?? 1 }));
  }
  const swatchFor = o => st.view === 'semantic' ? CLASS_COLORS[o.cls] : instanceColor(o.id);

  // ------------------------------------------------------------ chrome
  function renderChrome() {
    const list = scenes(), i = list.findIndex((r) => r.name === st.name), rec = list[i];
    if (!rec) return;
    st.index = i;
    const m = rec.manifest.scenes[0];
    title.textContent = rec.name;
    sub.textContent = `seed ${rec.seed} · ${TRAY_STYLES[m.style]?.label ?? human(m.style)}${m.scenario !== 'ordinary' ? ` · ${human(m.scenario)}` : ''}`;
    counter.textContent = `${i + 1} / ${list.length}`;
    prev.disabled = i <= 0; next.disabled = i >= list.length - 1;
    del.disabled = isRunning();
    del.title = isRunning() ? 'Deleting is available after generation finishes' : 'Delete this scene and all of its paired targets';
    const [w, h] = rec.meta.camera.resolution_px;
    frame.style.setProperty('--ar', String(w / h));
    frame.style.setProperty('--w', `${w}px`);
    thumb.src = rec.thumb;
    renderFacts(rec);
  }
  function syncControls() {
    for (const b of viewBtns) { const on = b.dataset.view === st.view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    for (const b of modeSeg.children) { b.setAttribute('aria-pressed', String(b.dataset.v === st.mode)); b.disabled = st.view === 'rgb'; }
    boxes.setAttribute('aria-pressed', String(st.boxes));
    zoom.setAttribute('aria-pressed', String(st.zoom === 'native'));
    zoom.firstChild.textContent = st.zoom === 'native' ? 'Fit' : '1:1';
    root.dataset.view = st.view; root.dataset.mode = st.view === 'rgb' ? 'rgb' : st.mode; root.dataset.zoom = st.zoom;
  }

  // ------------------------------------------------------------ drawing
  let baseFor = null;
  function draw() {
    syncControls();
    const d = st.data;
    if (!d) return;
    const { width: w, height: h } = d;
    if (baseFor !== d.name) {
      for (const c of [base, layer, hl]) { c.width = w; c.height = h; }
      const rgb = d.rgb(), img = new ImageData(w, h);
      for (let k = 0; k < w * h; k++) { img.data[k * 4] = rgb[k * 3]; img.data[k * 4 + 1] = rgb[k * 3 + 1]; img.data[k * 4 + 2] = rgb[k * 3 + 2]; img.data[k * 4 + 3] = 255; }
      base.getContext('2d').putImageData(img, 0, 0);
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      baseFor = d.name;
      frame.classList.add('ready');
    }
    const view = VIEWS.find((v) => v.id === st.view);
    if (st.view !== 'rgb') layer.getContext('2d').putImageData(compose(d, st.view, st.mode === 'split' ? 'target' : st.mode), 0, 0);
    tagR.textContent = view.label;
    frame.style.setProperty('--split', `${(st.split * 100).toFixed(2)}%`);
    splitH.setAttribute('aria-valuenow', String(Math.round(st.split * 100)));
    drawHighlight();
    drawBoxes();
    renderLegend();
    renderObjects();
    renderFile();
  }
  function drawHighlight() {
    const d = st.data, ctx = hl.getContext('2d'), id = st.pin ?? st.hover;
    if (!d) return;
    ctx.clearRect(0, 0, hl.width, hl.height);
    hl.classList.toggle('on', id != null);
    if (id == null) return;
    const ids = d.array(instKey()), img = ctx.createImageData(d.width, d.height);
    for (let k = 0; k < ids.length; k++) if (ids[k] !== id) { img.data[k * 4] = 12; img.data[k * 4 + 1] = 11; img.data[k * 4 + 2] = 10; img.data[k * 4 + 3] = 150; }
    ctx.putImageData(img, 0, 0);
    for (const r of objects.querySelectorAll('tr[data-id]')) r.classList.toggle('on', Number(r.dataset.id) === id);
  }
  function drawBoxes() {
    svg.replaceChildren(); boxTags.replaceChildren();
    const d = st.data; if (!d || !st.boxes) return;
    const focus = st.pin ?? st.hover;
    for (const o of objectsOf(d)) {
      if (!o.bbox) continue;
      const [x0, y0, x1, y1] = o.bbox;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [k, v] of Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })) r.setAttribute(k, v);
      if (focus === o.id) r.setAttribute('class', 'on');
      svg.append(r);
      boxTags.append(el('span', { class: focus === o.id ? 'on' : '', style: `left:${(x0 / d.width) * 100}%;top:${(y0 / d.height) * 100}%`, text: String(o.id) }));
    }
  }

  // ------------------------------------------------------------ side panels
  function row(sw, k, v, extra) { return el('div', { class: 'lg-r' }, el('i', { class: 'sw', style: `background:${rgbCss(sw)}` }), el('span', { class: 'lg-k', text: k }), el('span', { class: 'lg-v', text: v }), extra ?? null); }
  function renderLegend() {
    const d = st.data; if (!d) return;
    const v = st.view, parts = [el('div', { class: 'sci-h' }, el('span', { text: 'Legend' }), el('span', { class: 'a', text: VIEWS.find((x) => x.id === v).label }))];
    const noteP = (t) => el('p', { class: 'lg-note', text: t });
    if (v === 'rgb') {
      const r = d.meta.camera_response;
      parts.push(el('div', { class: 'lg-kv' }, ...[['Encoding', '8-bit sRGB PNG'], ['Camera response', r ? human(r.profile) : 'none'], ...(r && r.profile !== 'none' ? [['Gain · gamma', `${r.exposure_gain?.toFixed(3)} · ${r.gamma?.toFixed(3)}`], ['Noise σ · blur σ', `${r.noise_std?.toFixed(4)} · ${r.blur_sigma_pixels?.toFixed(2)} px`], ['JPEG quality', String(r.jpeg_quality)]] : [])].map(([a, b]) => el('div', {}, el('span', { text: a }), el('span', { text: b })))),
        noteP('The beauty render every target below is aligned to: same frozen camera, pose and resolution.'));
    } else if (v === 'instance') {
      const { counts, total } = stats(d, 'instance');
      const groups = [['Pills', (id) => id >= 10 && id < 500, 'one colour per instance'], ['Tray', (id) => id === 1], ['Debris', (id) => id === 500], ['Sticker paper', (id) => id >= 1000 && id < 2000 && id % 2 === 0], ['Sticker ink', (id) => id > 1000 && id < 2000 && id % 2 === 1], ['Printed ink', (id) => id >= 2000]];
      const list = el('div', { class: 'lg-list' });
      for (const [name, test, hint] of groups) {
        const ids = [...counts.keys()].filter(test).sort((a, b) => a - b); if (!ids.length) continue;
        const px = ids.reduce((a, id) => a + counts.get(id), 0);
        list.append(row(instanceColor(ids[0]), `${name}`, pct(px, total), el('span', { class: 'lg-ids', text: `${ids.length > 1 ? `${ids[0]}–${ids.at(-1)}` : ids[0]}${ids.length > 1 ? ` · ${ids.length} IDs` : ''}${hint ? ` · ${hint}` : ''}` })));
      }
      list.append(row(DARK, 'Background', pct(counts.get(0) || 0, total), el('span', { class: 'lg-ids', text: '0' })));
      parts.push(list, noteP('Display colours only. The file stores raw uint16 IDs; map IDs to classes with instance_to_class in the scene JSON.'));
    } else if (v === 'semantic') {
      const {counts,total}=stats(d,'semantic');
      const list=el('div',{class:'lg-list'});
      for(const id of [...counts.keys()].sort((a,b)=>a-b))list.append(row(id===0?DARK:CLASS_COLORS[id],`${id} · ${(CLASSES[id]??'?').replace(/_/g,' ')}`,pct(counts.get(id),total)));
      parts.push(list,noteP('Shared classes.json IDs 0–15, used in the scene and training. Stored as uint8 values, not colours.'));
    } else if (v === 'depth') {
      const s = stats(d, 'depth'), stops = [0, .25, .5, .75, 1].map((t) => `${rgbCss(VIRIDIS[255 - Math.round(t * 255)])} ${t * 100}%`).join(',');
      parts.push(el('div', { class: 'lg-bar', style: `background:linear-gradient(90deg,${stops})` }),
        el('div', { class: 'lg-scale' }, el('span', { text: `${(s.min * 1000).toFixed(1)} mm` }), el('span', { text: 'near → far' }), el('span', { text: `${(s.max * 1000).toFixed(1)} mm` })),
        el('div', { class: 'lg-list' }, row([74, 71, 66], 'No surface (hatched)', pct(s.bg, s.bg + s.valid), el('span', { class: 'lg-ids', text: 'stored as 1e10' }))),
        noteP('Euclidean camera-ray distance to the first geometric surface, cover removed. Stored as float32 metres, 1 µm quantization; colour scale spans this scene\'s range.'));
    } else if (MASKS[v]) {
      const s = stats(d, v), [what, meaning] = MASKS[v];
      parts.push(el('div', { class: 'lg-list' }, row(st.mode === 'overlay' ? [255, 104, 38] : [246, 244, 238], `255 · ${what}`, pct(s.on, s.total)), row(DARK, '0 · elsewhere', pct(s.total - s.on, s.total))),
        noteP(v === 'glare' ? `${d.train.glare_diagnostic?.method ?? 'Brightness heuristic'}. Bright fraction of cover: ${pct((d.train.glare_diagnostic?.cover_bright_pixel_fraction ?? 0) * 1e4, 1e4)}.` : meaning),
        s.on ? null : noteP('This scene has no such pixels; the mask is all zero.'));
    } else if (v === 'print') {
      const g = d.train.printed_graphics ?? [], list = el('div', { class: 'lg-list' });
      for (const x of g.filter((x) => x.visible_pixels > 0 && !x.kind.includes('paper')).slice(0, 14)) list.append(row(hue(x.instance_id), `${x.instance_id} · ${x.text ?? x.icon ?? human(x.kind)}`, `${x.visible_pixels} px`));
      const hidden = g.filter((x) => !x.visible_pixels && !x.kind.includes('paper')).length;
      parts.push(list, noteP(`${d.train.print_target_contract ?? ''}${hidden ? ` ${hidden} authored graphic${hidden === 1 ? '' : 's'} not visible.` : ''} IDs 2000+ are tray print, odd 1001+ sticker ink.`));
    }
    legend.replaceChildren(...parts);
  }
  function renderObjects() {
    const d = st.data; if (!d) return;
    const list = objectsOf(d);
    const body = el('tbody');
    for (const o of list) {
      const flags = [o.stacked && 'stacked', o.down && 'face down', Math.round(o.frac * 100) < 100 && `${Math.round(o.frac * 100)} % remains`, !o.px && 'hidden'].filter(Boolean).join(' · ');
      const tr = el('tr', { 'data-id': String(o.id), class: (st.pin ?? st.hover) === o.id ? 'on' : '', title: `Instance ${o.id}` },
        el('td', {}, el('i', { class: 'sw', style: `background:${rgbCss(swatchFor(o))}` })),
        el('td', { class: 'n', text: String(o.id) }),
        el('td', {}, el('span', { text: human(o.family) }), flags ? el('small', { text: flags }) : null),
        el('td', { class: 'n', text: o.L != null ? `${(+o.L).toFixed(1)}×${(+o.W).toFixed(1)}×${(+o.H).toFixed(1)}` : '—' }),
        el('td', { class: 'n', text: o.px ? String(o.px) : '0' }));
      tr.addEventListener('pointerenter', () => { if (st.hover !== o.id) { st.hover = o.id; drawHighlight(); drawBoxes(); } });
      tr.addEventListener('pointerleave', () => { if (st.hover === o.id) { st.hover = null; drawHighlight(); drawBoxes(); } });
      tr.addEventListener('click', () => { st.pin = st.pin === o.id ? null : o.id; drawHighlight(); drawBoxes(); });
      body.append(tr);
    }
    objects.replaceChildren(el('div', { class: 'sci-h' }, el('span', { text: 'Objects' }), el('span', { class: 'a', text: `${list.length} pill${list.length === 1 ? '' : 's'} · instance IDs` })),
      el('table', { class: 'sci-table' }, el('thead', {}, el('tr', {}, el('th', {}), el('th', { class: 'n', text: 'ID' }), el('th', { text: 'Class' }), el('th', { class: 'n', text: 'L×W×H mm' }), el('th', { class: 'n', text: 'px' }))), body));
  }
  function renderFacts(rec) {
    const m = rec.manifest.scenes[0], meta = rec.meta, cam = meta.camera, r = meta.camera_response;
    const block = (t, pairs) => el('div', { class: 'sci-sec' }, el('div', { class: 'sci-h' }, el('span', { text: t })), el('div', { class: 'lg-kv' }, ...pairs.filter(Boolean).map(([a, b, cls]) => el('div', { class: cls ?? '' }, el('span', { text: a }), el('span', { text: String(b) })))));
    const checks = Object.entries(meta.verification).map(([k, ok]) => [human(k).replace(/png /, 'PNG ').replace(/rgb/, 'RGB'), ok ? 'pass' : 'FAIL', ok ? 'ok' : 'bad']);
    const t = rec.timing;
    facts.replaceChildren(
      block('Scene', [['Scenario', human(m.scenario)], ['Container', `${TRAY_STYLES[m.style]?.label ?? human(m.style)} · ${human(meta.container?.material ?? '')}`], ['Cover', human(m.cover)], ['Surface', SURFACES[m.surface] ?? human(m.surface)], ['Lighting', LIGHTING[m.lighting]?.label ?? human(m.lighting)],
        ['Pills', `${meta.placed_pills} placed of ${meta.requested_pills} · ${m.visible_pills} visible`], (m.stacked || m.spilled) ? ['Stacked · spilled', `${m.stacked} · ${m.spilled}`] : null, ['Debris', meta.debris.length ? meta.debris.map((x) => human(x.kind)).join(', ') : 'none'], ['Stickers', String(meta.stickers?.length ?? 0)]]),
      block('Camera', [['Resolution', `${cam.resolution_px[0]} × ${cam.resolution_px[1]} px`], ['Focal length', `${cam.focal_length_px} px · ${cam.focal_length_35mm_equiv ?? '—'} mm eq.`], ['Field of view', `${cam.vfov_deg ?? cam.vertical_fov_deg}° v · ${cam.hfov_deg ?? '—'}° h`], ['Above rim', `${cam.clearance_above_rim_mm?.toFixed?.(1) ?? '—'} mm`], ['Tilt · roll', `${(+cam.tilt_deg || 0).toFixed(1)}° · ${(+cam.roll_deg || 0).toFixed(1)}°`], ['Response', r ? human(r.profile) : 'none'], ['Samples', `${rec.manifest.beauty_samples_per_pixel} spp`]]),
      block('Checks', [...checks, t ? ['Generated in', `${((t.building + t.rendering + t.encoding) / 1000).toFixed(1)} s · build ${(t.building / 1000).toFixed(1)} · render ${(t.rendering / 1000).toFixed(1)} · encode ${(t.encoding / 1000).toFixed(1)}`] : null]),
      filesBlock(),
    );
  }
  function filesBlock() {
    const wrap = el('div', { class: 'sci-sec', id: 'sciFiles' }, el('div', { class: 'sci-h' }, el('span', { text: 'Files' }), el('span', { class: 'a', text: 'in scene ZIP' })));
    const d = st.data;
    if (!d) { wrap.append(el('p', { class: 'lg-note', text: 'Reading the scene archive…' })); return wrap; }
    const ul = el('ul', { class: 'sci-files' });
    for (const f of d.list().sort((a, b) => a.short.localeCompare(b.short))) ul.append(el('li', {}, btn({ class: 'fl-dl', title: `Download ${f.short}`, 'aria-label': `Download ${f.short}`, onclick: () => onDownloadFile(d.bytes(f.path), fileName(d, f.path)) }, el('span', { class: 'p', text: f.short }), el('span', { class: 's', text: kb(f.bytes) }), icon(ICONS.download, 12))));
    wrap.append(ul);
    return wrap;
  }
  // Downloads keep the archive's basename, prefixed with the scene so files from different scenes never collide.
  const fileName = (d, path) => { const b = path.split('/').pop(); return path.includes('/blender/train/') ? `${d.name}_train${b.slice(6)}` : b === 'classes.json' ? 'classes.json' : `${d.name}_${b}`; };
  function currentPath() {
    const d = st.data; if (!d) return null;
    return d.paths[st.view === 'rgb' ? 'rgb' : arrayKey(st.view)];
  }
  function renderFile() {
    const d = st.data, p = currentPath(); if (!d || !p) return;
    const type = { rgb: '8-bit sRGB PNG', instance: 'uint16 PNG · instance IDs', semantic: 'uint8 PNG · class IDs', depth: 'float32 NPY · metres', film: 'uint8 PNG · 0/255', glare: 'uint8 PNG · 0/255', sticker: 'uint8 PNG · 0/255', print: 'uint16 PNG · ink IDs' }[st.view === 'rgb' ? 'rgb' : arrayKey(st.view)];
    fileLine.replaceChildren(el('span', { class: 'p', text: p.replace('pill-atelier-dataset/', '') }), el('span', { text: `${type} · ${d.width}×${d.height} · ${kb(d.bytes(p).length)}` }));
    dlFile.title = `Download ${p.split('/').pop()} (exact bytes from the scene archive)`;
  }

  // ------------------------------------------------------------ probe
  function probeAt(e) {
    const d = st.data; if (!d) return null;
    const r = base.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * d.width), y = Math.floor(((e.clientY - r.top) / r.height) * d.height);
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return null;
    return { x, y, k: y * d.width + x };
  }
  function showProbe(p) {
    const d = st.data;
    if (!p || !d) { probe.replaceChildren(el('span', { class: 'hint', text: isMobile() ? 'Tap the image to read pixel values and select a pill.' : 'Hover the image to read pixel values; click a pill to isolate it.' })); return; }
    const { x, y, k } = p, parts = [['x', x], ['y', y]];
    const rgb = d.rgb(); parts.push(['rgb', `${rgb[k * 3]} ${rgb[k * 3 + 1]} ${rgb[k * 3 + 2]}`]);
    const tid = d.array('instance')[k], tcl = d.array('semantic')[k];
    parts.push(['id', tid], ['class', `${tcl} ${CLASSES[tcl] ?? '?'}`]);
    const dep = d.array('depth')[k]; parts.push(['depth', dep >= BG_DEPTH ? 'none (1e10)' : fmtMM(dep)]);
    if (MASKS[st.view]) parts.push([st.view, d.array(st.view)[k]]);
    if (st.view === 'print') { const pid = d.array('print')[k]; const g = d.train.printed_graphics?.find((x) => x.instance_id === pid); parts.push(['ink', pid ? `${pid} ${g?.text ?? g?.icon ?? ''}` : 0]); }
    const primary = { instance: 'id', semantic: 'class', depth: 'depth', film: 'film', glare: 'glare', sticker: 'sticker', print: 'ink', rgb: 'rgb' }[st.view];
    probe.replaceChildren(...parts.map(([a, b]) => el('span', { class: a === primary ? 'pv on' : 'pv' }, el('b', { text: a }), el('span', { text: String(b) }))));
  }
  frame.addEventListener('pointermove', (e) => {
    if (drag) return;
    const p = probeAt(e); showProbe(p);
    const id = p ? st.data.array(instKey())[p.k] : 0;
    const isPill = id && objectsOf(st.data).some((o) => o.id === id);
    frame.classList.toggle('over-pill', !!isPill);
    for (const r of objects.querySelectorAll('tr[data-id]')) r.classList.toggle('hover', isPill && Number(r.dataset.id) === id);
  });
  frame.addEventListener('pointerleave', () => { if (!isMobile()) showProbe(null); frame.classList.remove('over-pill'); for (const r of objects.querySelectorAll('tr.hover')) r.classList.remove('hover'); });
  frame.addEventListener('click', (e) => {
    if (e.target === splitH || splitH.contains(e.target) || !st.data) return;
    const p = probeAt(e); if (!p) return;
    showProbe(p);
    const id = st.data.array(instKey())[p.k], isPill = id && objectsOf(st.data).some((o) => o.id === id);
    st.pin = isPill && st.pin !== id ? id : null;
    drawHighlight(); drawBoxes();
    if (st.pin != null) objects.querySelector(`tr[data-id="${st.pin}"]`)?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  });
  // Split handle: drag or arrow keys.
  let drag = false;
  splitH.addEventListener('pointerdown', (e) => { drag = true; splitH.setPointerCapture(e.pointerId); e.preventDefault(); });
  splitH.addEventListener('pointermove', (e) => { if (!drag) return; const r = frame.getBoundingClientRect(); st.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); frame.style.setProperty('--split', `${(st.split * 100).toFixed(2)}%`); splitH.setAttribute('aria-valuenow', String(Math.round(st.split * 100))); });
  const endDrag = () => { drag = false; };
  splitH.addEventListener('pointerup', endDrag); splitH.addEventListener('pointercancel', endDrag);
  splitH.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -.05, ArrowRight: .05, Home: -1, End: 1 }[e.key]; if (step == null) return;
    e.preventDefault(); e.stopPropagation();
    st.split = Math.min(1, Math.max(0, st.split + step)); frame.style.setProperty('--split', `${(st.split * 100).toFixed(2)}%`); splitH.setAttribute('aria-valuenow', String(Math.round(st.split * 100)));
  });

  // ------------------------------------------------------------ state changes
  function setView(id) {
    if (!VIEWS.some((v) => v.id === id) || id === st.view) return;
    st.view = id;
    draw();
    animate(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
  }
  function setMode(m) { if (st.view === 'rgb' || m === st.mode) return; st.mode = m; draw(); }
  function setZoom(z) { st.zoom = z; syncControls(); if (z === 'native') stageEl.scrollTo({ left: (frame.offsetWidth - stageEl.clientWidth) / 2, top: 0 }); }
  async function load(token) {
    const rec = record(); if (!rec) return;
    try { const data = await dataFor(rec); if(token !== st.token || !st.open)return; st.data = data; st.error = null; msg.textContent = ''; frame.classList.remove('failed'); }
    catch (e) { if(token !== st.token || !st.open)return; console.error(e); st.data = null; st.error = e; msg.textContent = `Could not read this scene archive: ${e.message}`; frame.classList.add('failed'); syncControls(); return; }
    if (token !== st.token) return;
    draw();
    renderFacts(rec);
    showProbe(null);
  }
  function show(name, { dir = 0 } = {}) {
    st.name = name; st.pin = null; st.hover = null; st.data = null; baseFor = null;
    frame.classList.remove('ready');
    renderChrome();
    syncControls();
    const token = ++st.token;
    // Decode after the transition has started (the thumbnail carries the first frames).
    requestAnimationFrame(() => setTimeout(() => { if (st.open && token === st.token) load(token); }, 0));
    if (dir) animate(frame, [{ opacity: .15, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: 'none' }], { duration: 280 });
  }
  function go(delta) {
    const list = scenes(), j = st.index + delta;
    if (!st.open || j < 0 || j >= list.length) return;
    show(list[j].name, { dir: delta });
  }

  function open(name) {
    const rec = scenes().find((r) => r.name === name); if (!rec) return false;
    const wasOpen = st.open;
    st.open = true;
    if (!wasOpen) { st.zoom = 'fit'; root.hidden = false; root.classList.add('on'); setInertBehind(true); }
    if (!wasOpen && !st.pushed) { try { history.pushState({ sceneInspector: true }, ''); st.pushed = true; } catch { st.pushed = false; } }
    note.textContent = '';
    show(name);
    if (!wasOpen) {
      back.focus({ preventScroll: true });
      const from = tileRect(name), to = frame.getBoundingClientRect();
      if (from && to.width && !reduced) {
        const s = from.width / to.width;
        animate(frame, [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})` }, { transform: 'none' }], { duration: 440 });
      }
      animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
      for (const [i, n] of [head, views, tools, probe, fileLine, side].entries()) animate(n, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 90 + i * 30, fill: 'backwards' });
    }
    return true;
  }
  function close({ instant = false } = {}) {
    if (!st.open) return;
    const name = st.name;
    st.open = false; st.token++;
    if (st.pushed) { st.pushed = false; try { history.back(); } catch { /* standalone file */ } }
    setInertBehind(false);
    const finish = () => { root.hidden = true; root.classList.remove('on'); st.data = null; baseFor = null; cache.clear(); frame.classList.remove('ready'); onClosed(name); };
    const to = !instant && !reduced && st.zoom === 'fit' ? tileRect(name, { reveal: true }) : null;
    if (!to) { finish(); return; }
    const from = frame.getBoundingClientRect(), s = to.width / from.width;
    for (const n of [head, views, tools, probe, fileLine, side, backdrop]) animate(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    const a = animate(frame, [{ transform: 'none' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${s})` }], { duration: 340, fill: 'forwards' });
    const done = () => { for (const n of [head, views, tools, probe, fileLine, side, backdrop, frame]) n.getAnimations().forEach((x) => x.cancel()); finish(); };
    if (a) a.finished.then(done, done); else done();
  }
  addEventListener('popstate', () => { if (st.open) { st.pushed = false; close(); } });

  function downloadCurrent() { const d = st.data, p = currentPath(); if (d && p) onDownloadFile(d.bytes(p), fileName(d, p)); }

  return {
    open, close, isOpen: () => st.open,
    // Collection changed (append, delete, running flag): keep the view coherent.
    sync() {
      if (!st.open) return;
      const list = scenes();
      for (const k of [...cache.keys()]) if (!list.some((r) => r.name === k)) cache.delete(k);
      if (list.some((r) => r.name === st.name)) { renderChrome(); return; }
      const gone = st.name;
      if (!list.length) { close({ instant: true }); return; }
      show(list[Math.min(st.index, list.length - 1)].name);
      note.textContent = `${gone} deleted with its paired targets`;
      animate(note, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    },
    handleKey(e) {
      if (!st.open) return false;
      if (e.target?.tagName === 'INPUT') return true;
      const k = e.key.toLowerCase();
      if (k === 'escape') { e.preventDefault(); close(); return true; }
      // Other shortcuts only when focus is in the inspector (not in the side panel's controls).
      if (e.target && e.target !== document.body && !root.contains(e.target)) return true;
      if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); go(k === 'arrowleft' ? -1 : 1); }
      else if (/^[1-8]$/.test(k)) setView(VIEWS[Number(k) - 1].id);
      else if (k === 'b') { st.boxes = !st.boxes; draw(); }
      else if (k === 'm' && st.view !== 'rgb') setMode(MODES[(MODES.findIndex(([m]) => m === st.mode) + 1) % MODES.length][0]);
      else if (k === 'z') setZoom(st.zoom === 'fit' ? 'native' : 'fit');
      return true;
    },
    setView, setMode, setZoom, next: () => go(1), prev: () => go(-1),
    setBoxes: (v) => { st.boxes = !!v; draw(); }, pin: (id) => { st.pin = id; drawHighlight(); drawBoxes(); },
    state: () => ({ open: st.open, name: st.name, index: st.index, view: st.view, mode: st.mode, boxes: st.boxes, zoom: st.zoom, pin: st.pin, loaded: !!st.data && baseFor === st.data.name, error: st.error?.message ?? null, file: currentPath() }),
  };
}
