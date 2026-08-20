import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
questions = json.loads((root / 'data' / 'mir-questions.json').read_text(encoding='utf-8'))
cases = json.loads((root / 'data' / 'cases.json').read_text(encoding='utf-8'))
case_ids = {item['id'] for item in cases}
assert isinstance(questions, list) and questions, 'mir-questions.json must contain a non-empty list'
seen = set()
for i, item in enumerate(questions, 1):
    required = ['id','area','difficulty','stem','question','options','correctIndex','explanation']
    missing = [key for key in required if key not in item]
    assert not missing, f'Question {i}: missing {missing}'
    assert item['id'] not in seen, f'Duplicate id {item["id"]}'
    seen.add(item['id'])
    assert item['difficulty'] in {'Básico','Intermedio','Avanzado'}, f'{item["id"]}: invalid difficulty'
    assert isinstance(item['options'], list) and len(item['options']) == 4, f'{item["id"]}: expected 4 options'
    assert isinstance(item['correctIndex'], int) and 0 <= item['correctIndex'] < 4, f'{item["id"]}: invalid correctIndex'
    assert all(isinstance(x, str) and x.strip() for x in item['options']), f'{item["id"]}: empty option'
    if item.get('caseId'):
        assert item['caseId'] in case_ids, f'{item["id"]}: unknown caseId {item["caseId"]}'
print(f'Validated {len(questions)} MIR-style questions; {sum(bool(x.get("caseId")) for x in questions)} include a linked image case.')
