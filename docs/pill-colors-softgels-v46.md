# Pill colors and oral softgel shape coverage — 28 September 2026

The previous v4.6 draft was too narrow: four softgel colors, elongated ellipsoids, and mandatory full transmission. It was stopped before training and preserved as `dataset-v46-pre-softgel-development`. The final corpus is regenerated from a new immutable source snapshot.

## Primary appearance evidence

| Source | What it establishes | Scope |
|---|---|---|
| [Utrogestan manufacturer SmPC](https://www.medicines.org.uk/emc/product/352/smpc) | Round, slightly yellow soft capsules; approximately 8.6 × 8.6 mm | One actual product, not a prevalence estimate |
| [Ibuprofen manufacturer SmPC](https://www.medicines.org.uk/emc/product/14695/smpc) | Transparent reddish-pink oval softgels, approximately 17 × 11 mm | Demonstrates colored transparency |
| [Roaccutane manufacturer leaflet](https://www.medicines.org.uk/emc/product/100634/pil) | Oval opaque brown-red shells; one strength has brown-red and white shells | Demonstrates opaque and two-color softgels |
| [Buscomint manufacturer leaflet](https://www.medicines.org.uk/emc/product/11329/pil) | Dull green oval soft capsules; Austrian trade name also listed | Green softgels need not be glass-like |
| [Progesterone manufacturer leaflet](https://www.medicines.org.uk/emc/product/101492/pil) | Off-white opaque round soft capsules | White round objects are not necessarily tablets |
| [Irish regulator: Dutasteride Krka](https://www.hpra.ie/img/uploaded/swedocuments/Licence_PA1347-069-001_26082021110230.pdf) | Light-yellow oblong soft capsules, approximately 16.5 × 6.5 mm | Distinct long rounded form |
| [EVP manufacturer geometry sheet](https://evp.group/app/uploads/Fact-Sheet-Softgels.pdf) | Round, oval, and oblong manufacturing examples with dimensions | Supports bounded shape/size diversity |
| [Catalent manufacturing overview](https://cdn.catalent.com/files/digitallibrary/Brochure-Catalent-Consumer-Health-Offerings.pdf) | Multiple softgel shapes, colors and sizes | Technology coverage, not hospital usage |
| [Capsugel hard-capsule color selector](https://translations.capsugel.com/resources/build-your-own-capsule/color-selection-tool/index) | Standard/custom shell palette | Separate shell halves may differ |
| Existing BASG appearance atlas | 50 curated Austrian product-description priors, with PDF hashes and explicit missing-dimension assumptions | Broad initial coverage; not a complete Austria/Europe catalogue |

## Implemented controls

- 25 named palette anchors: white/off-white/cream/beige, yellows, peach/orange, pink/salmon, red/brown-red/burgundy/brown, blues, greens/teal, lilac/violet, gray/near-black, amber/clear-straw. Subsets depend on dosage form and finish; RGB values are bounded artistic priors, not measured product colorimetry.
- Uncoated tablets are neutral-biased; coated tablets admit more colors; hard capsule cap/body colors vary independently within a coherent product prototype. These are coverage choices, not population frequencies.
- Oral softgel meshes support **round, oval and oblong**. Oblongs have adjustable straight-side length and rounded ends. Size, aspect ratio, height, minor forming asymmetry, and rotary-die seam width/relief are recorded. Two-tone softgels meet along a longitudinal shell seam, not a hard capsule's telescoping cap.
- Transparent, translucent, milky, and opaque material states have independent transmission, absorption density, suspension scattering and roughness. Opaque two-color shells are supported. Fine surface variation remains small, unlike pressed-tablet grain/chipping.
- Capsule/softgel print conforms to the curved mesh, with roll changing visibility. Rich targets retain color families, both colors, shape subtype, opacity, seam geometry and material parameters.
- Repeated products within one tray share dimensions and color. Render illumination/camera vary without changing the product's nominal material color targets.

## Limits and exclusions

This is not a verified full catalogue. Descriptions constrain appearance categories, not optical constants, exact pigments, prevalence or clinical identity. Clear hard capsules with separately modelled powder/pellet fills remain a gap. Softgel optics use a homogeneous fill/shell proxy rather than independently meshed liquid and shell interfaces. Twist-off cosmetic, topical, tube and suppository shapes are not sampled as ordinary oral pills. Manufacturer size codes in minims/cc must not be mistaken for millimetres. A color or shape never establishes medication identity or milligrams.

## Optical correction after independent Opus review

The review identified a real defect: peak-normalizing absorption tint discarded source brightness, turning brown translucent shells pinkish and green shells pale. The final material uses `softgel_optics.py`: nominal linear RGB **transmittance at an 8 mm reference path** is mapped through Beer–Lambert attenuation to per-channel extinction. This agrees with [Cycles' implementation](https://raw.githubusercontent.com/blender/blender/main/intern/cycles/kernel/svm/closure.h), where absorption coefficient equals `(1 - node color) × node density`. A density control of150 is the reference multiplier; actual coefficients in1/m are recorded separately. The reference path and values are design priors. They are not spectrophotometry.

A separate colored opaque lobe is mixed with the clear refracting lobe, avoiding white diffuse leakage in partially transmitting shells. Opaque colors remain diffuse albedo parameters. Consequently the model's color outputs are called **nominal material color parameters**, not universally reflectance colors. Exact rendered RGB also depends on thickness, view, background, light, scattering, tone mapping and camera processing. The optical test reconstructs reference-path transmission, not photographed color accuracy.

The rejected pre-correction corpus is preserved separately and never trains a model. `before-optical-correction/` holds the diagnostic sheet; the primary sheet and12cases use the corrected shader. Five color cases and the zero-density edge case pass the independent transmission contract check in `optics-qa.json`.

Source-description color labels remain intact in metadata. Curated atlas labels can add aliases or extra descriptions to the25 procedural anchors (for example `offwhite` versus `off_white`, or `light_brown`). These strings support traceability and descriptive slices; they are not a standardized color ontology or a separate supervised color-name head. The model's numeric material-color targets are independent of those names.
