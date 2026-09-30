# Third-party notices

The root MIT License applies to original Open Med Tray source and documentation. It does not relicense third-party code, fonts or other separately licensed material. Preserve the notices shipped with those components.

- Lite bundles three.js, three-mesh-bvh, three-bvh-csg and fflate under MIT. Full notices are in `lite/licenses/` and embedded in the standalone HTML.
- IBM Plex Sans, IBM Plex Mono and Instrument Serif use the SIL Open Font License 1.1. Their notices are in `lite/licenses/`; the branding font notice is also in `brand/licenses/`.
- Generator fonts are fetched separately. DejaVu's notice is in `blender/fonts/LICENSE_DEJAVU`; downloaded branding fonts carry their own OFL notices. The add-on packaging script retains those notices.
- Installed Python and development dependencies retain the licenses supplied by their respective projects. They are not relicensed by this repository.

## Blender integration

Blender is a separate GPL-licensed application and is not bundled here. The MIT grant permits reuse and sublicensing of original project code, including in GPL-compliant distributions. It does not remove GPL obligations that apply when distributing integrations using Blender's Python API. Follow [Blender's licensing policy](https://www.blender.org/about/license/) and preserve all applicable notices when packaging or redistributing an add-on.
