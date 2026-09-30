<img src="brand/png/open-med-tray-lockup@2x.png" alt="Open Med Tray" width="300">

Open Med Tray generates synthetic medication-tray scenes for computer-vision research. Tablets, capsules, softgels, containers, covers, lighting and cameras are procedural and seeded, and every render comes with integer instance and class IDs from the same scene and camera.

https://github.com/user-attachments/assets/8e095cf5-2933-47b1-84ae-46a18c79e769

**Trailer** (62 s): tablets, capsules, softgels, containers and whole scenes from the generator, Open Med Tray Lite at work in the browser, and the labels that come with every render. [Download the MP4](brand/media/open-med-tray-teaser.mp4) (720p, 10.8 MB).

**Showcase:** [evizero.github.io/open-med-tray](https://evizero.github.io/open-med-tray/) hosts the landing page and [Open Med Tray Lite](https://evizero.github.io/open-med-tray/lite/). Nothing else from this repository is hosted there; the source, including the research history, is public here on GitHub.

## Two editions

| | Open Med Tray | Open Med Tray Lite |
|---|---|---|
| Renders with | Cycles path tracing, Blender 5.2 | WebGL 2 in the browser; simpler materials and optics |
| Runs as | Python scripts or the Blender add-on | One offline HTML file, no install |
| Writes per scene | RGB, instance and class IDs, depth, cover, sticker, printed-ink and glare targets, scene JSON | RGB, 16-bit instance IDs, class IDs and metadata; the ZIP also carries the training layout |
| Source | [`blender/`](blender/), [`src/`](src/), [`scripts/`](scripts/) | [`lite/`](lite/) |

Lite is a subset of the full generator, not a port with full parity. Its geometry, appearance and label priors follow the generator; see [`lite/README.md`](lite/README.md) for what differs.

## Repository

| Path | Contents |
|---|---|
| `blender/` | Scene generator and Blender add-on |
| `src/` | Dataset, training and evaluation code |
| `configs/` | Generator configurations, class list and appearance presets (`appearance-presets.json`) |
| `scripts/` | Rendering, add-on packaging, font download, Pages build and publish |
| `lite/` | Open Med Tray Lite source; `lite/index.html` is the built app |
| `brand/` | Mark, lockups, page sources and their build tools |
| `docs/research-history.md` | Research record kept for context, including earlier results under the name MedTray; not hosted on the showcase site |

The repository holds source only, apart from the 10.8 MB showcase trailer in [`brand/media/`](brand/media/). Datasets, renders, trained models and the generator's font files are not committed; `scripts/fetch_fonts.py` downloads the fonts on demand. The small web fonts and images the pages and Lite need to run are included.

## Setup

**Lite** (Node 22):

```bash
cd lite && npm ci && npm run build   # writes lite/index.html
```

Open `lite/index.html` directly in a current browser with WebGL 2. Collections are saved in the browser per file path, so a copy of the file at another path starts empty; download anything you need to keep.

**Full generator** (Blender 5.2 at `/Applications/Blender.app`, Python 3.12, [uv](https://docs.astral.sh/uv/)):

```bash
uv sync --extra dev
uv run --with fonttools python scripts/fetch_fonts.py      # base and branding fonts; needed before rendering or packaging
.venv/bin/python scripts/render_v46_component.py \
  --config configs/photoreal-v46.json --out artifacts/my-v46-base
```

**Blender add-on:** after fetching the fonts, `uv run python scripts/package_open_med_tray.py` writes `artifacts/open-med-tray-addon.zip`. In Blender 5.2 choose Preferences → Add-ons → Install from Disk, then open the **Open Med Tray** tab in the 3D View sidebar. Details are in [`blender/README.md`](blender/README.md).

**Showcase pages:** the site is served from the `gh-pages` branch, which holds the two HTML pages, the social-preview image, `sitemap.xml` and `.nojekyll`. After committing a rebuilt landing page (`node brand/tools/build-brand.mjs`) or Lite:

```bash
python3 scripts/build_pages.py                             # stage the allowlist in _site/ and check its links
python3 scripts/publish_pages.py --message "<commit subject>"  # verify the files are committed, then push gh-pages
```

Publishing needs the GitHub CLI signed in with access to this repository.

## Status

A research preview, not a release.

- Every scene is synthetic. Open Med Tray does not identify or verify medication, is not a medical device and has not been validated for any clinical purpose. Models trained on its data are research demonstrations.
- Labels mark visible geometric surfaces with transparent covers removed; refraction, glare and defocus in the render can move edges in those regions.
## License

Original Open Med Tray source and documentation, including Lite, are available under the [MIT License](LICENSE), copyright © 2026 Christof Salis. Third-party components keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The MIT grant for original code does not replace Blender's GPL requirements for distributions integrating its Python API. See [Blender's licensing policy](https://www.blender.org/about/license/).
