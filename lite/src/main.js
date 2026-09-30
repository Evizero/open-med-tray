// Open Med Tray Lite — application wiring: state, inspector, overlays, tour, export.
import * as THREE from 'three';
import { Stage } from './app/stage.js';
import { PRESETS, BASE, validate, familyOf, randomProduct, instanceVariant } from './scene/catalog.js';
import { RNG } from './util/rng.js';
import {sampleIntrinsics} from './scene/camera-intrinsics.js';
import { randomConfig, SEMANTIC } from './scene/trayscene.js';
import { TRAY_STYLES } from './geo/tray.js';
import { renderLabels, colorize } from './labels/idpass.js';
import { generateDataset, collectionZip } from './labels/dataset.js';
import {GENERATOR_REVISION} from './labels/generator-version.js';
import {CollectionStore} from './labels/collection-store.js';
import { el, toggle, tabStrip, tabArrow, placeIndicator, refreshPanel, setEditHooks } from './ui/controls.js';
import { DimHandles } from './ui/handles.js';
import { capsuleDims, softgelDims } from './geo/shells.js';
import { presetList, pillTabs, instanceTab, trayTabs, datasetTabs } from './ui/panels.js';
import { createCollection } from './ui/collection.js';
import { createInspector } from './ui/scene-inspector.js';
import { createIntro } from './ui/intro.js';
import { bindSheetDrag } from './ui/sheet-drag.js';
import {prepareWood} from './render/wood.js';

const $ = (id) => document.getElementById(id);
const mobileQuery = matchMedia('(max-width: 760px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clone = (o) => structuredClone(o);
// The introduction opens on every load; ?no-intro skips it (automated QA only).
const introOnLoad = !new URLSearchParams(location.search).has('no-intro');

const DEFAULT_TRAY = { ...randomConfig(20260929), seed: 20260929, style: 'moulded_daily', container: 'white_plastic', cover: 'none', surface: 'wood', lighting: 'window', count: 7, products: 3, damage: .12, debris: true, sticker: true, language: 'en', camera: { ...sampleIntrinsics(20260929), clearance: 118, tilt: 0, roll: 0, offsetX: 0, offsetY: 0 } };

const state = {
  mode: 'specimen', presetId: 'p10', spec: clone(PRESETS[0].spec), sampled: false,
  tray: clone(DEFAULT_TRAY), trayView: 'capture', selected: null,
  labels: 'off', boxes: true, labelData: null,
  dataset: { sampling:'mixed', stressProbability:.06, cameraProfile:'auto', count: 8, res: '1024x512', samples: 12, seed: 1000, running: false, zip: null, nextIndex: 0, status: '', showLabels: false, scenes: [] },
  tour: { playing: false, paused: false, step: 0 },
};
window.__atelier = { state, THREE: { WebGLRenderTarget: THREE.WebGLRenderTarget, HalfFloatType: THREE.HalfFloatType, MeshPhysicalMaterial: THREE.MeshPhysicalMaterial, Color: THREE.Color, Vector3: THREE.Vector3 } };

async function loadFonts() {
  const faces = ['400 16px "IBM Plex Sans"', '500 16px "IBM Plex Sans"', '600 16px "IBM Plex Sans"', '700 16px "IBM Plex Sans"', '400 16px "Instrument Serif"', '400 16px "IBM Plex Mono"', '500 16px "IBM Plex Mono"'];
  try { await Promise.all(faces.map((f) => document.fonts.load(f, 'AB125 MORNING'))); } catch (e) { console.warn('font load', e); }
}

let stage;
// While the introduction covers the bench on load, the camera waits on the
// first pose of the macro pull-back; closing the sheet releases it.
let introHold = false;
// Whether the introduction covers the bench (from show() until its close
// starts), so the floating scene action stays out from under the sheet.
let introUp = introOnLoad;
const INTRO_EXAMPLE = clone(PRESETS.find((p) => p.id === 'p10').spec);
const intro = createIntro({
  // The blueprint is a fixed example (the default preset), not a live drawing of the bench.
  reduced, getSpec: () => INTRO_EXAMPLE,
  onClose: (action) => {
    introUp = false;
    const held = introHold; introHold = false;
    if (action === 'tour') playTour();
    else if (held) stage.specimenFrame(stage.pill, { macro: true, resume: true });
    updateFab();
  },
});
async function boot() {
  await Promise.all([loadFonts(),prepareWood()]);
  const canvas = $('gl');
  stage = new Stage(canvas, { mobile: mobileQuery.matches || /Mobi|Android/i.test(navigator.userAgent), reducedMotion: reduced, legacySampling: new URLSearchParams(location.search).has('legacy-sampling') });
  window.__atelier.stage = stage;
  layout();
  await stage.setSpecimen(state.spec);
  stage.specimenFrame(stage.pill, { instant: true });
  if (introOnLoad && !reduced) { introHold = true; stage.specimenFrame(stage.pill, { macro: true, hold: true }); }
  stage.pipe.dof.enabled = true;
  bindUI();
  renderInspector();
  updateCaption();
  stage.on('frame', onFrame);
  stage.on('idle', onIdle);
  stage.on('interact', () => { hideDims(); if (state.tour.playing && !state.tour.paused) pauseTour(true); });
  stage.on('pill', () => { updateCaption(); scheduleDims(); });
  stage.annotationFit = annotationFit;
  stage.annotationsEnabled = () => !state.tour.playing;
  // Direct manipulation of the drawn size dimensions (specimen view only).
  handles = new DimHandles({
    stage, canvas: $('gl'),
    enabled: () => state.mode === 'specimen' && !state.tour.playing && !state.dataset.running,
    getSpec: () => state.spec,
    begin: beginEdit,
    update: (fn) => { editSpecimen(fn, false); refreshPanel(); },
    commit: (fn) => { editSnap = null; editSpecimen(fn, true); },
    cancel: cancelEdit,
    hover: (hl) => { const b = $('inspBody'); if (hl) b.dataset.hl = hl; else delete b.dataset.hl; },
    hint: setDimHint,
  });
  window.__atelier.handles = handles;
  setEditHooks({ begin: beginEdit, cancel: cancelEdit });
  stage.wake();
  // First frame is on screen: reveal under the introduction, whose close
  // starts the short macro pull-back (skippable by any input).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const from = document.querySelector('#boot .boot-lockup');
    $('boot').classList.add('gone');
    if (introOnLoad) intro.show({ from });
    else if (!reduced) stage.specimenFrame(stage.pill, { macro: true });
  }));
  addEventListener('resize', () => { layout(); });
  // Mobile browsers settle toolbar and orientation changes over several
  // frames; coalesce those into one layout per frame.
  let relayout = 0;
  const queueLayout = () => { cancelAnimationFrame(relayout); relayout = requestAnimationFrame(() => layout()); };
  visualViewport?.addEventListener('resize', queueLayout);
  addEventListener('orientationchange', queueLayout);
  mobileQuery.addEventListener('change', () => { if (!mobileQuery.matches) setSheet(false, true); layout(); renderInspector(); updateFab(); });
}

// ------------------------------------------------------------ layout
// Desktop: icon rail + mode panel on the left, status bar along the bottom of
// the workspace. Phone: top bar + two-state bottom sheet. Safe render bounds
// follow these fixed chrome dimensions, never the current panel content.
const cssPx = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
// Resolved safe-area insets (env() only resolves inside a real property).
let safeProbe = null;
function safeBottom() {
  if (!safeProbe) { safeProbe = document.createElement('div'); safeProbe.setAttribute('aria-hidden', 'true'); safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)'; document.body.append(safeProbe); }
  return parseFloat(getComputedStyle(safeProbe).paddingBottom) || 0;
}
// Phone sheet geometry of the last layout (the drag gesture reads its travel).
const sheetGeom = { h: 0, peek: 0 };
function layout() {
  sheetDrag?.abort();
  // The fixed #app box is the visible viewport the canvas fills (it follows
  // mobile toolbars); window sizes are only a fallback.
  const app = $('app');
  const w = app.clientWidth || innerWidth, h = app.clientHeight || innerHeight;
  const mobile = mobileQuery.matches;
  const root = document.documentElement.style;
  let insets;
  if (mobile) {
    const top = $('rail').offsetHeight, safeB = safeBottom();
    const peek = cssPx('--peek-base') + safeB;
    // Expanded: ~62% of the screen; short landscape screens get most of the
    // height below the bar so the controls stay usable.
    const sheetH = Math.round(Math.min(h - top - 8, Math.max(Math.min(h * .62, 560), Math.min(h - top - 24, 300)) + safeB));
    root.setProperty('--sheet-h', sheetH + 'px');
    Object.assign(sheetGeom, { h: sheetH, peek });
    // Collapsed, the floating Resample card and the readout line sit above the
    // peek; the render (and its annotations) is framed clear of both.
    insets = { top, left: 0, right: 0, bottom: $('inspector').classList.contains('open') ? sheetH : peek + cssPx('--fab-reserve') };
  } else { root.removeProperty('--sheet-h'); insets = { top: 0, left: cssPx('--rail-w') + cssPx('--panel-w'), right: 0, bottom: cssPx('--status-h') }; }
  stage.resize(w, h);
  stage.setInsets(insets);
  // Resize / sheet toggle: refit the distance, keep the user's orbit direction.
  if (state.mode === 'specimen' && stage.pill && !stage.animations.size) stage.specimenFrame(stage.pill, introHold ? { macro: true, hold: true } : { instant: true, keepDirection: true });
  refreshLabels();
  placeIndicator($('inspTabs'));
}

// ------------------------------------------------------------ inspector
// One frame for every mode, for selection and editing only: tab strip,
// scrolling body, action footer. No summary head; the render and the readout
// show what is selected. Switching family, preset, selection or mode replaces
// the body (and footer content) inside the same footprint. `label` names the
// panel for assistive technology only.
const tabState = { specimen: 'presets', tray: 'scene', inspect: 'instance', dataset: 'batch' };
const scrollMemo = {};
const disclosureMemo = new Map();
let inspKey = null, inspTabs = [];

