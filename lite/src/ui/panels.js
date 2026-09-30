import {CAMERA_DEFAULTS} from '../scene/camera-intrinsics.js';
import {STRESS_SCENARIOS,stressConfig} from '../scene/stress.js';
import {randomConfig} from '../scene/trayscene.js';
// Inspector tab content: pill editor tabs (shared by the specimen and a
// selected tray product), preset list, instance facts, tray scene tabs and
// dataset tabs. Each builder returns DOM nodes for one tab; the frame around
// them (head, tab strip, footer) lives in main.js and never changes size.
import { el, section, advanced, slider, seg, swatches, toggle, text, kv } from './controls.js';
import { paramLimits } from './limits.js';
import { capsuleDims } from '../geo/shells.js';
import { FAMILY_GLYPHS, SOFTGEL_SHAPE_GLYPHS, SCORE_GLYPHS, IMPRINT_GLYPHS, BRAND_GLYPHS, TRAY_GLYPHS, outlineGlyph, sidesGlyph, finishGlyph, opticsGlyph, worktopChip, formCue, lensCue } from './cues.js';
import { PALETTE, PRESETS, RANGES, BASE, deepMerge, familyOf, SOFTGEL_STATES } from '../scene/catalog.js';
import { CONTAINER_COLORS, TRAY_STYLES } from '../geo/tray.js';
import { SURFACES } from '../render/surfaces.js';
import { LIGHTING } from '../render/lighting.js';
import { IMPRINT_LAYOUTS, EMBLEMS } from '../geo/relief.js';
import { SEMANTIC } from '../scene/trayscene.js';

const TABLET_SWATCHES = Object.fromEntries(['white', 'off_white', 'cream', 'beige', 'pale_yellow', 'yellow', 'peach', 'orange', 'salmon', 'pink', 'red', 'brown', 'pale_blue', 'blue', 'pale_green', 'green', 'lilac', 'gray'].map((k) => [k, PALETTE[k]]));
const CAPSULE_SWATCHES = Object.fromEntries(['white', 'cream', 'pale_yellow', 'yellow', 'orange', 'red', 'burgundy', 'brown_red', 'pink', 'lilac', 'violet', 'pale_blue', 'blue', 'teal', 'pale_green', 'green', 'gray', 'near_black'].map((k) => [k, PALETTE[k]]));
const SOFTGEL_SWATCHES = Object.fromEntries(['clear_straw', 'amber', 'red', 'pink', 'brown', 'brown_red', 'green', 'pale_yellow', 'off_white', 'orange', 'blue'].map((k) => [k, PALETTE[k]]));

