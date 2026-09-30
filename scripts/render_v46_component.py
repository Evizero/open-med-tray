"""Freeze complete generator/converter/input provenance, then resumable short Blender batches."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,sys,time
import argparse
p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--out',required=True);p.add_argument('--wait-for',type=Path);a=p.parse_args()
R=Path(__file__).resolve().parents[1];out=(R/a.out).resolve();out.mkdir(parents=True,exist_ok=True);source=out/'source';config=out/'config.json'
if not config.exists():
 source.mkdir(exist_ok=True)
 for folder in ['blender','src/medtray']:
  shutil.copytree(R/folder,source/folder,ignore=shutil.ignore_patterns('__pycache__'))
 (source/'configs').mkdir();shutil.copy2(R/'configs/classes.json',source/'configs/classes.json')
 c=json.loads((R/a.config).read_text());presets=(R/Path(c['appearance_presets_path'])).resolve();dest=source/'appearance-presets.json';shutil.copy2(presets,dest);c['appearance_presets_path']=str(dest)
 config.write_text(json.dumps(c,indent=2));(out/'external-inputs.json').write_text(json.dumps({'appearance_presets':{'original_path':str(presets),'runtime_path':str(dest),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}},indent=2))
 (out/'source-sha256.json').write_text(json.dumps({str(f.relative_to(source)):hashlib.sha256(f.read_bytes()).hexdigest() for f in source.rglob('*') if f.is_file()},indent=2))
sys.path.insert(0,str(source/'src'));from medtray.prepare import convert,audit
while a.wait_for and not a.wait_for.exists():time.sleep(10)
c=json.loads(config.read_text());start=time.time();done=0;target=sum(c['splits'].values());failures=[]
def valid(split,i):return (out/split/f'{i:05d}_depth.npy').exists()
def conversion(split,i):
 f=out/split/f'{i:05d}.exr'
 if f.exists() and f.with_suffix('.beauty.exr').exists():
  try:
   convert(f);f.unlink();f.with_suffix('.beauty.exr').unlink();return True
  except Exception as e:print('CONVERSION_PENDING',str(f),str(e),flush=True)
 return False
for split,n in c['splits'].items():
 (out/split).mkdir(exist_ok=True)
 for first in range(0,n,4):
  indices=list(range(first,min(n,first+4)))
  for attempt in range(3):
   for i in indices:
    if not valid(split,i):conversion(split,i)
   todo=[i for i in indices if not valid(split,i)]
   if not todo:break
   device=c['device'] if attempt<2 else 'CPU'
   with (out/f'{split}_{first:05d}.log').open('a') as log:
    rc=subprocess.run(['/Applications/Blender.app/Contents/MacOS/Blender','-b','--factory-startup','--python-exit-code','1','-P',str(source/'blender/generate.py'),'--','--config',str(config),'--out',str(out),'--split',split,'--start',str(min(todo)),'--count',str(max(todo)-min(todo)+1),'--device',device],stdout=log,stderr=subprocess.STDOUT,cwd=R).returncode
   if rc:failures.append(dict(split=split,first=first,attempt=attempt,device=device,returncode=rc));(out/'render-recoveries.json').write_text(json.dumps(failures,indent=2))
   for i in todo:conversion(split,i)
  assert all(valid(split,i) for i in indices),f'Failed batch {split}/{first}'
  done+=len(indices);status=dict(completed=done,target=target,split=split,split_completed=max(indices)+1,elapsed_seconds=round(time.time()-start,1),recoveries=len(failures));(out/'progress.json').write_text(json.dumps(status,indent=2));print(json.dumps(status),flush=True)
qa=audit(out);assert qa['passed'];(out/'DATASET_DONE').write_text(f'{target} frozen-source scenes rendered and label-audited.\n');print('DATASET_DONE',flush=True)
