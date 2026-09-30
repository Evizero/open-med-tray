// Visual cues for the inspector: small silhouettes for choice controls and
// live technical views that follow the sliders (plan + side at true
// proportions, lens field of view). Geometry comes from the same outline and
// profile functions the mesh builders use, so a cue never disagrees with the
// render. Pure presentation: nothing here writes state.
import { el, registerCue } from './controls.js';
import { outlinePoints } from '../geo/outline.js';
import { tabletDims } from '../geo/tablet.js';
import { capsuleDims, softgelDims } from '../geo/shells.js';
import { validate } from '../scene/catalog.js';

const NS = 'http://www.w3.org/2000/svg';
export function svgEl(w, h, inner, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
}
const G = (inner, w = 20, h = 14) => () => svgEl(w, h, inner, 'glyph');
const css = (c) => `rgb(${c.map((v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255)).join(',')})`;
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const poly = (pts, sx, ox, oy) => 'M' + pts.map(([x, y]) => `${f2(ox + x * sx)},${f2(oy - y * sx)}`).join('L') + 'Z';

function outlineOf(spec) {
  if (spec.outline === 'ring') return null;
  try { return outlinePoints(spec, 128); } catch { return null; }
}
const circlePath = (cx, cy, r) => `M${f2(cx + r)},${f2(cy)}a${f2(r)},${f2(r)} 0 1 0 ${f2(-2 * r)},0a${f2(r)},${f2(r)} 0 1 0 ${f2(2 * r)},0Z`;

