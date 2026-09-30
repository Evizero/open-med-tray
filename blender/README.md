# Open Med Tray — Blender add-on

The add-on adds an **Open Med Tray** tab to the 3D View sidebar for building and editing procedural tablets, capsules and softgels. It is research software: shapes, colours and imprints are procedural and never identify a real medicine.

## Build and install

No prebuilt add-on is published. Build it from this folder, from the repository root:

```bash
uv run --with fonttools python scripts/fetch_fonts.py   # base and branding fonts into blender/fonts/
uv run python scripts/package_open_med_tray.py          # writes artifacts/open-med-tray-addon.zip
```

The font binaries are downloaded on demand and never committed. `--base-only` fetches only the base fonts, but packaging needs both.

In Blender 5.2, open Preferences → Add-ons → Install from Disk, choose the ZIP, then open the **Open Med Tray** tab in the 3D View sidebar. The ZIP contains this folder as the package `medtray/` (with `medtray_addon.py` as `__init__.py`), the appearance presets and the fonts with their licences.

## Stable identifiers

The add-on was renamed from MedTray; only visible names changed. Scripts and saved `.blend` files keep working because these identifiers are unchanged: operators `medtray.build`, `medtray.load_appearance` and `medtray.load_softgel`, panel `MEDTRAY_PT_panel`, scene settings `Scene.medtray`, the `medtray_preview` object property and the package name `medtray`.
