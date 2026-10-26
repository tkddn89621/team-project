"""브랜드 인식: 로고 + 텍스트(OCR) + 사진 속 사물(라벨) + GPS → 후보 + 신뢰도.

detect() 가 사진을 분석하고(Vision), decide() 가 근처 매장(카카오 로컬·시연용 좌표)과 합쳐 후보를 정한다.
둘을 나눠 둔 건 Vision 호출과 카카오 검색을 동시에 하기 위해서 (main.create_recognition).

환경변수 (backend/.env 에 적어도 됨)
  GOOGLE_VISION_API_KEY=API키                      → 실제 Vision 호출 (서비스 계정 키가 막힌 조직용)
  GOOGLE_APPLICATION_CREDENTIALS=서비스계정.json   → 실제 Vision 호출
  RECOG_MODE=mock                                  → Vision 없이 파일명으로 브랜드 추정(시연 플랜 B)
"""
import math
import os
import re
from typing import List, Optional, Tuple
from .models import Brand

CONFIDENCE_AUTO = 0.80   # 이 이상 + 후보 1개면 자동 확정 (문서 AI-05)
CONF_TEXT = 0.75         # OCR 텍스트만으로 찾음 → 사용자 확인 유도
CONF_IMAGE = 0.55        # 사진 속 사물로 업종만 추정
CONF_GPS = 0.50          # 근처 매장이라는 것만으로 추정
GPS_BOOST = 0.15         # 다른 근거로 찾은 후보가 근처에도 있으면 가산
GPS_RADIUS_M = 50       # 실내에선 GPS가 20~50m 틀어져서 기획서 30m보다 넓게

# Vision 라벨(사진 속 사물) → 업종. 로고/글씨로 못 찾았을 때만 사용
# 'fast food'·'junk food' 같은 넓은 라벨은 과자에도 붙어서 넣지 않음 (구체적인 사물만)
LABEL_CATEGORY = {
    "hamburger": "패스트푸드", "burger": "패스트푸드", "cheeseburger": "패스트푸드",
    "french fries": "패스트푸드",
    "coffee": "카페", "coffee cup": "카페", "latte": "카페", "espresso": "카페", "cappuccino": "카페",
    "popcorn": "영화", "cosmetics": "뷰티", "book": "서점",
}


def _alias_list(brand: Brand) -> List[str]:
    return [a.strip().lower() for a in brand.aliases.split(",") if a.strip()]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


def _alias_pattern(alias: str) -> re.Pattern:
    body = r"\s*".join(re.escape(p) for p in alias.split())
    # 영문 alias는 단어 단위로만 매칭 ('cu'가 'security', 'picture'에 걸리지 않게). 한글은 조사가 붙으니 부분 매칭
    if re.fullmatch(r"[a-z0-9 .'&-]+", alias):
        return re.compile(rf"(?<![a-z]){body}(?![a-z])")
    return re.compile(body)


def brand_in_text(b: Brand, text: str) -> bool:
    """브랜드 alias가 text(간판 글씨·카카오 매장명 등)에 들어 있나"""
    t = _norm(text)
    return any(_alias_pattern(a).search(t) for a in _alias_list(b))


def _cand(b: Brand, confidence: float, source: str) -> dict:
    return {"brand_id": b.id, "name": b.name, "category": b.category,
            "logo_url": b.logo_url, "confidence": round(confidence, 2), "source": source}


def match_brands(logo_names: List[Tuple[str, float]], ocr_text: str, brands: List[Brand]) -> list:
    """logo_names: [(설명, score)], ocr_text: 전체 텍스트 → 후보 리스트(신뢰도 내림차순)"""
    text = _norm(ocr_text)
    found = {}

    for b in brands:
        aliases = _alias_list(b)
        best, source = 0.0, None
        # 1) 로고 감지 결과와 alias 일치 → 로고 score 그대로
        for desc, sc in logo_names:
            d = _norm(desc)
            if any(a == d or _alias_pattern(a).search(d) for a in aliases) and min(0.99, sc) > best:
                best, source = min(0.99, sc), "logo"
        # 2) OCR 텍스트에 alias 포함 → 0.75 (로고 없이 텍스트만이면 사용자 확인 유도)
        if CONF_TEXT > best and any(_alias_pattern(a).search(text) for a in aliases):
            best, source = CONF_TEXT, "text"
        if best > 0:
            found[b.id] = _cand(b, best, source)

    return sorted(found.values(), key=lambda c: c["confidence"], reverse=True)


def infer_from_labels(labels: List[Tuple[str, float]], brands: List[Brand]) -> list:
    """사진 속 사물(버거, 커피 등) → 업종 → 그 업종 브랜드들을 낮은 신뢰도로 후보에"""
    cats = {}
    for desc, sc in labels:
        cat = LABEL_CATEGORY.get(_norm(desc))
        if cat:
            cats[cat] = max(cats.get(cat, 0), sc)
    if not cats:
        return []
    top_cat = max(cats, key=cats.get)
    unique = {b.id: b for b in brands if b.category == top_cat}   # 근처 목록엔 같은 브랜드가 여러 지점일 수 있음
    return [_cand(b, CONF_IMAGE, "image") for b in unique.values()]


