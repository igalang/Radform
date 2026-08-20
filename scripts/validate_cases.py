#!/usr/bin/env python3
"""Validate Radform's local educational case bank before deployment."""
from __future__ import annotations
import json
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[1]
CASES_PATH=ROOT/'data'/'cases.json'
REQUIRED={'id','title','diagnosis','modality','modalityCode','anatomy','difficulty','vignette','question','options','correctIndex','keyFinding','explanation','differential','pearls','image'}
VALID_MODALITIES={'XR','CT','MRI','US'}; VALID_DIFFICULTY={'Básico','Intermedio','Avanzado'}
def https_url(v):
    if not isinstance(v,str): return False
    p=urlparse(v); return p.scheme=='https' and bool(p.netloc)
def main():
    cases=json.loads(CASES_PATH.read_text(encoding='utf-8'))
    if not isinstance(cases,list) or not cases: raise SystemExit('cases.json must contain a non-empty JSON array')
    seen=set(); errors=[]; fixed=dynamic=hotspots=0
    for i,c in enumerate(cases,1):
        prefix=f"case #{i} ({c.get('id','missing-id')})"; missing=REQUIRED-c.keys()
        if missing: errors.append(f'{prefix}: missing keys {sorted(missing)}'); continue
        if c['id'] in seen: errors.append(f'{prefix}: duplicate id')
        seen.add(c['id'])
        if c['modalityCode'] not in VALID_MODALITIES: errors.append(f'{prefix}: invalid modalityCode')
        if c['difficulty'] not in VALID_DIFFICULTY: errors.append(f'{prefix}: invalid difficulty')
        if not isinstance(c['options'],list) or len(c['options'])!=4: errors.append(f'{prefix}: exactly four options required')
        if not isinstance(c['correctIndex'],int) or not 0<=c['correctIndex']<=3: errors.append(f'{prefix}: correctIndex must be 0..3')
        image=c.get('image') or {}
        if not image.get('alt'): errors.append(f'{prefix}: image.alt required')
        if image.get('file'):
            fixed+=1
            for key in ('sourcePage','author','license','licenseUrl'):
                if not image.get(key): errors.append(f'{prefix}: image.{key} required for fixed image')
            if image.get('sourcePage') and not https_url(image['sourcePage']): errors.append(f'{prefix}: sourcePage must be HTTPS')
            if image.get('licenseUrl') and not https_url(image['licenseUrl']): errors.append(f'{prefix}: licenseUrl must be HTTPS')
        elif image.get('searchQuery'):
            dynamic+=1
        else: errors.append(f'{prefix}: image must provide file or searchQuery')
        hs=image.get('hotspot')
        if hs is not None:
            hotspots+=1
            if not isinstance(hs,dict): errors.append(f'{prefix}: hotspot must be object or null')
            else:
                for axis in ('x','y'):
                    v=hs.get(axis)
                    if not isinstance(v,(int,float)) or not 0<=v<=100: errors.append(f'{prefix}: hotspot {axis} must be 0..100')
                if not hs.get('label'): errors.append(f'{prefix}: hotspot label required')
    if errors:
        print('Radform case-bank validation failed:'); [print(' -',e) for e in errors]; raise SystemExit(1)
    print(f'Validated {len(cases)} cases · fixed images: {fixed} · dynamic open-image cases: {dynamic} · hotspots: {hotspots}')
if __name__=='__main__': main()
