"""카드 상품 DB(인기 카드 100장) + 업종코드표 + 가게→업종코드 연결표. 파일에서 읽기만 한다.

data/benefits/
  cards/*.json   카드별 혜택 (적용 대상은 원문 그대로)
  taxonomy.json  업종코드표 (실제 카드 혜택에서 거꾸로 뽑은 55개)
  mapping.json   업종코드 ↔ 카카오 업종·Vision 라벨·브랜드 별칭, 혜택 → 업종코드

카드를 늘리려면 cards/ 에 파일만 추가하면 된다 (코드 수정 없음).
경로를 바꾸려면 환경변수 CARD_DATA_DIR.
"""
import glob
import json
import os
import re
from functools import lru_cache

DATA_DIR = os.getenv("CARD_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "data", "benefits")

# 과자·노트북 사진에도 붙는 넓은 Vision 라벨 → 업종 추정에 쓰지 않음
GENERIC_LABELS = {
    "food", "dish", "meal", "tableware", "drink", "cup", "bottle", "fast food", "junk food", "snack",
    "convenience food", "retail", "shelf", "aisle", "market", "marketplace", "shopping cart", "lobby",
    "computer", "fashion", "clothing", "beauty", "publication", "education", "medical", "gaming",
}


def _load(name):
    with open(os.path.join(DATA_DIR, name), encoding="utf-8") as f:
        return json.load(f)


def norm(s: str) -> str:
    """브랜드 비교용: 소문자, 공백·기호 제거 ('메가 MGC커피' → '메가mgc커피')"""
    return re.sub(r"[\s'’.·\-_/()]+", "", (s or "").lower())


@lru_cache(maxsize=1)
def cards() -> dict:
    out = {}
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "cards", "*.json"))):
        with open(path, encoding="utf-8") as f:
            c = json.load(f)
        out[c["card_id"]] = c
    return out


@lru_cache(maxsize=1)
def taxonomy() -> dict:
    """code → {code, name, parent, store_recognizable}"""
    return {x["code"]: x for x in _load("taxonomy.json")["codes"]}


@lru_cache(maxsize=1)
def mapping() -> dict:
    return _load("mapping.json")


def code_name(code) -> str:
    return taxonomy().get(code, {}).get("name", "기타") if code else "기타"


@lru_cache(maxsize=1)
def store_codes() -> list:
    """사진으로 알아볼 수 있는(매장) 업종코드 — 상위 그룹(FD 등) 제외"""
    return [c for c, x in taxonomy().items() if x.get("parent") and x.get("store_recognizable")]


@lru_cache(maxsize=1)
def code_by_name() -> dict:
    return {x["name"]: c for c, x in taxonomy().items()}


@lru_cache(maxsize=1)
def _alias_index() -> dict:
    """정규화된 별칭 → 대표 브랜드명 (카드 원문 '메가커피'·'이디야'도 '메가MGC커피'·'이디야커피'로)"""
    idx = {}
    for b in mapping()["brands"]:
        for a in [b["brand"], *b.get("aliases", [])]:
            idx.setdefault(norm(a), b["brand"])
    return idx


def canonical_brand(name: str) -> str:
    n = norm(name)
    return _alias_index().get(n, n)


def store_brands() -> list:
    """매장으로 알아볼 수 있는 브랜드 [{brand, code, aliases}] (온라인몰·배달앱 제외)"""
    return [b for b in mapping()["brands"] if b.get("store_recognizable")]


@lru_cache(maxsize=1)
def benefit_code_map() -> dict:
    return mapping().get("benefit_codes", {})


def benefit_codes(benefit_id: str) -> list:
    return benefit_code_map().get(benefit_id, [])


def kakao_code(category_name: str, place_name: str = "", group_code: str = ""):
    """카카오 category_name('음식점 > 카페 > 커피전문점 > 스타벅스') → 업종코드. 가장 구체적인(뒤쪽) 세그먼트부터 비교"""
    segs = [s.strip() for s in (category_name or "").split(">")]
    entries = [x for x in mapping()["codes"] if x.get("kakao")]
    for seg in reversed(segs):
        hits = [x for x in entries if seg in (x["kakao"].get("category_name_segments") or [])]
        if len(hits) > 1:   # 같은 세그먼트를 여러 코드가 쓰면 매장명으로 구분 (예: 대형마트 vs 트레이더스)
            named = [x for x in hits if any(k in (place_name or "") for k in x["kakao"].get("place_name_contains") or [])]
            plain = [x for x in hits if not x["kakao"].get("place_name_contains")]
            hits = named or plain or hits
        if hits:
            return hits[0]["code"]
    if group_code:   # 세그먼트로 못 찾으면 카카오 그룹코드가 하나의 업종에만 쓰일 때
        by_group = [x["code"] for x in entries if group_code in (x["kakao"].get("category_group_codes") or [])]
        if len(by_group) == 1:
            return by_group[0]
    return None


@lru_cache(maxsize=1)
def _label_index() -> dict:
    """Vision 라벨 → 업종코드. 넓은 라벨과 여러 업종에 걸친 라벨은 제외"""
    seen = {}
    for x in mapping()["codes"]:
        for label in x.get("vision_labels") or []:
            seen.setdefault(label.lower(), set()).add(x["code"])
    return {l: next(iter(cs)) for l, cs in seen.items() if len(cs) == 1 and l not in GENERIC_LABELS}


def vision_code(labels):
    """[(라벨, 점수)] → (업종코드, 점수) 가장 점수 높은 것. 없으면 (None, 0)"""
    best = (None, 0.0)
    for desc, score in labels:
        code = _label_index().get((desc or "").lower())
        if code and score > best[1]:
            best = (code, score)
    return best