def _distance_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def seeded_near(brands: List[Brand], coords: Optional[Tuple[float, float]]) -> list:
    """seed.py에 좌표가 있는 브랜드 중 반경 안 → [(brand, 거리m)]"""
    if not coords:
        return []
    near = []
    for b in brands:
        if b.lat is not None and b.lng is not None:
            d = _distance_m(coords[0], coords[1], b.lat, b.lng)
            if d <= GPS_RADIUS_M:
                near.append((b, d))
    return near


def apply_gps(cands: list, near: list) -> list:
    """near=[(brand, 거리m)]: 이미 후보면 신뢰도 가산, 확신이 없을 땐 근처 매장을 후보로 추가"""
    if not near:
        return cands
    closest = {}
    for b, d in near:
        if b.id not in closest or d < closest[b.id][1]:
            closest[b.id] = (b, d)

    for c in cands:
        if c["brand_id"] in closest:
            c["distance_m"] = round(closest[c["brand_id"]][1])
            c["confidence"] = round(min(0.99, c["confidence"] + GPS_BOOST), 2)
    # 신뢰도가 같으면 가까운 매장 먼저
    cands.sort(key=lambda c: (-c["confidence"], c.get("distance_m", GPS_RADIUS_M + 1)))

    if not cands or cands[0]["confidence"] < CONFIDENCE_AUTO:
        have = {c["brand_id"] for c in cands}
        for b, d in sorted(closest.values(), key=lambda x: x[1]):
            if b.id not in have:
                cands.append({**_cand(b, CONF_GPS, "gps"), "distance_m": round(d)})
    return cands


def run_vision(image_bytes: bytes) -> Tuple[List[Tuple[str, float]], str, List[Tuple[str, float]]]:
    from google.cloud import vision  # lazy import
    api_key = os.getenv("GOOGLE_VISION_API_KEY")
    client = vision.ImageAnnotatorClient(client_options={"api_key": api_key}) if api_key else vision.ImageAnnotatorClient()
    image = vision.Image(content=image_bytes)
    resp = client.annotate_image({
        "image": image,
        "features": [
            {"type_": vision.Feature.Type.LOGO_DETECTION, "max_results": 5},
            {"type_": vision.Feature.Type.TEXT_DETECTION},
            {"type_": vision.Feature.Type.LABEL_DETECTION, "max_results": 10},
        ],
    })
    logos = [(l.description, float(l.score)) for l in resp.logo_annotations]
    text = resp.text_annotations[0].description if resp.text_annotations else ""
    labels = [(l.description, float(l.score)) for l in resp.label_annotations]
    return logos, text, labels


def detect(image_bytes: bytes, filename: str) -> dict:
    """사진 분석 → {mode, logos, text, labels, raw}. Vision 키가 없으면 파일명으로 흉내"""
    has_key = os.getenv("GOOGLE_VISION_API_KEY") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    mode = os.getenv("RECOG_MODE", "vision" if has_key else "mock")
    if mode == "mock":
        # 플랜 B: 파일명을 OCR 텍스트이자 사진 라벨로 취급 (starbucks.jpg → 로고 인식, burger.jpg → 사진 추론)
        words = re.findall(r"[a-z]+", filename.lower())
        return {"mode": mode, "logos": [], "text": filename, "labels": [(w, 0.9) for w in words],
                "raw": {"mode": "mock", "filename": filename}}
    logos, text, labels = run_vision(image_bytes)
    return {"mode": mode, "logos": logos, "text": text, "labels": labels,
            "raw": {"mode": "vision", "logos": logos, "text": text[:500], "labels": labels[:10]}}


def decide(det: dict, brands: List[Brand], near: list) -> list:
    """사진 분석 결과 + 근처 매장 [(brand, 거리m)] → 후보 최대 3개"""
    mock = det["mode"] == "mock"
    cands = match_brands(det["logos"], det["text"], brands)
    if mock and cands:
        cands[0]["confidence"], cands[0]["source"] = 0.95, "logo"   # 파일명 매칭 = 로고 인식 성공으로 간주
    if not cands:
        # 근처 매장을 알면 사진은 그 안에서 순위만 정한다 (근처에 없는 버거킹이 뜨지 않게)
        cands = infer_from_labels(det["labels"], [b for b, _ in near] if near else brands)
    cands = apply_gps(cands, near)
    if mock and not cands:
        # 아무 근거도 없으면 '버거 사진' 시나리오로 (시연용)
        cands = infer_from_labels([("hamburger", 0.9)], brands)
    return cands[:3]
