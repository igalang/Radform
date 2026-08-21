#!/usr/bin/env python3
from pathlib import Path
import json, sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_external_content import ROOT, DATA, GEN, commons_file, save_image, now_iso, write_json_atomic

EXAMS = DATA / "exams"
OUT = GEN / "exams"
CACHE = EXAMS / "image-cache.json"
ALLOWLIST = EXAMS / "verified-images.json"


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def existing_file(entry):
    url = str(entry.get("imageUrl") or "")
    if not url.startswith("./generated/"):
        return None
    path = ROOT / url[2:]
    return path if path.exists() else None


def is_exact_previous(entry, expected_file):
    return (
        str(entry.get("originalTitle") or "").strip() == str(expected_file or "").strip()
        and existing_file(entry) is not None
    )


def cleanup_unverified_files(keep_paths):
    OUT.mkdir(parents=True, exist_ok=True)
    removed = 0
    for path in OUT.iterdir():
        if not path.is_file():
            continue
        rel = "./" + path.relative_to(ROOT).as_posix()
        if rel not in keep_paths:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def main():
    allow_doc = load_json(ALLOWLIST, {})
    allow = allow_doc.get("items") or {}
    if not isinstance(allow, dict) or not allow:
        raise SystemExit("verified-images.json is missing or empty; refusing to publish exam images.")

    old_doc = load_json(CACHE, {"results": []})
    old = {x.get("key"): x for x in old_doc.get("results", []) if x.get("key")}
    results = []
    failures = []

    for key, spec in allow.items():
        exact_file = str(spec.get("file") or "").strip()
        context = str(spec.get("context") or "").strip()
        if not exact_file:
            failures.append(f"{key}: missing exact file")
            continue

        previous = old.get(key)
        if previous and is_exact_previous(previous, exact_file):
            item = dict(previous)
            item.update({
                "verified": True,
                "verification": "manual-exact-file",
                "expectedContext": context,
                "query": exact_file,
            })
            results.append(item)
            continue

        selected = commons_file(exact_file)
        if not selected or not selected.get("thumb"):
            failures.append(f"{key}: exact Commons file not available: {exact_file}")
            continue

        local = save_image(selected["thumb"], OUT / key)
        if not local:
            failures.append(f"{key}: could not save {exact_file}")
            continue

        results.append({
            "key": key,
            "query": exact_file,
            "imageUrl": local,
            "sourcePage": selected.get("sourcePage") or "",
            "author": selected.get("author") or "Wikimedia Commons contributor",
            "license": selected.get("license") or "",
            "licenseUrl": selected.get("licenseUrl") or "",
            "description": selected.get("description") or context or exact_file,
            "originalTitle": selected.get("title") or exact_file,
            "verified": True,
            "verification": "manual-exact-file",
            "expectedContext": context,
        })

    # Critical safety rule: never retain old fuzzy/unreviewed results.
    keep_paths = {str(x.get("imageUrl") or "") for x in results if x.get("imageUrl")}
    removed = cleanup_unverified_files(keep_paths)

    results.sort(key=lambda x: x["key"])
    write_json_atomic(CACHE, {
        "generated_at": now_iso(),
        "policy": "verified-exact-files-only",
        "results": results,
    })

    print(f"Verified exam images cached: {len(results)}")
    print(f"Stale/unverified exam image files removed: {removed}")
    if failures:
        print("Verified files not available this run (questions will remain text-only):")
        for line in failures:
            print(f" - {line}")


if __name__ == "__main__":
    main()
