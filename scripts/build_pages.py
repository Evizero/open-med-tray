from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '_site'
PAGE_FILES = (
    'index.html',
    'lite/index.html',
)
PUBLIC_FILES = PAGE_FILES + ('assets/open-med-tray-social.jpg', 'sitemap.xml')
SITE_URL = 'https://evizero.github.io/open-med-tray/'


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        for key, value in attrs:
            if value and key in ('href', 'src', 'poster'):
                self.refs.append((tag, key, value, attributes.get('rel')))


def main():
    bodies = {name: (ROOT / name).read_bytes() for name in PUBLIC_FILES}
    build = json.loads((ROOT / 'lite/build-info.json').read_text())
    assert hashlib.sha256(bodies[PUBLIC_FILES[1]]).hexdigest() == build['sha256'], 'Stale Lite build'
    for name in PAGE_FILES:
        body = bodies[name]
        text = body.decode('utf-8')
        for private in ('/Users/', 'file://', 'localhost:', '127.0.0.1:'):
            assert private not in text, f'Local reference in {name}: {private}'
        parser = References()
        parser.feed(text)
        for tag, attribute, reference, rel in parser.refs:
            url = urlsplit(reference)
            if url.scheme in ('https', 'http', 'mailto'):
                if tag == 'link' and rel == 'canonical':
                    expected = SITE_URL + ('' if name == 'index.html' else 'lite/')
                    assert reference == expected, f'Incorrect canonical: {reference}'
                    continue
                assert tag == 'a' and attribute == 'href', f'External runtime dependency: {reference}'
                continue
            if url.scheme == 'data' or not url.path:
                continue
            assert not url.scheme and not url.netloc, f'Unsupported URL: {reference}'
            target = (ROOT / name).parent / unquote(url.path)
            assert target.resolve() in {(ROOT / p).resolve() for p in PUBLIC_FILES}, f'Unpublished link in {name}: {reference}'
    if OUT.exists():
        shutil.rmtree(OUT)
    for name, body in bodies.items():
        dest = OUT / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
    (OUT / '.nojekyll').write_text('')
    print(json.dumps({'files': {n: len(b) for n, b in bodies.items()}, 'total_bytes': sum(map(len, bodies.values()))}))


if __name__ == '__main__':
    main()
