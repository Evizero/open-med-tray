"""Build the branded preview add-on, retaining the existing import namespace."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=ROOT / 'blender')
parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/open-med-tray-addon.zip')
args = parser.parse_args()
if not (args.source / 'fonts/DejaVuSans.ttf').exists() or not any((args.source / 'fonts/branding_static').glob('*/*.ttf')):
    raise SystemExit('Run scripts/fetch_fonts.py before packaging.')
files = {}
for path in args.source.glob('*.py'):
    if path.name != 'generate_draft.py':
        files['medtray/' + ('__init__.py' if path.name == 'medtray_addon.py' else path.name)] = path
for path in (args.source / 'fonts').rglob('*'):
    if path.is_file() and (path.suffix in {'.ttf', '.txt', '.json'} or path.name.startswith('LICENSE')):
        files['medtray/fonts/' + str(path.relative_to(args.source / 'fonts'))] = path
files['medtray/appearance-presets.json'] = ROOT / 'configs/appearance-presets.json'
files['medtray/appearance-research.md'] = ROOT / 'docs/pill-colors-softgels-v46.md'
if (args.source / 'README.md').exists():
    files['medtray/README.md'] = args.source / 'README.md'
payload = {name: path.read_bytes() for name, path in files.items()}
payload['medtray/source-sha256.json'] = json.dumps(
    {name: hashlib.sha256(data).hexdigest() for name, data in sorted(payload.items())}, indent=2
).encode()
args.out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name, data in sorted(payload.items()):
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, data)
print(json.dumps({'file': str(args.out), 'bytes': args.out.stat().st_size,
                  'sha256': hashlib.sha256(args.out.read_bytes()).hexdigest(), 'files': len(payload)}))
