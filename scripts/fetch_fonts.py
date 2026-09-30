from pathlib import Path
import argparse
import hashlib
import io
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip'
SHA256 = '7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a'
NAMES = ('DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSerif.ttf', 'DejaVuSansMono.ttf')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-only', action='store_true')
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'blender/fonts')
    args = parser.parse_args()
    if args.archive or not all((args.output / n).exists() for n in NAMES):
        if args.archive:
            raw = args.archive.read_bytes()
        else:
            with urllib.request.urlopen(URL, timeout=90) as response:
                raw = response.read()
        if hashlib.sha256(raw).hexdigest() != SHA256:
            raise ValueError('Font archive checksum mismatch')
        args.output.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for name in NAMES:
                (args.output / name).write_bytes(z.read('dejavu-fonts-ttf-2.37/ttf/' + name))
            (args.output / 'LICENSE_DEJAVU').write_bytes(z.read('dejavu-fonts-ttf-2.37/LICENSE'))
    if not args.base_only:
        for script in ('fetch_branding_fonts.py', 'instantiate_branding_fonts.py'):
            subprocess.run([sys.executable, str(ROOT / 'scripts' / script)], check=True)


if __name__ == '__main__':
    main()
