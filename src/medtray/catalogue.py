"""Preserve the official BASG export; index human oral solid forms without inventing identities."""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path

EXCLUDE=('vaginal','rektal','inhalation','creme','salbe')
def candidate(row):
    form=row['Darreichungsform'].lower()
    return row['Verwendung']=='Human' and any(t in form for t in ('tablette','kapsel','pastille')) and not any(t in form for t in EXCLUDE)

def build(source,out):
    source=Path(source);out=Path(out);out.mkdir(parents=True,exist_ok=True)
    rows=list(csv.DictReader(source.open(encoding='utf-8-sig')))
    human=[r for r in rows if r['Verwendung']=='Human'];solids=[r for r in human if candidate(r)]
    records=[]
    for r in solids:
        records.append({'product_id':'AT:'+r['Zulassungsnummer'],'name':r['Bezeichnung'],'registration':r['Zulassungsnummer'],'form':r['Darreichungsform'],'strength':r['Stärke'],'strength_unit':r['Einheit Stärke'],'ingredients':r['Wirkstoff(e)'],'atc':r['ATC Code'],'smpc_url':r['Fachinformation'] or None,'leaflet_url':r['Gebrauchsinformation'] or None,'source':'BASG official export','appearance':None,'appearance_status':'not_extracted','identity_model_status':'not_trained','marketed_status':'unknown','route_requires_review':True})
    (out/'austria_oral_solids.json').write_text(json.dumps(records,indent=2,ensure_ascii=False))
    summary={'source_url':'https://medikamente.basg.gv.at/de/medicinal-products','retrieved':'2026-09-27','source_updated':'2026-09-26 23:30:28 Europe/Vienna','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'export_rows':len(rows),'distinct_registrations':len({r['Zulassungsnummer'] for r in rows}),'human_registrations':len(human),'candidate_oral_solid_registrations':len(records),'with_smpc_url':sum(bool(r['smpc_url']) for r in records),'by_form':dict(collections.Counter(r['form'] for r in records).most_common()),'verified_product_models':0,'note':'Broad name/form filter, not a clinical route or formulary whitelist. Authorisation does not establish current marketing. Export includes repeated veterinary rows; human registrations are unique. No claim to cover all Europe.'}
    (out/'coverage.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False));return summary

def main():
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--out',default='artifacts/catalogue');a=p.parse_args();print(json.dumps(build(a.source,a.out),indent=2,ensure_ascii=False))
if __name__=='__main__':main()
