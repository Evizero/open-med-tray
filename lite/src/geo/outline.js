// Tablet outlines in millimetres. Every outline is resampled to the same number
// of points by arc length, starting on the +X axis, so any two outlines share
// vertex correspondence and can be morphed vertex-for-vertex.

export const OUTLINES = ['round', 'oval', 'caplet', 'oblong', 'polygon', 'diamond', 'heart', 'ring', 'lobed'];

function ellipse(a, b, m = 2048) {
  const pts = [];
  for (let i = 0; i < m; i++) { const t = i / m * Math.PI * 2; pts.push([a * Math.cos(t), b * Math.sin(t)]); }
  return pts;
}

function stadium(a, b, m = 2048) {
  // Straight flats with semicircular ends of radius b (true caplet/stadium).
  const c = Math.max(0, a - b), pts = [];
  const arc = Math.PI * b, flat = 2 * c, per = m / (2 * arc + 2 * flat);
  const na = Math.max(16, Math.round(arc * per)), nf = Math.round(flat * per);
  for (let i = 0; i < na; i++) { const t = -Math.PI / 2 + i / na * Math.PI; pts.push([c + b * Math.cos(t), b * Math.sin(t)]); }
  for (let i = 0; i < nf; i++) pts.push([c - i / nf * flat, b]);
  for (let i = 0; i < na; i++) { const t = Math.PI / 2 + i / na * Math.PI; pts.push([-c + b * Math.cos(t), b * Math.sin(t)]); }
  for (let i = 0; i < nf; i++) pts.push([-c + i / nf * flat, -b]);
  return pts;
}

function superellipse(a, b, p, m = 2048) {
  const pts = [];
  for (let i = 0; i < m; i++) {
    const t = i / m * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / p)]);
  }
  return pts;
}

function roundedPolygon(sides, cornerFrac, a, b, rotation, m = 2048) {
  // Unit regular polygon with circular corner fillets, then stretched to a x b.
  const R = 1, rc = Math.min(.9, cornerFrac) * Math.cos(Math.PI / sides);
  const pts = [];
  const per = Math.max(8, Math.floor(m / sides));
  for (let k = 0; k < sides; k++) {
    const ang = rotation + k * 2 * Math.PI / sides;
    // Fillet centre sits inside the vertex so the arc is tangent to both edges.
    const d = (R - rc / Math.cos(Math.PI / sides));
    const cx = d * Math.cos(ang), cy = d * Math.sin(ang);
    for (let j = 0; j < per; j++) {
      const t = ang - Math.PI / sides + (j / (per - 1)) * 2 * Math.PI / sides;
      pts.push([cx + rc * Math.cos(t), cy + rc * Math.sin(t)]);
    }
  }
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const ox = (minx + maxx) / 2, oy = (miny + maxy) / 2;
  return pts.map(([x, y]) => [(x - ox) / (maxx - minx) * 2 * a, (y - oy) / (maxy - miny) * 2 * b]);
}

function heart(a, b, m = 2048) {
  const raw = [];
  for (let i = 0; i < m; i++) {
    const t = i / m * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push([y, x]); // lobes toward -X after rotation, point toward +X
  }
  // Soften the top cusp: a moulded heart has a rounded notch, not a singularity.
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of raw) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  return raw.map(([x, y]) => [((x - minx) / (maxx - minx) - .5) * 2 * a * -1, ((y - miny) / (maxy - miny) - .5) * 2 * b]);
}

function orient(pts) {
  // Counter-clockwise, starting at the rightmost point on/near the +X axis.
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; area += x0 * y1 - x1 * y0; }
  if (area < 0) pts.reverse();
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < pts.length; i++) { const [x, y] = pts[i]; const s = x - 4 * Math.abs(y); if (s > bestScore) { bestScore = s; best = i; } }
  return pts.slice(best).concat(pts.slice(0, best));
}

function resample(pts, n) {
  const m = pts.length, cum = [0];
  for (let i = 1; i <= m; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i % m]; cum.push(cum[i - 1] + Math.hypot(x1 - x0, y1 - y0)); }
  const L = cum[m], out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = k / n * L;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / Math.max(1e-12, cum[j + 1] - cum[j]);
    const [x0, y0] = pts[j], [x1, y1] = pts[(j + 1) % m];
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return out;
}

