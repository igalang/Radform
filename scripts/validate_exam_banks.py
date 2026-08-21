#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMS = ROOT / 'data' / 'exams'


def fail(message: str) -> None:
    raise SystemExit(f'Exam validation failed: {message}')


def validate_question(q: dict, ids: set[str], path: str) -> None:
    qid = str(q.get('id') or '')
    if not qid:
        fail(f'{path}: missing question id')
    if qid in ids:
        fail(f'duplicate question id: {qid}')
    ids.add(qid)
    if q.get('type') not in {'single', 'multiple', 'order'}:
        fail(f'{qid}: unsupported type {q.get("type")!r}')
    options = q.get('options')
    correct = q.get('correct')
    if not isinstance(options, list) or len(options) < 2:
        fail(f'{qid}: options must contain at least two entries')
    if not isinstance(correct, list) or not correct:
        fail(f'{qid}: correct must be a non-empty list')
    if any(not isinstance(i, int) or i < 0 or i >= len(options) for i in correct):
        fail(f'{qid}: correct index out of range')
    if q.get('type') == 'single' and len(correct) != 1:
        fail(f'{qid}: single question must have exactly one correct answer')
    if not str(q.get('question') or '').strip():
        fail(f'{qid}: empty question text')
    if not str(q.get('explanation') or '').strip():
        fail(f'{qid}: empty explanation')
    unsafe = q.get('unsafeOptions', [])
    if any(not isinstance(i, int) or i < 0 or i >= len(options) for i in unsafe):
        fail(f'{qid}: unsafe option index out of range')


def main() -> None:
    manifest_path = EXAMS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    ids: set[str] = set()
    expected_files = []
    for kind in ('ebir', 'edir'):
        files = manifest.get(kind, {}).get('examFiles') or []
        if len(files) < 6:
            fail(f'{kind}: expected at least 6 practice sets')
        expected_files.extend(files)
        for filename in files:
            path = EXAMS / filename
            if not path.exists():
                fail(f'missing file {filename}')
            doc = json.loads(path.read_text(encoding='utf-8'))
            if doc.get('kind') != kind:
                fail(f'{filename}: kind mismatch')
            if doc.get('official') is not False or doc.get('rankingPoints') is not False:
                fail(f'{filename}: must be non-official and non-ranking')
            sections = {s.get('id'): s for s in doc.get('sections', [])}
            if kind == 'ebir':
                clinical = sections.get('clinical-scenarios')
                general = sections.get('general-practice')
                if not clinical or clinical.get('type') != 'sequential':
                    fail(f'{filename}: missing sequential EBIR clinical scenarios')
                if not general or general.get('type') != 'standalone':
                    fail(f'{filename}: missing EBIR general practice section')
                for case in clinical.get('cases', []):
                    count = len(case.get('questions', []))
                    if not 4 <= count <= 6:
                        fail(f'{filename}/{case.get("id")}: EBIR case must have 4-6 questions')
            else:
                if sections.get('mrq', {}).get('type') != 'standalone':
                    fail(f'{filename}: missing MRQ section')
                if sections.get('short-cases', {}).get('type') != 'shortcases':
                    fail(f'{filename}: Short Cases must be grouped as cases')
                if sections.get('core', {}).get('type') != 'core':
                    fail(f'{filename}: missing CORE cases')

            for section in doc.get('sections', []):
                if section.get('type') == 'standalone':
                    for q in section.get('questions', []):
                        validate_question(q, ids, f'{filename}/{section.get("id")}')
                else:
                    for case in section.get('cases', []):
                        if not str(case.get('stem') or '').strip():
                            fail(f'{filename}/{case.get("id")}: empty case stem')
                        for q in case.get('questions', []):
                            validate_question(q, ids, f'{filename}/{case.get("id")}')
    print(f'Validated {len(expected_files)} exam files and {len(ids)} questions.')


if __name__ == '__main__':
    main()
