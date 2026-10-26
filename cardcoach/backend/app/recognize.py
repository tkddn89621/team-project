"""브랜드 인식: Google Vision(로고 + 텍스트) → 브랜드 alias 매칭 → 후보 + 신뢰도.

환경변수
  GOOGLE_APPLICATION_CREDENTIALS=서비스계정.json   → 실제 Vision 호출
  RECOG_MODE=mock                                  → Vision 없이 파일명으로 브랜드 추정(시연 플랜 B)
"""
import os
import re
from typing import List, Tuple
from .models import Brand

CONFIDENCE_AUTO = 0.80   # 이 이상 + 후보 1개면 자동 확정 (문서 AI-05)


def _alias_list(brand: Brand) -> List[str]:
    return [a.strip().lower() for a in brand.aliases.split(",") if a.strip()]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


def match_brands(logo_names: List[Tuple[str, float]], ocr_text: str, brands: List[Brand]) -> list:
    """logo_names: [(설명, score)], ocr_text: 전체 텍스트 → 후보 리스트(신뢰도 내림차순)"""
    text = _norm(ocr_text)
    text_nospace = text.replace(" ", "")
    scores = {}

    for b in brands:
        aliases = _alias_list(b)
        best = 0.0
        # 1) 로고 감지 결과와 alias 일치 → 로고 score 그대로
        for desc, sc in logo_names:
            d = _norm(desc)
            if any(a == d or a in d or d in a for a in aliases):
                best = max(best, min(0.99, sc))
        # 2) OCR 텍스트에 alias 포함 → 0.75 (로고 없이 텍스트만이면 사용자 확인 유도)
        for a in aliases:
            if a and (a in text or a.replace(" ", "") in text_nospace):
                best = max(best, 0.75)
        if best > 0:
            scores[b.id] = (b, round(best, 2))

    ranked = sorted(scores.values(), key=lambda x: x[1], reverse=True)
    return [
        {"brand_id": b.id, "name": b.name, "category": b.category,
         "logo_url": b.logo_url, "confidence": sc}
        for b, sc in ranked[:3]
    ]


def run_vision(image_bytes: bytes) -> Tuple[List[Tuple[str, float]], str]:
    from google.cloud import vision  # lazy import
    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_bytes)
    resp = client.annotate_image({
        "image": image,
        "features": [
            {"type_": vision.Feature.Type.LOGO_DETECTION, "max_results": 5},
            {"type_": vision.Feature.Type.TEXT_DETECTION},
        ],
    })
    logos = [(l.description, float(l.score)) for l in resp.logo_annotations]
    text = resp.text_annotations[0].description if resp.text_annotations else ""
    return logos, text


def recognize(image_bytes: bytes, filename: str, brands: List[Brand]) -> dict:
    mode = os.getenv("RECOG_MODE", "vision" if os.getenv("GOOGLE_APPLICATION_CREDENTIALS") else "mock")
    if mode == "mock":
        # 플랜 B: 파일명에 브랜드 alias가 있으면 그걸로, 없으면 버거킹
        cands = match_brands([], filename, brands)
        if not cands:
            bk = next((b for b in brands if b.name == "버거킹"), brands[0])
            cands = [{"brand_id": bk.id, "name": bk.name, "category": bk.category,
                      "logo_url": bk.logo_url, "confidence": 0.95}]
        else:
            cands[0]["confidence"] = 0.95
        return {"candidates": cands, "raw": {"mode": "mock", "filename": filename}}

    logos, text = run_vision(image_bytes)
    cands = match_brands(logos, text, brands)
    return {"candidates": cands, "raw": {"mode": "vision", "logos": logos, "text": text[:500]}}
