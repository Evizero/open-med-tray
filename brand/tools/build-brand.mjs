// Builds every Open Med Tray brand asset from mark-geometry.mjs:
// SVG masters and lockups, PNG icons/lockups/social preview (rasterised by the
// pinned Chrome through playwright-core), embedded page imagery, and the
// standalone HTML pages (brand specimen, landing page, explorer wrapper).
//
//   node brand/tools/build-brand.mjs            (run from the candidate root)
//
// Inputs: app/fonts (IBM Plex, OFL-1.1), brand/img/*-source.png captures and
// brand/src/*.html templates. Deterministic apart from Chrome's rasteriser.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { mark } from './mark-geometry.mjs';
import { heroLabels, stackLayers, sourcesFor, HERO_SCENE, BENCH_SCENE, STACK_SCENE, CYCLES_BENCH } from './landing-assets.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const APP = ROOT + (existsSync(ROOT + 'lite/package.json') ? 'lite/' : (existsSync(ROOT + 'app/package.json') ? 'app/' : 'artifacts/web-parity-v3/'));
const { chromium } = await import(APP + 'node_modules/playwright-core/index.mjs');
const BRAND = ROOT + 'brand/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const d of ['svg', 'png', 'img', 'licenses']) mkdirSync(BRAND + d, { recursive: true });

export const C = {
  navy: '#0E3A66',    // tray
  blue: '#3D95DE',    // capsule
  ink: '#0C2740',     // wordmark
  accent: '#1B64BE',  // edition descriptors, links, UI accent (AA on paper)
  sky: '#6CB6F2',     // capsule and edition on navy
  paper: '#FBFBF9',
};
const FONT_STACK = "'IBM Plex Sans', 'IBM Plex Sans Text', system-ui, -apple-system, 'Segoe UI', sans-serif";
const font = (f) => readFileSync(APP + 'fonts/' + f).toString('base64');
const FONTS = {
  sans400: font('ibm-plex-sans-latin-400-normal.woff2'), sans500: font('ibm-plex-sans-latin-500-normal.woff2'),
  sans600: font('ibm-plex-sans-latin-600-normal.woff2'), mono400: font('ibm-plex-mono-latin-400-normal.woff2'),
};
const fontFaces = (weights = ['400', '500', '600'], mono = true) => weights.map((w) => `@font-face{font-family:"IBM Plex Sans";font-weight:${w};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${FONTS['sans' + w]}) format("woff2")}`).join('\n') + (mono ? `\n@font-face{font-family:"IBM Plex Mono";font-weight:400;font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${FONTS.mono400}) format("woff2")}` : '');

// ---------- mark SVG fragments ----------
function markPaths(variant, { tray, capsule, capsuleLeft = null }) {
  const m = mark(variant);
  const cap = m.capsule
    ? `<path fill="${capsule}" fill-rule="evenodd" d="${m.capsule}"/>`
    : `<path fill="${capsuleLeft ?? capsule}" d="${m.capsuleHalves.left}"/><path fill="${capsule}" d="${m.capsuleHalves.right}"/>`;
  return `<path fill="${tray}" d="${m.rim}"/><path fill="${tray}" d="${m.base}"/>${cap}`;
}
const svgDoc = (w, h, body, title, vb = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

const TILE = {
  standard: { frac: .72, capsuleLeft: null },
  small: { frac: .8, capsuleLeft: null },
  pixel: { frac: .86, capsuleLeft: '#FFFFFF' },
};
function tileBody(variant) {
  const t = TILE[variant], s = 64 * t.frac / 120, tx = (64 - 120 * s) / 2, ty = (64 - 64 * s) / 2;
  return `<rect width="64" height="64" rx="14" fill="${C.navy}"/><g transform="translate(${+tx.toFixed(3)} ${+ty.toFixed(3)}) scale(${+s.toFixed(5)})">${markPaths(variant, { tray: '#FFFFFF', capsule: C.sky, capsuleLeft: t.capsuleLeft })}</g>`;
}
export const inlineMark = (variant = 'standard', colors = { tray: C.navy, capsule: C.blue }, attrs = '') => `<svg viewBox="0 0 120 64" ${attrs}>${markPaths(variant, colors)}</svg>`;
export const inlineTile = (variant = 'standard', attrs = '') => `<svg viewBox="0 0 64 64" ${attrs}>${tileBody(variant)}</svg>`;

const out = {};
const put = (rel, data) => { writeFileSync(BRAND + rel, data); out[rel] = Buffer.byteLength(data); };

put('svg/open-med-tray-mark.svg', svgDoc(120, 64, markPaths('standard', { tray: C.navy, capsule: C.blue }), 'Open Med Tray'));
put('svg/open-med-tray-mark-small.svg', svgDoc(120, 64, markPaths('small', { tray: C.navy, capsule: C.blue }), 'Open Med Tray'));
put('svg/open-med-tray-mark-mono.svg', svgDoc(120, 64, markPaths('standard', { tray: C.ink, capsule: C.ink }), 'Open Med Tray'));
put('svg/open-med-tray-mark-reversed.svg', svgDoc(120, 64, markPaths('standard', { tray: '#FFFFFF', capsule: '#FFFFFF' }), 'Open Med Tray'));
put('svg/open-med-tray-mark-currentcolor.svg', svgDoc(120, 64, markPaths('standard', { tray: 'currentColor', capsule: 'currentColor' }), 'Open Med Tray'));
put('svg/open-med-tray-icon.svg', svgDoc(64, 64, tileBody('standard'), 'Open Med Tray'));
put('svg/open-med-tray-icon-small.svg', svgDoc(64, 64, tileBody('small'), 'Open Med Tray'));
put('svg/open-med-tray-favicon.svg', svgDoc(64, 64, tileBody('pixel'), 'Open Med Tray'));
export const faviconDataUri = () => 'data:image/svg+xml,' + encodeURIComponent(readFileSync(BRAND + 'svg/open-med-tray-favicon.svg', 'utf8').trim()).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%22/g, "'");

