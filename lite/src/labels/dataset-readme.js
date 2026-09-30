export function datasetReadme(m) {
  const sem = Object.entries(m.semantic_classes).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
  return `# Open Med Tray Lite mini dataset

**Synthetic** scenes generated in Open Med Tray Lite, the browser edition of Open Med Tray (three.js raster renderer with progressive accumulation). Created ${m.created}. ${m.scenes.length} scene(s), ${m.resolution[0]}×${m.resolution[1]} px, ${m.beauty_samples_per_pixel} beauty samples per pixel, base seed ${m.base_seed}.${m.cancelled_after ? ` Generation was cancelled after ${m.cancelled_after} scene(s); the archive contains only completed scenes.` : ''}

Nothing here identifies a real medicine. Shapes, colours, imprints, brand names and sticker identifiers are procedural priors or invented text. No clinical, identity or strength claim is made or implied. This is not the Blender/Cycles training corpus and its rendering differs from Cycles (see "Fidelity" below).

Open Med Tray Lite was previously called Pill Atelier. For compatibility with existing loaders, archive paths keep the \`pill-atelier-dataset/\` root and the manifest keeps its original \`generator\` values.

## Files per scene

| File | Content |
|---|---|
| \`rgb.png\` | 8-bit sRGB beauty render (Khronos PBR Neutral tone mapping, seeded camera response applied after rendering). Anti-aliased by sub-pixel jitter accumulation. |
| \`instance_ids.png\` | **16-bit grayscale**, one value per pixel: shared instance ID: background 0, tray 1, pills 10+, debris 500, stickers 1000+, printed ink 2000+. Raw IDs, not a visualisation. |
| \`semantic_ids.png\` | 8-bit grayscale semantic class per pixel (table below). |
| \`label_preview.png\` | Visualisation only: colourised instances blended over RGB with ID-derived boxes. Never use as a label. |
| \`metadata.json\` | Seed, full scene configuration, container/cover/sticker/debris records, camera (pose, intrinsics, matrices), seeded camera/ISP response, every pill's family, parameters, materials, pose, dimensions, damage record and pixel box. |

\`manifest.json\` lists all scenes and the per-scene verification results.

## Training-compatible file layout

The \`blender/train/\` directory contains matching six-digit \`.png\`, \`_instance.png\`, \`_semantic.png\` and \`.json\` files with the Blender pipeline's 16 semantic IDs and \`objects\` / \`instance_to_class\` metadata. Background is 0, tray 1, pills begin at 10, debris 500, sticker paper uses even IDs from 1000 and its ink uses the following odd ID. Retained fractured pills keep their shape class. Five/eight-sided and heart outlines map to unknown_shape. Legacy browser round presets map flat/biconvex at crown/thickness 0.075; explicit source families take priority. This mapping is recorded per object.

It additionally supplies metric camera-ray depth as float32 NumPy, the visible cover mask, the processed-RGB glare diagnostic, opaque sticker mask, binary printed-ink mask and 16-bit printed-ink instances. Print IDs are 2000+ for tray graphics and odd IDs 1001–1011 for sticker ink; these also appear in the canonical instance map and metadata lookup as class 1. Printed targets use the authored raster artwork at a 50% coverage threshold with nearest-texel sampling, unlike Blender's text meshes. Depth excludes transparent covers and uses metres, 1 µm quantization and 1e10 for the background. Both file layouts use identical IDs and pixel values. There is one label convention in the browser, inspector and training loaders.

## Semantic classes

| ID | Class |
|---|---|
${sem}

- A two-piece hard capsule's cap and body share **one** instance ID.
- A fractured tablet remaining in the tray is one pill instance retaining its original shape class; its missing volume is recorded as \`damage.remaining_fraction\`. Loose chips, crumbs and powder are **fragments** (class 14, grouped instance ID 500), excluded from pill counts.
- Printed branding and well labels are part of the container (class 1). Opaque paper stickers are class 1 with distinct instance IDs and occlude whatever lies beneath them in screen space.

## Label pass definition

- Rendered with the **same frozen camera, transforms, resolution and seed** as \`rgb.png\`. Before capture all animation is completed and camera damping disabled; the label pass is rendered before and after the beauty pass and the two must be byte-identical (\`state_frozen_between_label_passes\`).
- Pinhole, one sample at each pixel centre. No tone mapping, blending, antialiasing, lighting, environment, textures or colour management. Values are exact integers.
- **Modal** (visible) masks only. Fully hidden pixels are not labelled; \`fully_hidden: true\` marks pills with no visible pixel. No amodal masks are provided.
- \`bbox_xyxy_px\` = [x_min, y_min, x_max + 1, y_max + 1] computed from \`instance_ids.png\` (exclusive max), origin top-left.
- \`instance_png_roundtrip_exact\` / \`semantic_png_roundtrip_exact\`: the written PNG bytes were decoded in the browser and compared value-for-value with the rendered IDs.

## Placement and sampling

The mixed schedule uses ordinary scenes plus a configurable 6% rare stress prior. Ordinary-only and balanced eight-scenario sweeps are available. Stress scenarios are sparse frames, dense wells, table spills, table scatter, heavy labels, lid occlusion, intentional crops and mixed overload. The corpus settings are design priors, not clinical prevalence.

Placement uses each rotated mesh's convex projected hull, actual lower support height and nonnegative clearances. Tablets may face down; capsules/softgels roll and tilt slightly. Stacking is a conservative bounding-height fallback after floor placement fails, with recorded supports and a height cap. Closed covers further restrict height. This is not rigid-body settling. Table regions are distinct from medication compartments. Rejections, requested counts, actual counts, stacks and spills are recorded.

Stress cameras add full roll, nine possible frame anchors and controlled extent; deliberate crops retain only visible labels. Acquisition shift is applied identically to RGB and every target, separately from the interface's screen offset. Camera matrices retain full numeric precision. Depth is quantized to 1 µm, but float32 GPU interpolation at extreme wide angles has larger numerical error; the tested stress cohort had less than 0.003 mm implied support-plane error at the 99.9th percentile.

## Camera response

Seeded machine-vision, clean-phone, processed-phone and low-light appearance priors match the Blender postprocessing parameter ranges: gain, white balance, gamma, vignette, signal-dependent noise, Gaussian blur, sharpening and JPEG. No pixel-coordinate warp is applied. The JS RNG, blur implementation and browser JPEG encoder differ from NumPy/Pillow; equal seeds are not pixel-identical across engines. Metadata records every sampled value; these are not calibrated device models.

## Transparent covers and refraction

Transparent covers (sliding PET lids, film, hinged clear lids) are **excluded** from geometric labels: pills beneath a closed clear cover are labelled where their geometry projects through a pinhole. The beauty RGB shows the cover's reflections, smudge haze, scratches and glare, so image and label can legitimately disagree where glare hides a pill or where a thick clear container body refracts it. Clear tray bodies and softgels use screen-space refraction in RGB; labels use unrefracted geometry. Treat such pixels as label-visible even if they are visually obscured.

## Fidelity

three.js physically based raster rendering, image-based lighting from procedural emissive softboxes, jittered area-light shadow maps, screen-space ambient occlusion (GTAO) and screen-space transmission with analytic Beer–Lambert path length for softgels. It is **not** path traced: there are no caustics, no multiple inter-reflection between pills, and transmission sees only opaque objects behind it. Tablet grain, score grooves, imprints and breakouts are object-space shader relief on real geometry (scores also displace vertices; chips and fractures are real CSG geometry). Colour values are nominal material parameters, not measured colorimetry.
`;
}
