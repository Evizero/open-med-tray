// Valid ranges of the directly editable shape parameters for the current spec,
// mirroring validate() and the geometry resolvers (tabletDims, capsuleDims,
// softgelDims). Sliders use them so no part of a track is dead; the 3D handles
// use them to bound a drag. Presentation only: validate() stays authoritative.
import { RANGES } from '../scene/catalog.js';
import { capsuleDims, softgelDims } from '../geo/shells.js';

const ROUND = ['round', 'ring'];
const SQUAT = ['polygon', 'heart', 'diamond', 'lobed'];
const ELONGATED = ['oval', 'caplet', 'oblong'];
const span = (lo, hi) => [lo, Math.max(lo, hi)];

export function paramLimits(s) {
  const R = RANGES[s.kind];
  if (s.kind === 'tablet') {
    const round = ROUND.includes(s.outline);
    const length = span(round ? 4.5 : R.length[0], round || SQUAT.includes(s.outline) ? 16 : R.length[1]);
    const width = span(R.width[0], ELONGATED.includes(s.outline) ? Math.min(R.width[1], s.length * .92) : SQUAT.includes(s.outline) ? 16 : R.width[1]);
    const minLW = Math.min(s.length, round ? s.length : s.width);
    const thickness = span(R.thickness[0], Math.min(R.thickness[1], minLW * .98));
    return { length, width, thickness, crownHeight: span(0, Math.min(R.crownHeight[1], s.thickness * .36)), rimWidth: span(0, Math.min(R.rimWidth[1], minLW * .2)) };
  }
  if (s.kind === 'capsule') {
    const d = capsuleDims(s);
    return {
      length: [...R.length],
      width: span(R.width[0], Math.min(R.width[1], s.length * .66)),
      capFraction: span(Math.max(R.capFraction[0], .38, (d.rc + d.wall * .5 + .12) / d.L), Math.min(R.capFraction[1], .62, 1 - (d.rb + .12) / d.L)),
    };
  }
  const L = s.length;
  const length = s.shape === 'round' ? [5.5, 11] : [...R.length];
  const width = s.shape === 'round' ? span(L * .94, L) : s.shape === 'oval' ? span(L * .5, L * .8) : span(L * .3, L * .5);
  const W = softgelDims(s).W;
  return { length, width, thickness: span(W * .5, W) };
}

// Clamp and round to a step (avoids 0.30000000004 in fields and specs).
export function clampStep(v, [lo, hi], step) {
  const d = (String(step).split('.')[1] || '').length;
  return +Math.min(hi, Math.max(lo, Math.round(v / step) * step)).toFixed(d);
}
