// Open Med Tray Lite — reproducible single-file build: bundle JS (esbuild),
// inline CSS and fonts (base64 WOFF2), prepend third-party licence texts.
// Output: index.html. Local legacy filenames remain available outside the
// source tree for collections that are keyed by their earlier page path.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('.', import.meta.url).pathname;
const r = (p) => readFileSync(here + p);

// Fingerprint inputs rather than output HTML (avoids a self-referential hash).
const sourceHash=createHash('sha256');
function fingerprint(dir){for(const entry of readdirSync(here+dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=dir+'/'+entry.name;if(entry.isDirectory())fingerprint(path);else sourceHash.update(path).update(r(path));}}
fingerprint('src');fingerprint('fonts');
for(const path of ['build.mjs','package.json','package-lock.json','../LICENSE','../THIRD_PARTY_NOTICES.md'])if(existsSync(here+path))sourceHash.update(path).update(r(path));
for(const config of ['classes.json','photoreal-v46.json','appearance-presets.json'])sourceHash.update(config).update(readFileSync(new URL('../configs/'+config,import.meta.url)));
const generatorRevision=sourceHash.digest('hex');

const out = await build({
  entryPoints: [here + 'src/main.js'], bundle: true, format: 'iife', minify: true, write: false,
  target: ['es2022', 'chrome110', 'safari16.4', 'firefox115'], legalComments: 'none', sourcemap: false,
  loader: {'.png':'dataurl'},
  define: { 'process.env.NODE_ENV': '"production"', __PA_GENERATOR_REVISION__:JSON.stringify(generatorRevision) }, logLevel: 'warning',
  // CSG 0.0.18 uses the pre-0.9 BVH spelling. Keep the pinned dependencies
  // untouched (shared with the original workbench), and update only this
  // equivalent option name in the bundled source. Never suppress warnings.
  plugins: [{name:'csg-bvh-option-compat',setup(b){
    b.onLoad({filter:/three-bvh-csg\/src\/core\/Brush\.js$/},args=>{
      const source=readFileSync(args.path,'utf8');
      if(!source.includes('maxLeafSize: 3'))throw new Error('CSG compatibility patch needs review');
      return {contents:source.replace('maxLeafSize: 3','targetLeafSize: 3'),loader:'js'};
    });
  }}],
});
let js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const fonts = [
  ['Instrument Serif', 400, 'normal', 'instrument-serif-latin-400-normal.woff2'],
  ['Instrument Serif', 400, 'italic', 'instrument-serif-latin-400-italic.woff2'],
  ['IBM Plex Sans', 400, 'normal', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['IBM Plex Sans', 500, 'normal', 'ibm-plex-sans-latin-500-normal.woff2'],
  ['IBM Plex Sans', 600, 'normal', 'ibm-plex-sans-latin-600-normal.woff2'],
  ['IBM Plex Sans', 700, 'normal', 'ibm-plex-sans-latin-700-normal.woff2'],
  ['IBM Plex Mono', 400, 'normal', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['IBM Plex Mono', 500, 'normal', 'ibm-plex-mono-latin-500-normal.woff2'],
];
const fontCss = fonts.map(([fam, w, st, f]) => `@font-face{font-family:"${fam}";font-weight:${w};font-style:${st};font-display:block;src:url(data:font/woff2;base64,${r('fonts/' + f).toString('base64')}) format("woff2")}`).join('\n');

const licences = [
  ['Open Med Tray', '../LICENSE'],
  ['three.js', 'node_modules/three/LICENSE'],
  ['three-mesh-bvh', 'node_modules/three-mesh-bvh/LICENSE'],
  ['three-bvh-csg', 'node_modules/three-bvh-csg/LICENSE'],
  ['fflate', 'node_modules/fflate/LICENSE'],
  ['IBM Plex (fonts)', 'node_modules/@fontsource/ibm-plex-sans/LICENSE'],
  ['Instrument Serif (font)', 'node_modules/@fontsource/instrument-serif/LICENSE'],
];
mkdirSync(here + 'licenses', { recursive: true });
let licText = 'Open Med Tray Lite is MIT licensed. Bundled third-party software and fonts retain their own licences. Full licence texts follow.\n';
for (const [name, p] of licences) {
  const t = r(p).toString('utf8').replace(/\*\//g, '* /');
  licText += `\n==== ${name} (${p.replace('node_modules/', '')}) ====\n${t}\n`;
  copyFileSync(here + p, here + 'licenses/' + name.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') + '.LICENSE.txt');
}

const pkg = JSON.parse(r('package.json'));
const versions = Object.entries(pkg.dependencies).map(([k]) => `${k}@${JSON.parse(r(`node_modules/${k}/package.json`)).version}`).join(', ');
let html = r('src/index.html').toString('utf8')
  .replace('/*@FONTS@*/', () => fontCss)
  .replace('/*@CSS@*/', () => r('src/styles.css').toString('utf8'))
  .replace('/*@JS@*/', () => `/*!\n${licText}\n*/\n/* bundled: ${versions} */\n${js}`);
const files = ['index.html'];
for (const file of files) writeFileSync(here + file, html);
const hash = createHash('sha256').update(html).digest('hex');
writeFileSync(here + 'build-info.json', JSON.stringify({ file: files[0], files, generatorRevision, bytes: Buffer.byteLength(html), sha256: hash, built: new Date().toISOString(), dependencies: versions, node: process.version }, null, 2));
console.log(`${files.join(' = ')} ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB sha256 ${hash.slice(0, 16)}`);

const legacy = new URL('../artifacts/web-parity-v3/', import.meta.url).pathname;
if (existsSync(legacy)) {
  for (const name of ['open-med-tray-lite.html', 'pill-atelier.html']) writeFileSync(legacy + name, html);
}