// Symmetric shapes are resampled per quadrant so vertex columns fall exactly on
// the X and Y axes, where score grooves run.
function resampleQuadrant(pts, n) {
  const q = pts.filter(([x, y]) => x >= -1e-9 && y >= -1e-9).sort((p, r) => Math.atan2(p[1], p[0]) - Math.atan2(r[1], r[0]));
  const a = q[0][0], b = q[q.length - 1][1];
  q[0] = [a, 0]; q[q.length - 1] = [0, b];
  const cum = [0];
  for (let i = 1; i < q.length; i++) cum.push(cum[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]));
  const L = cum[cum.length - 1], nq = n / 4, quarter = [];
  let j = 0;
  for (let k = 0; k < nq; k++) {
    const s = k / nq * L;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / Math.max(1e-12, cum[j + 1] - cum[j]);
    quarter.push([q[j][0] + (q[j + 1][0] - q[j][0]) * t, q[j][1] + (q[j + 1][1] - q[j][1]) * t]);
  }
  const out = [];
  for (let k = 0; k < nq; k++) out.push(quarter[k]);
  for (let k = 0; k < nq; k++) { const [x, y] = quarter[(nq - k) % nq]; out.push(k === 0 ? [0, b] : [-x, y]); }
  for (let k = 0; k < nq; k++) { const [x, y] = quarter[k]; out.push(k === 0 ? [-a, 0] : [-x, -y]); }
  for (let k = 0; k < nq; k++) { const [x, y] = quarter[(nq - k) % nq]; out.push(k === 0 ? [0, -b] : [x, -y]); }
  return out;
}

// Blender compression_tablet radial outlines, including its unknown five-lobe
// family. Preserve the source silhouette rather than substituting a stadium.
function sourceOutline(spec, m=2048) {
  const a=spec.length/2,b=spec.width/2,shape=spec.outline,pts=[];
  if(shape==='heart') {
    const raw=Array.from({length:m},(_,k)=>{const t=k/m*Math.PI*2;return [(16*Math.sin(t)**3+6*Math.sin(t))/44,13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t)];});
    const lo=Math.min(...raw.map(v=>v[1])),hi=Math.max(...raw.map(v=>v[1]));
    return raw.map(([x,y])=>[x*spec.length,((y-lo)/(hi-lo)-.5)*spec.width]);
  }
  const exp={caplet:.7,oblong:.40,diamond:1.7}[shape]??1,power=2/exp;
  for(let k=0;k<m;k++){
    const t=k/m*Math.PI*2,c=Math.cos(t),q=Math.sin(t);
    let r=(Math.abs(c)**power+Math.abs(q)**power)**(-1/power);
    if(shape==='polygon'){const sides=spec.sides??6,sector=2*Math.PI/sides;r*=Math.cos(Math.PI/sides)/Math.cos((t+Math.PI/sides)%sector-Math.PI/sides);}
    if(shape==='lobed')r*=1+.18*Math.cos(5*t);
    pts.push([a*c*r,b*q*r]);
  }
  return pts;
}

export function outlinePoints(spec, n) {
  const a = spec.length / 2, b = spec.width / 2;
  const shape = spec.outline;
  let pts, symmetric = true;
  if(spec.outlineProfile==='source_v46'||shape==='lobed')return resample(orient(sourceOutline(spec)),n);
  if (shape === 'round') pts = ellipse(a, a);
  else if (shape === 'oval') pts = ellipse(a, b);
  else if (shape === 'caplet') pts = stadium(a, b);
  else if (shape === 'oblong') pts = superellipse(a, b, 4.4);
  else if (shape === 'diamond') pts = roundedPolygon(4, spec.cornerRound ?? .28, a, b, 0);
  else if (shape === 'polygon') {
    const sides = spec.sides ?? 6;
    pts = roundedPolygon(sides, spec.cornerRound ?? .22, a, b, sides % 2 ? 0 : Math.PI / sides);
    symmetric = sides % 2 === 0;
  } else if (shape === 'heart') { pts = heart(a, b); symmetric = false; }
  else throw new Error('Unknown outline ' + shape);
  if (symmetric && n % 4 === 0) return resampleQuadrant(pts, n);
  return resample(orient(pts), n);
}

// Outward unit normals of a closed CCW polyline (central differences).
export function outlineNormals(pts) {
  const n = pts.length, out = [];
  for (let k = 0; k < n; k++) {
    const [x0, y0] = pts[(k - 1 + n) % n], [x1, y1] = pts[(k + 1) % n];
    const tx = x1 - x0, ty = y1 - y0, l = Math.hypot(tx, ty) || 1;
    out.push([ty / l, -tx / l]);
  }
  return out;
}

// Minimum radius of curvature (mm) of a sampled closed outline; rims and
// bevels must stay below it to avoid self-intersecting inward offsets.
export function minCurvatureRadius(pts) {
  let best = Infinity;
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const [ax, ay] = pts[(k - 1 + n) % n], [bx, by] = pts[k], [cx, cy] = pts[(k + 1) % n];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross <= 1e-12) continue; // concave or straight
    const a = Math.hypot(bx - ax, by - ay), b = Math.hypot(cx - bx, cy - by), c = Math.hypot(cx - ax, cy - ay);
    best = Math.min(best, a * b * c / (2 * Math.abs(cross)));
  }
  return best;
}