// Miniature shape preview of a spec (preset rows, panel head). Plan view in a
// 36 × 24 box: outline, colour(s), score layout, a soft sheen for volume.
let iconSeq = 0;
export function presetIcon(spec) {
  const css = (c) => `rgb(${c.map((v) => Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255)).join(',')})`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 36 24');
  const add = (tag, a, parent = svg) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); parent.append(e); return e; };
  const stroke = 'rgba(31,30,28,.4)', ink = 'rgba(31,30,28,.45)';
  const sheenId = 'ps' + (++iconSeq);
  const defs = add('defs', {});
  const grad = add('radialGradient', { id: sheenId, cx: '32%', cy: '28%', r: '75%' }, defs);
  add('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.55' }, grad);
  add('stop', { offset: '.55', 'stop-color': '#fff', 'stop-opacity': '0' }, grad);
  add('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.18' }, grad);
  const sheen = `url(#${sheenId})`;
  const cx = 18, cy = 12;
  if (spec.kind === 'capsule') {
    const f = Math.min(.7, Math.max(.35, spec.capFraction ?? .5));
    const w = Math.min(32, Math.max(22, spec.length * 1.4)), h = Math.min(13, Math.max(8, spec.width * 1.6));
    const x0 = cx - w / 2, xc = x0 + w * (1 - f);
    add('rect', { x: x0, y: cy - h / 2, width: w, height: h, rx: h / 2, fill: css(spec.bodyColor), stroke });
    add('path', { d: `M${xc} ${cy - h / 2}h${x0 + w - h / 2 - xc}a${h / 2} ${h / 2} 0 0 1 0 ${h}h${-(x0 + w - h / 2 - xc)}z`, fill: css(spec.capColor), stroke });
    add('rect', { x: x0, y: cy - h / 2, width: w, height: h, rx: h / 2, fill: sheen });
  } else if (spec.kind === 'softgel') {
    const rx = spec.shape === 'round' ? 9 : spec.shape === 'oblong' ? 15 : 13, ry = spec.shape === 'round' ? 9 : spec.shape === 'oblong' ? 6 : 8;
    const clear = spec.opacity === 'transparent' || spec.opacity === 'translucent';
    const c = css(spec.color);
    const shape = spec.shape === 'oblong' ? add('rect', { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2, rx: ry, fill: c, stroke, 'fill-opacity': clear ? .78 : 1 }) : add('ellipse', { cx, cy, rx, ry, fill: c, stroke, 'fill-opacity': clear ? .78 : 1 });
    if (spec.twoTone) add('path', { d: `M${cx - rx} ${cy}a${rx} ${ry} 0 0 0 ${rx * 2} 0z`, fill: css(spec.secondColor) });
    if (clear) add('ellipse', { cx, cy, rx: rx * .62, ry: ry * .55, fill: c, 'fill-opacity': .5 });
    const sh = shape.cloneNode(); sh.setAttribute('fill', sheen); sh.removeAttribute('stroke'); sh.removeAttribute('fill-opacity'); svg.append(sh);
    add('ellipse', { cx: cx - rx * .35, cy: cy - ry * .45, rx: rx * .3, ry: ry * .18, fill: 'rgba(255,255,255,.75)' });
  } else {
    const c = css(spec.color), o = spec.outline;
    let shape;
    if (o === 'round') shape = add('circle', { cx, cy, r: 10, fill: c, stroke });
    else if (o === 'ring') shape = add('path', { d: `M${cx + 10} ${cy}a10 10 0 1 0-20 0a10 10 0 1 0 20 0M${cx + 3.6} ${cy}a3.6 3.6 0 1 0-7.2 0a3.6 3.6 0 1 0 7.2 0`, fill: c, stroke, 'fill-rule': 'evenodd' });
    else if (o === 'oval') shape = add('ellipse', { cx, cy, rx: 15, ry: 8.5, fill: c, stroke });
    else if (o === 'caplet' || o === 'oblong') shape = add('rect', { x: 3, y: 4.5, width: 30, height: 15, rx: o === 'caplet' ? 7.5 : 4, fill: c, stroke });
    else if (o === 'polygon') {
      const n = spec.sides, pts = [];
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n + (n % 2 ? 0 : Math.PI / n); pts.push(`${cx + 10.5 * Math.cos(a)},${cy + .5 + 10.5 * Math.sin(a)}`); }
      shape = add('polygon', { points: pts.join(' '), fill: c, stroke, 'stroke-linejoin': 'round' });
    } else if (o === 'diamond') shape = add('polygon', { points: `${cx},2 ${cx + 14},${cy} ${cx},22 ${cx - 14},${cy}`, fill: c, stroke, 'stroke-linejoin': 'round' });
    else if (o === 'lobed') shape = add('path', { d: `M${cx} ${cy - 10}c4.5 0 6 2.5 8.5 4s3 6.5-1.5 9-5.5-1-7-1-2.5 3.5-7 1-4-7.5-1.5-9 4-4 8.5-4z`, fill: c, stroke });
    else shape = add('path', { d: `M${cx} 21C8.5 14.5 7 5.5 12.5 4.5c3-.6 5.5 2.2 5.5 3.3 0-1.1 2.5-3.9 5.5-3.3 5.5 1 4 10-5.5 16.5z`, fill: c, stroke });
    if (spec.score?.count && o !== 'ring' && o !== 'heart') {
      const L = spec.score.layout, y0 = cy - 8.5, y1 = cy + 8.5;
      if (L === 'cross') { add('line', { x1: cx, y1: y0, x2: cx, y2: y1, stroke: ink }); add('line', { x1: cx - 8.5, y1: cy, x2: cx + 8.5, y2: cy, stroke: ink }); }
      else if (L === 'parallel') { add('line', { x1: cx - 3.5, y1: y0 + 1.5, x2: cx - 3.5, y2: y1 - 1.5, stroke: ink }); add('line', { x1: cx + 3.5, y1: y0 + 1.5, x2: cx + 3.5, y2: y1 - 1.5, stroke: ink }); }
      else add('line', { x1: cx, y1: y0, x2: cx, y2: y1, stroke: ink });
    }
    if (spec.damage?.fracture) add('path', { d: `M${cx - 1} ${cy - 9.5}l1.6 4.5-2.4 3.2 2 3.6-1.4 6.8`, fill: 'none', stroke: 'rgba(31,30,28,.5)', 'stroke-width': '1.2', 'stroke-linejoin': 'round' });
    if (shape) { const sh = shape.cloneNode(); sh.setAttribute('fill', sheen); sh.removeAttribute('stroke'); svg.append(sh); }
  }
  return svg;
}

// Preset list: one aligned row per preset under family sub-headers.
export function presetList(activeId, onPick) {
  const list = el('div', { class: 'presets', role: 'listbox', 'aria-label': 'Presets' });
  const groups = [['tablet', 'Tablets'], ['capsule', 'Capsules'], ['softgel', 'Softgels']];
  const rows = [];
  for (const [kind, title] of groups) {
    list.append(el('div', { class: 'preset-group' }, el('span', { text: title }), el('span', { class: 'n', text: String(PRESETS.filter((x) => x.spec.kind === kind).length) })));
    for (const p of PRESETS.filter((x) => x.spec.kind === kind)) {
      const b = el('button', { class: 'preset', type: 'button', role: 'option', 'aria-selected': String(p.id === activeId), 'aria-pressed': String(p.id === activeId), 'data-preset': p.id, 'data-k': 'preset:' + p.id, title: `${p.name} — ${p.note}` },
        el('span', { class: 'ico' }, presetIcon(p.spec)), el('span', { class: 'pn', text: p.name }), el('span', { class: 'pd', text: p.note }));
      b.addEventListener('click', () => { for (const o of rows) { o.setAttribute('aria-pressed', String(o === b)); o.setAttribute('aria-selected', String(o === b)); } onPick(p); });
      rows.push(b); list.append(b);
    }
  }
  return list;
}

