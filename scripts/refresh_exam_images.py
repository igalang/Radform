#!/usr/bin/env python3
from pathlib import Path
import json, sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_external_content import ROOT, DATA, GEN, commons_search, save_image, clean, now_iso, write_json_atomic

EXAMS = DATA / "exams"
OUT = GEN / "exams"
CACHE = EXAMS / "image-cache.json"

def walk(obj):
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from walk(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from walk(value)

def file_exists(entry):
    url=str(entry.get("imageUrl") or "")
    return url.startswith("./generated/") and (ROOT / url[2:]).exists()

def main():
    old_doc = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {"results":[]}
    old = {x.get("key"): x for x in old_doc.get("results",[]) if x.get("key")}
    results=[]
    seen=set()
    for path in sorted(EXAMS.glob("*.json")):
        if path.name in {"manifest.json","image-cache.json"}:
            continue
        doc=json.loads(path.read_text(encoding="utf-8"))
        for node in walk(doc):
            query=clean(node.get("imageQuery")) if isinstance(node,dict) else ""
            if not query:
                continue
            key=clean(node.get("imageKey") or node.get("id"))
            if not key or key in seen:
                continue
            seen.add(key)
            if key in old and file_exists(old[key]):
                results.append(old[key]); continue
            selected=commons_search(query)
            if not selected or not selected.get("thumb"):
                if key in old: results.append(old[key])
                continue
            local=save_image(selected["thumb"], OUT / key)
            if not local:
                if key in old: results.append(old[key])
                continue
            results.append({
                "key":key,
                "query":query,
                "imageUrl":local,
                "sourcePage":selected.get("sourcePage") or "",
                "author":selected.get("author") or "Wikimedia Commons contributor",
                "license":selected.get("license") or "",
                "licenseUrl":selected.get("licenseUrl") or "",
                "description":selected.get("description") or query,
                "originalTitle":selected.get("title") or ""
            })
    write_json_atomic(CACHE, {"generated_at":now_iso(),"results":results})
    print(f"Exam images cached: {len(results)}")

if __name__=="__main__":
    main()