function inspectorDef() {
  if (state.mode === 'specimen') {
    const ed = pillTabs(() => state.spec, (fn, final, hint) => editSpecimen(fn, final, hint), { onFamily: (k) => switchFamily(k) });
    return {
      key: 'specimen', label: 'Specimen controls',
      tabs: [
        { id: 'presets', label: 'Presets', build: () => [presetList(state.presetId, (p) => applyPreset(p))] },
        { id: 'form', label: 'Form', build: ed.form }, { id: 'surface', label: 'Surface', build: ed.surface }, { id: 'marks', label: 'Marks', build: ed.marks },
      ],
      // Resample is the primary action; the preset pager is secondary.
      foot: () => {
        const i = PRESETS.findIndex((p) => p.id === state.presetId);
        const step = (d) => { const j = Math.max(0, PRESETS.findIndex((p) => p.id === state.presetId)); applyPreset(PRESETS[(j + d + PRESETS.length) % PRESETS.length]); };
        return [
          resampleButton('pill'),
          el('span', { class: 'pager' },
            el('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Previous preset', title: 'Previous preset ([)', 'data-k': 'btn:prev', onclick: () => step(-1) }, chev(-1)),
            el('span', { class: 'counter', text: i >= 0 ? `${i + 1} / ${PRESETS.length}` : state.sampled ? 'Sampled' : 'Custom', title: i >= 0 ? `Preset ${i + 1} of ${PRESETS.length}` : `Not a preset · ${PRESETS.length} presets` }),
            el('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Next preset', title: 'Next preset (])', 'data-k': 'btn:next', onclick: () => step(1) }, chev(1))),
        ];
      },
    };
  }
  if (state.mode === 'tray' && state.selected) {
    const pill = state.selected, tray = stage.tray, pi = pill.placement.product;
    const ed = pillTabs(() => stage.tray.products[pi], (fn, final) => editProduct(pi, fn, final), { onFamily: (k) => editProduct(pi, (x) => { Object.keys(x).forEach((key) => delete x[key]); Object.assign(x, clone(BASE[k])); }, true) });
    return {
      key: 'inspect', label: `Pill controls: product ${pi + 1}, instance ${pill.label.instance}`,
      tabs: [
        { id: 'instance', label: 'Instance', build: () => instanceTab(pill, tray) },
        { id: 'form', label: 'Form', build: ed.form }, { id: 'surface', label: 'Surface', build: ed.surface }, { id: 'marks', label: 'Marks', build: ed.marks },
      ],
      foot: () => [
        el('button', { class: 'btn', type: 'button', text: 'Back to tray', title: 'Return to the capture view (Esc)', 'data-k': 'btn:back', onclick: () => deselect() }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Open in studio', 'data-k': 'btn:studio', onclick: () => openInStudio(tray.products[pi]) }),
      ],
    };
  }
  if (state.mode === 'tray') {
    const t = trayTabs({ ...state, trayView: stage.trayView }, trayActions);
    return {
      key: 'tray', label: 'Tray controls',
      tabs: [{ id: 'scene', label: 'Scene', build: t.scene }, { id: 'container', label: 'Container', build: t.container }, { id: 'contents', label: 'Contents', build: t.contents }, { id: 'camera', label: 'Camera', build: t.camera }],
      foot: () => [
        resampleButton('tray'),
        el('button', { class: 'btn ghost', type: 'button', text: 'Replay drop', title: 'Drop the same pills into the same tray again', 'data-k': 'btn:replay', onclick: () => trayActions.rebuild(true) }),
      ],
    };
  }
  const t = datasetTabs(state, datasetActions);
  const d = state.dataset;
  return {
    key: 'dataset', label: 'Dataset controls',
    tabs: [{ id: 'batch', label: 'Batch', build: t.batch }, { id: 'archive', label: 'Archive', build: t.archive }],
    // Footer: the "Scenes to add" stepper sits on its own row above the actions.
    foot: () => {
      return [
        el('div', { class: 'progressbar' }, el('i', { id: 'dsProg' })),
        el('label', { class: 'batch-count', for: 'dsBatchCount' }, el('span', { text: 'Scenes to add' }),
          el('span', { class: 'stepper' },
            el('button', { type: 'button', id: 'dsCountMinus', text: '−', 'aria-label': 'Fewer scenes', title: 'Fewer scenes', disabled: d.running || d.count <= COUNT_MIN ? '' : null, 'data-k': 'btn:count-', onclick: () => setDatasetCount(d.count - 1) }),
            el('input', { id: 'dsBatchCount', type: 'number', min: COUNT_MIN, max: COUNT_MAX, step: 1, value: d.count, disabled: d.running ? '' : null, 'aria-label': 'Scenes to add', 'data-k': 'batch-count', ...countInputHandlers }),
            el('button', { type: 'button', id: 'dsCountPlus', text: '+', 'aria-label': 'More scenes', title: 'More scenes', disabled: d.running || d.count >= COUNT_MAX ? '' : null, 'data-k': 'btn:count+', onclick: () => setDatasetCount(d.count + 1) }))),
        ...(d.pendingRun&&!d.running?[el('button',{class:'btn',id:'dsResume',type:'button',text:`Resume ${d.pendingRun.count-d.pendingRun.done} remaining`,disabled:d.exporting||d.pendingRun.generatorRevision!==GENERATOR_REVISION?'':null,title:d.pendingRun.generatorRevision!==GENERATOR_REVISION?'The generator changed. Resume in the original HTML, or Generate & add a new batch.':'Continue the saved batch with its original settings',onclick:()=>datasetActions.generate(true)})]:[]),
        el('button', { class: 'btn accent' + (d.running ? ' hidden' : ''), id: 'dsGo', type: 'button', text: 'Generate & add', title: 'Render the scenes and append them to the collection', disabled:d.exporting?'':null, 'data-k': 'btn:generate', onclick: () => datasetActions.generate() }),
        el('button', { class: 'btn' + (d.running ? '' : ' hidden'), id: 'dsCancel', type: 'button', text: 'Cancel', title: 'Stop after the current scene; completed scenes are kept', 'data-k': 'btn:cancel', onclick: () => datasetActions.cancel() }),
        el('button', { class: 'btn ghost', id: 'dsZip', type: 'button', text: 'Download ZIP', title: 'Download the whole collection as one archive', disabled: d.scenes.length && !d.running && !d.exporting ? null : '', 'data-k': 'btn:zip', onclick: () => datasetActions.download() }),
      ];
    },
  };
}

function renderInspector({ animate = false } = {}) {
  const def = inspectorDef();
  const body = $('inspBody'), strip = $('inspTabs'), foot = $('inspFoot');
  const active = document.activeElement;
  const focusKey = body.contains(active) || foot.contains(active) ? active.dataset.k : null;
  const tabFocus = strip.contains(active);
  // Read the scope actually rendered in the DOM: setTab has already changed
  // tabState by this point. Preserve both opened and explicitly closed groups.
  const previousScope = body.dataset.panelScope;
  if (previousScope) {
    scrollMemo[previousScope] = body.scrollTop;
    const groups = disclosureMemo.get(previousScope) ?? new Map();
    for (const details of body.querySelectorAll('details.adv')) {
      const key = details.querySelector('summary[data-k]')?.dataset.k;
      if (key) groups.set(key, details.open);
    }
    disclosureMemo.set(previousScope, groups);
  }
  inspKey = def.key; inspTabs = def.tabs;
  if (!def.tabs.some((t) => t.id === tabState[def.key])) tabState[def.key] = def.tabs[0].id;
  const tab = def.tabs.find((t) => t.id === tabState[def.key]);
  $('inspector').setAttribute('aria-label', def.label);
  tabStrip(strip, def.tabs, tab.id, (id) => setTab(id));
  placeIndicator(strip);
  body.classList.toggle('anim', animate && !reduced);
  body.replaceChildren(...tab.build());
  const scope = def.key + ':' + tab.id;
  body.dataset.panelScope = scope;
  const groups = disclosureMemo.get(scope);
  for (const details of body.querySelectorAll('details.adv')) {
    const key = details.querySelector('summary[data-k]')?.dataset.k;
    if (groups?.has(key)) details.open = groups.get(key);
  }
  body.setAttribute('aria-label', tab.label);
  foot.replaceChildren(...def.foot());
  $('inspector').scrollLeft = 0;
  body.scrollTop = scrollMemo[def.key + ':' + tab.id] ?? 0;
  if (focusKey) (body.querySelector(`[data-k="${CSS.escape(focusKey)}"]`) || foot.querySelector(`[data-k="${CSS.escape(focusKey)}"]`))?.focus({ preventScroll: true });
  else if (tabFocus) strip.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  updateCamActual();
  updateDock();
}
function setTab(id) {
  if (!inspKey || !inspTabs.some((t) => t.id === id)) return;
  const changed = tabState[inspKey] !== id;
  scrollMemo[inspKey + ':' + tabState[inspKey]] = $('inspBody').scrollTop;
  tabState[inspKey] = id;
  renderInspector({ animate: changed });
  if (mobileQuery.matches) openSheetIfMobile();
}

// One label everywhere; the description says what is sampled in this mode.
const RESAMPLE_HINT = {
  pill: 'Sample a new pill: family, size, colour, finish and marks (R)',
  tray: 'Sample a new tray scene: container, cover, contents, light and camera (R)',
};
const dice = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<rect x="3.25" y="3.25" width="13.5" height="13.5" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7.1" cy="7.1" r="1.25" fill="currentColor"/><circle cx="10" cy="10" r="1.25" fill="currentColor"/><circle cx="12.9" cy="12.9" r="1.25" fill="currentColor"/>'; return s; };
const resampleButton = (kind) => el('button', { class: 'btn accent resample', type: 'button', title: RESAMPLE_HINT[kind], 'data-k': 'btn:resample', onclick: () => resample() }, dice(), el('span', { text: 'Resample' }));
const chev = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = `<path d="${d < 0 ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`; return s; };
// Sizes as built (validated and resolved), matching the drawn dimensions.
const specDims = (s0) => {
  const s = validate(clone(s0));
  if (s.kind === 'capsule') { const d = capsuleDims(s); return `${d.L.toFixed(1)} mm · Ø ${(2 * d.rc).toFixed(2)} mm`; }
  const d = s.kind === 'softgel' ? softgelDims(s) : { L: s.length, W: s.width, H: s.thickness };
  return `${d.L.toFixed(1)} × ${d.W.toFixed(1)} × ${d.H.toFixed(1)} mm`;
};
function describeSpec(s) {
  const fam = s.kind === 'tablet' ? `${s.outline === 'polygon' ? `${s.sides}-sided` : s.outline} tablet` : s.kind === 'capsule' ? 'two-piece capsule' : `${s.shape} softgel, ${s.opacity}`;
  return `${fam} · ${specDims(s)}`;
}

