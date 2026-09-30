"""Vendor OFL font assets and their licenses from the official Google Fonts repo."""
import concurrent.futures, hashlib, json, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'blender/fonts/branding';out.mkdir(exist_ok=True)
FAMILIES=['barlowcondensed','bebasneue','caveat','cinzel','comicneue','cormorantgaramond','dancingscript','domine','greatvibes','josefinsans','kaushanscript','librebaskerville','lobster','manrope','merriweather','montserrat','nunito','orbitron','oswald','pacifico','playfairdisplay','quicksand','rajdhani','sacramento']
HEADERS={'User-Agent':'medtray-procedural-research'}
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=45) as r:return r.read()
def run(family):
    entries=json.loads(fetch('https://api.github.com/repos/google/fonts/contents/ofl/'+family))
    fonts=[e for e in entries if e['name'].endswith('.ttf')]
    # Include all styles for static families; variable files keep their native default face.
    rows=[]
    for e in fonts:
        path=out/family/e['name'];path.parent.mkdir(exist_ok=True);data=path.read_bytes() if path.exists() else fetch(e['download_url']);path.write_bytes(data)
        rows.append({'family':family,'file':str(path.relative_to(out)),'source':e['download_url'],'git_blob_sha':e['sha'],'sha256':hashlib.sha256(data).hexdigest()})
    lic=next(e for e in entries if e['name']=='OFL.txt');(out/family/'OFL.txt').write_bytes(fetch(lic['download_url']))
    return rows
rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(run,FAMILIES):rows.extend(result)
(out/'manifest.json').write_text(json.dumps({'license':'SIL Open Font License 1.1; per-family OFL.txt preserved','source_repository':'https://github.com/google/fonts','families':FAMILIES,'fonts':rows},indent=2))
print('FONTS_READY',len(FAMILIES),len(rows))
