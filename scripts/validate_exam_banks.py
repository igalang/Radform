#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EXAMS=ROOT/'data'/'exams'

def fail(msg:str): raise SystemExit(f'Exam validation failed: {msg}')

def validate_question(q:dict,ids:set[str],path:str):
    qid=str(q.get('id') or '')
    if not qid: fail(f'{path}: missing question id')
    if qid in ids: fail(f'duplicate question id: {qid}')
    ids.add(qid)
    if q.get('type') not in {'single','multiple','order'}: fail(f'{qid}: unsupported type {q.get("type")!r}')
    options=q.get('options'); correct=q.get('correct')
    if not isinstance(options,list) or len(options)<2: fail(f'{qid}: options must contain at least two entries')
    if not isinstance(correct,list) or not correct: fail(f'{qid}: correct must be a non-empty list')
    if any(not isinstance(i,int) or i<0 or i>=len(options) for i in correct): fail(f'{qid}: correct index out of range')
    if q.get('type')=='single' and len(correct)!=1: fail(f'{qid}: single question must have exactly one correct answer')
    if not str(q.get('question') or '').strip(): fail(f'{qid}: empty question text')
    if not str(q.get('explanation') or '').strip(): fail(f'{qid}: empty explanation')
    if not str(q.get('topic') or '').strip(): fail(f'{qid}: missing topic metadata')
    unsafe=q.get('unsafeOptions',[])
    if any(not isinstance(i,int) or i<0 or i>=len(options) for i in unsafe): fail(f'{qid}: unsafe option index out of range')


def validate_verified_images():
    path = EXAMS / 'verified-images.json'
    if not path.exists():
        fail('missing verified-images.json')
    vdoc = json.loads(path.read_text(encoding='utf-8'))
    items = vdoc.get('items')
    if not isinstance(items, dict) or not items:
        fail('verified-images.json: items must be a non-empty object')

    referenced = set()
    exact_refs = {}

    def scan(obj):
        if isinstance(obj, dict):
            key = obj.get('imageKey')
            if key:
                referenced.add(str(key))
            if obj.get('imageFile') and key:
                exact_refs[str(key)] = str(obj.get('imageFile'))
            for value in obj.values():
                scan(value)
        elif isinstance(obj, list):
            for value in obj:
                scan(value)

    for filename in [f'ebir-{i:02d}.json' for i in range(1,7)] + [f'edir-{i:02d}.json' for i in range(1,7)]:
        scan(json.loads((EXAMS / filename).read_text(encoding='utf-8')))

    for key, spec in items.items():
        if not isinstance(spec, dict):
            fail(f'verified image {key}: spec must be an object')
        filename = str(spec.get('file') or '').strip()
        context = str(spec.get('context') or '').strip()
        if not filename:
            fail(f'verified image {key}: missing exact Commons filename')
        if not context:
            fail(f'verified image {key}: missing clinical context')
        if key not in referenced:
            fail(f'verified image {key}: key is not referenced in exam banks')

    for key, filename in exact_refs.items():
        spec = items.get(key)
        if not spec:
            fail(f'{key}: imageFile is used in an exam but is not allowlisted')
        if str(spec.get('file') or '').strip() != filename.strip():
            fail(f'{key}: imageFile does not match verified-images.json')

    unique_files = len({str(spec.get('file') or '').strip() for spec in items.values()})
    if unique_files < 12:
        fail(f'verified image pool too small: {unique_files} unique files')
    return len(items), unique_files

