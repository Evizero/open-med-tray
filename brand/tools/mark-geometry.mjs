// Open Med Tray mark geometry. Every shape is a polygon with circular fillets,
// emitted as plain SVG path data (M/L/A/Z). No strokes, no rasters, no fonts.
//
// The mark: an open tray (a trapezoid rim over a front lip with a U notch)
// holding a capsule whose left half is drawn in outline and right half filled.
// Coordinates are on a 120 x 64 grid, y down, symmetric about x = 60.

const f = (n) => { const v = Math.round(n * 100) / 100; return Object.is(v, -0) ? '0' : String(v); };

// Polygon with per-vertex fillet radii -> closed path.
export function filleted(points) {
  const n = points.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const [px, py, r = 0] = points[i];
    const [ax, ay] = points[(i + n - 1) % n];
    const [bx, by] = points[(i + 1) % n];
    const l1 = Math.hypot(ax - px, ay - py), l2 = Math.hypot(bx - px, by - py);
    const u1 = [(ax - px) / l1, (ay - py) / l1], u2 = [(bx - px) / l2, (by - py) / l2];
    const theta = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    if (!r || theta > Math.PI - 1e-6) { d += (i ? 'L' : 'M') + f(px) + ' ' + f(py); continue; }
    const t = Math.min(r / Math.tan(theta / 2), l1 / 2, l2 / 2);
    const rr = t * Math.tan(theta / 2);
    const t1 = [px + u1[0] * t, py + u1[1] * t], t2 = [px + u2[0] * t, py + u2[1] * t];
    const turn = (px - ax) * (by - py) - (py - ay) * (bx - px);
    d += (i ? 'L' : 'M') + f(t1[0]) + ' ' + f(t1[1]) + 'A' + f(rr) + ' ' + f(rr) + ' 0 0 ' + (turn > 0 ? 1 : 0) + ' ' + f(t2[0]) + ' ' + f(t2[1]);
  }
  return d + 'Z';
}

// Variants: 'standard' (>= 48 px), 'small' (20-48 px, heavier rims, wider
// gaps), 'pixel' (16 px favicon, same grid but fitted for a 16 px tile).
export const VARIANTS = {
  standard: { rim: 8, leg: 10, legEnd: 38, gap: 4, floor: 8, slope: .54, notchSlope: .8, notchX: 21, capW: 60, capH: 26, capY: 36.5, capLine: 3.7, rOuter: 10, rInner: 3.5 },
  small: { rim: 10.5, leg: 13, legEnd: 36.5, gap: 6, floor: 10, slope: .5, notchSlope: .8, notchX: 22, capW: 58, capH: 25, capY: 35.5, capLine: 6, rOuter: 11, rInner: 3 },
  pixel: { rim: 12, leg: 15, legEnd: 35, gap: 7.5, floor: 11, slope: .48, notchSlope: .7, notchX: 22, capW: 56, capH: 26, capY: 34, capLine: 0, rOuter: 12, rInner: 2.5 },
};

export function mark(variant = 'standard') {
  const v = VARIANTS[variant];
  const W = 120, H = 64, cx = 60;
  // Rim: outer contour then inner contour, one closed polygon open at the bottom.
  const oBL = 1 + 0, topY = 0;
  const oTL = oBL + v.slope * (v.legEnd - topY);
  const iBL = oBL + v.leg, iTL = iBL + v.slope * (v.legEnd - v.rim);
  const rim = filleted([
    [oBL, v.legEnd, 1], [oTL, topY, v.rOuter], [W - oTL, topY, v.rOuter], [W - oBL, v.legEnd, 1],
    [W - iBL, v.legEnd, 1], [W - iTL, v.rim, v.rInner], [iTL, v.rim, v.rInner], [iBL, v.legEnd, 1],
  ]);
  // Front lip: full-width block with a U notch that opens the tray.
  const baseTop = v.legEnd + v.gap, floorY = H - v.floor;
  const nx0 = v.notchX, nx1 = nx0 + v.notchSlope * (floorY - baseTop);
  const base = filleted([
    [0, baseTop, 1.5], [nx0, baseTop, 6], [nx1, floorY, 6], [W - nx1, floorY, 6], [W - nx0, baseTop, 6], [W, baseTop, 1.5],
    [W, H, 7], [0, H, 7],
  ]);
  // Capsule: stadium; left half hollowed to an outline (evenodd hole), unless
  // capLine is 0, in which case the two halves are returned separately so the
  // tiny favicon can colour them as a two-tone capsule.
  const r = v.capH / 2, x0 = cx - v.capW / 2, x1 = cx + v.capW / 2, y0 = v.capY - r, y1 = v.capY + r;
  const stadium = `M${f(x0 + r)} ${f(y0)}H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)}H${f(x0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)}Z`;
  const capsuleHalves = {
    left: `M${f(cx)} ${f(y0)}V${f(y1)}H${f(x0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)}Z`,
    right: `M${f(cx)} ${f(y0)}H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)}H${f(cx)}Z`,
  };
  let capsule = null;
  if (v.capLine) {
    const t = v.capLine, ri = r - t;
    capsule = stadium + `M${f(cx)} ${f(y0 + t)}H${f(x0 + r)}A${f(ri)} ${f(ri)} 0 0 0 ${f(x0 + r)} ${f(y1 - t)}H${f(cx)}Z`;
  }
  return { width: W, height: H, rim, base, capsule, capsuleHalves };
}