// A delayed sample must not replace a newer preset, edit or mode choice.
let specimenRevision = 0;
function applyPreset(p) {
  specimenRevision++;
  state.presetId = p.id; state.sampled = false;
  const next = clone(p.spec);
  const sameKind = next.kind === state.spec.kind;
  state.spec = next;
  const done = stage.setSpecimen(next, { transition: sameKind ? 'auto' : 'section' });
  renderInspector();
  updateCaption();
  return done;
}
function switchFamily(kind) {
  if (kind === state.spec.kind) return;
  const p = PRESETS.find((x) => x.spec.kind === kind);
  applyPreset(p);
}

let liveTimer = 0;
let pendingSpecimen = null;
function flushSpecimenEdit() {
  const pending = pendingSpecimen;
  if (state.mode !== 'specimen' || !stage.pill || stage.pill.morph || stage.section) return;
  const queued = pending && pending.revision === specimenRevision && pending.pill === stage.pill;
  if (!queued && !stage.pill.needsFinalize) return;
  cancelAnimationFrame(liveTimer); liveTimer = 0; pendingSpecimen = null;
  stage.pill.live(clone(state.spec), true); stage.groundHero();
}
// Edit transaction for live previews (3D handle drags, arrow-key steps in a
// value field): the first real change snapshots spec and preset; cancel puts
// both back exactly, so an aborted gesture leaves no trace (not even
// "Custom specimen").
let editSnap = null, handles = null;
function beginEdit() { editSnap = state.mode === 'specimen' ? { spec: clone(state.spec), presetId: state.presetId, sampled: state.sampled } : null; }
function cancelEdit() {
  if (!editSnap || state.mode !== 'specimen') { editSnap = null; return false; }
  const snap = editSnap; editSnap = null;
  cancelAnimationFrame(liveTimer);
  pendingSpecimen = null; liveTimer = 0;
  state.spec = snap.spec; state.presetId = snap.presetId; state.sampled = snap.sampled;
  stage.pill.live(clone(state.spec), true); stage.groundHero(); stage.lightStudio(); stage.pipe.reset(); stage.wake();
  renderInspector(); updateCaption(); scheduleDims();
  return true;
}
function editSpecimen(fn, final, hint) {
  specimenRevision++;
  fn(state.spec);
  validate(state.spec);
  state.presetId = null; state.sampled = false;
  hideDims();
  if (hint === 'morph') {
    stage.setSpecimen(clone(state.spec)).then(() => scheduleDims());
    renderInspector();
  } else {
    // Coalesce slider input to one geometry update per frame.
    cancelAnimationFrame(liveTimer);
    const revision = specimenRevision, pill = stage.pill, spec = clone(state.spec);
    pendingSpecimen = { revision, pill };
    liveTimer = requestAnimationFrame(() => {
      pendingSpecimen = null; liveTimer = 0;
      // A preset/mode/selection change can replace the subject before this
      // queued input runs. It must never apply an old gesture to the new pill.
      if (revision !== specimenRevision || state.mode !== 'specimen' || pill !== stage.pill) return;
      if (pill.live(spec, !!final) !== false) stage.groundHero();
      stage.pipe.reset(); stage.wake();
      if (final) { stage.lightStudio(); scheduleDims(); }
    });
    if (final && needsRerender(fn)) renderInspector();
  }
  updateCaption();
}
// Discrete controls change which sub-controls exist.
function needsRerender() { return true; }

function editProduct(pi, fn, final) {
  const tray = stage.tray;
  const spec = tray.products[pi];
  fn(spec);
  validate(spec);
  const sel = state.selected;
  cancelAnimationFrame(liveTimer);
  pendingSpecimen = null;
  if (!final) {
    const inst = { ...clone(spec), seed: sel.spec.seed, damage: sel.spec.damage };
    liveTimer = requestAnimationFrame(() => {
      if (state.mode !== 'tray' || stage.tray !== tray || state.selected !== sel) return;
      sel.live(inst, false); stage.pipe.reset(); stage.wake();
    });
    return;
  }
  // Rebuild the scene with the edited product; placement stays physically valid.
  const products = tray.products.map(clone);
  stage.buildTray(state.tray, { animate: false, products });
  const again = stage.tray.pills.find((p) => p.placement.product === pi) || stage.tray.pills[0];
  state.selected = again;
  if (again) { stage.controls.target.copy(again.group.position); stage.pipe.dof.focus = stage.trayCam.position.distanceTo(again.group.position); stage.controls.update(); }
  renderInspector();
  refreshLabels();
}

function openInStudio(spec) {
  state.spec = clone(spec);
  state.presetId = null; state.sampled = false;
  deselect(true);
  setMode('specimen').then(() => stage.setSpecimen(clone(spec), { transition: 'section' }));
}

// ------------------------------------------------------------ modes
async function setMode(mode) {
  handles?.cancel();
  if ((state.dataset.running || generating) && mode !== 'dataset') { toast('Generation in progress — cancel first'); return; }
  // A gesture can lose its release when a mode changes. Finish its exact
  // geometry/relief before parking the studio, so returning shows saved state.
  flushSpecimenEdit();
  specimenRevision++;
  const prev = state.mode;
  if (mode !== 'dataset') sceneInspector?.close({ instant: true });
  state.mode = mode;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
  $('sheet').classList.toggle('on', mode === 'dataset');
  $('app').classList.toggle('dataset-mode', mode === 'dataset');
  $('readout').classList.toggle('on-dark', mode !== 'specimen');
  hideDims();
  if (mode === 'specimen') {
    state.selected = null;
    setLabels('off', true);
    stage.setMode('specimen');
    scheduleDims();
  } else {
    if (!stage.tray) stage.buildTray(state.tray, { animate: prev === 'specimen' });
    else if (prev === 'specimen' && !reduced) stage.buildTray(state.tray, { animate: true, products: stage.tray.products });
    stage.setMode('tray');
    if (mode === 'dataset') { state.selected = null; setLabels('off', true); if (stage.trayView !== 'capture') stage.setTrayView('capture'); }
  }
  renderInspector();
  updateCaption();
  closeSheetIfMobile();
  updateFab();
}

const trayActions = {
  config(fn) { delete state.tray.camera.captureLock; fn(state.tray); rebuildTray(false); },
  contents(fn) {
    const cap=stage.tray.captureCamera(2),camera=clone(state.tray.camera);
    camera.captureLock={position:cap.position.toArray(),quaternion:cap.quaternion.toArray(),up:cap.up.toArray(),fov:cap.fov,aspect:cap.aspect,shift:cap.userData.captureShift??[0,0],record:clone(cap.userData.record)};
    fn(state.tray);state.tray.camera=camera;
    rebuildTray(false,true);
  },
  rebuild(animate) { rebuildTray(animate); },
  // Resample: a whole new scene from the priors (the requested camera height is kept).
  randomize() {
    let seed;
    do seed = Math.floor(Math.random() * 1e6); while (seed === state.tray.seed);
    const cam = state.tray.camera;
    state.tray = { ...randomConfig(seed), camera: { ...randomConfig(seed).camera } };
    state.tray.camera.clearance = cam.clearance;
    rebuildTray(true);
  },
  randomizeCamera() { delete state.tray.camera.captureLock; const c=state.tray.camera,seed=(c.intrinsicsSeed??state.tray.seed)+1;Object.assign(c,sampleIntrinsics(seed),{framing:'lens'});stage.tray.config.camera=clone(c);stage.updateTrayCamera();renderInspector();refreshLabels(); },
  camera(fn, final) { delete state.tray.camera.captureLock; fn(state.tray.camera); stage.tray.config.camera = clone(state.tray.camera); if (stage.trayView === 'capture') stage.updateTrayCamera(); if (final) refreshLabels(); else hideLabelsQuick(); updateCaption(); updateCamActual(); },
  captureRecord: () => stage.capture?.userData.record ?? null,
  lighting(v) { state.tray.lighting = v; stage.tray.config.lighting = v; stage.applyTrayLighting(); stage.pipe.reset(); stage.wake(); refreshLabels(); renderTrayPanel(); },
  labels(v) { setLabels(v); },
  boxes(v) { state.boxes = v; drawOverlay(); },
  view(v) { stage.setTrayView(v); setLabels(state.labels); renderInspector(); },
};
function renderTrayPanel() { if (state.mode === 'tray' && !state.selected) renderInspector(); }

// Automatic fit may back the camera off beyond the requested clearance (raised
// lids, near surfaces); say so beside the request, only when they differ.
function updateCamActual() {
  const n = $('camActual'); if (!n) return;
  const r = stage.capture?.userData.record, cam = state.tray.camera;
  const differs = r && (cam.framing ?? 'fit') === 'fit' && Math.abs(r.clearance_above_rim_mm - r.requested_clearance_above_rim_mm) > .5;
  n.hidden = !differs;
  if (differs) n.replaceChildren(el('strong', { text: `Actual ${r.clearance_above_rim_mm.toFixed(0)} mm.` }), ` Fit tray backed off ${r.auto_fit_pullback_mm.toFixed(0)} mm from the requested height so near surfaces stay within ${r.near_surface_magnification.toFixed(2)}× of rim scale.`);
}
function rebuildTray(animate, preserveView = false) {
  state.selected = null;
  stage.buildTray(state.tray, { animate });
  if (!preserveView && stage.trayView !== 'capture') stage.setTrayView('capture');
  renderInspector();
  updateCaption();
  refreshLabels();
}

function select(pill) {
  if (!pill) return;
  state.selected = pill;
  hideLabelsQuick();
  stage.setTrayView('pill', pill);
  renderInspector();
  updateCaption();
  openSheetIfMobile();
  updateFab();
}
function deselect(silent) {
  if (!state.selected) return;
  state.selected = null;
  stage.setTrayView('capture');
  if (!silent) { renderInspector(); updateCaption(); refreshLabels(); }
  updateFab();
}

// ------------------------------------------------------------ labels overlay
let labelsTimer = 0;
function setLabels(mode, silent) {
  state.labels = mode;
  if (mode === 'off' || state.mode !== 'tray' || stage.trayView !== 'capture') {
    const L = $('labelLayer');
    L.style.clipPath = 'polygon(0% 0%, 0% 0%, -30% 100%, -30% 100%)';
    L.style.opacity = '0';
    state.labelData = mode === 'off' ? null : state.labelData;
    drawOverlay();
    if (!silent) renderInspectorMaybe();
    return;
  }
  refreshLabels(true);
}
function renderInspectorMaybe() { if (state.mode === 'tray' && !state.selected) { /* segmented control already reflects state */ } }
function hideLabelsQuick() { const L = $('labelLayer'); L.style.transition = 'none'; L.style.opacity = '0'; state.labelData = null; drawOverlay(); }