def main():
    manifest=json.loads((EXAMS/'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('productModel')!='practice-center': fail('manifest must use practice-center product model')
    if manifest.get('defaultDurationMinutes')!=20: fail('20 minutes must be the default practice duration')
    if manifest.get('durationsMinutes') != [10,20,40]: fail('practice durations must be 10/20/40 minutes')
    ids=set(); docs={'ebir':[],'edir':[]}; topic_counts={'ebir':{},'edir':{}}
    for kind in ('ebir','edir'):
        files=manifest.get(kind,{}).get('examFiles') or []
        if len(files)<6: fail(f'{kind}: expected at least 6 source banks')
        for filename in files:
            path=EXAMS/filename
            if not path.exists(): fail(f'missing file {filename}')
            doc=json.loads(path.read_text(encoding='utf-8'))
            if doc.get('kind')!=kind: fail(f'{filename}: kind mismatch')
            if doc.get('official') is not False or doc.get('rankingPoints') is not False: fail(f'{filename}: must be non-official and non-ranking')
            docs[kind].append(doc)
            sections={s.get('id'):s for s in doc.get('sections',[])}
            if kind=='ebir':
                clinical=sections.get('clinical-scenarios'); general=sections.get('general-practice')
                if not clinical or clinical.get('type')!='sequential': fail(f'{filename}: missing sequential EBIR clinical scenarios')
                if not general or general.get('type')!='standalone': fail(f'{filename}: missing EBIR general practice')
            else:
                if sections.get('mrq',{}).get('type')!='standalone': fail(f'{filename}: missing MRQ')
                if sections.get('short-cases',{}).get('type')!='shortcases': fail(f'{filename}: Short Cases must be grouped cases')
                if sections.get('core',{}).get('type')!='core': fail(f'{filename}: missing CORE')
            for section in doc.get('sections',[]):
                if section.get('type')=='standalone':
                    for q in section.get('questions',[]):
                        validate_question(q,ids,f'{filename}/{section.get("id")}')
                        topic_counts[kind][q['topic']]=topic_counts[kind].get(q['topic'],0)+1
                else:
                    for case in section.get('cases',[]):
                        if not str(case.get('stem') or '').strip(): fail(f'{filename}/{case.get("id")}: empty case stem')
                        if not str(case.get('topic') or '').strip(): fail(f'{filename}/{case.get("id")}: missing topic metadata')
                        qs=case.get('questions',[])
                        if kind=='ebir' and section.get('id')=='clinical-scenarios' and not 4<=len(qs)<=6: fail(f'{filename}/{case.get("id")}: EBIR case must have 4-6 questions')
                        for q in qs:
                            validate_question(q,ids,f'{filename}/{case.get("id")}')
                            topic_counts[kind][q['topic']]=topic_counts[kind].get(q['topic'],0)+1

    for kind in ('ebir','edir'):
        allowed=set(manifest.get(kind,{}).get('topics') or [])
        unknown=set(topic_counts[kind])-allowed
        if unknown: fail(f'{kind}: topics not declared in manifest: {sorted(unknown)}')
        missing=allowed-set(topic_counts[kind])
        if missing: fail(f'{kind}: declared topics without questions: {sorted(missing)}')
        sparse={k:v for k,v in topic_counts[kind].items() if v<6}
        if sparse: fail(f'{kind}: topic pools must have at least 6 questions: {sparse}')
    # Official-scale pool coverage for optional full mock mode.
    ebir_cases=sum(len(next(s for s in d['sections'] if s['id']=='clinical-scenarios').get('cases',[])) for d in docs['ebir'])
    ebir_general=sum(len(next(s for s in d['sections'] if s['id']=='general-practice').get('questions',[])) for d in docs['ebir'])
    ebir_clinical_q=sum(sum(len(c.get('questions',[])) for c in next(s for s in d['sections'] if s['id']=='clinical-scenarios').get('cases',[])) for d in docs['ebir'])
    if ebir_cases<10 or ebir_general<50 or ebir_clinical_q<50: fail(f'EBIR pool too small: {ebir_cases} cases, {ebir_clinical_q} clinical questions, {ebir_general} general questions')
    edir_mrq=sum(len(next(s for s in d['sections'] if s['id']=='mrq').get('questions',[])) for d in docs['edir'])
    edir_short=sum(len(next(s for s in d['sections'] if s['id']=='short-cases').get('cases',[])) for d in docs['edir'])
    edir_core=sum(len(next(s for s in d['sections'] if s['id']=='core').get('cases',[])) for d in docs['edir'])
    if edir_mrq<78 or edir_short<24 or edir_core<10: fail(f'EDiR pool too small: {edir_mrq} MRQ, {edir_short} Short Cases, {edir_core} CORE')
    # Visual practice should have a meaningful source pool.
    visual_cases=0
    for kind in ('ebir','edir'):
        for d in docs[kind]:
            for s in d.get('sections',[]):
                for case in s.get('cases',[]):
                    if case.get('images') or case.get('imageQuery') or case.get('imageFile'): visual_cases += 1
    if visual_cases<20: fail(f'visual case pool too small: {visual_cases}')
    verified_mappings, verified_files = validate_verified_images()
    print(f'Validated image safety: {verified_mappings} verified mappings / {verified_files} unique exact Commons files.')
    print(f'Validated practice center: {len(ids)} questions · EBIR {ebir_cases} cases/{ebir_general} general · EDiR {edir_mrq} MRQ/{edir_short} Short Cases/{edir_core} CORE · {visual_cases} visual cases.')

if __name__=='__main__': main()
