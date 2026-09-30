<img src="brand/png/open-med-tray-lockup@2x.png" alt="Open Med Tray" width="300">

# Open Med Tray

Open Med Tray generates synthetic medication-tray scenes with per-pixel labels for computer-vision research. Tablets, capsules, softgels, containers, lighting and cameras are procedural and seeded. Every render comes with integer instance and class IDs and further geometry-derived targets from the same scene and camera. Labels mark visible geometric surfaces with transparent covers removed, while the render adds refraction, glare and defocus, so edges need not align exactly in those regions (see [Generator and labels](#generator-and-labels)).

Open Med Tray was previously called MedTray. Reports, videos and files made before the rename keep that name.

## Products

**Open Med Tray** is the full generator. It renders with Cycles in Blender 5.2, from Python scripts or through the add-on panel, and produced the datasets and experiments below.

**Open Med Tray Lite** runs the generator family in the browser: one self-contained HTML file, offline, no install. You can shape a single tablet or capsule, compose seeded trays and collect labelled scenes into a downloadable dataset. It uses raster rendering and does not yet match every feature of the full generator. See its [README](artifacts/web-parity-v3/README.md).

## Get started

- **Open Med Tray Lite:** open [`artifacts/web-parity-v3/open-med-tray-lite.html`](artifacts/web-parity-v3/open-med-tray-lite.html) in a current browser with WebGL 2. The earlier filename, `pill-atelier.html`, is the same build and stays available. Collections are stored in the browser per file, so if you collected scenes under the old filename, keep using it or download the collection before switching.
- **Blender add-on:** download [`artifacts/open-med-tray-addon.zip`](artifacts/open-med-tray-addon.zip). In Blender 5.2, open Preferences → Add-ons → Install from Disk, choose the ZIP, then open the **Open Med Tray** tab in the 3D View sidebar. Operator and property IDs are unchanged, so existing `.blend` files keep working ([notes](blender/README.md)).
- **Datasets and training:** see [Reproduce](#reproduce).
- **Front door:** [`index.html`](index.html) links the products, research and brand assets.

## Release status

Open Med Tray is a research preview, not a public release.

- It makes synthetic images. It does not identify medication, is not a medical device and has not been validated for any clinical purpose.
- Model scores below were measured on synthetic scenes. Real-image performance, medication identity and dose remain unvalidated.
- Open Med Tray Lite does not have full feature or rendering parity with the Cycles generator.
- Licensing is not final. Terms for the generator, Lite and the Blender add-on are still being decided.
- The [release audit](docs/open-med-tray-release/audit.html) lists what must be resolved before a public release.

## Research results

The experiments below are historical records, published under the name MedTray and kept unchanged; reissues under the new name are pending. They train a compact TensorFlow Metal proof of concept for pill segmentation and counting on the generated data. All model weights start from scratch and all training pixels are synthetic. Claude Opus 5.5 designed the explorer and trailers; the parent session handled ML, rendering and evidence verification.

### Open the results

- [v4.9 experiment: improving the BiFPN query model](artifacts/claude-report-v49/medtray-v49-results.html) — standalone results page, **1.0 MB**; [write-up](docs/experiment-v49.md). None of eight screened changes (prior supervision, refinement, attention, IoU scoring, pile reweighting, targeted data) passed its pre-declared gate. The same v4.8 model trained for 45 instead of 30 epochs improves a fresh, once-evaluated 152-scene synthetic holdout: F1 0.861 → 0.876 (second seed 0.868), count MAE 1.47 → 1.18, two-tone split + missed 59 → 51 of 183. The gain is about the size of the seed-to-seed variation, and split two-colour capsules remain on the ImageGen photos. **The v4.7 model below remains the default.**
- [v4.8 experiment: direct whole-instance masks](artifacts/claude-report-v48/medtray-v48-results.html) — standalone results page, **2.5 MB**; [write-up](docs/experiment-v48.md). On synthetic scenes, a one-to-one query-mask model raises instance F1 (validation 0.821 → 0.863, test 0.880 → 0.906, stress 0.753 → 0.824) and reduces two-tone capsule splits and misses. It does not solve two-tone capsules, and it shows new merges and printed-graphic false masks in reviewed cases. **The v4.7 model below remains the default.**
- [Simplified explorer](artifacts/claude-report-v47/medtray-explorer-v47.html) — one scene viewer, Render / Labels / Prediction, comparison wipe, 47 example scenes and ten unlabeled ImageGen comparisons. Optional model details. Standalone offline HTML, **6.53 MB**. It also opens inside the Open Med Tray frame at [`explorer.html`](explorer.html); the report itself is unchanged.
- [Updated mobile trailer](artifacts/claude-trailer-v47-beat/medtray-trailer-v47-beat-mobile.mp4) — **66 seconds, 720p, 9.14 MB**. Opus 5.5 replaced the soundtrack with a continuous 120 BPM groove, accelerated the flat 2D network through four real inputs, and replaced the closing notes with a beat-synchronized visual montage. The model and explorer are unchanged. [Verification](artifacts/claude-trailer-v47-beat/delivery-manifest.json).
- [Network preview with soundtrack](artifacts/claude-trailer-v47-beat/medtray-trailer-v47-beat-network-720.mp4) — **20 seconds, 1.95 MB**. Matching real input/features/heads/results for each of four scenes.
- [Ending preview with soundtrack](artifacts/claude-trailer-v47-beat/medtray-trailer-v47-beat-finale-720.mp4) — **18 seconds, 5.39 MB**. Comparison predictions, pill/material/container montage, targets, predictions and the expanding dataset canvas.
- [1080p master](artifacts/claude-trailer-v47-beat/medtray-trailer-v47-beat.mp4) — **67.35 MB**. [Previous silent 2D edition](artifacts/claude-trailer-v47-2d/medtray-trailer-v47-2d-mobile.mp4) remains preserved.
- [Experiment and research](docs/experiment-v47.md), [ImageGen failure review](docs/imagegen-review-v47.md), [full measured results](artifacts/comparison-v47/paired-results.json) and [delivery verification](artifacts/delivery-v47.json).
- [Blender add-on v4.6](artifacts/medtray_blender_addon_v46.zip) (historical package), [appearance atlas](artifacts/appearance-atlas/README.md), [container research](artifacts/container-reference-study/README.md) and [softgel/color evidence](docs/pill-colors-softgels-v46.md).

## New model results

The v4.7 detector improves on the same fixed synthetic scenes, without rendering another corpus. It uses a 1.03M-parameter residual depthwise encoder-decoder, separate foreground/boundary/instance/family heads, stronger geometric and camera augmentation, restrained training-only copy-paste and instance-F1 checkpoint selection. This is a combined experiment; it does not isolate the effect of augmentation.

| Synthetic split | Previous mask F1 | v4.7 mask F1 | Previous count MAE | v4.7 count MAE |
|---|---:|---:|---:|---:|
| Test | 0.496 | **0.880** | 2.40 | **0.64** |
| Stress | 0.435 | **0.753** | 4.69 | **2.21** |

Mask matching is class-agnostic IoU ≥0.50, visible GT ≥10 pixels on a common 512×256 evaluation grid. Existing test/stress scenes have historical reporting exposure; they are not a pristine new benchmark. v4.7 receives 640×320 inputs. Checkpoint/threshold selection used validation only and was frozen before the new test evaluation.

Printing remains a weakness: test print-associated false positives rose from 3 to 13, although total false positives fell from 112 to 51. Matched-instance coarse-family accuracy is 43.0% on test. ImageGen comparisons reveal split two-tone capsules, low-contrast misses, debris/reflection confusion and false detections on an empty tray. These images have no ground truth or accuracy score. **Real-image performance, medication identity and dose remain unvalidated.**

The explorer passed 22 offline DOM/image/data checks; real browser CSS/layout/touch inspection was unavailable. The beat edit passed all 1,584 frames of text-layout auditing with supersampled-font measurements, parallel-render parity and full encoded-file decoding. Its score measured −14.0 LUFS integrated and −5.82 dBTP; the network now has continuous audio. Opus and parent inspected selected rendered/compressed stills, sequential-frame strips and source. Real-time video playback and perceptual listening were unavailable. See each artifact's review notes for the precise scope.

The [v4.6 report](artifacts/claude-report-v46/medtray-research-v46.html), [v4.6 trailer](artifacts/claude-trailer-v46/medtray-trailer-v46-mobile.mp4), [previous README](artifacts/legacy-readme-v46.md) and older experiments remain preserved. The normalized generator-parameter embedding proposal is [deferred](docs/deferred-parameter-embedding.md). The older crop embedding is retained separately, unchanged; it is not part of the new detector or simplified explorer.

## Generator and labels

The v4.6 corpus contains **1,056 scenes: 704 train, 104 validation, 112 test and 136 stress**, at 768 × 384 and 64 Cycles samples. It combines 960 base scenes and 96 separately tracked edge scenes (9.1%). Both component sources and assembly provenance are frozen and SHA-256 hashed. Hero film renders have higher resolution/sample counts and shot-specific parameters; they are not training examples.

Ten tray families cover continuous moulded daily trays, thin blister-style shells, compact trays, varied dividers, removable inserts, four pods, rigid organizers, 2×7 weekly boxes, twin compacts and round cups. Separate cover mechanisms include sliding lids, peel film, individual hinges and no cover. Dimensions, branding placement, multilingual labels, icons, fonts, fictional logos, stickers, scratches and oil smudges vary. Weekly mechanisms are approximate procedural geometry, not a complete packaging catalogue. The edge supplement includes sparse/dense occupancy, spills, wide scatter, heavy labels, cover occlusion and cropped framing; component and scenario IDs remain available for evaluation slices.

Lighting includes controlled chamber LEDs, window light, sunlight and indoor lighting. Worktops include wood, laminate, plastic and clean or fingerprint-clouded metal. Camera clearance is 100–150 mm above the tray rim, varying pose, focal length, aperture, exposure and sensor effects. Fine pressed grain and rare angular granule losses replace the rejected regular crater texture. Capsules have separate colored shells, seams and wear. Softgels vary round/oval/oblong geometry, intended opacity, palette and nominal absorption; this is a homogeneous shell/fill proxy with uncalibrated optical priors. Independent score width/depth, thin face rims, stronger stepped profiles, large crossed/stacked/boxed/symbol imprints, irregular chunks and tilted fractures vary. Powder and loose pieces inherit their source's core material.

Every scene exports:

- `NNNNN.png`: rendered RGB.
- `NNNNN_semantic.png`: integer class IDs from [classes.json](configs/classes.json).
- `NNNNN_instance.png`: uint16 instance IDs; caps and markings share the parent pill ID.
- `NNNNN_film.png`: transparent-cover coverage mask.
- `NNNNN_print.png`, `NNNNN_sticker.png`, `NNNNN_glare.png`: exact printed-ink, opaque sticker and heuristic glare targets (see filenames in the corpus).
- `NNNNN_depth.npy`: camera-ray depth in metres without the transparent cover.
- `NNNNN_colors.png`: viewable semantic palette.
- `NNNNN.json`: seeds, camera scale, tray/cover/lighting, slots, attributes, bounding boxes, visible pixels, imprint results and label contract.

Instance/count evaluation requires at least 10 visible pixels on the fixed 512 × 256 evaluation grid. Embedding crops require at least 30 visible pixels in the original 768 × 384 scene. Masks are geometric visible surfaces, not amodal targets. The label view removes covers and makes other surfaces opaque. RGB refraction, glare and defocus therefore need not align exactly with label edges. Powder groups, crumbs and loose chunks are class 14 and never counted as whole pills. Subpixel grains and fully hidden pills may have no visible target pixels. Class 15 is reserved for opaque packaging and currently has no generated examples. Seeds and curated appearance-preset IDs are disjoint between splits for the new run; the frozen older baseline may have seen some priors in its earlier training. The audit checks label consistency and seed overlap; it does not certify photorealism or real-image transfer. Debris placement and stacking are approximate, not a mass-conserving fracture or rigid-body simulation.

## Model and GPU scope

The new model has **1,034,245 parameters** and six heads: foreground, boundary, centers, offsets, coarse appearance family and scene-material class. Full-resolution foreground/boundaries retain fine detail; centers and offsets use stride two. It is a small custom architecture informed by modern convolutional and Panoptic-DeepLab principles, not an exact published architecture or a state-of-the-art benchmark claim.

Thirty epochs train from random initialization, batch 16. Validation selects epoch 27, center threshold 0.35 and foreground threshold 0.9. Training/selection took about 49 minutes. TensorFlow 2.18.1 and tensorflow-metal 1.2.0 verified all 132 trainable gradients and six outputs on GPU. Data decoding/augmentation and instance grouping run on CPU. Median synchronized forward time is 83.7 ms, or 100.7 ms with CPU grouping, on one validation image; it excludes image loading/resizing and is not a deployment guarantee.

The camera input is normalized to [-1, 1], aspect-preserving and letterboxed. Augmentation includes rotation, translation, zoom, flips, exposure/gamma/white balance/saturation, blur, noise, downsampling/JPEG and limited uncovered opaque-pill copy-paste. Categorical maps share the same integer nearest-neighbor transform; centers and offsets are rebuilt afterward. The last 20% of training reduces augmentation. See [pre-run diagnosis](docs/model-research-v47.md), [GPU verification](artifacts/tf-panoptic-v47-strong/gpu-verification.json), [augmentation checks](artifacts/model-research-v47/augmentation-qa.json) and [frozen selection](artifacts/comparison-v47/FROZEN_SELECTION.json).

The original supplied photo remains a local design reference and is excluded from the final explorer/trailer. Shape labels and confidence scores are not drug identity or strength. Plan comparisons always require review and never authorize medication administration.

## Reproduce

Tested on Apple M4 Max, Blender 5.2 LTS and Python 3.12. The renderer expects `/Applications/Blender.app/Contents/MacOS/Blender`; use a new output directory for a different source/configuration so frozen datasets remain comparable.

```bash
uv sync --extra dev
uv venv .venv-tf --python 3.12
uv pip install --python .venv-tf/bin/python -r requirements-tf-metal.lock.txt
.venv/bin/python scripts/render_v46_component.py \
  --config configs/photoreal-v46.json --out artifacts/my-v46-base
.venv/bin/python scripts/render_v46_component.py \
  --config configs/photoreal-v46-edge.json --out artifacts/my-v46-edge
# The measured composite assembly is scripts/assemble_v46_dataset.py;
# it has explicit frozen input/output paths and refuses an existing completed corpus.
PYTHONPATH=src .venv-tf/bin/python -m medtray.tf_panoptic_v47 \
  --data artifacts/dataset-v46-combined --out artifacts/my-panoptic-v47 --epochs 30 --batch-size 16
PYTHONPATH=src .venv-tf/bin/python -m medtray.tf_infer_v47 photo.jpg \
  --run artifacts/tf-panoptic-v47-strong --out artifacts/my-inference \
  --plan configs/example_plan.json
```

The plan checker compares visible appearance-family counts in calibrated compartments and always returns review required with identity unverified and administration unauthorized. Product identity, strength, hidden pills and prescription correctness require separate evidence.

Install the add-on ZIP through Blender Preferences → Add-ons → Install from Disk, then open **Open Med Tray** in the 3D View sidebar. Rebuilding a pill modifies the current scene and is undoable. For direct scene generation, `blender/generate.py --help` lists container, camera and rendering overrides; preview outputs include editable `.blend` files.

## Legacy crop embedding and later reference calibration

These commands use the unchanged v4.6 oracle-crop embedding (169,181 parameters, 128-D output). It was not retrained or evaluated end to end with the v4.7 detector. The normalized generator-parameter vector remains future work.

Supply a nonempty JSON array of independently verified product references, including RGB, an individual-object binary mask, product ID, name, manufacturer, strength and finite positive camera scale. Use separate IDs for different strengths or manufacturers. Example structure, with placeholder values to replace:

```json
[
  {"image":"pill.png","mask":"pill-mask.png","product_id":"AT:VERIFIED_ID",
   "name":"VERIFIED_PRODUCT","manufacturer":"VERIFIED_MANUFACTURER",
   "strength":"VERIFIED_STRENGTH","mm_per_pixel":0.08,"verified_reference":true}
]
```

```bash
PYTHONPATH=src .venv-tf/bin/python -m medtray.tf_calibrate \
  --model artifacts/tf-embedding-v46/best.keras build references.json --out bank.json
PYTHONPATH=src .venv-tf/bin/python -m medtray.tf_calibrate \
  --model artifacts/tf-embedding-v46/best.keras query pill.png pill-mask.png \
  --bank bank.json --mm-per-pixel 0.08
```

Reference banks are tied to the exact embedding checkpoint hash. Similarity is not identity probability; no acceptance threshold or real-product recognition score was fitted here. Strengths come from verified reference metadata, never an appearance guess. Keep independent real photographs for validation.

## Austria and Europe

The preserved official BASG export retrieved on 2026-09-27 contains 19,055 distinct registrations, including 16,843 human registrations. The broad oral-solid filter yields 7,949 candidate registrations and 5,775 Fachinformation links. This is an authorization index, not a dispensing whitelist or complete European appearance library. The 50 curated appearance priors draw on 20 official documents; source-declared attributes and procedural assumptions remain distinct. Rare families are intentionally oversampled, not weighted to hospital prevalence. See [research notes](docs/research.md), [appearance atlas](artifacts/appearance-atlas/README.md) and [container sources](artifacts/container-reference-study/README.md).