// ---------- browser ----------
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(`<style>${fontFaces()}</style><body>`);
await page.evaluate(() => Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 40px "IBM Plex Sans"`))));

// Measure SVG text advance with the real font (used as textLength so that a
// fallback font can never overflow the lockup's viewBox).
async function measure(text, size, weight) {
  return page.evaluate(({ text, size, weight }) => {
    const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), t = document.createElementNS(ns, 'text');
    t.setAttribute('font-family', '"IBM Plex Sans"'); t.setAttribute('font-size', size); t.setAttribute('font-weight', weight); t.textContent = text;
    s.append(t); document.body.append(s); const w = t.getComputedTextLength(); s.remove(); return w;
  }, { text, size, weight });
}

// Horizontal lockup: mark height 1.7 x cap height, gap 0.5 x cap height, cap
// centred on the mark. Plex Sans cap height = 0.698 em, descender 0.225 em.
const CAP = .698;
async function lockup({ edition = null, reversed = false, size = 40 }) {
  const capH = CAP * size, mh = 1.7 * capH, mw = mh * 120 / 64, gap = .5 * capH;
  const word = 'Open Med Tray', ww = await measure(word, size, 600);
  const space = await measure('Open Med Tray Lite', size, 600) - await measure('Open Med TrayLite', size, 600);
  const ew = edition ? await measure(edition, size, 500) : 0;
  const x = mw + gap, base = mh / 2 + capH / 2, width = Math.ceil(x + ww + (edition ? space + ew : 0) + 2), height = Math.ceil(Math.max(mh, base + .23 * size));
  const colors = reversed ? { tray: '#FFFFFF', capsule: C.sky } : { tray: C.navy, capsule: C.blue };
  const f = (n) => +n.toFixed(2);
  const body = `<g transform="scale(${f(mh / 64)})">${markPaths('standard', colors)}</g>`
    + `<text x="${f(x)}" y="${f(base)}" font-family="${FONT_STACK}" font-size="${size}" font-weight="600" fill="${reversed ? '#FFFFFF' : C.ink}" textLength="${f(ww)}" lengthAdjust="spacingAndGlyphs">${word}</text>`
    + (edition ? `<text x="${f(x + ww + space)}" y="${f(base)}" font-family="${FONT_STACK}" font-size="${size}" font-weight="500" fill="${reversed ? C.sky : C.accent}" textLength="${f(ew)}" lengthAdjust="spacingAndGlyphs">${edition}</text>` : '');
  const pad = Math.ceil(.06 * mh);
  return svgDoc(width + 2 * pad, height + 2 * pad, body, edition ? `Open Med Tray ${edition}` : 'Open Med Tray', `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`);
}
// Stacked lockup after the selected concept: mark over wordmark, with the
// optional Lite descriptor centred beneath. Open Med Tray itself carries no
// qualifier; Lite is the only edition name.
async function stacked({ edition = null } = {}) {
  const size = 56, capH = CAP * size, mh = 2.6 * capH, mw = mh * 120 / 64, es = size * .5;
  const ww = await measure('Open Med Tray', size, 600), ew = edition ? await measure(edition, es, 500) : 0;
  const width = Math.ceil(Math.max(ww, mw) + 8), cx = width / 2, f = (n) => +n.toFixed(2);
  const wordBase = mh + capH * .9 + capH, edBase = wordBase + size * .36 + CAP * es + es * .55;
  const height = Math.ceil(edition ? edBase + .25 * es : wordBase + .23 * size);
  const body = `<g transform="translate(${f(cx - mw / 2)} 0) scale(${f(mh / 64)})">${markPaths('standard', { tray: C.navy, capsule: C.blue })}</g>`
    + `<text x="${f(cx - ww / 2)}" y="${f(wordBase)}" font-family="${FONT_STACK}" font-size="${size}" font-weight="600" fill="${C.ink}" textLength="${f(ww)}" lengthAdjust="spacingAndGlyphs">Open Med Tray</text>`
    + (edition ? `<text x="${f(cx - ew / 2)}" y="${f(edBase)}" font-family="${FONT_STACK}" font-size="${es}" font-weight="500" fill="${C.accent}" textLength="${f(ew)}" lengthAdjust="spacingAndGlyphs">${edition}</text>` : '');
  const pad = Math.ceil(.06 * mh);
  return svgDoc(width + 2 * pad, height + 2 * pad, body, edition ? `Open Med Tray ${edition}` : 'Open Med Tray', `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`);
}
put('svg/open-med-tray-lockup.svg', await lockup({}));
put('svg/open-med-tray-lockup-reversed.svg', await lockup({ reversed: true }));
put('svg/open-med-tray-lite-lockup.svg', await lockup({ edition: 'Lite' }));
put('svg/open-med-tray-lite-lockup-reversed.svg', await lockup({ edition: 'Lite', reversed: true }));
put('svg/open-med-tray-lockup-stacked.svg', await stacked());
put('svg/open-med-tray-lite-lockup-stacked.svg', await stacked({ edition: 'Lite' }));

// ---------- rasterise ----------
async function raster(svgRel, pngRel, width, height, { bg = null, scale = 1 } = {}) {
  const svg = readFileSync(BRAND + svgRel, 'utf8');
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await p.setContent(`<style>${fontFaces(['500', '600'], false)}html,body{margin:0;background:${bg ?? 'transparent'}}svg{display:block;width:${width}px;height:${height}px}</style>${svg.replace(/ width="[\d.]+" height="[\d.]+"/, '')}`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: BRAND + pngRel, omitBackground: !bg, clip: { x: 0, y: 0, width, height } });
  await p.close(); out[pngRel] = readFileSync(BRAND + pngRel).length;
}
for (const s of [16, 32]) await raster('svg/open-med-tray-favicon.svg', `png/open-med-tray-icon-${s}.png`, s, s);
await raster('svg/open-med-tray-icon-small.svg', 'png/open-med-tray-icon-64.png', 64, 64);
for (const s of [180, 192, 512]) await raster('svg/open-med-tray-icon.svg', `png/open-med-tray-icon-${s}.png`, s, s);
await raster('svg/open-med-tray-mark.svg', 'png/open-med-tray-mark-1200.png', 1200, 640);
for (const name of ['lockup', 'lite-lockup', 'lockup-reversed', 'lite-lockup-reversed', 'lockup-stacked', 'lite-lockup-stacked']) {
  const svg = readFileSync(BRAND + `svg/open-med-tray-${name}.svg`, 'utf8'), [, w, h] = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  await raster(`svg/open-med-tray-${name}.svg`, `png/open-med-tray-${name}@2x.png`, +w, +h, { scale: 2 });
}

// ---------- page imagery (genuine renders; provenance in brand/img/README.md) ----------
// Large source captures live outside the candidate (see capture-renders.mjs);
// when a source is absent the committed JPEG is kept as is.
const SOURCES = process.env.OMT_SOURCES || (process.env.TMPDIR || '/tmp/') + 'omt-brand-sources/';
async function jpeg(srcPath, destRel, crop, width, quality) {
  if (!existsSync(srcPath)) { if (!existsSync(BRAND + destRel)) throw new Error('missing source ' + srcPath); out[destRel] = readFileSync(BRAND + destRel).length; return; }
  const src = 'data:image/png;base64,' + readFileSync(srcPath).toString('base64');
  const h = Math.round(width * crop.h / crop.w);
  const p = await browser.newPage({ viewport: { width, height: h }, deviceScaleFactor: 1 });
  await p.setContent(`<style>html,body{margin:0}</style><canvas id=c width=${width} height=${h}></canvas>`);
  await p.evaluate(async ({ src, crop, width, h }) => { const im = new Image(); im.src = src; await im.decode(); const x = document.getElementById('c').getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, crop.x, crop.y, crop.w, crop.h, 0, 0, width, h); }, { src, crop, width, h });
  await p.screenshot({ path: BRAND + destRel, type: 'jpeg', quality, clip: { x: 0, y: 0, width, height: h } });
  await p.close(); out[destRel] = readFileSync(BRAND + destRel).length;
}
await jpeg(SOURCES + 'lite-tray.png', 'img/lite-tray.jpg', { x: 0, y: 330, w: 2472, h: 1100 }, 1600, 74);
await jpeg(SOURCES + 'lite-tray.png', 'img/lite-tray-band.jpg', { x: 0, y: 548, w: 2472, h: 657 }, 1280, 84);
await jpeg(SOURCES + 'lite-specimen.png', 'img/lite-specimen.jpg', { x: 150, y: 330, w: 2200, h: 1100 }, 1000, 80);
await jpeg(ROOT + '../dataset-v46/test/00052.png', 'img/cycles-render.jpg', { x: 0, y: 0, w: 768, h: 384 }, 768, 84);
const dataUri = (rel, type) => `data:${type};base64,${readFileSync(BRAND + rel).toString('base64')}`;

// ---------- landing imagery (genuine exports; see landing-assets.mjs) ----------
const LS = sourcesFor(ROOT, SOURCES);
const FULL = { x: 0, y: 0, w: 1536, h: 768 }, HALF = { x: 0, y: 0, w: 768, h: 384 };
await jpeg((LS.lite ?? '/missing/') + HERO_SCENE + '/rgb.png', 'img/lite-hero.jpg', FULL, 1536, 80);
await jpeg((LS.lite ?? '/missing/') + BENCH_SCENE + '/rgb.png', 'img/lite-bench.jpg', FULL, 1100, 80);
await jpeg((LS.corpus ?? '/missing/') + STACK_SCENE + '.png', 'img/cycles-stack.jpg', HALF, 768, 88);
await jpeg((LS.corpus ?? '/missing/') + CYCLES_BENCH + '.png', 'img/cycles-bench.jpg', HALF, 768, 86);
const keep = (rel, make) => { if (make) put(rel, make()); else if (existsSync(BRAND + rel)) out[rel] = readFileSync(BRAND + rel).length; else throw new Error('missing ' + rel); };
keep('img/lite-hero-labels.json', LS.lite && (() => JSON.stringify(heroLabels(LS.lite + HERO_SCENE + '/'))));
const STACK = LS.corpus ? stackLayers(LS.corpus, STACK_SCENE) : null;
// Flat label maps stay lossless PNG; layers with photographic or smooth content are JPEG.
const STACK_FMT = { instance: 'png', class: 'png', ink: 'png', depth: 'jpg', cover: 'jpg', sticker: 'jpg' };
for (const [k, f] of Object.entries(STACK_FMT)) {
  if (f === 'png') { keep(`img/cycles-stack-${k}.png`, STACK && (() => STACK.layers[k])); continue; }
  const tmp = SOURCES + `stack-${k}.png`;
  if (STACK) { mkdirSync(SOURCES, { recursive: true }); writeFileSync(tmp, STACK.layers[k]); }
  await jpeg(STACK ? tmp : '/missing/', `img/cycles-stack-${k}.jpg`, HALF, 768, 86);
}
keep('img/cycles-stack.json', STACK && (() => JSON.stringify({ scene: STACK_SCENE, width: STACK.w, height: STACK.h, pills: STACK.pills, classes: STACK.classes, depth_m: STACK.depthRange.map((v) => +v.toFixed(3)) })));

// ---------- social preview 1280 x 640 ----------
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  const lockSrc = readFileSync(BRAND + 'svg/open-med-tray-lockup.svg', 'utf8');
  const [vx, , , vh] = lockSrc.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number), textX = +lockSrc.match(/<text x="([\d.]+)"/)[1];
  const textLeft = Math.round((textX - vx) * 92 / vh);
  const lock = lockSrc.replace(/ width="[\d.]+" height="[\d.]+"/, ' style="height:92px;width:auto;display:block"');
  await p.setContent(`<style>${fontFaces(['400', '500', '600'], true)}
html,body{margin:0;width:1280px;height:640px;overflow:hidden;background:#F4F3EF;font-family:"IBM Plex Sans",sans-serif;color:${C.ink}}
.top{position:absolute;left:72px;top:58px;right:80px}
.d{margin:18px 0 0 ${textLeft}px;font-size:27px;line-height:1.3;font-weight:400;color:#3E4A58;letter-spacing:-.003em}
.band{position:absolute;left:0;right:0;bottom:0;height:340px;background:url(${dataUri('img/lite-tray-band.jpg', 'image/jpeg')}) center/cover}
</style><div class="top">${lock}<div class="d">Synthetic medication-tray scenes with per-pixel labels</div></div><div class="band"></div>`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: BRAND + 'png/open-med-tray-social-preview.png' });
  await p.close(); out['png/open-med-tray-social-preview.png'] = readFileSync(BRAND + 'png/open-med-tray-social-preview.png').length;
}

// ---------- HTML pages from templates ----------
const vars = {
  FONTS: fontFaces(['400', '500', '600'], true),
  FAVICON: faviconDataUri(),
  MARK: inlineMark('standard', { tray: C.navy, capsule: C.blue }, 'class="mark" aria-hidden="true"'),
  MARK_SMALL: inlineMark('small', { tray: C.navy, capsule: C.blue }, 'class="mark" aria-hidden="true"'),
  MARK_REVERSED: inlineMark('standard', { tray: '#FFFFFF', capsule: C.sky }, 'class="mark" aria-hidden="true"'),
  MARK_MONO: inlineMark('standard', { tray: C.ink, capsule: C.ink }, 'class="mark" aria-hidden="true"'),
  TILE: inlineTile('standard', 'class="tile" aria-hidden="true"'),
  TILE_SMALL: inlineTile('small', 'class="tile" aria-hidden="true"'),
  TILE_PIXEL: inlineTile('pixel', 'class="tile" aria-hidden="true"'),
  PNG16: () => dataUri('png/open-med-tray-icon-16.png', 'image/png'),
  PNG32: () => dataUri('png/open-med-tray-icon-32.png', 'image/png'),
  IMG_TRAY: () => dataUri('img/lite-tray.jpg', 'image/jpeg'),
  IMG_SPECIMEN: () => dataUri('img/lite-specimen.jpg', 'image/jpeg'),
  IMG_CYCLES: () => dataUri('img/cycles-render.jpg', 'image/jpeg'),
  IMG_HERO: () => dataUri('img/lite-hero.jpg', 'image/jpeg'),
  HERO_LABELS: () => readFileSync(BRAND + 'img/lite-hero-labels.json', 'utf8').replace(/</g, '\\u003c'),
  IMG_LITE_BENCH: () => dataUri('img/lite-bench.jpg', 'image/jpeg'),
  IMG_CYCLES_BENCH: () => dataUri('img/cycles-bench.jpg', 'image/jpeg'),
  STACK_RGB: () => dataUri('img/cycles-stack.jpg', 'image/jpeg'),
  ...Object.fromEntries(Object.entries(STACK_FMT).map(([k, f]) => ['STACK_' + k.toUpperCase(), () => dataUri(`img/cycles-stack-${k}.${f}`, f === 'png' ? 'image/png' : 'image/jpeg')])),
  STACK_META: () => readFileSync(BRAND + 'img/cycles-stack.json', 'utf8'),
  LOCKUP_STACKED: () => readFileSync(BRAND + 'svg/open-med-tray-lockup-stacked.svg', 'utf8').replace(/<svg [^>]*?width="[\d.]+" height="[\d.]+"/, (m) => m.replace(/ width="[\d.]+" height="[\d.]+"/, ' class="stacked"')),
};
const fill = (tpl) => tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => { if (!(k in vars)) throw new Error('unknown template var ' + k); const v = vars[k]; return typeof v === 'function' ? v() : v; });
for (const [src, dest] of [['src/specimen.html', BRAND + 'specimen.html'], ['src/landing.html', ROOT + 'index.html'], ['src/explorer.html', ROOT + 'explorer.html']]) {
  if (!existsSync(BRAND + src)) continue;
  const html = fill(readFileSync(BRAND + src, 'utf8'));
  writeFileSync(dest, html); out[dest.replace(ROOT, '')] = Buffer.byteLength(html);
}
copyFileSync(APP + 'licenses/IBM-Plex-fonts.LICENSE.txt', BRAND + 'licenses/IBM-Plex-fonts.LICENSE.txt');

await browser.close();
writeFileSync(BRAND + 'build-manifest.json', JSON.stringify({ generated_by: 'brand/tools/build-brand.mjs', palette: C, files: out }, null, 1) + '\n');
console.log(Object.entries(out).map(([k, v]) => `${k.padEnd(52)} ${v}`).join('\n'));
