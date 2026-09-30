# Page imagery

Every image here is a genuine render, cropped and compressed by `../tools/build-brand.mjs`. None is retouched or generated for marketing.

| File | Source |
|---|---|
| `lite-tray.jpg`, `lite-tray-band.jpg` | Open Med Tray Lite, Tray mode, default scene, interface hidden, captured by `../tools/capture-renders.mjs` at 1600 × 900 CSS px, 2× |
| `lite-specimen.jpg` | Open Med Tray Lite, Specimen mode, preset *Two-piece capsule* (`cap22`), same capture script; the dimension lines are the app's live drafting |
| `cycles-render.jpg` | Open Med Tray generator, Cycles: `artifacts/dataset-v46/test/00052.png` (768 × 384), re-encoded only |

| `lite-hero.jpg`, `lite-hero-labels.json` | Open Med Tray Lite Dataset export `scene_0001` (seed 4100, 1536 × 768, 32 samples), captured by `../tools/capture-landing.mjs`: `rgb.png` re-encoded, and the pill outlines, IDs and classes traced from the same scene's 16-bit `instance_ids.png` by `../tools/landing-assets.mjs` |
| `lite-bench.jpg` | Same Lite export batch, `scene_0005` |
| `cycles-stack.jpg`, `cycles-stack-*.png/.jpg`, `cycles-stack.json` | Open Med Tray generator, Cycles: `artifacts/dataset-v46/test/00008` render with its own instance, semantic, depth, film, sticker and print maps, recoloured for the page by `../tools/landing-assets.mjs` (values unchanged) |
| `cycles-bench.jpg` | Open Med Tray generator, Cycles: `artifacts/dataset-v46/test/00062.png`, re-encoded only |

Brand names, stickers and patient identifiers visible in the renders are procedural and invented.
