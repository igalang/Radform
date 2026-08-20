#!/usr/bin/env python3
"""Build small, self-hosted educational snapshots from public Hugging Face datasets.

The site never needs a Hugging Face token. During GitHub Pages deployment this script
uses the public Dataset Viewer REST API, downloads a bounded subset of images into the
Pages artifact, and writes local JSON indexes. If a remote source is unavailable the
script keeps the empty snapshot and exits successfully so Radform remains functional.
"""
from __future__ import annotations
import json, os, re, time, urllib.parse, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
GEN=ROOT/'generated'
UA='Radform/2026 educational radiology app (+https://igalang.github.io/Radform/)'
BASE='https://datasets-server.huggingface.co'


def req_json(url, timeout=35):
    req=urllib.request.Request(url, headers={'Accept':'application/json','User-Agent':UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def discover(dataset):
    url=f"{BASE}/splits?"+urllib.parse.urlencode({'dataset':dataset})
    data=req_json(url)
    splits=data.get('splits') or []
    if not splits: raise RuntimeError(f'No splits for {dataset}')
    # Prefer default/train, otherwise first train, otherwise first split.
    splits=sorted(splits,key=lambda x:(x.get('split')!='train',x.get('config')!='default'))
    x=splits[0]
    return x['config'],x['split']


def rows(dataset, config, split, offset, length=100):
    url=f"{BASE}/rows?"+urllib.parse.urlencode({'dataset':dataset,'config':config,'split':split,'offset':offset,'length':length})
    return req_json(url)


def image_src(v):
    if isinstance(v,str): return v
    if isinstance(v,dict): return v.get('src') or v.get('url') or v.get('path') or ''
    return ''


def clean(v): return ' '.join(str(v or '').split())

def safe_name(s, fallback='image'):
    stem=re.sub(r'[^A-Za-z0-9._-]+','-',str(s or fallback)).strip('-._') or fallback
    return stem[:120]


def download(url, dest):
    if not url: return False
    dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() and dest.stat().st_size>1000: return True
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'image/*,*/*;q=0.8'})
    try:
        with urllib.request.urlopen(req,timeout=35) as r, open(dest,'wb') as f:
            f.write(r.read())
        if dest.stat().st_size<500:
            dest.unlink(missing_ok=True); return False
        return True
    except Exception:
        dest.unlink(missing_ok=True); return False


def out_json(name, results, errors):
    (DATA/name).write_text(json.dumps({'generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'results':results,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')


def build_vqarad():
    dataset='abhay2812/vqa-rad'; errors=[]; grouped={}
    try:
        split_info=req_json(f"{BASE}/splits?"+urllib.parse.urlencode({'dataset':dataset})).get('splits') or []
        for sp in split_info:
            config, split=sp['config'],sp['split']; offset=0
            while True:
                data=rows(dataset,config,split,offset,100); rr=data.get('rows') or []
                if not rr: break
                for wr in rr:
                    row=wr.get('row') or {}; name=clean(row.get('image_name') or f"{split}-{wr.get('row_idx')}.jpg")
                    g=grouped.setdefault(name,{'id':name,'imageName':name,'organ':clean(row.get('image_organ')),'questions':[],'sourceUrl':'https://huggingface.co/datasets/abhay2812/vqa-rad','license':'CC0 1.0'})
                    if len(g['questions'])<12:
                        g['questions'].append({'question':clean(row.get('question')),'answer':clean(row.get('answer')),'answerType':clean(row.get('answer_type')),'questionType':clean(row.get('question_type_primary'))})
                    if not g.get('_src'): g['_src']=image_src(row.get('image'))
                offset+=len(rr)
                if len(rr)<100: break
        out=[]
        folder=GEN/'vqa-rad'
        for idx,(name,g) in enumerate(grouped.items()):
            ext=Path(name).suffix.lower() or '.jpg'; dest=folder/f"{idx:04d}-{safe_name(Path(name).stem)}{ext}"
            if download(g.pop('_src',''),dest):
                g['imageUrl']='./'+dest.relative_to(ROOT).as_posix(); out.append(g)
        out_json('vqa-rad-snapshot.json',out,errors)
        print(f'VQA-RAD bundle: {len(out)} images / {sum(len(x["questions"]) for x in out)} QA')
    except Exception as e:
        errors.append(str(e)); out_json('vqa-rad-snapshot.json',[],errors); print('VQA-RAD:',e)


def build_simple(dataset, json_name, folder_name, limit, source_url, license_text, kind):
    errors=[]; out=[]
    try:
        config,split=discover(dataset); offset=0; folder=GEN/folder_name
        while len(out)<limit:
            data=rows(dataset,config,split,offset,min(100,limit*2)); rr=data.get('rows') or []
            if not rr: break
            for wr in rr:
                row=wr.get('row') or {}; src=image_src(row.get('image'))
                if not src: continue
                rid=clean(row.get('image_id') or row.get('file_id') or row.get('id') or row.get('file') or f'{offset}-{wr.get("row_idx",0)}')
                caption=clean(row.get('caption') or row.get('text_references') or row.get('text') or row.get('description') or 'Imagen radiológica')
                if not caption: continue
                ext='.jpg'; dest=folder/f"{len(out):04d}-{safe_name(rid)}{ext}"
                if not download(src,dest): continue
                article=clean(row.get('article_id') or row.get('pmcid') or '')
                source= f'https://pmc.ncbi.nlm.nih.gov/articles/{urllib.parse.quote(article)}/' if article.startswith('PMC') else source_url
                out.append({'id':rid,'imageUrl':'./'+dest.relative_to(ROOT).as_posix(),'caption':caption,'context':clean(row.get('text_references') or row.get('context') or ''),'tag':clean(row.get('tag') or row.get('image_type') or kind),'license':clean(row.get('license') or license_text),'sourceUrl':source,'datasetUrl':source_url})
                if len(out)>=limit: break
            offset+=len(rr)
            if len(rr)<100: break
        out_json(json_name,out,errors); print(f'{kind} bundle: {len(out)} images')
    except Exception as e:
        errors.append(str(e)); out_json(json_name,[],errors); print(kind+':',e)


def main():
    GEN.mkdir(exist_ok=True)
    # VQA-RAD declares CC0, so Radform can prepare a self-hosted educational copy.
    build_vqarad()
    # ROCOv2 and MultiCaRe remain linked external collections. We deliberately do
    # not re-host their images because dataset/article-level licences vary and
    # include non-commercial/share-alike terms.
    out_json('roco-snapshot.json',[],['External collection: not re-hosted by design'])
    out_json('multicare-snapshot.json',[],['External collection: not re-hosted by design'])

if __name__=='__main__': main()
