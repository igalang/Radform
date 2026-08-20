#!/usr/bin/env python3
import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'data' / 'atlas-topics.json'
data = json.loads(path.read_text(encoding='utf-8'))
assert isinstance(data, list) and data, 'atlas-topics.json must be a non-empty list'
required = {'id','label','query','modality','anatomy','level'}
ids=set()
for i,item in enumerate(data,1):
    missing=required-item.keys()
    assert not missing, f'topic {i}: missing {sorted(missing)}'
    assert item['id'] not in ids, f'duplicate id: {item["id"]}'
    ids.add(item['id'])
    assert item['modality'] in {'XR','CT','MRI','US'}, f'{item["id"]}: bad modality'
    assert item['level'] in {'Básico','Intermedio','Avanzado'}, f'{item["id"]}: bad level'
    assert str(item['label']).strip() and str(item['query']).strip(), f'{item["id"]}: empty label/query'
print(f'Atlas OK: {len(data)} topics')