function refreshLabels(wipe = false) {
  clearTimeout(labelsTimer);
  if (state.mode !== 'tray' || !stage.tray || stage.trayView !== 'capture') { drawOverlay(); return; }
  if (state.labels === 'off' && !state.boxes) { drawOverlay(); return; }
  hideLabelsQuick();
  labelsTimer = setTimeout(() => {
    // A return-to-capture flight still shows intermediate poses; don't put a
    // final-camera label image over those frames.
    if (stage.cancelFlight) { refreshLabels(wipe); return; }
    stage.tray.finishAnimation();
    const rect = stage.captureFrameRect();
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(Math.min(1600, rect.w * dpr)), h = Math.round(w / 2);
    const cap = stage.capture.clone();
    stage.tray.group.updateMatrixWorld(true);
    const labels = renderLabels(stage.renderer, stage.trayWorld, cap, w, h);
    state.labelData = { labels, rect, w, h };
    const L = $('labelLayer');
    if (state.labels !== 'off') {
      L.width = w; L.height = h;
      L.getContext('2d').putImageData(colorize(labels, state.labels), 0, 0);
      Object.assign(L.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
      L.style.transition = 'none';
      if (wipe && !reduced) {
        L.style.clipPath = 'polygon(0% 0%, 0% 0%, -30% 100%, -30% 100%)';
        L.style.opacity = '.92';
        L.getBoundingClientRect();
        L.style.transition = 'clip-path .8s cubic-bezier(.2,.7,.15,1), opacity .2s';
      } else L.style.opacity = '.92';
      L.style.clipPath = 'polygon(0% 0%, 130% 0%, 100% 100%, -30% 100%)';
    }
    drawOverlay();
    stage.pipe.reset(); stage.wake();
  }, wipe ? 30 : 160);
}

// ------------------------------------------------------------ SVG overlay
const svgNS = 'http://www.w3.org/2000/svg';
// Specimen drafting now follows the camera in the 3D render pass.
function hideDims() { drawOverlay(); }
function scheduleDims() { stage.wake(); drawOverlay(); }

function drawOverlay() {
  const svg = $('annot');
  const parts = [];
  if (state.mode !== 'specimen' && stage.tray) {
    if (stage.trayView === 'capture') parts.push(frameMarkup());
    if (stage.trayView === 'capture' && state.boxes && state.labelData && state.labels !== 'off') parts.push(boxesMarkup());
    if (state.selected) parts.push(bracketMarkup(state.selected, 'sel'));
    else if (hoverPill && stage.trayView === 'capture') parts.push(bracketMarkup(hoverPill, 'hover'));
  }
  svg.innerHTML = parts.join('');
}

function projectLocal(pill, x, y, z) {
  const v = new THREE.Vector3(x, y, z);
  pill.frame.localToWorld(v);
  return stage.project(v);
}
// Annotation text is measured (canvas, same font as #annot text) so labels can
// be kept inside the visible render area on narrow viewports.
let measureCtx = null;
function textWidth(s) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = '11px "IBM Plex Mono", ui-monospace, Menlo, monospace';
  return measureCtx.measureText(s).width + 4; // + halo stroke
}
const TEXT_H = 14; // 11 px mono line box + halo
// The area annotations may occupy: the unobstructed render rectangle (no top
// rule, column or sheet) minus the readout line along the bottom.
function annotArea() { const f = stage.free; return { x0: f.x + 8, y0: f.y + 8, x1: f.x + f.w - 8, y1: f.y + f.h - 34 }; }
// While measuring for the camera fit, extents are accumulated here instead
// of being clamped; `measuring` also disables the on-screen filters.
let measuring = false, bounds = null;
const grow = (x, y) => { if (!bounds) return; if (x < bounds[0]) bounds[0] = x; if (y < bounds[1]) bounds[1] = y; if (x > bounds[2]) bounds[2] = x; if (y > bounds[3]) bounds[3] = y; };
const growBox = (x, y, hx, hy) => { grow(x - hx, y - hy); grow(x + hx, y + hy); };
// Move P along P->Q until it is inside the area (extension lines start at the
// object, which may be outside the visible rectangle during close-ups).
function clipToArea(P, Q, A) {
  const inside = (x, y) => x >= A.x0 && x <= A.x1 && y >= A.y0 && y <= A.y1;
  if (inside(P[0], P[1])) return P;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; const x = P[0] + (Q[0] - P[0]) * m, y = P[1] + (Q[1] - P[1]) * m; if (inside(x, y)) hi = m; else lo = m; }
  return [P[0] + (Q[0] - P[0]) * hi, P[1] + (Q[1] - P[1]) * hi, P[2]];
}
// Technical dimension: extension lines from the object to an offset dimension
// line, arrowheads, label reading along the line. All points in screen px.
// The label slides along its line (and flips side) so it stays inside the
// annotation area; a dimension whose line leaves the area is not drawn.
function dimSeg(e0, e1, a, b, label) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const A = annotArea();
  const onScreen = (p) => p[0] > A.x0 && p[0] < A.x1 && p[1] > A.y0 && p[1] < A.y1 && p[2] < 1;
  if (len < 44 || (!measuring && ![a, b].every(onScreen))) return '';
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const ext = (P, Q) => {
    P = measuring ? P : clipToArea(P, Q, A);
    const l = Math.hypot(Q[0] - P[0], Q[1] - P[1]); if (l < 3) return '';
    const vx = (Q[0] - P[0]) / l, vy = (Q[1] - P[1]) / l;
    const S = [P[0] + vx * 3, P[1] + vy * 3];
    let E = [Q[0] + vx * 5, Q[1] + vy * 5];
    if (!measuring) E = clipToArea(E, S, A); // the 5 px overshoot past the dimension line stays inside too
    grow(S[0], S[1]); grow(E[0], E[1]);
    return `<line x1="${S[0]}" y1="${S[1]}" x2="${E[0]}" y2="${E[1]}" stroke-opacity=".5"/>`;
  };
  const arrow = (P, d) => { growBox(P[0], P[1], 8, 8); return `<path d="M${P[0] + ux * 7 * d - uy * 2.6},${P[1] + uy * 7 * d + ux * 2.6}L${P[0]},${P[1]}L${P[0] + ux * 7 * d + uy * 2.6},${P[1] + uy * 7 * d - ux * 2.6}"/>`; };
  let ang = Math.atan2(uy, ux) * 180 / Math.PI;
  if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const nx = -uy, ny = ux;
  const W = textWidth(label);
  // Half extents of the rotated label's axis-aligned box.
  const hx = Math.abs(ux) * W / 2 + Math.abs(uy) * TEXT_H / 2, hy = Math.abs(uy) * W / 2 + Math.abs(ux) * TEXT_H / 2;
  const { x0, x1, y0, y1 } = A;
  const overflow = (x, y) => Math.max(0, x0 - (x - hx)) + Math.max(0, (x + hx) - x1) + Math.max(0, y0 - (y - hy)) + Math.max(0, (y + hy) - y1);
  let best = null;
  for (const side of [ny > 0 ? 1 : -1, ny > 0 ? -1 : 1]) {
    let tx = mx + nx * 9 * side, ty = my + ny * 9 * side;
    // Slide along the line by the projected overflow, limited to the segment.
    const dx = Math.max(0, x0 - (tx - hx)) - Math.max(0, (tx + hx) - x1), dy = Math.max(0, y0 - (ty - hy)) - Math.max(0, (ty + hy) - y1);
    const t = clampNum(dx * ux + dy * uy, -(len / 2 - W / 2), len / 2 - W / 2);
    if (Number.isFinite(t)) { tx += ux * t; ty += uy * t; }
    const o = overflow(tx, ty);
    if (!best || o < best.o) best = { tx, ty, o };
    if (o === 0) break;
  }
  const { tx, ty } = best;
  growBox(tx, ty, hx, hy);
  return `${ext(e0, a)}${ext(e1, b)}<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>${arrow(a, 1)}${arrow(b, -1)}<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang} ${tx} ${ty})">${label}</text>`;
}
const clampNum = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
// Camera fit hook (stage.specimenFrame): with the studio camera at a candidate
// pose, measure the projected specimen box plus every annotation at its
// natural placement and return the factor by which the distance must grow
// so everything sits inside the annotation area with a 12 px margin.
function annotationFit(pill, tg, rest) {
  const A = annotArea(), m = 12;
  const cx = (A.x0 + A.x1) / 2, cy = (A.y0 + A.y1) / 2;
  const availX = (A.x1 - A.x0) / 2 - m, availY = (A.y1 - A.y0) / 2 - m;
  if (availX < 40 || availY < 40) return 1;
  measuring = true; bounds = [Infinity, Infinity, -Infinity, -Infinity];
  try {
    // Measure the final grounded pose; the live morph interpolates towards it.
    const saveY = pill.group.position.y;
    pill.group.position.y = rest; pill.group.updateMatrixWorld(true);
    dimensionMarkup(tg, pill);
    const d = pill.describe(tg.dims, tg.spec);
    for (const x of [-d.L / 2, d.L / 2]) for (const y of [-d.W / 2, d.W / 2]) for (const z of [-d.H / 2, d.H / 2]) { const q = projectLocal(pill, x, y, z); grow(q[0], q[1]); }
    pill.group.position.y = saveY; pill.group.updateMatrixWorld(true);
  } finally { measuring = false; }
  const b = bounds; bounds = null;
  if (!Number.isFinite(b[0])) return 1;
  const needX = Math.max(cx - b[0], b[2] - cx), needY = Math.max(cy - b[1], b[3] - cy);
  return Math.max(1, needX / availX, needY / availY);
}
function dimensionMarkup(tg = null, p = stage.pill) {
  const spec = tg ? tg.spec : p.spec, dims = tg ? tg.dims : p.dims;
  const d = p.describe(dims, spec);
  const L = d.L, W = d.W, H = d.H, z0 = -H / 2;
  const size = Math.max(L, W), off = size * .16;
  const camL = p.frame.worldToLocal(stage.studioCam.position.clone());
  const sy = camL.y >= 0 ? 1 : -1, sx = camL.x >= 0 ? 1 : -1;
  const P = (x, y, z) => projectLocal(p, x, y, z);
  const f = (v) => `${v.toFixed(v < 10 ? 2 : 1)} mm`;
  let out = '<g class="dim">';
  const yl = sy * (W / 2 + off);
  out += dimSeg(P(-L / 2, 0, z0), P(L / 2, 0, z0), P(-L / 2, yl, z0), P(L / 2, yl, z0), spec.kind === 'tablet' && spec.outline === 'round' ? `Ø ${f(L)}` : f(L));
  if (Math.abs(L - W) > .05) {
    const xs = Math.max(0, L / 2 - W / 2) * sx, xl = sx * (L / 2 + off);
    out += dimSeg(P(xs, -W / 2, z0), P(xs, W / 2, z0), P(xl, -W / 2, z0), P(xl, W / 2, z0), f(W));
  }
  // Height at the extreme that is leftmost on screen, offset outward.
  const cands = [[-L / 2, 0, -1, 0], [L / 2, 0, 1, 0], [0, -W / 2, 0, -1], [0, W / 2, 0, 1]];
  let best = null;
  for (const c of cands) { const q = P(c[0], c[1], 0); if (!best || q[0] < best.q[0]) best = { c, q }; }
  const [hx, hy, ox, oy] = best.c;
  out += dimSeg(P(hx, hy, z0), P(hx, hy, -z0), P(hx + ox * off, hy + oy * off, z0), P(hx + ox * off, hy + oy * off, -z0), f(H));
  // Feature callouts (leader to a surface point).
  const s = spec, dm = dims;
  const callouts = [];
  if (s.kind === 'tablet' && s.score?.count) callouts.push([[0, W * .3, H / 2], `score ${s.score.width.toFixed(2)} × ${s.score.depth.toFixed(3)} mm`]);
  if (s.kind === 'tablet' && s.rimWidth > .05) callouts.push([[-L / 2 + dm.bevel + s.rimWidth / 2, 0, dm.zLand], `shoulder land ${s.rimWidth.toFixed(2)} mm`]);
  if (s.kind === 'tablet' && s.imprint?.layout && s.imprint.layout !== 'none' && callouts.length < 2) callouts.push([[s.imprint.offsetX ?? 0, (s.imprint.offsetY ?? 0), H / 2 - .05], `deboss ${s.imprint.depth.toFixed(3)} mm`]);
  if (s.kind === 'tablet' && (s.damage?.chips || s.damage?.fracture) && p.record.damage?.remaining_fraction) callouts.push([[0, 0, H / 2], `${Math.round(p.record.damage.remaining_fraction * 100)} % volume remains`]);
  if (s.kind === 'capsule') callouts.push([[dm.xRim, 0, dm.rc], `cap step ${dm.wall.toFixed(3)} mm`]);
  if (s.kind === 'softgel') callouts.push([[0, 0, H / 2], `seam ${s.seamWidth.toFixed(3)} mm`]);
  // Feature callouts are lower priority than the size readouts: each one tries
  // its preferred side, then the other side, then a shorter leader; if the
  // text still cannot sit inside the annotation area it is not drawn.
  const A = annotArea();
  const xMin = A.x0, xMax = A.x1;
  const placed = [];
  callouts.slice(0, 2).forEach(([pt, text], i) => {
    const [x, y, z] = projectLocal(p, ...pt);
    if (z > 1) return;
    grow(x, y);
    if (x < A.x0 || x > A.x1 || y < A.y0 || y > A.y1) return; // anchor outside: dropped (the fit sees the anchor)
    const W = textWidth(text);
    let hit = null;
    for (const reach of [64, 24]) {
      for (const d of [i ? -1 : 1, i ? 1 : -1]) {
        const tx = x + d * reach, tStart = tx + d * 12, tEnd = tStart + d * W;
        if (Math.min(tStart, tEnd) >= xMin && Math.max(tStart, tEnd) <= xMax) { hit = { d, tx, reach }; break; }
      }
      if (hit) break;
    }
    // While measuring for the camera fit, a callout that fits nowhere (even
    // flipped and shortened) counts at its natural placement so the fit
    // widens; when drawing it is simply not shown.
    if (!hit) { if (!measuring) return; hit = { d: i ? -1 : 1, tx: x + (i ? -64 : 64) }; }
    const { d, tx } = hit;
    let ty = Math.min(A.y1 - 8, Math.max(A.y0 + 8, y - 64 - i * 12));
    // Keep two callouts on the same side from sharing a line.
    for (const q of placed) if (q.d === d && Math.abs(q.ty - ty) < TEXT_H + 2) ty = Math.max(A.y0 + 8, q.ty - (TEXT_H + 4));
    placed.push({ d, ty });
    grow(x, y); grow(tx, ty); growBox(tx + d * 12 + d * W / 2, ty, W / 2 + 2, TEXT_H / 2);
    out += `<circle cx="${x}" cy="${y}" r="2.6" fill="#1b64be" stroke="none"/><path d="M${x},${y}L${tx},${ty}H${tx + d * 8}"/><text x="${tx + d * 12}" y="${ty}" text-anchor="${d < 0 ? 'end' : 'start'}" dominant-baseline="middle">${text}</text>`;
  });
  return out + '</g>';
}

