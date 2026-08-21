#!/usr/bin/env python3
"""Refresh Radform's locally cached open educational content.

Design goals:
- The public app never depends on an external service to open its core content.
- External sources are refreshed in a separate GitHub Action.
- Existing good snapshots are preserved if a source is temporarily unavailable.
- Every cached Wikimedia image keeps source/author/license metadata.

Sources:
- Wikimedia Commons (case + atlas thumbnails)
- VQA-RAD on Hugging Face (CC0 1.0)
- CasiMedicos/HiTZ on Hugging Face (CC BY 4.0)
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
GEN = ROOT / "generated"
CASES_DIR = GEN / "cases"
ATLAS_DIR = GEN / "atlas"
VQA_DIR = GEN / "vqa-rad"
UA = "Radform/2026 educational radiology app (+https://igalang.github.io/Radform/)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
HF_BASE = "https://datasets-server.huggingface.co"

RAD_KEYS = (
    "radiograf", "radiolog", "imagen", "tomograf", " tac ", "tac ", "resonancia",
    "ecograf", "mamograf", " rm ", " tc ", "rayos x", "rx ", "pet", "gammagraf",
)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def clean(value) -> str:
    return " ".join(str(value or "").split())


def norm(value) -> str:
    import unicodedata
    text = unicodedata.normalize("NFD", clean(value).lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json_atomic(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def req_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def request_bytes(url: str, timeout: int = 35) -> tuple[bytes, str]:
    if url.startswith("data:"):
        header, encoded = url.split(",", 1)
        mime = header[5:].split(";", 1)[0] or "image/jpeg"
        if ";base64" in header:
            return base64.b64decode(encoded), mime
        return urllib.parse.unquote_to_bytes(encoded), mime
    req = urllib.request.Request(url, headers={"Accept": "image/*,*/*;q=0.8", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read(), response.headers.get_content_type() or "image/jpeg"


def extension_for_mime(mime: str, url: str = "") -> str:
    mapping = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    if mime in mapping:
        return mapping[mime]
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    return mimetypes.guess_extension(mime or "") or ".jpg"


def save_image(src: str, base_path: Path) -> str | None:
    try:
        data, mime = request_bytes(src)
        if len(data) < 700:
            return None
        ext = extension_for_mime(mime, src)
        path = base_path.with_suffix(ext)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return "./" + path.relative_to(ROOT).as_posix()
    except Exception:
        return None


def strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return clean(text.replace("&nbsp;", " ").replace("&amp;", "&"))


def extmeta_value(metadata, key: str) -> str:
    value = ((metadata or {}).get(key) or {}).get("value") or ""
    return strip_html(value)


def commons_normalize_page(page) -> dict | None:
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        return None
    mime = str(info.get("mime") or "")
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        return None
    md = info.get("extmetadata") or {}
    title = re.sub(r"^File:", "", str(page.get("title") or ""), flags=re.I)
    license_name = extmeta_value(md, "LicenseShortName") or extmeta_value(md, "UsageTerms")
    # Conservative: do not cache if Wikimedia did not expose a license label.
    if not license_name:
        return None
    return {
        "title": title,
        "thumb": info.get("thumburl") or info.get("url") or "",
        "sourcePage": info.get("descriptionurl") or "",
        "author": extmeta_value(md, "Artist") or extmeta_value(md, "Credit") or "Wikimedia Commons contributor",
        "license": license_name,
        "licenseUrl": strip_html(((md.get("LicenseUrl") or {}).get("value") or "")),
        "description": extmeta_value(md, "ImageDescription") or extmeta_value(md, "ObjectName") or title,
        "width": info.get("width") or 0,
        "height": info.get("height") or 0,
    }


def commons_query_params(**extra) -> str:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime|size",
        "iiurlwidth": "900",
    }
    params.update({k: str(v) for k, v in extra.items() if v is not None})
    return COMMONS_API + "?" + urllib.parse.urlencode(params)


def commons_file(filename: str) -> dict | None:
    if not filename:
        return None
    title = filename if filename.lower().startswith("file:") else f"File:{filename}"
    try:
        data = req_json(commons_query_params(titles=title), timeout=25)
        pages = data.get("query", {}).get("pages") or []
        for page in pages:
            item = commons_normalize_page(page)
            if item:
                return item
    except Exception:
        pass
    return None


def search_variants(*values: str) -> list[str]:
    variants: list[str] = []
    noise = {
        "ct", "cta", "mri", "mr", "xray", "xr", "radiograph", "radiography", "ultrasound", "us", "scan",
        "image", "imaging", "axial", "coronal", "sagittal", "contrast", "enhanced", "angiography", "neck",
        "chest", "abdomen", "pelvis", "brain", "fluid", "finding", "findings", "sign", "appearance", "view",
    }
    for value in values:
        text = clean(value)
        if not text:
            continue
        variants.append(text)
        words = norm(text).split()
        clinical = [word for word in words if word not in noise]
        if len(clinical) >= 2:
            variants.append(" ".join(clinical))
        if len(clinical) >= 3:
            variants.append(" ".join(clinical[:3]))
        if len(clinical) >= 2:
            variants.append(" ".join(clinical[:2]))
    seen = set()
    out = []
    for item in variants:
        key = norm(item)
        if len(key) < 3 or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out[:7]


def score_commons(item: dict, query: str) -> int:
    hay = norm(f"{item.get('title','')} {item.get('description','')}")
    words = [w for w in norm(query).split() if len(w) > 2]
    score = sum(3 for word in words if word in hay)
    for useful in ("ct", "tomography", "mri", "resonance", "x ray", "radiograph", "ultrasound", "angiograph"):
        if useful in hay:
            score += 1
    for poor in ("logo", "icon", "map", "diagram", "scheme", "drawing", "histology", "microscopy", "specimen"):
        if poor in hay:
            score -= 5
    if int(item.get("width") or 0) >= 500 and int(item.get("height") or 0) >= 500:
        score += 1
    return score


def commons_search(*queries: str) -> dict | None:
    for query in search_variants(*queries):
        params = commons_query_params(
            generator="search",
            gsrsearch=query,
            gsrnamespace=6,
            gsrlimit=20,
        )
        try:
            data = req_json(params, timeout=25)
            pages = data.get("query", {}).get("pages") or []
            items = [commons_normalize_page(page) for page in pages]
            items = [item for item in items if item]
            if items:
                items.sort(key=lambda item: score_commons(item, query), reverse=True)
                return items[0]
        except Exception:
            continue
    return None


def file_exists_for_entry(entry: dict) -> bool:
    url = str(entry.get("imageUrl") or "")
    if not url.startswith("./generated/"):
        return False
    return (ROOT / url[2:]).exists()


def refresh_case_images() -> tuple[int, int]:
    cases = load_json(DATA / "cases.json", [])
    old_doc = load_json(DATA / "case-image-cache.json", {"results": []})
    old = {str(item.get("id")): item for item in old_doc.get("results", []) if item.get("id")}
    results = []
    new_count = 0

    for idx, case in enumerate(cases):
        case_id = str(case.get("id") or "")
        if not case_id:
            continue
        if case_id in old and file_exists_for_entry(old[case_id]):
            results.append(old[case_id])
            continue

        image = case.get("image") or {}
        selected = commons_file(clean(image.get("file"))) if image.get("file") else None
        if not selected:
            selected = commons_search(
                clean(image.get("searchQuery")),
                clean(case.get("diagnosis")),
                clean(case.get("title")),
            )
        if not selected or not selected.get("thumb"):
            if case_id in old:
                results.append(old[case_id])
            continue

        local_url = save_image(selected["thumb"], CASES_DIR / case_id)
        if not local_url:
            if case_id in old:
                results.append(old[case_id])
            continue

        results.append({
            "id": case_id,
            "clinicalLabel": clean(case.get("diagnosis") or case.get("title")),
            "imageUrl": local_url,
            "sourcePage": selected.get("sourcePage") or image.get("sourcePage") or "",
            "author": selected.get("author") or image.get("author") or "Wikimedia Commons contributor",
            "license": selected.get("license") or image.get("license") or "",
            "licenseUrl": selected.get("licenseUrl") or image.get("licenseUrl") or "",
            "description": clean(image.get("alt") or selected.get("description") or case.get("diagnosis")),
            "originalTitle": selected.get("title") or image.get("file") or "",
        })
        new_count += 1
        if idx % 20 == 0:
            print(f"Case images: {idx + 1}/{len(cases)}")
        time.sleep(0.04)

    results.sort(key=lambda item: item["id"])
    if results:
        write_json_atomic(DATA / "case-image-cache.json", {"generated_at": now_iso(), "results": results})
    return len(results), new_count


def refresh_atlas_images() -> tuple[int, int]:
    topics = load_json(DATA / "atlas-topics.json", [])
    old_doc = load_json(DATA / "atlas-image-cache.json", {"results": []})
    old = {str(item.get("topicId")): item for item in old_doc.get("results", []) if item.get("topicId")}
    results = []
    new_count = 0

    for idx, topic in enumerate(topics):
        topic_id = str(topic.get("id") or "")
        if not topic_id:
            continue
        if topic_id in old and file_exists_for_entry(old[topic_id]):
            results.append(old[topic_id])
            continue
        selected = commons_search(clean(topic.get("query")), clean(topic.get("label")))
        if not selected or not selected.get("thumb"):
            if topic_id in old:
                results.append(old[topic_id])
            continue
        local_url = save_image(selected["thumb"], ATLAS_DIR / topic_id)
        if not local_url:
            if topic_id in old:
                results.append(old[topic_id])
            continue
        results.append({
            "topicId": topic_id,
            "label": clean(topic.get("label")),
            "query": clean(topic.get("query")),
            "modality": clean(topic.get("modality")),
            "anatomy": clean(topic.get("anatomy")),
            "imageUrl": local_url,
            "sourcePage": selected.get("sourcePage") or "",
            "author": selected.get("author") or "Wikimedia Commons contributor",
            "license": selected.get("license") or "",
            "licenseUrl": selected.get("licenseUrl") or "",
            "description": clean(selected.get("description") or topic.get("label")),
            "originalTitle": selected.get("title") or "",
        })
        new_count += 1
        if idx % 20 == 0:
            print(f"Atlas images: {idx + 1}/{len(topics)}")
        time.sleep(0.04)

    results.sort(key=lambda item: item["topicId"])
    if results:
        write_json_atomic(DATA / "atlas-image-cache.json", {"generated_at": now_iso(), "results": results})
    return len(results), new_count


def hf_splits(dataset: str) -> list[dict]:
    url = HF_BASE + "/splits?" + urllib.parse.urlencode({"dataset": dataset})
    data = req_json(url, timeout=35)
    return data.get("splits") or []


def hf_rows(dataset: str, config: str, split: str, offset: int, length: int = 100) -> list[dict]:
    url = HF_BASE + "/rows?" + urllib.parse.urlencode({
        "dataset": dataset, "config": config, "split": split,
        "offset": offset, "length": max(1, min(length, 100)),
    })
    data = req_json(url, timeout=35)
    return data.get("rows") or []


def image_src(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("src") or value.get("url") or value.get("path") or ""
    return ""


def normalize_options(raw) -> list[str]:
    if isinstance(raw, list):
        return [clean(v) for v in raw if clean(v)]
    if isinstance(raw, dict):
        def order(item):
            try:
                return int(item[0])
            except Exception:
                return 999
        return [clean(v) for _, v in sorted(raw.items(), key=order) if clean(v)]
    return []


def correct_index(raw, n: int):
    text = clean(raw)
    try:
        value = int(text)
        if 1 <= value <= n:
            return value - 1
        if 0 <= value < n:
            return value
    except Exception:
        pass
    if text:
        value = ord(text[0].upper()) - 65
        if 0 <= value < n:
            return value
    return None


def refresh_casimedicos() -> int:
    dataset = "HiTZ/casimedicos-exp"
    old_doc = load_json(DATA / "mir-open-snapshot.json", {"results": []})
    try:
        splits = [sp for sp in hf_splits(dataset) if sp.get("config") == "es"]
        if not splits:
            raise RuntimeError("Spanish split unavailable")
        results = []
        seen = set()
        for sp in splits:
            offset = 0
            while True:
                rows = hf_rows(dataset, sp["config"], sp["split"], offset, 100)
                if not rows:
                    break
                for wrapper in rows:
                    row = wrapper.get("row") or {}
                    options = normalize_options(row.get("options"))
                    question = clean(row.get("full_question") or row.get("question"))
                    explanation = clean(row.get("full_answer") or row.get("full_answer_text"))
                    specialty = clean(row.get("type") or "MIR")
                    hay = " " + norm(f"{question} {explanation} {specialty}") + " "
                    if not any(key in hay for key in RAD_KEYS):
                        continue
                    qid = clean(row.get("id") or f"casimedicos-{row.get('year','')}-{row.get('question_id_specific', wrapper.get('row_idx',''))}")
                    if not qid or qid in seen:
                        continue
                    seen.add(qid)
                    results.append({
                        "id": qid,
                        "year": clean(row.get("year")),
                        "questionId": clean(row.get("question_id_specific")),
                        "question": question,
                        "explanation": explanation,
                        "specialty": specialty,
                        "options": options,
                        "correctIndex": correct_index(row.get("correct_option", row.get("correct option")), len(options)),
                        "source": "CasiMedicos / HiTZ",
                        "license": "CC BY 4.0",
                        "sourceUrl": "https://huggingface.co/datasets/HiTZ/casimedicos-exp",
                    })
                offset += len(rows)
                if len(rows) < 100:
                    break
        if not results:
            raise RuntimeError("No radiology questions found")
        write_json_atomic(DATA / "mir-open-snapshot.json", {"generated_at": now_iso(), "results": results})
        return len(results)
    except Exception as exc:
        print(f"CasiMedicos refresh failed; keeping previous snapshot: {exc}")
        return len(old_doc.get("results", []))


def refresh_vqarad() -> tuple[int, int]:
    dataset = "abhay2812/vqa-rad"
    old_doc = load_json(DATA / "vqa-rad-snapshot.json", {"results": []})
    old = {str(item.get("id")): item for item in old_doc.get("results", []) if item.get("id")}
    try:
        grouped: dict[str, dict] = {}
        splits = hf_splits(dataset)
        if not splits:
            raise RuntimeError("VQA-RAD splits unavailable")
        for sp in splits:
            offset = 0
            while True:
                rows = hf_rows(dataset, sp["config"], sp["split"], offset, 100)
                if not rows:
                    break
                for wrapper in rows:
                    row = wrapper.get("row") or {}
                    name = clean(row.get("image_name") or f"{sp['split']}-{wrapper.get('row_idx','')}.jpg")
                    item = grouped.setdefault(name, {
                        "id": name,
                        "imageName": name,
                        "organ": clean(row.get("image_organ")),
                        "questions": [],
                        "sourceUrl": "https://huggingface.co/datasets/abhay2812/vqa-rad",
                        "license": "CC0 1.0",
                        "_src": "",
                    })
                    if len(item["questions"]) < 12:
                        item["questions"].append({
                            "question": clean(row.get("question")),
                            "answer": clean(row.get("answer")),
                            "answerType": clean(row.get("answer_type")),
                            "questionType": clean(row.get("question_type_primary")),
                        })
                    if not item["_src"]:
                        item["_src"] = image_src(row.get("image"))
                offset += len(rows)
                if len(rows) < 100:
                    break

        results = []
        new_count = 0
        for idx, (name, item) in enumerate(grouped.items()):
            previous = old.get(name)
            if previous and file_exists_for_entry(previous):
                results.append(previous)
                continue
            src = item.pop("_src", "")
            local_url = save_image(src, VQA_DIR / f"{idx:04d}-{re.sub(r'[^A-Za-z0-9_-]+','-',Path(name).stem)[:70]}")
            if not local_url:
                if previous:
                    results.append(previous)
                continue
            item["imageUrl"] = local_url
            results.append(item)
            new_count += 1
        if not results:
            raise RuntimeError("No VQA-RAD images could be cached")
        write_json_atomic(DATA / "vqa-rad-snapshot.json", {"generated_at": now_iso(), "results": results})
        return len(results), new_count
    except Exception as exc:
        print(f"VQA-RAD refresh failed; keeping previous snapshot: {exc}")
        return len(old_doc.get("results", [])), 0


def write_generated_media_doc(case_count: int, atlas_count: int, vqa_count: int, mir_count: int) -> None:
    text = f"""# Radform generated/open media cache\n\nLast refresh: {now_iso()}\n\nThis folder is generated by `scripts/refresh_external_content.py`. Do not remove source/license metadata from the JSON indexes.\n\n- Cached Radform case images: {case_count}\n- Cached Atlas topic images: {atlas_count}\n- Cached VQA-RAD images: {vqa_count} (dataset license: CC0 1.0)\n- Cached CasiMedicos/HiTZ radiology questions: {mir_count} (dataset license: CC BY 4.0)\n\nWikimedia Commons images retain per-file author, source page and license metadata in `data/case-image-cache.json` and `data/atlas-image-cache.json`. The UI displays those attribution fields with the cached image.\n"""
    (ROOT / "GENERATED_MEDIA.md").write_text(text, encoding="utf-8")


def main() -> None:
    DATA.mkdir(exist_ok=True)
    GEN.mkdir(exist_ok=True)
    print("Refreshing Radform open educational content…")
    case_count, case_new = refresh_case_images()
    atlas_count, atlas_new = refresh_atlas_images()
    mir_count = refresh_casimedicos()
    vqa_count, vqa_new = refresh_vqarad()
    write_generated_media_doc(case_count, atlas_count, vqa_count, mir_count)
    print("\nRefresh summary")
    print(f"  Case images: {case_count} ({case_new} new)")
    print(f"  Atlas images: {atlas_count} ({atlas_new} new)")
    print(f"  VQA-RAD images: {vqa_count} ({vqa_new} new)")
    print(f"  MIR real questions: {mir_count}")


if __name__ == "__main__":
    main()