// Pill editor tabs. `spec` is mutated through `update(mutator, final, hint)`.
export function pillTabs(getSpec, update, { onFamily } = {}) {
  const sets = (path) => (v, final = true) => update((x) => { setPath(x, path, v); }, final);
  const get = (path) => () => getPath(getSpec(), path);
  const form = () => {
    const s = getSpec(), R = RANGES[s.kind], Lm = paramLimits(s);
    const out = [section('Family', [
      seg({ options: [['tablet', 'Tablet', FAMILY_GLYPHS.tablet], ['capsule', 'Capsule', FAMILY_GLYPHS.capsule], ['softgel', 'Softgel', FAMILY_GLYPHS.softgel]], get: () => getSpec().kind, set: (k) => onFamily?.(k) }),
      s.kind === 'tablet' ? seg({ label: 'Outline', stack: true, options: [['round', 'Round'], ['oval', 'Oval'], ['caplet', 'Caplet'], ['oblong', 'Oblong'], ['polygon', 'Polygon'], ['diamond', 'Diamond'], ['heart', 'Heart'], ['ring', 'Ring'], ['lobed', 'Lobed']].map(([k, t]) => [k, t, outlineGlyph(k, s)]), get: get('outline'), set: (v) => update((x) => { x.outline = v; delete x.sourceFamily; if (v === 'round') x.width = x.length; if (['oval', 'caplet', 'oblong'].includes(v) && x.width >= x.length * .9) { x.length = Math.max(x.length, 12); x.width = x.length * .56; } if (v === 'polygon' || v === 'diamond' || v === 'heart') { x.length = Math.min(Math.max(x.length, 8), 12); x.width = x.length * (v === 'diamond' ? .8 : .94); } if (v === 'heart') x.score.count = 0; }, true, 'morph') }) : null,
      s.kind === 'tablet' && s.outline === 'polygon' ? seg({ label: 'Sides', stack: true, options: [3, 4, 5, 6, 7, 8].map((k) => [k, String(k), sidesGlyph(k)]), get: get('sides'), set: (v) => update((x) => { x.sides = v; }, true, 'morph') }) : null,
      s.kind === 'softgel' ? seg({ label: 'Shape', options: [['round', 'Round', SOFTGEL_SHAPE_GLYPHS.round], ['oval', 'Oval', SOFTGEL_SHAPE_GLYPHS.oval], ['oblong', 'Oblong', SOFTGEL_SHAPE_GLYPHS.oblong]], get: get('shape'), set: (v) => update((x) => { x.shape = v; if (v === 'round') { x.length = Math.min(x.length, 9.5); x.width = x.length; x.thickness = x.width * .93; } else if (v === 'oval') { x.length = Math.max(x.length, 11); x.width = x.length * .64; x.thickness = x.width * .86; } else { x.length = Math.max(x.length, 15); x.width = x.length * .4; x.thickness = x.width * .92; x.straight = .46; } }, true, 'morph') }) : null,
    ])];
    if (s.kind === 'tablet') {
      const lockRound = ['round', 'ring'].includes(s.outline);
      out.push(section('Dimensions', [
        formCue(getSpec),
        slider({ hl: 'h-length', label: lockRound ? 'Diameter' : 'Length', min: Lm.length[0], max: Lm.length[1], step: .1, digits: 1, get: get('length'), set: (v, f) => update((x) => { x.length = v; if (lockRound) x.width = v; }, f) }),
        lockRound ? null : slider({ hl: 'h-width', label: 'Width', min: Lm.width[0], max: Lm.width[1], step: .1, digits: 1, get: get('width'), set: sets('width') }),
        slider({ hl: 'h-thickness', label: 'Thickness', min: Lm.thickness[0], max: Lm.thickness[1], step: .05, digits: 2, get: get('thickness'), set: sets('thickness') }),
      ]));
      if (s.outline !== 'ring') out.push(section('Profile', [
        slider({ hl: 'h-crown', label: 'Crown height', min: 0, max: Lm.crownHeight[1], step: .01, get: get('crownHeight'), set: sets('crownHeight') }),
        slider({ hl: 'h-land', label: 'Flat shoulder land', min: 0, max: Lm.rimWidth[1], step: .01, get: get('rimWidth'), set: sets('rimWidth') }),
        advanced('Junction and edge', [
          slider({ hl: 'h-crown', label: 'Crown curve', min: 1, max: 4, step: .05, unit: '', get: get('crownCurve'), set: sets('crownCurve') }),
          slider({ hl: 'h-land', label: 'Junction blend', min: 0, max: R.crownBlend[1], step: .005, digits: 3, get: get('crownBlend'), set: sets('crownBlend') }),
          slider({ hl: 'h-edge', label: 'Edge radius', min: R.edgeRadius[0], max: R.edgeRadius[1], step: .01, get: get('edgeRadius'), set: sets('edgeRadius') }),
        ]),
      ]));
    } else if (s.kind === 'capsule') {
      out.push(section('Dimensions', [
        formCue(getSpec),
        slider({ hl: 'h-length', label: 'Closed length', min: R.length[0], max: R.length[1], step: .1, digits: 1, get: get('length'), set: sets('length') }),
        slider({ hl: 'h-width', label: 'Body diameter', min: Lm.width[0], max: Lm.width[1], step: .05, get: get('width'), set: sets('width') }),
        slider({ hl: 'h-cap', label: 'Cap fraction', min: Lm.capFraction[0], max: Lm.capFraction[1], step: .005, unit: '', digits: 3, get: () => capsuleDims(getSpec()).capFrac, set: sets('capFraction') }),
      ]));
      out.push(section('Shell', [
        slider({ hl: 'h-wall', label: 'Cap wall step', min: R.capWall[0], max: R.capWall[1], step: .005, digits: 3, get: get('capWall'), set: sets('capWall') }),
      ]));
    } else {
      out.push(section('Dimensions', [
        formCue(getSpec),
        slider({ hl: 'h-length', label: 'Length', min: Lm.length[0], max: Lm.length[1], step: .1, digits: 1, get: get('length'), set: sets('length') }),
        slider({ hl: 'h-width', label: 'Width', min: Lm.width[0], max: Lm.width[1], step: .1, digits: 1, get: get('width'), set: sets('width') }),
        slider({ hl: 'h-thickness', label: 'Height', min: Lm.thickness[0], max: Lm.thickness[1], step: .1, digits: 1, get: get('thickness'), set: sets('thickness') }),
        s.shape === 'oblong' ? slider({ hl: 'h-straight', label: 'Straight section', min: R.straight[0], max: R.straight[1], step: .01, unit: '', get: get('straight'), set: sets('straight') }) : null,
      ]));
    }
    return out;
  };
  const surface = () => {
    const s = getSpec(), R = RANGES[s.kind];
    if (s.kind === 'tablet') return [
      section('Material', [
        seg({ label: 'Finish', stack: true, options: [['chalky', 'Uncoated'], ['matte_film', 'Matte film'], ['satin_film', 'Satin film']].map(([k, t]) => [k, t, finishGlyph(k, s.color)]), get: get('finish'), set: (v) => update((x) => { x.finish = v; }, true) }),
        swatches({ label: 'Colour', colors: TABLET_SWATCHES, get: get('colorName'), set: (v) => update((x) => { x.colorName = v; x.color = PALETTE[v]; }, true, 'morph') }),
      ]),
      section('Grain', [
        slider({ label: 'Grain relief', min: 0, max: 2, step: .01, unit: '×', get: get('texture'), set: sets('texture') }),
        slider({ label: 'Grain size', min: .5, max: 2, step: .01, unit: '×', get: get('grainScale'), set: sets('grainScale') }),
        advanced('Powder, pores and flecks', [
          slider({ label: 'Powder patches', min: 0, max: 1.5, step: .01, unit: '', get: get('powder'), set: sets('powder') }),
          slider({ label: 'Pores', min: 0, max: .25, step: .005, unit: '', digits: 3, get: () => getSpec().pores ?? (getSpec().finish === 'chalky' ? .08 : .015), set: sets('pores') }),
          slider({ label: 'Press breakouts', min: 0, max: 2, step: .05, unit: '×', get: get('pressDefects'), set: sets('pressDefects') }),
          slider({ label: 'Breakout density', min: 0, max: .15, step: .005, unit: '/mm²', digits: 3, get: get('breakoutDensity'), set: sets('breakoutDensity') }),
          slider({ label: 'Breakout size', min: .05, max: .45, step: .01, unit: 'mm', get: get('breakoutSize'), set: sets('breakoutSize') }),
          slider({ label: 'Surface wear', min: 0, max: 1, step: .01, unit: '', get: get('wear'), set: sets('wear') }),
          slider({ label: 'Flecks', min: 0, max: 1, step: .01, unit: '', get: get('speckles'), set: sets('speckles') }),
        ]),
      ]),
    ];
    if (s.kind === 'capsule') return [
      section('Colours', [
        swatches({ label: 'Cap', colors: CAPSULE_SWATCHES, get: get('capColorName'), set: (v) => update((x) => { x.capColorName = v; x.capColor = PALETTE[v]; }, true, 'morph') }),
        swatches({ label: 'Body', colors: CAPSULE_SWATCHES, get: get('bodyColorName'), set: (v) => update((x) => { x.bodyColorName = v; x.bodyColor = PALETTE[v]; }, true, 'morph') }),
      ]),
      section('Gelatin', [
        slider({ label: 'Surface scuffs', min: 0, max: 2, step: .01, unit: '×', get: get('scuffs'), set: sets('scuffs') }),
      ]),
    ];
    return [
      section('Shell optics', [
        seg({ label: 'Shell', options: [['transparent', 'Transparent'], ['translucent', 'Translucent'], ['milky', 'Milky'], ['opaque', 'Opaque']].map(([k, t]) => [k, t, opticsGlyph(k, s.color)]), get: get('opacity'), set: (v) => update((x) => { x.opacity = v; x.transmission = SOFTGEL_STATES[v]; if (v !== 'opaque') x.twoTone = false; if (v !== 'opaque' && x.density < 20) x.density = 120; }, true, 'morph') }),
        swatches({ label: 'Fill / shell colour', colors: SOFTGEL_SWATCHES, get: get('colorName'), set: (v) => update((x) => { x.colorName = v; x.color = PALETTE[v]; }, true, 'morph') }),
        slider({ label: 'Optical density', min: 0, max: 260, step: 1, unit: '', digits: 0, ref: 150, get: get('density'), set: sets('density') }),
        slider({ label: 'Gloss roughness', min: R.roughness[0], max: R.roughness[1], step: .005, unit: '', digits: 3, get: get('roughness'), set: sets('roughness') }),
        toggle({ label: 'Two-tone opaque halves', get: () => !!getSpec().twoTone, set: (v) => update((x) => { x.twoTone = v; if (v) { x.opacity = 'opaque'; x.transmission = 0; } }, true) }),
      ]),
    ];
  };
  const marks = () => {
    const s = getSpec(), R = RANGES[s.kind];
    if (s.kind === 'tablet') {
      const im = s.imprint || {};
      const out = [];
      if (!['heart', 'ring'].includes(s.outline)) out.push(section('Score', [
        seg({ stack: true, options: [[0, 'None'], ['single', 'Single'], ['cross', 'Cross'], ['parallel', 'Parallel']].map(([k, t]) => [k, t, SCORE_GLYPHS[k]]), get: () => (getSpec().score.count ? getSpec().score.layout : 0), set: (v) => update((x) => { if (!v) x.score.count = 0; else { x.score.count = v === 'single' ? 1 : 2; x.score.layout = v; } }, true) }),
        slider({ label: 'Groove width', min: R.scoreWidth[0], max: R.scoreWidth[1], step: .01, get: get('score.width'), set: sets('score.width') }),
        slider({ label: 'Groove depth', min: R.scoreDepth[0], max: R.scoreDepth[1], step: .005, digits: 3, get: get('score.depth'), set: sets('score.depth') }),
        advanced('Reach and faces', [
          slider({ label: 'Reach', min: R.scoreReach[0], max: 1, step: .01, unit: '', fmt: (v) => v >= .999 ? 'edge to edge' : `${Math.round(v * 100)} %`, get: get('score.reach'), set: sets('score.reach') }),
          toggle({ label: 'Score both faces', get: () => getSpec().score.faces === 'both', set: (v) => update((x) => { x.score.faces = v ? 'both' : 'top'; }, true) }),
        ]),
      ]));
      else out.push(section('Score', [el('p', { class: 'hint', text: 'Heart and ring outlines are not scored.' })]));
      if (s.outline !== 'ring') out.push(section('Imprint', [
        seg({ options: IMPRINT_LAYOUTS.map((k) => [k, { none: 'None', text: 'Text', stacked: 'Stacked', cross: 'Cross', boxed: 'Boxed', symbol_code: 'Symbol + code', emblem: 'Emblem' }[k], IMPRINT_GLYPHS[k]]), get: () => getSpec().imprint?.layout ?? 'none', set: (v) => update((x) => { x.imprint = { ...BASE.tablet.imprint, ...(x.imprint || {}), layout: v }; if (v === 'cross' && (x.imprint.text.length < 3 || x.imprint.text.length % 2 === 0)) x.imprint.text = 'ATLAS'; if (v === 'stacked' && !x.imprint.text.includes('/')) x.imprint.text = 'AB/125'; if (v === 'cross' || v === 'emblem') { x.imprint.offsetX = 0; x.imprint.rotation = 0; } }, true) }),
        im.layout && im.layout !== 'none' ? el('div', { class: 'grp' },
          im.layout !== 'emblem' ? text({ maxLength: 9, label: 'Text', get: () => getSpec().imprint.text, set: (v) => update((x) => { x.imprint.text = v.toUpperCase().slice(0, 9) || 'P'; }, true) }) : null,
          seg({ label: 'Typeface', cls: 'tf', options: [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']], get: get('imprint.font'), set: (v) => update((x) => { x.imprint.font = v; }, true) }),
          im.layout === 'symbol_code' || im.layout === 'emblem' ? seg({ label: 'Symbol', options: EMBLEMS.map((e) => [e, e[0].toUpperCase() + e.slice(1)]), get: get('imprint.symbol'), set: (v) => update((x) => { x.imprint.symbol = v; }, true) }) : null,
          slider({ label: 'Size', min: 1.5, max: 9, step: .1, digits: 1, get: get('imprint.span'), set: sets('imprint.span') }),
          slider({ label: 'Deboss depth', min: .03, max: .2, step: .005, digits: 3, get: get('imprint.depth'), set: sets('imprint.depth') }),
          advanced('Placement and wear', [
            slider({ label: 'Offset', min: -4, max: 4, step: .05, get: get('imprint.offsetX'), set: sets('imprint.offsetX') }),
            slider({ label: 'Rotation', min: -180, max: 180, step: 1, unit: '°', digits: 0, get: get('imprint.rotation'), set: sets('imprint.rotation') }),
            slider({ label: 'Die wear', min: 0, max: 1, step: .01, unit: '', get: get('imprint.wear'), set: sets('imprint.wear') }),
          ])) : null,
      ]));
      if (s.outline !== 'ring') out.push(section('Damage', [
        slider({ label: 'Edge chips', min: 0, max: 3, step: 1, unit: '', digits: 0, get: get('damage.chips'), set: (v, f) => f && update((x) => { x.damage.chips = v; }, true) }),
        slider({ label: 'Chip size', min: .08, max: .3, step: .01, unit: '', get: get('damage.chipSize'), set: (v, f) => f && update((x) => { x.damage.chipSize = v; }, true) }),
        toggle({ label: 'Split (fracture)', get: () => getSpec().damage.fracture, set: (v) => update((x) => { x.damage.fracture = v; }, true) }),
        advanced('Fracture shape', [
          slider({ label: 'Tilt through thickness', min: -45, max: 45, step: 1, unit: '°', digits: 0, get: get('damage.tilt'), set: (v, f) => f && update((x) => { x.damage.tilt = v; }, true) }),
          slider({ label: 'Waviness', min: 0, max: .8, step: .01, get: get('damage.waviness'), set: (v, f) => f && update((x) => { x.damage.waviness = v; }, true) }),
          slider({ label: 'Tongue', min: 0, max: 1.2, step: .01, get: get('damage.lip'), set: (v, f) => f && update((x) => { x.damage.lip = v; }, true) }),
          el('div', { class: 'btns' }, el('button', { class: 'btn ghost', type: 'button', text: 'Reseed damage', 'data-k': 'btn:reseed', onclick: () => update((x) => { x.damage.seed = Math.floor(Math.random() * 1e6); }, true) })),
        ]),
      ]));
      return out;
    }
    if (s.kind === 'capsule') return [
      section('Print', [
        text({ maxLength: 8, label: 'Body text', get: () => getSpec().print?.text ?? '', set: (v) => update((x) => { x.print = { ...(x.print || {}), text: v.toUpperCase().slice(0, 8) }; }, true) }),
        text({ maxLength: 8, label: 'Cap text', get: () => getSpec().print?.capText ?? '', set: (v) => update((x) => { x.print = { ...(x.print || {}), capText: v.toUpperCase().slice(0, 8) }; }, true) }),
        el('p', { class: 'hint', text: 'Axial print on the gelatin shell, up to 8 characters per half. Leave both empty for a plain capsule.' }),
      ]),
    ];
    return [
      section('Forming seam', [
        slider({ label: 'Seam width', min: R.seamWidth[0], max: R.seamWidth[1], step: .005, digits: 3, get: get('seamWidth'), set: sets('seamWidth') }),
        slider({ label: 'Seam relief', min: 0, max: R.seamRelief[1], step: .001, digits: 3, get: get('seamRelief'), set: sets('seamRelief') }),
        el('p', { class: 'hint', text: 'Softgel shells carry no imprint; the longitudinal seam is the only surface mark.' }),
      ]),
    ];
  };
  return { form, surface, marks };
}

// Read-only facts about a selected tray pill.
export function instanceTab(pill, tray) {
  const s = pill.spec, pl = pill.placement, d = pill.describe();
  const repeats = tray.pills.filter((p) => p.placement.product === pl.product).length;
  const dmg = pill.record.damage;
  const rows = [
    ['instance', `#${pill.label.instance}`],
    ['class', `${pill.label.semantic} · ${SEMANTIC[pill.label.semantic].split(' (')[0]}`],
    ['family', familyOf(s).replace(/_/g, ' ')],
    ['size', s.kind === 'capsule' ? `${d.L.toFixed(1)} mm · Ø ${d.W.toFixed(2)} mm` : `${d.L.toFixed(1)} × ${d.W.toFixed(1)} × ${d.H.toFixed(2)} mm`],
    ['product', `${pl.product + 1} of ${tray.products.length} · ${repeats} in tray`],
    ['well', `#${pl.well + 1} · yaw ${Math.round(pl.yaw * 180 / Math.PI)}°${s.kind === 'tablet' ? (pl.flip ? ' · face down' : ' · face up') : ''}`],
    ['damage', dmg?.remaining_fraction ? `${Math.round(dmg.remaining_fraction * 100)} % volume remains` : dmg?.chips?.length ? `${dmg.chips.length} chip(s)` : 'none'],
  ];
  return [
    section('Instance', [kv(rows)]),
    section(null, [el('p', { class: 'hint', text: 'Form, Surface and Marks edit the product, so every repeat in the tray follows. Each instance keeps its own damage and micro-variation. Esc returns to the capture view.' })]),
  ];
}

const TRAY_SHORT = { moulded_daily: 'Daily moulded', thin_blister: 'Blister', compact_daily: 'Compact daily', adjustable: 'Unequal wells', removable_inserts: 'Inserts', four_pods: 'Four-pod', rigid_organizer: 'Organizer', weekly_2x7: 'Weekly AM/PM', twin_compact: 'Twin compact', round_cups: 'Round cups' };
export function trayTabs(state, act) {
  const c = state.tray;
  const setC = (k) => (v) => act.config((x) => { x[k] = v; });
  const cam = (k) => ({ get: () => state.tray.camera[k], set: (v, f) => act.camera((x) => { x[k] = v; }, f) });
  const coverNames = { individual_hinged:'Individual lids', detached_lid:'Detached lid', peeled_film:'Peeled film', none: 'None', rigid_sliding: 'Sliding lid', partly_open_sliding: 'Part open', flexible_film: 'Film', hinged_closed: 'Closed', hinged_open: 'Open', hinged_partly: 'Ajar' };
  return {
    scene: () => [
      section('View', [
        seg({ label: 'Labels', options: [['off', 'Beauty'], ['instance', 'Instances'], ['semantic', 'Classes']], get: () => state.labels, set: (v) => act.labels(v) }),
        toggle({ label: 'Pixel boxes from IDs', get: () => state.boxes, set: (v) => act.boxes(v) }),
      ]),
      section('Surface and light', [
        seg({ label: 'Worktop', options: Object.entries(SURFACES).map(([k, v]) => [k, v, worktopChip(k)]), get: () => c.surface, set: setC('surface') }),
        seg({ label: 'Lighting', options: Object.entries(LIGHTING).filter(([k]) => k !== 'studio').map(([k, v]) => [k, v.label]), get: () => c.lighting, set: (v) => act.lighting(v) }),
      ]),
      section(null, [el('p', { class: 'hint', text: `Seed ${c.seed}. Select a pill to inspect or edit its product; Resample (R) draws a whole new scene.` })]),
    ],
    container: () => {
      const covers = TRAY_STYLES[c.style].covers;
      return [
        section('Container', [
          seg({ label: 'Form', note: (v) => TRAY_STYLES[v].label, options: Object.keys(TRAY_STYLES).map((k) => [k, TRAY_SHORT[k] ?? TRAY_STYLES[k].label, TRAY_GLYPHS[k]]), get: () => c.style, set: (v) => act.config((x) => { x.style = v; if (!TRAY_STYLES[v].covers.includes(x.cover)) x.cover = TRAY_STYLES[v].covers[1] ?? 'none'; if (v === 'rigid_organizer' && CONTAINER_COLORS[x.container].kind === 'opaque') x.container = 'clear_plastic'; }) }),
          swatches({ label: 'Plastic', colors: Object.fromEntries(Object.entries(CONTAINER_COLORS).map(([k, v]) => [k, v.color])), get: () => c.container, set: setC('container') }),
          seg({ label: 'Cover', options: covers.map((k) => [k, coverNames[k]]), get: () => c.cover, set: setC('cover') }),
        ]),
        section('Printing', [
          seg({label:'Brand placement',stack:true,options:[['left','Left'],['right','Right'],['top','Top'],['bottom','Bottom']].map(([k,t])=>[k,t,BRAND_GLYPHS[k]]),get:()=>c.brandPlacement ?? 'top',set:setC('brandPlacement')}),
          seg({ label: 'Language', options: [['de', 'DE'], ['en', 'EN'], ['fr', 'FR'], ['it', 'IT']], get: () => c.language, set: setC('language') }),
          toggle({ label: 'Patient-style sticker', get: () => c.sticker, set: setC('sticker') }),
          slider({label:'Sticker count',min:1,max:6,step:1,unit:'',digits:0,get:()=>c.stickerCount??1,set:(v,f)=>f&&act.config(x=>{x.stickerCount=v;})}),
        ]),
      ];
    },
    contents: () => [
      section('Scenario', [seg({label:'Acquisition',options:[['ordinary','Ordinary'],...STRESS_SCENARIOS.map(k=>[k,k[0].toUpperCase()+k.slice(1).replaceAll('_',' ')])],get:()=>c.edgeScenario??'ordinary',set:v=>act.contents(x=>Object.assign(x,stressConfig(structuredClone(c),v,c.seed%72)))})]),
      section('Contents', [
        slider({ label: 'Pills', min: 1, max: 60, step: 1, unit: '', digits: 0, get: () => c.count, set: (v, f) => f && act.contents((x) => { x.count = v; }) }),
        slider({ label: 'Products', min: 1, max: 6, step: 1, unit: '', digits: 0, get: () => c.products, set: (v, f) => f && act.contents((x) => { x.products = v; }) }),
        slider({ label: 'Damage rate', min: 0, max: .6, step: .01, unit: '', fmt: (v) => `${Math.round(v * 100)} %`, get: () => c.damage, set: (v, f) => f && act.contents((x) => { x.damage = v; }) }),
        toggle({label:'Allow supported stack fallback',get:()=>c.allowStack??true,set:v=>act.contents(x=>{x.allowStack=v;})}),
        slider({label:'Spill fraction',min:0,max:.9,step:.05,unit:'',fmt:v=>`${Math.round(v*100)} %`,get:()=>c.spillFraction??0,set:(v,f)=>f&&act.contents(x=>{x.spillFraction=v;})}),
        toggle({ label: 'Crumbs and powder', get: () => c.debris, set: v=>act.contents(x=>{x.debris=v;}) }),
      ]),
      section(null, [el('p', { class: 'hint', text: 'Counts and rates rebuild the scene from the same seed; placement stays physically valid.' })]),
    ],
    camera: () => [
      section('Lens and sensor', [
        seg({label:'Framing',options:[['fit','Fit tray'],['lens','Fixed lens']],get:()=>c.camera.framing??'fit',set:v=>act.camera(x=>{x.framing=v;},true)}),
        lensCue(()=>state.tray.camera),
        slider({hl:'h-fov',label:'Focal length',min:1.5,max:12,step:.05,digits:2,get:()=>c.camera.focalLength??CAMERA_DEFAULTS.focalLength,set:(v,f)=>act.camera(x=>{x.focalLength=v;},f)}),
        slider({hl:'h-fov',label:'Active sensor width',min:4.8,max:13.2,step:.1,digits:1,get:()=>c.camera.sensorWidth??CAMERA_DEFAULTS.sensorWidth,set:(v,f)=>act.camera(x=>{x.sensorWidth=v;},f)}),
        slider({label:'Principal point x',min:-.03,max:.03,step:.001,unit:'',fmt:v=>`${(v*100).toFixed(1)} %`,get:()=>c.camera.principalX??0,set:(v,f)=>act.camera(x=>{x.principalX=v;},f)}),
        slider({label:'Principal point y',min:-.03,max:.03,step:.001,unit:'',fmt:v=>`${(v*100).toFixed(1)} %`,get:()=>c.camera.principalY??0,set:(v,f)=>act.camera(x=>{x.principalY=v;},f)}),
        el('div',{class:'btns'},el('button',{class:'btn ghost',type:'button',text:'Randomize intrinsics','data-k':'btn:intrinsics',onclick:()=>act.randomizeCamera()})),
        el('p',{class:'hint',text:'Fit tray adjusts distance and lens for natural proportions, including open lids. Fixed lens keeps the chosen camera position and optics; cropping is possible.'}),
      ]),
      section('Capture camera', [
        slider({ label: 'Clearance above rim', min: 100, max: 150, step: 1, digits: 0, ...cam('clearance') }),
        el('p', { class: 'hint cam-actual', id: 'camActual', hidden: '' }),
        slider({ label: 'Tilt', min: -12, max: 12, step: .5, unit: '°', digits: 1, ...cam('tilt') }),
        slider({ label: 'Roll', min: -180, max: 180, step: .5, unit: '°', digits: 1, ...cam('roll') }),
        slider({ label: 'Offset x', min: -20, max: 20, step: .5, digits: 1, ...cam('offsetX') }),
        slider({ label: 'Offset y', min: -12, max: 12, step: .5, digits: 1, ...cam('offsetY') }),
      ]),
      section('View', [
        seg({ options: [['capture', 'Capture frame'], ['orbit', 'Free orbit']], get: () => state.trayView === 'orbit' ? 'orbit' : 'capture', set: (v) => act.view(v) }),
        el('p', { class: 'hint', text: 'The 2:1 capture frame is letterboxed, never stretched. Labels are always computed in the capture view.' }),
      ]),
    ],
  };
}

export function datasetTabs(state,actions) {
  const d = state.dataset;
  return {
    batch: () => [
      section('Batch', [
        seg({label:'Sampling',options:[['mixed','Mixed'],['ordinary','Ordinary'],['stress_sweep','Stress sweep']],get:()=>d.sampling??'mixed',set:v=>{d.sampling=v;}}),
        slider({label:'Rare stress scenes',min:0,max:.2,step:.01,unit:'',fmt:v=>`${Math.round(v*100)} %`,get:()=>d.stressProbability??.06,set:v=>{d.stressProbability=v;}}),
        seg({label:'Camera response',options:[['auto','Mixed'],['machine_vision','Machine vision'],['phone_clean','Phone'],['phone_processed','Phone ISP'],['low_light','Low light'],['none','Off']],get:()=>d.cameraProfile??'auto',set:(v)=>{d.cameraProfile=v;}}),
        seg({ label: 'Resolution', options: [['768x384', '768 × 384'], ['1024x512', '1024 × 512'], ['1536x768', '1536 × 768']], get: () => d.res, set: (v) => { d.res = v; } }),
        slider({ label: 'Beauty samples', min: 4, max: 32, step: 1, unit: 'spp', digits: 0, get: () => d.samples, set: (v) => { d.samples = v; } }),
        slider({ label: 'Base seed', min: 1, max: 999999, step: 1, unit: '', digits: 0, get: () => d.seed, set: (v) => { d.seed = v; } }),
      ]),
      section('Status', [
        el('p',{class:'hint',text:d.storage==='saved'?'Saved on this device. Interrupted batches can resume. Browser storage may be cleared or evicted; keep a downloaded copy.':d.storage==='opening'?'Opening local collection…':'Session only: local saving unavailable. Download before closing.'}),
        el('p', { class: 'status-line', id: 'dsStatus', text: d.status || 'Ready' }),
        el('p', { class: 'hint', text: 'Batches append to the collection. Select a scene to inspect its targets. The Archive tab can stream a larger collection directly to disk.' }),
      ]),
    ],
    archive: () => [
      section('Per scene', [kv([['rgb.png', 'Beauty render, 8-bit RGB'], ['instance_ids.png', '16-bit instance IDs'], ['semantic_ids.png', 'Class IDs'], ['label_preview.png', 'Visualisation only'], ['metadata.json', 'Camera, container, pills, verification']], { variant: 'files' })]),
      section('Training targets', [kv([['blender/train/NNNNNN.png', 'Same RGB, training name'], ['_instance.png · _semantic.png', '16-bit IDs · classes.json IDs'], ['_depth.npy', 'float32 ray distance, metres'], ['_film · _glare · _sticker.png', '0/255 masks'], ['_print_instance.png · _print.png', 'Printed-ink IDs and mask'], ['NNNNNN.json', 'Objects, instance_to_class, contracts']], { variant: 'files' })]),
      section('Archive', [
        ...(window.showSaveFilePicker?[el('button',{class:'btn',id:'dsSaveDisk',type:'button',text:'Save ZIP to disk',disabled:d.scenes.length&&!d.running&&!d.exporting?null:'',title:'Stream the collection to disk without buffering the entire ZIP',onclick:()=>actions.saveToDisk()})]:[]),
        kv([['manifest.json', 'Scene list and settings'], ['README.md', 'Every field and class; cover and refraction policy']], { variant: 'files' })]),
      section('Classes', [kv(Object.entries(SEMANTIC).map(([k, v]) => [k, v[0].toUpperCase() + v.slice(1)]), { variant: 'ids' })]),
    ],
  };
}

export function getPath(o, p) { return p.split('.').reduce((a, k) => a?.[k], o); }
export function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; }
export { deepMerge };