function frameMarkup() {
  const r = stage.captureFrameRect();
  const W = stage.cssW, H = stage.cssH;
  const shade = `<path class="frame-shade" fill-rule="evenodd" d="M0,0H${W}V${H}H0Z M${r.x},${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z"/>`;
  const t = 14;
  const ticks = [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]].map(([x, y, sx, sy]) => `<path class="frame-tick" d="M${x + sx * t},${y}H${x}V${y + sy * t}"/>`).join('');
  const cam = state.tray.camera;
  const actualClearance = stage.capture?.userData.record?.clearance_above_rim_mm ?? cam.clearance;
  const label = `CAPTURE 2:1 · ${actualClearance.toFixed(0)} MM ABOVE RIM · TILT ${cam.tilt.toFixed(1)}° · ROLL ${cam.roll.toFixed(1)}°`;
  return `${shade}<rect class="frame" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>${ticks}<text class="frame-label" x="${r.x}" y="${r.y - 8}">${label}</text>`;
}

function boxesMarkup() {
  const { labels, rect, w } = state.labelData;
  const k = rect.w / w;
  let out = '<g class="box">';
  for (const b of labels.boxes) {
    const x = rect.x + b.x0 * k, y = rect.y + b.y0 * k, bw = (b.x1 - b.x0 + 1) * k, bh = (b.y1 - b.y0 + 1) * k;
    const hue = (b.id * 0.61803398875 % 1) * 360;
    out += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" stroke="hsl(${hue} 70% 62%)"/><text x="${x + 2}" y="${y - 4}">#${b.id}</text>`;
  }
  return out + '</g>';
}

function bracketMarkup(pill, cls) {
  const box = new THREE.Box3().setFromObject(pill.group);
  const pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(stage.project(new THREE.Vector3(x, y, z)));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - 6, x1 = Math.max(...xs) + 6, y0 = Math.min(...ys) - 6, y1 = Math.max(...ys) + 6;
  const t = Math.min(12, (x1 - x0) / 3);
  const c = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].map(([x, y, sx, sy]) => `<path d="M${x + sx * t},${y}H${x}V${y + sy * t}"/>`).join('');
  const s = pill.spec;
  const label = cls === 'sel' ? '' : `<text x="${x0}" y="${y0 - 6}">#${pill.label.instance} ${familyOf(s).replace(/_/g, ' ')}</text>`;
  return `<g class="${cls}">${c}${label}</g>`;
}

// ------------------------------------------------------------ readouts
let lastInfo = '';
function onFrame({ busy, samples }) {
  if (state.mode !== 'specimen' && (busy || hoverPill || state.selected)) drawOverlay();
  updateReadout(samples, busy);
}
function onIdle() {
  updateReadout(stage.pipe.samples, false);
  drawOverlay();
}
function updateReadout(samples, busy) {
  const cam = stage.camera;
  let dist;
  if (state.mode === 'specimen' || state.selected || stage.trayView !== 'capture') dist = cam.position.distanceTo(stage.controls.target);
  else dist = state.tray.camera.clearance;
  const fh = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  const pxPerMM = stage.cssH / fh;
  const nice = [.5, 1, 2, 5, 10, 20, 50, 100];
  let L = nice[0];
  for (const n of nice) if (n * pxPerMM <= (mobileQuery.matches ? 150 : 65)) L = n;
  $('scaleBarBar').style.width = `${Math.round(L * pxPerMM)}px`;
  $('scaleBarText').textContent = `${L} mm${state.mode === 'specimen' || state.selected ? ' at focus' : ' at rim'}`;
  const done = samples >= stage.pipe.maxSamples;
  const status = `<span class="status-dot ${done ? '' : 'live'}"></span>${busy ? 'interactive' : done ? `converged · ${samples} samples` : `refining ${samples}/${stage.pipe.maxSamples}`}`;
  const sep = '<span class="sep"> · </span>';
  // Context (family/finish or seed/placement) is wrapped so the phone line can show the status alone.
  let info;
  if (state.mode === 'specimen') {
    const s = state.spec;
    info = `<span class="ctx">${familyOf(s).replace(/_/g, ' ')}${sep}${s.kind === 'tablet' ? s.finish.replace('_', ' ') : s.kind === 'softgel' ? s.opacity + ' shell' : 'gelatin shell'}${sep}</span>${status}`;
  } else {
    const m = stage.tray?.meta;
    info = m ? `<span class="ctx">seed ${m.seed}${sep}${m.placed_pills} placed · ${m.debris.length ? 'debris' : 'no debris'}${sep}</span>${status}` : status;
  }
  if (info !== lastInfo) { $('infoCard').innerHTML = info; lastInfo = info; }
}

// Handle guidance lives in the status strip (a fixed UI location), never on the object.
let dimHint = null;
function setDimHint(text) {
  dimHint = text;
  $('readout').classList.toggle('hinting', !!text);
  if (text) $('caption').textContent = text; else updateCaption();
}
function updateCaption() {
  let c;
  if (state.mode === 'specimen') c = `specimen · ${describeSpec(state.spec)}`;
  else if (state.mode === 'dataset') c = 'dataset · deterministic seeds · local export';
  else if (state.selected) c = `tray · instance #${state.selected.label.instance} · ${familyOf(state.selected.spec).replace(/_/g, ' ')}`;
  else c = `tray · ${TRAY_STYLES[state.tray.style].label.toLowerCase()} · seed ${state.tray.seed}`;
  if (!dimHint) $('caption').textContent = c;
}

