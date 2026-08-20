#!/usr/bin/env python3
import json, time, urllib.parse, urllib.request
from pathlib import Path

OUT=Path(__file__).resolve().parents[1]/'data'/'mir-open-snapshot.json'
BASE='https://datasets-server.huggingface.co/search'
DATASET='HiTZ/casimedicos-exp'
TERMS=['radiografía','radiologia','radiología','imagen','tomografía','TAC','resonancia','ecografía','mamografía','RM','TC']
SPLITS=['train','validation','test']
RAD_KEYS=('radiograf','radiolog','imagen','tomograf',' tac ','tac ','resonancia','ecograf','mamograf',' rm ',' tc ','rayos x','rx ','pet','gammagraf')

def clean(v): return ' '.join(str(v or '').split())
def options(raw):
    if isinstance(raw,list): return [clean(x) for x in raw if clean(x)]
    if isinstance(raw,dict):
        def k(item):
            try:return int(item[0])
            except:return 999
        return [clean(v) for _,v in sorted(raw.items(),key=k) if clean(v)]
    return []
def correct(raw,n):
    s=clean(raw)
    try:
        x=int(s)
        if 1<=x<=n:return x-1
        if 0<=x<n:return x
    except: pass
    if s:
        x=ord(s[0].upper())-65
        if 0<=x<n:return x
    return None

def fetch(q,split):
    p=urllib.parse.urlencode({'dataset':DATASET,'config':'es','split':split,'query':q,'offset':0,'length':100})
    req=urllib.request.Request(BASE+'?'+p,headers={'Accept':'application/json','User-Agent':'Radform/2026 educational app'})
    with urllib.request.urlopen(req,timeout=30) as r:data=json.load(r)
    out=[]
    for wr in data.get('rows') or []:
        row=wr.get('row') or {}; opts=options(row.get('options'))
        question=clean(row.get('full_question') or row.get('question'))
        hay=(' '+question+' '+clean(row.get('full_answer'))+' '+clean(row.get('type'))+' ').lower()
        if not any(k in hay for k in RAD_KEYS): continue
        out.append({
          'id':clean(row.get('id') or f'casimedicos-{row.get("year","")}-{row.get("question_id_specific",wr.get("row_idx",""))}'),
          'year':clean(row.get('year')),'questionId':clean(row.get('question_id_specific')),
          'question':question,'explanation':clean(row.get('full_answer')),'specialty':clean(row.get('type') or 'MIR'),
          'options':opts,'correctIndex':correct(row.get('correct_option',row.get('correct option')),len(opts)),
          'source':'CasiMedicos / HiTZ','license':'CC BY 4.0','sourceUrl':'https://huggingface.co/datasets/HiTZ/casimedicos-exp'
        })
    return out

results=[];seen=set();errors=[]
for split in SPLITS:
  for q in TERMS:
    try:
      for item in fetch(q,split):
        if not item['question'] or item['id'] in seen: continue
        seen.add(item['id']);results.append(item)
      time.sleep(.08)
    except Exception as e: errors.append(f'{split}/{q}: {e}')
OUT.write_text(json.dumps({'generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'results':results,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'MIR abierto snapshot: {len(results)} preguntas; {len(errors)} errores (no bloqueantes).')
