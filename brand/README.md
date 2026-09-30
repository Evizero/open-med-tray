# Open Med Tray brand

One mark and one wordmark. The product is **Open Med Tray**, with no qualifier; the browser edition is **Open Med Tray Lite**, and *Lite* is the only edition name. Blender appears only in setup and compatibility text, never in a lockup. Open [`specimen.html`](specimen.html) to see everything below at size.

The mark is an open tray holding a two-tone capsule. Its geometry is defined in [`tools/mark-geometry.mjs`](tools/mark-geometry.mjs); every SVG and PNG here is generated from it.

## Files

| Path | Use |
|---|---|
| `svg/open-med-tray-mark.svg` | Colour mark, standard cut, 48 px wide and up |
| `svg/open-med-tray-mark-small.svg` | Colour mark, heavier small cut, 20–47 px wide |
| `svg/open-med-tray-mark-mono.svg`, `-mark-reversed.svg`, `-mark-currentcolor.svg` | One-colour ink, white on dark, and `currentColor` for inline use |
| `svg/open-med-tray-icon.svg`, `-icon-small.svg` | App tile: standard from 96 px, small cut 33–95 px |
| `svg/open-med-tray-favicon.svg` | Favicon tile, fitted for 16–32 px |
| `svg/open-med-tray-lockup.svg`, `-lite-lockup.svg` (+ `-reversed`) | Horizontal lockups |
| `svg/open-med-tray-lockup-stacked.svg`, `-lite-lockup-stacked.svg` | Stacked lockups |
| `png/open-med-tray-icon-{16,32,64,180,192,512}.png` | Raster icons (16 and 32 from the favicon cut, 64 from the small cut) |
| `png/*-lockup*@2x.png`, `png/open-med-tray-mark-1200.png` | Portable raster lockups and mark, transparent |
| `png/open-med-tray-social-preview.png` | 1280 × 640 link preview |
| `img/` | Page imagery cropped from genuine renders; see [`img/README.md`](img/README.md) |

Marks and icons are plain filled paths (no strokes, text, rasters or embedded data). Lockup SVGs use live text and need **IBM Plex Sans** (600 and 500) installed; each text run carries its measured `textLength`, so a fallback font cannot overflow the artwork. Where the font cannot be guaranteed, use the PNG lockups.

## Colour

| Name | Hex | Use |
|---|---|---|
| Tray navy | `#0E3A66` | Mark tray, app tile |
| Capsule blue | `#3D95DE` | Mark capsule only; 3.1:1 on paper, so never for text |
| Accent blue | `#1B64BE` | *Lite*, links, the UI accent; 5.6:1 on `#FBFBF9`, 5.1:1 on the app ground `#F1F1EE` |
| Ink | `#0C2740` | Wordmark and monochrome mark; 14.7:1 on paper |
| Sky | `#6CB6F2` | Capsule and *Lite* on navy; 5.3:1 on navy |
| Paper | `#FBFBF9` | Default ground |

In Open Med Tray Lite the accent blue marks the active tab, primary action, focus ring, live progress and specimen drafting. Class-colour palettes and scene materials do not use brand colours.

## Type

IBM Plex Sans: 600 for the wordmark and headings, 500 for *Lite* and labels, 400 for text. IBM Plex Mono 400 for measurements, identifiers and file names. IBM Plex is licensed under the SIL Open Font License 1.1 ([`licenses/IBM-Plex-fonts.LICENSE.txt`](licenses/IBM-Plex-fonts.LICENSE.txt)); the pages here embed it under that licence.

## Use

- Clear space around the mark: at least the capsule height on every side.
- Keep the capsule's left half in outline and right half filled. Do not recolour it to resemble a real product.
- No red cross, check mark, shield or certification device. Open Med Tray is research software and makes no clinical claim.
- Describe labels precisely: integer instance and class IDs from the same scene and camera. Do not claim that labels match the rendered pixels exactly; covers are removed from labels, and refraction, glare and blur change edges in the render.

## Pages and imagery

The landing page (`src/landing.html` → `../index.html`) and the Lite introduction share one direction: genuine renders on warm paper, read by a single blue drafting line. Motion shows labelling or measuring (a scan that outlines and numbers instances, a plan that plots itself) and is skipped under reduced motion. Page imagery is cropped from real generator and Lite output only; see [`img/README.md`](img/README.md). Overlays drawn on a render must share its pixel grid: the landing hero keeps the render and its outlines in one SVG.

## Rebuild

From the repository root, with Lite's dependencies installed (`cd lite && npm ci`):

```bash
node brand/tools/capture-landing.mjs 8 4100   # optional: fresh Lite exports for the landing ($TMPDIR/omt-brand-sources)
node brand/tools/build-brand.mjs              # SVG, PNG, page imagery, specimen.html, ../index.html
node brand/tools/landing-qa.mjs               # landing checks: layout, label alignment, contours -> brand/qa/landing/
```

Captures and the Cycles corpus are read from outside the repository; when they are absent, the committed files in `img/` are used as they are. Page sources are `src/landing.html`, `src/specimen.html` and `src/explorer.html`.