// ------------------------------------------------------------ dataset
function saveArchive(bytes, filename, type = 'application/zip') {
  if (!bytes) return;
  const a=document.createElement('a'), url=URL.createObjectURL(new Blob([bytes],{type}));
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
}
// Contact sheet (ui/collection.js) and scene inspector (ui/scene-inspector.js).
let collection = null, sceneInspector = null;
const collectionStore = new CollectionStore();
let collectionReady;
const settingsOf = d => Object.fromEntries(['count','res','samples','cameraProfile','stressProbability','sampling'].map(k=>[k,d[k]]));
const checkpoint = (d,run=d.pendingRun) => ({nextIndex:d.nextIndex,seed:d.seed,run:run??null,settings:settingsOf(run??d)});
const readArchive = r => collectionStore.db ? collectionStore.archive(r) : Promise.resolve(r.archive);
async function downloadScene(name) {
  const r=state.dataset.scenes.find(r=>r.name===name);if(!r)return;
  try {saveArchive(await readArchive(r),r.name+'.zip');}catch(e){const d=state.dataset;d.status=`Download failed: ${e.message}`;setDsStatus(d.status);}
}
function initDataset() {
  const byName = (name) => state.dataset.scenes.find((r) => r.name === name);
  collection = createCollection({
    grid: $('sheetGrid'), reduced,
    onOpen: (name) => datasetActions.inspect(name),
    onDownload: downloadScene,
    onDelete: (name) => datasetActions.remove(name),
  });
  sceneInspector = createInspector({
    root: $('sceneInspector'), reduced,
    getScenes: () => state.dataset.scenes, isRunning: () => state.dataset.running || !!generating || state.dataset.exporting,
    onDownloadScene: downloadScene,
    readArchive,
    onDownloadFile: (bytes, filename) => saveArchive(bytes, filename, filename.endsWith('.png') ? 'image/png' : filename.endsWith('.json') ? 'application/json' : 'application/octet-stream'),
    onDelete: (name) => datasetActions.remove(name),
    tileRect: (name, { reveal = false } = {}) => {
      const pic = collection.tileFor(name)?.querySelector('.pic'); if (!pic) return null;
      if (reveal) pic.scrollIntoView({ block: 'nearest' });
      const r = pic.getBoundingClientRect(); return r.width ? r : null;
    },
    onClosed: (name) => { updateDock(); collection.focusTile(name); },
    isMobile: () => mobileQuery.matches,
    setInertBehind: (on) => { $('sheet').inert = on; for (const id of ['rail', 'inspector']) $(id).inert = on && mobileQuery.matches; if (on) updateDock(); },
  });
  collectionReady=(async()=>{
    const d=state.dataset;d.storage='opening';
    try {
      await collectionStore.open();const saved=await collectionStore.restore();
      d.scenes=saved.scenes;
      if(saved.checkpoint){d.nextIndex=saved.checkpoint.nextIndex;d.seed=saved.checkpoint.seed;d.pendingRun=saved.checkpoint.run;Object.assign(d,saved.checkpoint.settings??{});}
      d.storage='saved';
      if(d.scenes.length||d.pendingRun)d.status=`Restored ${d.scenes.length} saved scenes${d.pendingRun?`; ${d.pendingRun.count-d.pendingRun.done} scenes ${d.pendingRun.generatorRevision===GENERATOR_REVISION?'can resume':'require the original generator to resume'}`:''}.`;
    }catch(e){collectionStore.db?.close();collectionStore.db=null;d.storage='unavailable';d.status=`Local saving unavailable: ${e.message}. Download scenes before closing this tab.`;}
    renderCollection();if(state.mode==='dataset')renderInspector();
  })();
  renderCollection();
}
function renderCollection() {
  const d=state.dataset;
  collection.sync(d.scenes,{running:d.running||!!generating||d.exporting});
  sceneInspector.sync();
  const pills=d.scenes.reduce((a,r)=>a+r.meta.placed_pills,0);
  $('sheetMeta').textContent=`${d.scenes.length} scene${d.scenes.length===1?'':'s'} in collection${d.scenes.length?` · ${pills} pills`:''}`;
}
// Scenes per batch: one range and one setter for the panel footer and the
// phone dock, so either control always shows the count the next batch uses.
const COUNT_MIN = 1, COUNT_MAX = 64;
const clampCount = (v) => Math.max(COUNT_MIN, Math.min(COUNT_MAX, Math.round(Number(v) || COUNT_MIN)));
function setDatasetCount(v) {
  const d = state.dataset;
  if (!d.running && !generating) d.count = clampCount(v);
  syncCountControls();
}
function syncCountControls(skip = null) {
  const d = state.dataset, locked = d.running || !!generating;
  for (const [input, minus, plus] of [['dsBatchCount', 'dsCountMinus', 'dsCountPlus'], ['dockCount', 'dockMinus', 'dockPlus']].map((ids) => ids.map($))) {
    if (!input) continue;
    if (input !== skip) input.value = d.count;
    input.disabled = locked;
    minus.disabled = locked || d.count <= COUNT_MIN;
    plus.disabled = locked || d.count >= COUNT_MAX;
  }
}
// Typing takes effect as soon as it is a valid count (without rewriting the
// field mid-entry); committing clamps. Digits stay in the field rather than
// reaching the 1/2/3 mode shortcuts.
const countInputHandlers = {
  oninput: (e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= COUNT_MIN && v <= COUNT_MAX && !state.dataset.running && !generating) { state.dataset.count = v; syncCountControls(e.target); } },
  onchange: (e) => setDatasetCount(e.target.value),
  onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') setDatasetCount(e.target.value); },
};
// The start of a batch (opening the collection, taking the cross-tab lock)
// is asynchronous; a second press meanwhile must neither start another batch
// nor be refused as "another tab".
let generating = null, batchStep = null;
const datasetActions = {
  generate(resume = false) {
    const d = state.dataset;
    if (generating || d.running || d.exporting) return Promise.resolve();
    generating = datasetActions.run(resume).finally(() => { generating = null; batchStep = null; renderCollection(); syncCountControls(); updateDock(); });
    renderCollection(); syncCountControls(); updateDock();
    return generating;
  },
  async run(resume=false,locked=false) {
    const d=state.dataset;if(d.running||d.exporting)return;
    await collectionReady;if(d.running||d.exporting)return;
    if(collectionStore.db&&navigator.locks&&!locked)return navigator.locks.request(collectionStore.name,{ifAvailable:true},async lock=>{
      if(!lock){setDsStatus('Another tab is generating this collection. Stop it there first.');return;}
      const saved=await collectionStore.restore();d.scenes=saved.scenes;
      if(saved.checkpoint&&saved.checkpoint.nextIndex!==d.nextIndex){d.nextIndex=saved.checkpoint.nextIndex;d.seed=saved.checkpoint.seed;}
      d.pendingRun=saved.checkpoint?.run??null;
      return datasetActions.run(resume,true);
    });
    if(resume&&d.pendingRun?.generatorRevision!==GENERATOR_REVISION){d.status='This batch belongs to a different generator version. Use its original HTML to resume, or Generate & add a new batch.';renderInspector();return;}
    stopTour();d.running=true;d.zip=null;d.status='Starting…';d.failure=null;batchStep=null;
    const run=resume&&d.pendingRun?structuredClone(d.pendingRun):{generatorRevision:GENERATOR_REVISION,count:clampCount(d.count),done:0,baseSeed:d.seed,startIndex:d.nextIndex,res:d.res,samples:d.samples,cameraProfile:d.cameraProfile,stressProbability:d.stressProbability,sampling:d.sampling};
    d.pendingRun=run;
    const [w,h]=run.res.split('x').map(Number),count=run.count-run.done,baseSeed=run.baseSeed+run.done,startIndex=run.startIndex+run.done,offset=run.done;
    const ac=new AbortController();d.abort=ac;renderInspector();renderCollection();
    collection.queueStart({count,startIndex,baseSeed,width:w,height:h,samples:run.samples});
    const t0=performance.now();let added=0,failed=false,failureStage='checkpoint';
    // Measured per-stage durations of the active scene (UI only; not exported).
    let timing={},cur=null,tStage=0;
    const mark=(index,stage)=>{const now=performance.now();if(cur&&cur.index===index)timing[cur.stage]=(timing[cur.stage]||0)+now-tStage;else timing={building:0,rendering:0,encoding:0};cur={index,stage};tStage=now;};
    try {
      if(collectionStore.db)await collectionStore.checkpoint(checkpoint(d,run));
      const res=await generateDataset(stage,{
        count,baseSeed,startIndex,collect:false,width:w,height:h,samples:run.samples,cameraProfile:run.cameraProfile,stressProbability:run.stressProbability,sampling:run.sampling,scenarioOffset:offset,signal:ac.signal,
        onProgress:(p)=>{const {index,count,stage:st}=p;failureStage=st;mark(index,st);batchStep={n:index+1,count};collection.queueProgress(p);d.status=`Adding ${index+1} of ${count}: ${st}…`;setDsStatus(d.status,index/count);},
        onScene:async record=>{
          if(cur?.index===record.index)mark(record.index,'done');record.timing=timing;
          record.ok=Object.values(record.meta.verification).every(Boolean);
          const nextRun={...run,done:offset+added+1};
          const next={nextIndex:record.globalIndex+1,seed:record.seed+1,run:nextRun.done<nextRun.count?nextRun:null,settings:settingsOf(run)};
          failureStage='saving';
          if(collectionStore.db)record=await collectionStore.save(record,next);
          d.scenes.push(record);added++;d.nextIndex=next.nextIndex;d.seed=next.seed;d.pendingRun=next.run;
          failureStage='preview';
          const shown=collection.queueComplete(record,record.index,{running:true});renderCollection();setDsStatus(`Added ${added} of ${count}`,(added/count));
          await shown;
        }
      });
      const secs=((performance.now()-t0)/1000).toFixed(1);
      d.status=`${res.cancelled?'Stopped':'Finished'}: added ${added} scene${added===1?'':'s'} in ${secs} s`;
    } catch(e) {
      failed=true;
      d.failure={name:e?.name??'Error',message:e?.message??String(e),stage:failureStage,index:cur?.index??0,seed:baseSeed+(cur?.index??0),resolution:[w,h],samples:run.samples,contextLost:stage.renderer.getContext().isContextLost(),stack:e?.stack??null};
      console.error('Dataset generation failed',d.failure,e);
      d.status=`Failed: ${d.failure.stage} · ${d.failure.name}: ${d.failure.message}. ${added} completed scenes retained.`;
    }
    finally {d.running=false;d.abort=null;collection.queueEnd({reason:failed?'failed':ac.signal.aborted?'cancelled':'done',error:d.failure});renderCollection();renderInspector();setDsStatus(d.status);}
  },
  cancel() {state.dataset.abort?.abort();collection.queueCancelling();setDsStatus('Stopping after the current scene…');updateDock();},
  async remove(name) {
    const d=state.dataset;if(d.running||generating||d.exporting)return;
    if(collectionStore.db)try{await collectionStore.remove(name);}catch(e){setDsStatus(`Delete failed: ${e.message}`);return;}
    const i=d.scenes.findIndex(s=>s.name===name);if(i<0)return;
    d.scenes.splice(i,1);d.zip=null;d.status=`Deleted ${name} and its paired targets.`;
    renderCollection();renderInspector();setDsStatus(d.status);
  },
  async download() {
    const d=state.dataset;if(d.running||d.exporting||!d.scenes.length)return;
    d.exporting=true;renderCollection();renderInspector();
    try {saveArchive(await collectionZip(d.scenes.slice(),readArchive),'open-med-tray-lite-collection.zip');}catch(e){d.status=`Download failed: ${e.message}`;setDsStatus(d.status);}
    finally{d.exporting=false;renderCollection();renderInspector();}
  },
  async saveToDisk() {
    const d=state.dataset;if(d.running||d.exporting||!d.scenes.length)return;
    d.exporting=true;renderCollection();renderInspector();
    let stream;
    try{
      const file=await showSaveFilePicker({suggestedName:'open-med-tray-lite-collection.zip',types:[{description:'Dataset ZIP',accept:{'application/zip':['.zip']}}]});
      stream=await file.createWritable();
      await collectionZip(d.scenes.slice(),readArchive,{write:chunk=>stream.write(chunk)});
      await stream.close();stream=null;d.status='Collection saved to disk.';setDsStatus(d.status);
    }catch(e){if(stream)await stream.abort().catch(()=>{});if(e.name!=='AbortError'){d.status=`Save failed: ${e.message}`;setDsStatus(d.status);}}
    finally{d.exporting=false;renderCollection();renderInspector();}
  },
  inspect(name) {if(state.mode!=='dataset')return false;closeSheetIfMobile();return sceneInspector.open(name);},
  closeInspector() {sceneInspector.close();},
  showLabels(v) {state.dataset.showLabels=v;$('sheet').classList.toggle('show-labels',v);}
};

