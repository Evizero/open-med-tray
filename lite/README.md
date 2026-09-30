# Open Med Tray Lite

The browser edition of Open Med Tray: shape synthetic tablets, capsules and softgels, fill seeded medication trays, and export labelled scenes, all from one offline HTML file.

**Use it:** open [`index.html`](index.html) in a current desktop or mobile browser with WebGL 2, or the hosted copy at [evizero.github.io/open-med-tray/lite/](https://evizero.github.io/open-med-tray/lite/). The file is self-contained (script, styles, fonts and textures inlined), makes no network requests and ships a `default-src 'none'` Content Security Policy.

## What it does

| Mode | |
|---|---|
| **Specimen** (`1`) | One tablet, capsule or softgel on a stone sweep. 16 presets, or **Resample** for a whole new pill from the product priors; outline, dimensions in mm, crown, score, imprint, surface and damage are live controls, and dimension lines drawn on the mesh can be dragged. |
| **Tray** (`2`) | Seeded scenes in ten container families with their own covers, invented branding and stickers, worktops, lighting and a physical capture camera; **Resample** draws a whole new one. Click a pill to edit it; `L` cycles render, instance and class views. |
| **Dataset** (`3`) | Batches of seeded scenes (768 × 384 to 1536 × 768, 4–32 samples) collected in the browser, inspectable per scene and downloadable as a ZIP. |

Each exported scene contains `rgb.png`, `instance_ids.png` (16-bit), `semantic_ids.png`, `label_preview.png` (for viewing only) and `metadata.json`. The ZIP also repeats every scene in the full generator's training layout under `blender/train/`, with depth, cover, sticker, printed-ink and glare targets; `manifest.json` and a README in the ZIP define every field and class.

Labels come from a separate pinhole pass of the same frozen scene and camera. They mark visible geometric surfaces with transparent covers removed, so refraction, glare and blur in the render can move edges in those regions.

## Introduction and controls

An introduction sheet opens on every load: what Lite is, the three modes, and what separates it from the full generator. **Open the workbench**, Esc, the close button or a click outside it dismisses it. The mark at the top of the rail reopens it. With reduced motion the sheet appears and closes without animation, and the camera does not move. For automated tests only, `?no-intro` skips the sheet.

Keys: `1` `2` `3` modes · `[` `]` preset · `R` resample the pill or tray scene · `L` label view · `0` reset view · `Esc` leave pill inspection or collapse the phone sheet. On phones the rail becomes a top bar with the three modes, the panel a bottom sheet you drag or tap between two states, and Resample floats above the collapsed sheet.

## Saved collections

Collections are stored in the browser's IndexedDB under a key made from the page path. A copy of the file at another path, including an earlier filename, starts with its own empty collection; open the file that made a collection to reach it. Browsers can clear this storage, so download anything you need to keep.

## Differences from the full generator

Lite is a subset of Open Med Tray, not a port with full parity. It renders with three.js WebGL 2 physically based materials and progressive refinement (up to 40 samples, 20 on phones) instead of Cycles path tracing:

- no caustics or inter-reflections, and transmission sees only opaque objects, so clear softgels read lighter and less saturated;
- simpler tray materials: no subsurface scattering, and clear lids blend Fresnel and haze without refraction offset;
- polygon and heart imprints are relief-shaded rather than cut geometry; scores and damage do change the silhouette;
- damage cuts take up to about a second each and are recomputed on slider release.

Geometry, appearance and optical priors are ported from the generator's `blender/` modules without changing them.

## Build

Node 22:

```bash
npm ci
npm run build     # esbuild bundle + inlined CSS, fonts and licences -> index.html, build-info.json
```

Sources are in `src/`: `geo/` geometry, `render/` materials, lighting and pipeline, `scene/` catalogue, pills and trays, `labels/` ID pass and export, `ui/` controls, panels, inspector and the introduction (`ui/intro.js`), `app/stage.js` scene and camera, and `main.js` wiring. The introduction's browser check is `qa/intro/intro-qa.mjs`.

## Licences

three.js, three-mesh-bvh and three-bvh-csg (MIT), fflate (MIT), IBM Plex Sans and Mono and Instrument Serif (SIL OFL 1.1). Full texts are embedded at the top of the built file and copied to `licenses/`. Textures are procedural, except the oak worktop, a synthetic ImageGen albedo documented in `src/assets/oak-imagegen-v3.md`. All names, brands and sticker identifiers are invented; nothing here identifies a real medicine or makes a clinical claim.
