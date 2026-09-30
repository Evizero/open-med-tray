# Research basis and coverage

Retrieved 2026-09-27. Official public sources are used for Austrian product indexing; random procedural assets are not assigned real medicine names.

1. **BASG Medikamente Info Austria:** https://medikamente.basg.gv.at/de/medicinal-products . The official export was obtained once using the site's CSV export. Original bytes, a hash, and a derived human oral-solid index are kept locally. The export has multiple veterinary detail rows, hence 30,470 CSV rows but 19,055 distinct registrations.
2. **BASG export and availability guidance:** https://www.basg.gv.at/fuer-unternehmen/online-service/nutzungsbedingungen . Authorisation is distinct from current marketing. A full export is available through an unfiltered search; avoid repeated bulk downloads. No public API is promised.
3. **EMA, SmPC section 3 / pharmaceutical form:** https://www.ema.europa.eu/en/documents/presentation/presentation-section-3-pharmaceutical-form_en.pdf . Appearance descriptions can include shape, color, size and markings. They do not necessarily provide enough measurements or images to reconstruct both pill faces.
4. **BASG Bisoprolol Accord example:** https://medikamente.basg.gv.at/documents/1-31181__DOTC_FACH_INFO.pdf . Page 1 was visually inspected. The shared document differentiates three strengths by diameter and marking. This illustrates why extracting all numbers into one product would be wrong; automated hints stay unverified.
5. **NLM Pill Image Recognition Challenge:** https://pmc.ncbi.nlm.nih.gov/articles/PMC5973812/ . Pill identification needs fine visual distinctions, including imprint detail; consumer images differ from controlled reference photography.
6. **ePillID research:** https://arxiv.org/abs/2005.14288 . A fine-grained, low-shot pill recognition benchmark motivates learning an embedding and using verified reference views. Shape and color alone do not separate many products.
7. **Domain randomization:** https://arxiv.org/abs/1703.06907 . Varying simulated scenes can assist transfer. Success in a different vision task is not evidence that this model works on real medication.
8. **Blender render passes:** https://docs.blender.org/manual/en/latest/render/layers/passes.html . A separate opaque label view avoids interpreting mixed/reflected colors as class IDs. RGB and object-index outputs are preserved separately.

## Physical modeling decisions

The generator uses millimeter-scale objects, continuous molded wells, a thin plastic shell, hemisphere/cylinder capsule geometry, rounded tablet shoulders, score grooves, chipped edges and geometric partial tablets. Matte and chalky surfaces have small roughness/color variations and micron-scale bump. Gloss is mostly associated with capsules and softgels; matte/satin coated tablets are separate finishes.

Backgrounds are procedural wood grain, plastic/laminate, brushed steel, and cloudy steel roughness variation. Steel smudges are stochastic roughness fields, not anatomically exact fingerprint ridge patterns. Tray wear, material dispersion, realistic manufacturing lots and imprint typography are simplified. There is no physics engine settling step; stacking is approximate, so some poses are less realistic than photographed trays.

Lighting includes a square imaging enclosure with a front insertion slot and two diffused LED strips, window light, sun and indoor area lights. Camera position, height, roll, focal length, aperture and metered exposure vary. Blur, white balance, JPEG and sensor noise are training augmentations. Barrel distortion, rolling shutter, Bayer demosaicing and polarization are not modeled in this version.

## Required next evidence

A held-out real capture study is needed to establish transfer. Collect independently labeled photos from the target camera and trays, including empty trays, look-alike strengths/manufacturers, tablets face-down, chips/halves, overlap, strong glare, unfamiliar pills, printed packaging and changes in device/lot. Keep this evaluation separate from any calibration photographs. The two user-provided references are visual checks, not a validated benchmark.

Prioritize reliable foreground/instance separation, then attributes and calibrated product retrieval. General imprint OCR requires native high-resolution crops, varied fonts and code strings, printed/embossed/debossed marks, and explicit unreadable cases. Exact identity must not be inferred from a match in coarse morphology or a dose number alone.