function setDsStatus(text, frac) {
  const s = $('dsStatus'); if (s) s.textContent = text;
  const m = $('sheetStatus'); if (m) m.textContent = text;
  const p = $('dsProg'); if (p && frac !== undefined) p.style.width = `${Math.round(frac * 100)}%`;
  if (frac !== undefined) $('dockProg').style.width = `${Math.round(frac * 100)}%`;
  updateDock();
}

// Phone, Dataset: the dock carries the batch size and Generate & add while
// the sheet is collapsed; it steps aside for the expanded sheet (whose footer
// carries both), an open scene (until its close finishes), the introduction
// and the tour. A press that starts a batch arms Cancel only after a short
// delay, so a double tap cannot start and immediately stop the same batch.
// Scene builds block the main thread, so a second tap can be delivered
// seconds late: presses are timed by their pointerdown / keydown, and the
// second click of a double click never cancels.
const CANCEL_ARM_MS = 600;
let dockArmedAt = 0, dockArmTimer = 0, dockPressAt = 0;
function updateDock() {
  const dock = $('dsDock'); if (!dock || !stage) return;
  const d = state.dataset, busy = d.running || !!generating;
  const on = mobileQuery.matches && state.mode === 'dataset' && !introUp && !state.tour.playing && !$('inspector').classList.contains('open') && $('sceneInspector').hidden;
  $('app').classList.toggle('dock-on', on);
  dock.classList.toggle('running', busy);
  syncCountControls();
  const stopping = !!d.abort?.signal.aborted;
  const cancelReady = d.running && !stopping && performance.now() >= dockArmedAt;
  const go = $('dockGo');
  go.setAttribute('aria-disabled', String(busy ? !cancelReady : !!d.exporting));
  $('dockGoText').textContent = !busy ? 'Generate & add' : stopping ? 'Stopping…' : 'Cancel';
  go.title = busy ? 'Stop after the current scene; completed scenes are kept' : 'Render the scenes and append them to the collection';
  const step = busy ? (batchStep ? `Adding ${batchStep.n} of ${batchStep.count}` : 'Starting…') : '';
  if ($('dockState').textContent !== step) $('dockState').textContent = step;
  if (!busy) $('dockProg').style.width = '0%';
}
function dockAction(e) {
  const d = state.dataset, pressed = dockPressAt || e.timeStamp;
  dockPressAt = 0;
  if (d.running || generating) {
    if (d.running && !d.abort?.signal.aborted && e.detail <= 1 && pressed >= dockArmedAt) datasetActions.cancel();
    return;
  }
  if (d.exporting) return;
  dockArmedAt = pressed + CANCEL_ARM_MS;
  clearTimeout(dockArmTimer); dockArmTimer = setTimeout(updateDock, CANCEL_ARM_MS + 20);
  datasetActions.generate();
}

