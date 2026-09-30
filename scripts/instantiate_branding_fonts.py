"""Resolve variable fonts to explicit static weights for consistent Blender rendering."""
import hashlib,json,shutil
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
R=Path(__file__).resolve().parents[1];src=R/'blender/fonts/branding';out=R/'blender/fonts/branding_static';rows=[]
for path in sorted(src.glob('*/*.ttf')):
 font=TTFont(path);dest=out/path.parent.name;dest.mkdir(parents=True,exist_ok=True)
 shutil.copy2(path.parent/'OFL.txt',dest/'OFL.txt')
 if 'fvar' not in font:
  target=dest/path.name;shutil.copy2(path,target);rows.append({'file':str(target.relative_to(out)),'source':str(path.relative_to(src)),'axes':None});continue
 defaults={a.axisTag:a.defaultValue for a in font['fvar'].axes}
 for weight in ([400,600,800] if 'wght' in defaults else [None]):
  axes=dict(defaults)
  if weight is not None:axes['wght']=weight
  instance=instantiateVariableFont(font,axes,inplace=False)
  suffix=('-w'+str(weight)) if weight else '-static';target=dest/(path.stem.split('[')[0]+suffix+'.ttf')
  family='MT '+path.parent.name+' '+('Italic ' if 'Italic' in path.name else '')+str(weight or 'Static')
  for record in instance['name'].names:
   if record.nameID in [1,4,6,16]:
    value=family.replace(' ','') if record.nameID==6 else family
    record.string=value.encode(record.getEncoding(),errors='replace')
  instance.save(target);rows.append({'file':str(target.relative_to(out)),'source':str(path.relative_to(src)),'axes':axes})
for r in rows:r['sha256']=hashlib.sha256((out/r['file']).read_bytes()).hexdigest()
(out/'manifest.json').write_text(json.dumps({'note':'OFL sources in sibling branding directory. Variable faces instantiated at explicit weights; modified family names prefixed MT. Licenses preserved.','font_faces':len(rows),'families':len({Path(r['file']).parent.name for r in rows}),'fonts':rows},indent=2))
print('STATIC_FONTS_READY',len(rows))