// ---------------------------------------------------------------- glyphs
// Tablet outlines drawn from the real outline generator at canonical
// proportions (polygon follows the current side count).
const OUTLINE_SIZES = { round: [10, 10], oval: [14, 8.4], caplet: [15, 7.4], oblong: [15, 8], polygon: [10, 10], diamond: [12, 9.6], heart: [11, 10.2], lobed: [11, 11], ring: [10, 10] };
export function outlineGlyph(outline, spec = {}) {
  return () => {
    const [L, W] = OUTLINE_SIZES[outline];
    const s = Math.min(17 / L, 12 / W);
    let d;
    if (outline === 'ring') d = circlePath(10, 7, L * s / 2) + circlePath(10, 7, L * s * .18);
    else {
      let pts = outlineOf({ ...spec, outline, length: L, width: W, sides: spec.sides ?? 6, outlineProfile: undefined });
      // The heart glyph is shown upright (point down) so it reads as a heart.
      if (pts && outline === 'heart') { const r = Math.min(17 / W, 12 / L); pts = pts.map(([x, y]) => [y * r / s, -x * r / s]); }
      d = pts ? poly(pts, s, 10, 7) : circlePath(10, 7, 5.5);
    }
    return svgEl(20, 14, `<path class="f" d="${d}" fill-rule="evenodd"/>`, 'glyph');
  };
}
export function sidesGlyph(n) {
  return () => {
    const pts = outlineOf({ outline: 'polygon', sides: n, length: 10, width: 10 });
    return svgEl(20, 14, `<path class="f" d="${poly(pts, 1.15, 10, 7)}"/>`, 'glyph');
  };
}
export const FAMILY_GLYPHS = {
  tablet: G('<circle class="f" cx="10" cy="7" r="5.6"/><path class="l" d="M10 1.9v10.2"/>'),
  capsule: G('<rect class="f" x="2" y="3.8" width="16" height="6.4" rx="3.2"/><path class="l" d="M10.6 3.8v6.4"/>'),
  softgel: G('<ellipse class="f" cx="10" cy="7" rx="7.4" ry="4.9"/><ellipse cx="7.4" cy="5.2" rx="1.9" ry="1" fill="currentColor" fill-opacity=".45"/>'),
};
export const SOFTGEL_SHAPE_GLYPHS = {
  round: G('<circle class="f" cx="10" cy="7" r="5.2"/>'),
  oval: G('<ellipse class="f" cx="10" cy="7" rx="7.2" ry="4.6"/>'),
  oblong: G('<rect class="f" x="1.5" y="3.9" width="17" height="6.2" rx="3.1"/>'),
};
export const SCORE_GLYPHS = {
  0: G('<circle class="f" cx="10" cy="7" r="5.8"/>'),
  single: G('<circle class="f" cx="10" cy="7" r="5.8"/><path class="l" d="M10 1.5v11"/>'),
  cross: G('<circle class="f" cx="10" cy="7" r="5.8"/><path class="l" d="M10 1.5v11M4.5 7h11"/>'),
  parallel: G('<circle class="f" cx="10" cy="7" r="5.8"/><path class="l" d="M8 2v10M12 2v10"/>'),
};
const disc = '<circle class="f" cx="10" cy="7" r="6"/>';
export const IMPRINT_GLYPHS = {
  none: G(disc),
  text: G(`${disc}<rect class="m" x="6.2" y="6" width="7.6" height="2" rx=".6"/>`),
  stacked: G(`${disc}<rect class="m" x="7" y="4.5" width="6" height="1.8" rx=".6"/><rect class="m" x="7" y="7.7" width="6" height="1.8" rx=".6"/>`),
  cross: G(`${disc}<rect class="m" x="6" y="6.2" width="8" height="1.6" rx=".6"/><rect class="m" x="9.2" y="3" width="1.6" height="8" rx=".6"/>`),
  boxed: G(`${disc}<rect x="6.3" y="4.4" width="7.4" height="5.2" rx=".6" fill="none" stroke="currentColor" stroke-width="1"/><rect class="m" x="8" y="6.2" width="4" height="1.6" rx=".5"/>`),
  symbol_code: G(`${disc}<path class="m" d="M7.4 5.2 9 7 7.4 8.8 5.8 7z"/><rect class="m" x="10" y="6.2" width="4.4" height="1.6" rx=".5"/>`),
  emblem: G(`${disc}<path class="m" d="M10 3.6 13 7l-3 3.4L7 7z"/>`),
};
export const BRAND_GLYPHS = {
  left: G('<rect class="f" x="2" y="2.5" width="16" height="9" rx="1.5"/><rect class="m" x="3.4" y="3.9" width="3" height="6.2" rx=".6"/>'),
  right: G('<rect class="f" x="2" y="2.5" width="16" height="9" rx="1.5"/><rect class="m" x="13.6" y="3.9" width="3" height="6.2" rx=".6"/>'),
  top: G('<rect class="f" x="2" y="2.5" width="16" height="9" rx="1.5"/><rect class="m" x="3.4" y="3.9" width="13.2" height="2.2" rx=".6"/>'),
  bottom: G('<rect class="f" x="2" y="2.5" width="16" height="9" rx="1.5"/><rect class="m" x="3.4" y="7.9" width="13.2" height="2.2" rx=".6"/>'),
};
// Plan-view silhouettes of the container families (compartment layout).
const cells = (x, y, w, h, cols, rows = 1, web = 1, widths) => {
  let out = '';
  const tot = widths ? widths.reduce((a, b) => a + b, 0) : cols;
  const cw = (w - web * (cols + 1)), ch = (h - web * (rows + 1)) / rows;
  for (let r = 0; r < rows; r++) { let cx = x + web; for (let c = 0; c < cols; c++) { const ww = cw * (widths ? widths[c] : 1) / tot; out += `<rect class="c" x="${f2(cx)}" y="${f2(y + web + r * (ch + web))}" width="${f2(ww)}" height="${f2(ch)}" rx=".7"/>`; cx += ww + web; } }
  return out;
};
const frame = (x, y, w, h, rx = 1.8) => `<rect class="f" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
export const TRAY_GLYPHS = {
  moulded_daily: G(frame(1, 2.5, 22, 9) + cells(1, 2.5, 22, 9, 4, 1, 1.4), 24, 14),
  thin_blister: G('<rect class="f" x="1" y="2.5" width="22" height="9" rx=".8" fill-opacity="0"/>' + [3, 8.5, 14, 19.5].map((x) => `<rect class="c" x="${x - 1.2}" y="4" width="4.4" height="6" rx="2"/>`).join(''), 24, 14),
  compact_daily: G(frame(4, 3.5, 16, 7) + cells(4, 3.5, 16, 7, 3, 1, 1.2), 24, 14),
  adjustable: G(frame(1, 2.5, 22, 9) + cells(1, 2.5, 22, 9, 4, 1, 1.3, [5, 3, 6, 4]), 24, 14),
  removable_inserts: G('<rect class="f" x="1" y="2.5" width="22" height="9" rx="1.8" fill-opacity="0" stroke-dasharray="1.6 1.2"/>' + [0, 1, 2, 3].map((i) => `<rect class="c" x="${2.6 + i * 5.1}" y="4" width="4.1" height="6" rx=".8"/>`).join(''), 24, 14),
  four_pods: G(frame(6.5, 1, 11, 12) + cells(6.5, 1, 11, 12, 2, 2, 1.2), 24, 14),
  rigid_organizer: G(frame(1, 3, 22, 9) + cells(1, 3, 22, 9, 6, 1, 1.1) + '<path class="l" d="M2.5 1.4h19"/>', 24, 14),
  weekly_2x7: G(frame(1, 1.5, 22, 11, 1.4) + cells(1, 1.5, 22, 11, 7, 2, .9), 24, 14),
  twin_compact: G(frame(5, 3.5, 14, 7) + cells(5, 3.5, 14, 7, 2, 1, 1.3), 24, 14),
  round_cups: G(frame(1, 2.5, 22, 9) + [4.5, 9.5, 14.5, 19.5].map((x) => `<circle class="c" cx="${x}" cy="7" r="2.3"/>`).join(''), 24, 14),
};

// Material finish on a sphere in the current colour: diffuse only, broad
// sheen, tighter highlight.
let gid = 0;
export function finishGlyph(kind, color) {
  return () => {
    const id = 'fg' + (++gid), c = css(color);
    // Diffuse falloff is shared; uncoated adds powder speckle, matte a broad
    // soft sheen, satin a tight specular spot.
    const shade = `<radialGradient id="${id}d" cx="42%" cy="38%" r="68%"><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></radialGradient>`;
    const sheen = kind === 'matte_film' ? `<radialGradient id="${id}h" cx="38%" cy="34%" r="46%"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` : '';
    let top = '';
    if (kind === 'chalky') top = [[5.6, 6.2], [9.4, 5], [7.6, 9.4], [10.8, 9], [6, 11], [9.2, 12.2], [11.8, 6.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".45" fill="rgba(31,30,28,.32)"/>`).join('');
    else if (kind === 'matte_film') top = `<circle cx="8" cy="8" r="6.5" fill="url(#${id}h)"/>`;
    else top = `<ellipse cx="5.9" cy="5.5" rx="1.9" ry="1.3" fill="#fff" transform="rotate(-35 5.9 5.5)"/><circle cx="10.6" cy="11" r=".7" fill="#fff" fill-opacity=".7"/>`;
    return svgEl(16, 16, `<defs>${shade}${sheen}</defs><circle cx="8" cy="8" r="6.5" fill="${c}"/><circle cx="8" cy="8" r="6.5" fill="url(#${id}d)"/>${top}<circle cx="8" cy="8" r="6.5" fill="none" stroke="rgba(31,30,28,.3)" stroke-width=".8"/>`, 'glyph mat');
  };
}
// Shell optics: the current colour over a two-line target.
export function opticsGlyph(kind, color) {
  return () => {
    const a = { transparent: .32, translucent: .58, milky: .82, opaque: 1 }[kind];
    const c = kind === 'milky' ? css(color.map((v) => v * .55 + .45)) : css(color);
    return svgEl(16, 16, `<path d="M3 5.5h10M3 10.5h10" stroke="rgba(31,30,28,.7)" stroke-width="1.3"/><circle cx="8" cy="8" r="6.2" fill="${c}" fill-opacity="${a}" stroke="rgba(31,30,28,.3)" stroke-width=".8"/>`, 'glyph mat');
  };
}
export const worktopChip = (k) => () => el('span', { class: `chip chip-${k}`, 'aria-hidden': 'true' });