// ------------------------------------------------------------ tour
const wait = (ms) => new Promise((res) => {
  let left = ms, last = performance.now();
  const tick = () => {
    if (!state.tour.playing) return res();
    const now = performance.now();
    if (!state.tour.paused) left -= now - last;
    last = now;
    $('tourProg').style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - left / ms))})`;
    if (left <= 0) res(); else setTimeout(tick, 50);
  };
  tick();
});
const P = (id) => PRESETS.find((p) => p.id === id);
const TOUR = [
  { t: 'Pressed powder', n: 'grain, pores, breakouts · 0.14 mm score · P10 deboss', run: async () => { await setMode('specimen'); await applyPreset(P('p10')); await stage.specimenFrame(stage.pill, { macro: true }); }, hold: 1600 },
  { t: 'Shape is a parameter', n: 'same mesh, morphed vertex for vertex', run: () => applyPreset(P('inset')), hold: 2600 },
  { t: 'Faces and edges', n: 'hexagon · cross score on both faces', run: () => applyPreset(P('hex')), hold: 2400 },
  { t: 'Marks at any scale', n: 'crossed wordmark, conformal deboss', run: () => applyPreset(P('cross')), hold: 2400 },
  { t: 'Damage is geometry', n: 'CSG chips and a tilted, wavy fracture', run: () => applyPreset(P('damaged')), hold: 2800 },
  { t: 'Two shells, one instance', n: 'section plane · telescoping cap', run: () => applyPreset(P('cap22')), hold: 2600 },
  { t: 'Light passes through', n: 'Beer–Lambert path through the fill', run: () => applyPreset(P('amber')), hold: 2800 },
  { t: 'Into the tray', n: 'one moulded skin · seeded placement', run: () => setMode('tray'), hold: 3200 },
  { t: 'What the dataset sees', n: 'instance IDs from a frozen pinhole pass', run: () => setLabels('instance'), hold: 3000 },
  { t: 'Every scene is a new roll', n: 'container, cover, light, camera, contents', run: () => { setLabels('off'); trayActions.randomize(); }, hold: 3400 },
];
async function playTour() {
  handles?.cancel();
  if (state.dataset.running || generating) return;
  state.tour = { playing: true, paused: false, step: 0 };
  $('tourBtn').setAttribute('aria-pressed', 'true');
  $('tourCap').classList.add('on');
  $('readout').classList.add('hidden');
  updateFab();
  hideDims();
  for (let i = 0; i < TOUR.length && state.tour.playing; i++) {
    state.tour.step = i;
    const s = TOUR[i];
    $('tourTitle').textContent = s.t;
    $('tourNote').textContent = `${String(i + 1).padStart(2, '0')}/${TOUR.length} · ${s.n}`;
    $('tourProg').style.transform = 'scaleX(0)';
    while (state.tour.paused && state.tour.playing) await new Promise((r) => setTimeout(r, 100));
    await s.run();
    await wait(s.hold);
  }
  stopTour();
}
function stopTour() {
  if (!state.tour.playing) return;
  state.tour.playing = false; state.tour.paused = false;
  $('tourBtn').setAttribute('aria-pressed', 'false');
  $('tourCap').classList.remove('on');
  $('readout').classList.remove('hidden');
  $('tourPause').textContent = 'Pause';
  updateFab();
  scheduleDims();
}
function pauseTour(force) {
  if (!state.tour.playing) return;
  state.tour.paused = force === true ? true : !state.tour.paused;
  $('tourPause').textContent = state.tour.paused ? 'Resume' : 'Pause';
}

// ------------------------------------------------------------ mobile sheet
// Two explicit states (collapsed peek / expanded), toggled only by the user
// (handle or head drag and tap, tab tap, selection, Esc, canvas tap); heights
// never follow content. `force` also applies off the phone layout (reset).
let sheetDrag = null;
function setSheet(open, force = false) {
  const insp = $('inspector');
  if ((!mobileQuery.matches && !force) || insp.classList.contains('open') === open) return;
  insp.classList.toggle('open', open);
  $('sheetHandle').setAttribute('aria-expanded', String(open));
  $('sheetHandle').setAttribute('aria-label', open ? 'Collapse controls' : 'Expand controls');
  updateFab();
  layout();
}
function openSheetIfMobile() { setSheet(true); }
function closeSheetIfMobile() { setSheet(false); }

// ------------------------------------------------------------ resample
// The scene's primary action: a whole new pill (specimen) or tray scene from
// the procedural priors. On phones it floats above the collapsed sheet; the
// panel footer carries the same action on desktop and in the expanded sheet.
const SAMPLE_DAMAGE = .12; // chance of chips or a fracture, as for tray instances
function samplePill() {
  const key = (s) => JSON.stringify([s.kind, s.outline ?? s.shape, s.length, s.width, s.thickness, s.colorName ?? s.capColorName]);
  const prev = key(state.spec);
  let spec;
  for (let i = 0; i < 4; i++) {
    const rng = new RNG(Math.floor(Math.random() * 1e9) + 1);
    spec = validate(instanceVariant(randomProduct(rng, 0, { split: 'preview' }), rng, SAMPLE_DAMAGE));
    if (key(spec) !== prev) break;
  }
  return spec;
}
let resampling = null;
function resample() {
  if (state.mode === 'dataset' || state.dataset.running) return Promise.resolve(false);
  stopTour();
  handles?.cancel();
  if (state.mode === 'tray') { trayActions.randomize(); return Promise.resolve(true); }
  // A specimen build is synchronous and then animates; further taps wait for it.
  if (resampling) return resampling;
  const revision = specimenRevision;
  $('app').classList.add('resampling');
  // Let the pressed state paint before the geometry is built.
  resampling = new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))).then(() => {
    if (state.mode !== 'specimen' || revision !== specimenRevision) return false;
    const next = samplePill(), sameKind = next.kind === state.spec.kind;
    state.spec = next; state.presetId = null; state.sampled = true;
    hideDims();
    const done = stage.setSpecimen(clone(next), { transition: sameKind ? 'auto' : 'section' });
    renderInspector();
    updateCaption();
    return done.then(() => { scheduleDims(); return true; });
  }).catch((e) => { console.error('resample', e); return false; })
    .finally(() => { resampling = null; $('app').classList.remove('resampling'); });
  return resampling;
}
// Shown on phones in Specimen and Tray while nothing else claims the bottom
// of the render: not in Dataset, pill inspection, the tour, the introduction
// or with the sheet expanded (its footer then carries Resample).
function updateFab() {
  const fab = $('fab'); if (!fab || !stage) return;
  const on = mobileQuery.matches && (state.mode === 'specimen' || state.mode === 'tray') && !state.selected && !state.tour.playing && !introUp && !state.dataset.running && !$('inspector').classList.contains('open');
  // Off, the card is visibility:hidden (display:none on desktop), which also
  // takes it out of focus order and the accessibility tree.
  $('app').classList.toggle('fab-on', on);
  const tray = state.mode === 'tray';
  $('fabResample').setAttribute('aria-label', tray ? 'Resample tray scene' : 'Resample pill');
  $('fabResample').title = RESAMPLE_HINT[tray ? 'tray' : 'pill'];
  // The capture camera is fixed, so there is no tray view to reset.
  $('fabReset').hidden = tray;
  updateDock();
}
// The card and readout ride up with the sheet while it is dragged from the peek.
function liftChrome(px) {
  const app = $('app');
  app.classList.toggle('sheet-dragging', px !== null);
  if (px === null) { app.style.removeProperty('--lift'); app.style.removeProperty('--lift-k'); return; }
  app.style.setProperty('--lift', px + 'px');
  app.style.setProperty('--lift-k', Math.min(1, px / 56).toFixed(3));
}

// ------------------------------------------------------------ input
let hoverPill = null, down = null;
function bindUI() {
  for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => { stopTour(); setMode(b.dataset.mode); });
  $('tourBtn').addEventListener('click', () => (state.tour.playing ? stopTour() : playTour()));
  $('tourPause').addEventListener('click', () => pauseTour());
  $('tourStop').addEventListener('click', () => stopTour());
  $('resetBtn').addEventListener('click', resetView);
  $('brandBtn').addEventListener('click', () => { stopTour(); handles?.cancel(); introUp = true; updateFab(); intro.show({ from: $('brandBtn'), returnFocus: $('brandBtn') }); });
  const sheetOpen = () => $('inspector').classList.contains('open');
  $('sheetHandle').addEventListener('click', () => setSheet(!sheetOpen()));
  $('sheetHandle').addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setSheet(e.key === 'ArrowUp'); } });
  // Grab area: the handle and the whole tab strip (69 px across the full
  // width). Vertical drags move the sheet; taps keep their meaning (toggle /
  // pick a tab) and horizontal movement is left alone.
  sheetDrag = bindSheetDrag({
    panel: $('inspector'), surfaces: [$('sheetHandle'), $('inspTabs')],
    enabled: () => mobileQuery.matches, isOpen: sheetOpen, setOpen: (open) => setSheet(open),
    range: () => sheetGeom.h - sheetGeom.peek, onLift: liftChrome,
  });
  window.__atelier.sheetDrag = sheetDrag;
  $('fabResample').addEventListener('click', () => resample());
  $('fabReset').addEventListener('click', resetView);
  $('dockGo').addEventListener('pointerdown', (e) => { dockPressAt = e.timeStamp; });
  $('dockGo').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') dockPressAt = e.timeStamp; });
  $('dockGo').addEventListener('click', dockAction);
  $('dockMinus').addEventListener('click', () => setDatasetCount(state.dataset.count - 1));
  $('dockPlus').addEventListener('click', () => setDatasetCount(state.dataset.count + 1));
  for (const [type, fn] of Object.entries(countInputHandlers)) $('dockCount').addEventListener(type.slice(2), fn);
  updateFab();
  $('inspTabs').addEventListener('keydown', (e) => { const id = tabArrow($('inspTabs'), e); if (id) setTab(id); });
  const modes = document.querySelector('.modes');
  modes.addEventListener('keydown', (e) => { const m = tabArrow(modes, e, 'data-mode'); if (m) { stopTour(); setMode(m); } });
  initDataset();
  $('sheetOpt').append(toggle({ label: 'Label previews', get: () => state.dataset.showLabels, set: (v) => datasetActions.showLabels(v) }));
  const canvas = $('gl');
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY, performance.now()]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > 6) return;
    if (state.mode !== 'tray') { closeSheetIfMobile(); return; }
    const pill = stage.pick(e.clientX, e.clientY);
    if (pill) { stopTour(); select(pill); }
    else if (state.selected) deselect();
    else closeSheetIfMobile();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'tray' || e.pointerType !== 'mouse' || down) return;
    const p = stage.pick(e.clientX, e.clientY);
    if (p !== hoverPill) { hoverPill = p; canvas.style.cursor = p ? 'pointer' : 'default'; drawOverlay(); }
  });
  canvas.addEventListener('pointerleave', () => { if (hoverPill) { hoverPill = null; drawOverlay(); } });
  addEventListener('keydown', (e) => {
    if (intro.open) return;
    if (sceneInspector?.handleKey(e)) return;
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    const k = e.key.toLowerCase();
    if (k === '1') setMode('specimen');
    else if (k === '2') setMode('tray');
    else if (k === '3') setMode('dataset');
    else if (k === 't') state.tour.playing ? stopTour() : playTour();
    else if (k === ' ' && state.tour.playing) { e.preventDefault(); pauseTour(); }
    else if (k === 'escape') { if (state.tour.playing) stopTour(); else if (state.selected) deselect(); else closeSheetIfMobile(); }
    else if (k === 'r' && !e.metaKey && !e.ctrlKey && (state.mode === 'specimen' || state.mode === 'tray')) resample();
    else if (k === 'l' && state.mode === 'tray') { const order = ['off', 'instance', 'semantic']; setLabels(order[(order.indexOf(state.labels) + 1) % 3]); renderInspector(); }
    else if ((k === ']' || k === '[') && state.mode === 'specimen') { const i = Math.max(0, PRESETS.findIndex((p) => p.id === state.presetId)); applyPreset(PRESETS[(i + (k === ']' ? 1 : PRESETS.length - 1)) % PRESETS.length]); }
    else if (k === '0') resetView();
  });
}
function resetView() {
  if (state.mode === 'specimen') stage.specimenFrame(stage.pill);
  else if (state.selected) deselect();
  else stage.setTrayView('capture');
}

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

function namedView(v) {
  stage.pipe.dof.enabled = false;
  const p = stage.pill, d = p.describe(), size = Math.max(d.L, d.W);
  const t = new THREE.Vector3(0, p.restHeight, 0);
  const dirs = { hero: null, top: [0.001, 1, 0.02], macro: [-.5, .28, .8], side: [0, .06, 1], low: [-.7, .35, .6] };
  if (!dirs[v]) { stage.specimenFrame(p, { instant: true }); stage.pipe.reset(); stage.wake(); return; }
  const dist = v === 'macro' ? size * 1.5 : v === 'top' ? size * 3.6 : size * 3.4;
  stage.controls.target.copy(v === 'macro' ? new THREE.Vector3(size * .12, p.restHeight * 1.8, 0) : t);
  stage.studioCam.position.copy(stage.controls.target).addScaledVector(new THREE.Vector3(...dirs[v]).normalize(), dist);
  stage.controls.update();
  if(v !== 'macro') stage.specimenFrame(p,{instant:true,keepDirection:true});
  stage.pipe.dof.focus = stage.studioCam.position.distanceTo(stage.controls.target);
  stage.pipe.reset(); stage.wake();
}
window.__atelier.presetIds = PRESETS.map((p) => p.id);
// QA helper: floor/background mask (instance 0 and not a pill) of the live viewport.
function floorMask() {
  const cam = stage.camera, p = stage.pipe;
  const l = renderLabels(stage.renderer, stage.scene, cam, p.width, p.height, { keepView: true });
  p.applyBaseShift(cam);
  let out = '';
  for (let i = 0; i < l.semantic.length; i++) out += l.semantic[i] === 0 ? '1' : '0';
  return { w: p.width, h: p.height, bits: out };
}
// QA helper: FNV hash of the capture-camera label pass (determinism checks).
function labelsHash() {
  const cap = stage.tray.captureCamera(2);
  const l = renderLabels(stage.renderer, stage.trayWorld, cap, 512, 256);
  let h = 2166136261;
  for (let i = 0; i < l.raw.length; i++) { h ^= l.raw[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + ':' + l.boxes.length;
}
window.__atelier.api = { intro, get inspector() { return sceneInspector; }, get collection() { return collection; }, labelsHash, floorMask, view: namedView, applyPresetById: (id) => applyPreset(PRESETS.find((p) => p.id === id)), setMode, applyPreset, setLabels, trayActions, resample, updateFab, datasetActions, select, deselect, playTour, stopTour, pauseTour, refreshLabels, setTab, setSheet, tabState, state, SEMANTIC };
boot().catch((e) => { console.error(e); intro.abort(); introHold = false; document.getElementById('boot').innerHTML = `<span style="font-size:18px">WebGL 2 is required (${e.message})</span>`; });
