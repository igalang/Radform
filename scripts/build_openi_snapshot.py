#!/usr/bin/env python3
import json, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'data' / 'openi-snapshot.json'
TERMS = [
    ('pneumothorax chest x ray','x'), ('lobar pneumonia chest x ray','x'), ('pleural effusion chest x ray','x'),
    ('pulmonary embolism CT angiography','c'), ('aortic dissection CT','c'), ('appendicitis CT','c'),
    ('acute ischemic stroke MRI','m'), ('intracranial hemorrhage CT','c'), ('meningioma MRI','m'),
    ('gallstones ultrasound','u'), ('deep vein thrombosis ultrasound','u'), ('kidney stone CT','c'),
]

def clean(v):
    return ' '.join(str(v or '').replace('<',' <').split())

def abs_url(v):
    v = str(v or '').strip()
    if not v: return ''
    if v.startswith(('http://','https://')): return v
    return 'https://openi.nlm.nih.gov' + ('' if v.startswith('/') else '/') + v

def fetch(q, it):
    params = urllib.parse.urlencode({'query': q, 'm': 1, 'n': 8, 'it': it})
    req = urllib.request.Request('https://openi.nlm.nih.gov/api/search?' + params, headers={'Accept':'application/json','User-Agent':'Radform/2026 educational app'})
    with urllib.request.urlopen(req, timeout=25) as r:
        data = json.load(r)
    out=[]
    for item in data.get('list') or []:
        image = item.get('image') if isinstance(item.get('image'),dict) else {}
        url=abs_url(item.get('imgLarge') or item.get('imgGrid150') or item.get('imgThumb') or image.get('imgLarge'))
        if not url: continue
        pmcid=item.get('pmcid') or ''
        article=abs_url(item.get('fulltext_html_url') or item.get('detailedQueryURL') or item.get('pmc_url'))
        if not article and pmcid: article=f'https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/'
        out.append({
            'id': str(item.get('uid') or pmcid or url), 'query':q,
            'title': clean(item.get('title') or item.get('docTitle') or image.get('caption') or 'Imagen Open-i'),
            'imageUrl':url, 'thumbUrl':abs_url(item.get('imgGrid150') or item.get('imgThumb') or url),
            'description':clean(image.get('caption') or item.get('abstract') or image.get('mention') or ''),
            'articleUrl':article or 'https://openi.nlm.nih.gov', 'sourcePage':article or 'https://openi.nlm.nih.gov',
            'author':'U.S. National Library of Medicine / source article',
            'license':clean(item.get('license') or item.get('lic') or 'Consultar licencia del artículo fuente'),
            'licenseUrl':article or 'https://openi.nlm.nih.gov', 'source':'Open-i (NLM)'
        })
    return out

results=[]; seen=set(); errors=[]
for q,it in TERMS:
    try:
        for item in fetch(q,it):
            if item['id'] in seen: continue
            seen.add(item['id']); results.append(item)
        time.sleep(.25)
    except Exception as e:
        errors.append(f'{q}: {e}')
OUT.write_text(json.dumps({'generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),'results':results,'errors':errors}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Open-i snapshot: {len(results)} resultados; {len(errors)} errores (no bloqueantes).')