// ---------------------------------------------------------------- technical views
// Plan + side view of the current spec at one true scale. Parts named by the
// sliders (data-hl on the panel body) are drawn in the accent colour.
export function formCue(getSpec) {
  const box = el('div', { class: 'cue cue-form', 'aria-hidden': 'true' });
  box.refresh = () => box.replaceChildren(drawForm(getSpec()));
  box.refresh();
  return registerCue(box);
}

const VW = 268, VH = 92;
function dimH(x0, x1, y, cls) { return `<g class="hl ${cls}"><path d="M${f2(x0)},${f2(y - 3)}v6M${f2(x1)},${f2(y - 3)}v6M${f2(x0)},${f2(y)}H${f2(x1)}"/></g>`; }
function dimV(x, y0, y1, cls) { return `<g class="hl ${cls}"><path d="M${f2(x - 3)},${f2(y0)}h6M${f2(x - 3)},${f2(y1)}h6M${f2(x)},${f2(y0)}V${f2(y1)}"/></g>`; }

// Drawn from the resolved shape (validate + geometry resolvers), so the view
// shows what is built even where a requested value was constrained.
function drawForm(s0) {
  const s = validate(structuredClone(s0));
  const clear = s.kind === 'softgel' && s.opacity !== 'opaque';
  const fill = css(s.kind === 'capsule' ? s.bodyColor : s.color);
  const sd = s.kind === 'softgel' ? softgelDims(s) : null, cd = s.kind === 'capsule' ? capsuleDims(s) : null;
  const L = s.length, W = sd ? sd.W : cd ? cd.rb * 2 : s.width, H = sd ? sd.H : cd ? cd.rb * 2 : s.thickness;
  let out = '';
  if (s.kind === 'capsule') {
    // One elevation (rotationally symmetric): body, overlapping cap, wall step.
    const sc = Math.min((VW - 48) / L, (VH - 30) / (cd.rc * 2));
    const x0 = (VW - L * sc) / 2, cy = VH / 2 - 4, r = W * sc / 2, rc = cd.rc * sc;
    const xc = x0 + L * sc * (1 - cd.capFrac), x1 = x0 + L * sc;
    out += `<rect class="body" x="${f2(x0)}" y="${f2(cy - r)}" width="${f2(L * sc)}" height="${f2(2 * r)}" rx="${f2(r)}" fill="${fill}"/>`;
    const capD = `M${f2(xc)},${f2(cy - rc)}H${f2(x1 - rc)}a${f2(rc)},${f2(rc)} 0 0 1 0,${f2(2 * rc)}H${f2(xc)}Z`;
    out += `<path class="body" d="${capD}" fill="${css(s.capColor)}"/>`;
    out += `<g class="hl h-cap"><path d="${capD}"/></g>`;
    out += `<g class="hl h-wall"><path d="M${f2(xc)},${f2(cy - rc - 5)}V${f2(cy - r + 3)}M${f2(xc)},${f2(cy + r - 3)}V${f2(cy + rc + 5)}"/></g>`;
    out += dimH(x0, x1, cy + rc + 9, 'h-length') + dimV(x1 + 9, cy - r, cy + r, 'h-width');
    out += `<path class="axis" d="M${f2(x0 - 6)},${f2(cy)}H${f2(x1 + 6)}"/>`;
    return svgEl(VW, VH, out, 'view');
  }
  const gap = 34;
  const sc = Math.min((VW - 40 - gap) / (2 * L), (VH - 26) / Math.max(W, H));
  const pw = L * sc, cy = VH / 2 - 3;
  const pcx = (VW - gap) / 2 - pw / 2 - 4, scx = (VW + gap) / 2 + pw / 2 - 4;
  const fo = clear ? ' fill-opacity=".7"' : '';
  if (s.kind === 'tablet') {
    const pts = outlineOf(s);
    const d = s.outline === 'ring' ? circlePath(pcx, cy, L * sc / 2) + circlePath(pcx, cy, L * sc / 2 * .36) : pts ? poly(pts, sc, pcx, cy) : circlePath(pcx, cy, L * sc / 2);
    out += `<path class="body" d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
    if (s.score?.count && s.outline !== 'ring' && s.outline !== 'heart') {
      const hy = W * sc / 2 * .92, hx = L * sc / 2 * .92;
      if (s.score.layout === 'parallel') { const o = L / 6 * sc; out += `<path class="mark" d="M${f2(pcx - o)},${f2(cy - hy * .8)}V${f2(cy + hy * .8)}M${f2(pcx + o)},${f2(cy - hy * .8)}V${f2(cy + hy * .8)}"/>`; }
      else out += `<path class="mark" d="M${f2(pcx)},${f2(cy - hy)}V${f2(cy + hy)}${s.score.layout === 'cross' ? `M${f2(pcx - hx)},${f2(cy)}H${f2(pcx + hx)}` : ''}"/>`;
    }
    out += sideTablet(s, pts, sc, scx, cy, fill);
  } else {
    // Softgel: straight section with elliptical ends, in plan (L × W) and side (L × H).
    const st = sd.straight;
    const shape = (cx, h) => { const a = (L - st) / 2 * sc, b = h * sc / 2, x0 = cx - st * sc / 2, x1 = cx + st * sc / 2; return `M${f2(x0)},${f2(cy - b)}H${f2(x1)}a${f2(a)},${f2(b)} 0 0 1 0,${f2(2 * b)}H${f2(x0)}a${f2(a)},${f2(b)} 0 0 1 0,${f2(-2 * b)}Z`; };
    out += `<path class="body" d="${shape(pcx, W)}" fill="${fill}"${fo}/><path class="body" d="${shape(scx, H)}" fill="${fill}"${fo}/>`;
    out += `<path class="seam" d="M${f2(scx - L * sc / 2)},${f2(cy)}H${f2(scx + L * sc / 2)}"/>`;
    if (st > 0) out += `<g class="hl h-straight"><path d="M${f2(pcx - st * sc / 2)},${f2(cy - W * sc / 2)}H${f2(pcx + st * sc / 2)}M${f2(pcx - st * sc / 2)},${f2(cy + W * sc / 2)}H${f2(pcx + st * sc / 2)}M${f2(scx - st * sc / 2)},${f2(cy - H * sc / 2)}H${f2(scx + st * sc / 2)}M${f2(scx - st * sc / 2)},${f2(cy + H * sc / 2)}H${f2(scx + st * sc / 2)}"/></g>`;
  }
  out += dimH(pcx - pw / 2, pcx + pw / 2, cy + Math.max(W, H) * sc / 2 + 8, 'h-length') + dimH(scx - pw / 2, scx + pw / 2, cy + Math.max(W, H) * sc / 2 + 8, 'h-length');
  out += dimV(pcx + pw / 2 + 8, cy - W * sc / 2, cy + W * sc / 2, 'h-width');
  out += dimV(scx + pw / 2 + 8, cy - H * sc / 2, cy + H * sc / 2, 'h-thickness');
  out += `<text class="vl" x="${f2(pcx)}" y="${VH - 2}">plan</text><text class="vl" x="${f2(scx)}" y="${VH - 2}">side</text>`;
  return svgEl(VW, VH, out, 'view');
}

// Tablet elevation from the same profile rules as buildTablet: band, bevel,
// flat land, crown (power law with Hermite blend into the land).
function sideTablet(s, pts, sc, cx, cy, fill) {
  const d = tabletDims(s, pts || undefined);
  const a = s.length / 2, H = s.thickness;
  if (s.outline === 'ring') {
    const r = Math.min(H / 2, a) * .7 * sc;
    return `<rect class="body" x="${f2(cx - a * sc)}" y="${f2(cy - H * sc / 2)}" width="${f2(2 * a * sc)}" height="${f2(H * sc)}" rx="${f2(r)}" fill="${fill}"/>`;
  }
  const { bevel, crown, rim, shoulder, blend, curve, zLand } = d;
  const power = curve + 1, minHalf = Math.min(d.L, d.W) / 2;
  const blendU = rim > 0 ? Math.min(blend / minHalf, .25) : 0;
  const crownZ = (u) => {
    if (rim > 0) {
      let cap = Math.max(0, 1 - Math.pow(u, power));
      if (blendU > 0 && u > 1 - blendU) { const u0 = 1 - blendU, y0 = 1 - Math.pow(u0, power), dy0 = -power * Math.pow(u0, power - 1), t = (u - u0) / blendU; cap = (2 * t ** 3 - 3 * t * t + 1) * y0 + (t ** 3 - 2 * t * t + t) * blendU * dy0; }
      return zLand + crown * cap;
    }
    return H / 2 - crown * u * u;
  };
  const xc = a - bevel - rim;
  const crownPts = [], landPts = [[xc, zLand], [a - bevel, zLand]], bevelPts = [];
  for (let i = 0; i <= 28; i++) { const u = i / 28; crownPts.push([u * xc, crownZ(u)]); }
  for (let i = 0; i <= 8; i++) { const phi = Math.PI / 2 * (1 - i / 8); bevelPts.push([a - bevel * (1 - Math.cos(phi)), shoulder + bevel * Math.sin(phi)]); }
  const right = [...crownPts, ...(rim > 0 ? landPts : []), ...bevelPts];
  const P = ([x, z]) => `${f2(cx + x * sc)},${f2(cy - z * sc)}`;
  const top = [...right.slice().reverse().map(([x, z]) => [-x, z]), ...right];
  const full = [...top, ...top.slice().reverse().map(([x, z]) => [x, -z])];
  const seg = (list) => { let o = ''; for (const m of [1, -1]) for (const sx of [1, -1]) o += 'M' + list.map(([x, z]) => P([sx * x, m * z])).join('L'); return o; };
  let out = `<path class="body" d="M${full.map(P).join('L')}Z" fill="${fill}"/>`;
  out += `<g class="hl h-crown"><path d="${seg(crownPts)}"/></g>`;
  if (rim > 0) out += `<g class="hl h-land"><path d="${seg(landPts)}"/></g>`;
  out += `<g class="hl h-edge"><path d="${seg(bevelPts)}"/></g>`;
  return out;
}

// Lens: horizontal field-of-view wedge plus derived exact numbers.
export function lensCue(getCam) {
  const wedge = el('span', { class: 'lens-w' });
  const dl = el('dl', { class: 'lens-d' });
  const box = el('div', { class: 'cue cue-lens' }, wedge, dl);
  box.refresh = () => {
    const c = getCam();
    const f = c.focalLength ?? 3.6, sw = c.sensorWidth ?? 6.4, clr = c.clearance ?? 118;
    const h = 2 * Math.atan(sw / (2 * f)), v = 2 * Math.atan(sw / 2 / (2 * f));
    const deg = (r) => `${(r * 180 / Math.PI).toFixed(1)}°`;
    const half = Math.min(h / 2, 1.45), R = 44, ax = 6, ay = 26;
    const ex = ax + R * Math.cos(half), ey = R * Math.sin(half);
    const arc = 16;
    wedge.replaceChildren(svgEl(56, 52, `<path class="fov" d="M${ax},${ay}L${f2(ex)},${f2(ay - ey)}A${R},${R} 0 0 1 ${f2(ex)},${f2(ay + ey)}Z"/><path class="arc" d="M${f2(ax + arc * Math.cos(half))},${f2(ay - arc * Math.sin(half))}A${arc},${arc} 0 0 1 ${f2(ax + arc * Math.cos(half))},${f2(ay + arc * Math.sin(half))}"/><circle cx="${ax}" cy="${ay}" r="1.6" class="apex"/>`, 'view'));
    const fw = 2 * clr * Math.tan(h / 2);
    const rows = [['Horizontal FOV', deg(h)], ['Vertical FOV', deg(v)], ['35 mm equivalent', `${(f * 36 / sw).toFixed(1)} mm`], ['Field at rim', `${fw.toFixed(0)} × ${(fw / 2).toFixed(0)} mm`]];
    dl.replaceChildren(...rows.flatMap(([k, val]) => [el('dt', { text: k }), el('dd', { text: val })]));
  };
  box.refresh();
  return registerCue(box);
}
