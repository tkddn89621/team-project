"""애매한 사진만 Claude에게: 사진 + 후보 매장 목록 → 어느 매장에서 찍었는지 고르기.

로고·간판으로 확실한 경우(신뢰도 0.80 이상)는 부르지 않는다 (main.create_recognition).

환경변수 (backend/.env)
  ANTHROPIC_API_KEY=...   → 없으면 사용 안 함 (규칙 기반 결과 그대로)
"""
import base64
import io
import json
import os

import anthropic
from PIL import Image, ImageOps

from . import catalog

MODEL = "claude-opus-5-5"
MAX_SIDE = 1024   # 사진을 줄여서 보냄 (토큰·지연 감소)
# 업종 = 업종코드표에서 매장으로 알아볼 수 있는 업종 이름 (data/benefits/taxonomy.json) + 기타
CATEGORIES = [catalog.code_name(c) for c in catalog.store_codes()] + ["기타"]

SCHEMA = {
    "type": "object",
    "properties": {
        "candidate_id": {"type": "integer"},   # 후보 id, 목록에 없거나 판단 불가면 0
        "brand_name": {"type": "string"},      # 목록 밖 브랜드가 사진에 확실히 보이면 그 이름, 아니면 ""
        "category": {"type": "string", "enum": CATEGORIES},
        "category_match": {"type": "string", "enum": ["exact", "similar"]},   # 업종이 정확히 같은지, 가장 가까운 것인지
        "confidence": {"type": "number"},      # 0~1
        "reason": {"type": "string"},          # 사용자에게 보여줄 한 문장
    },
    "required": ["candidate_id", "brand_name", "category", "category_match", "confidence", "reason"],
    "additionalProperties": False,
}

PROMPT = """카드 혜택 추천 앱입니다. 사용자가 결제 직전에 매장 안이나 앞에서 이 사진을 찍었습니다.
사진 속 가맹점(매장 브랜드)을 알아내세요.
- 먼저 아래 후보 중에서 고르세요. 간판·로고·포장지·상품 종류(예: 과자·음료 → 편의점, 커피 → 카페, 버거 → 패스트푸드)와 현재 위치에서의 거리를 함께 고려하세요. 거리가 표시된 후보는 지금 근처에 실제로 있는 매장이라 더 유력합니다.
- 후보에 없지만 사진에 특정 가맹점 브랜드가 확실히 보이면(로고·간판·포장지의 브랜드명) candidate_id 는 0, brand_name 에 그 브랜드 이름(한국에서 부르는 이름, 지점명 제외), category 에 업종을 쓰세요.
  상품 제조사(오리온, 농심 등)나 상품명은 가맹점이 아니니 brand_name 에 쓰지 마세요.
  이때 category 는 목록에서 그 매장과 가장 가까운 업종을 쓰고, category_match 에 정확히 같은 업종이면 "exact",
  가장 가깝지만 같지는 않으면 "similar" 를 쓰세요. (예: 동네 카페 → 카페 exact, 아웃도어 옷 매장 → 의류(SPA) similar)
  비슷한 업종조차 없으면 "기타" 로 쓰세요.
- 업종은 분명하지만(예: 껌·과자 → 편의점) 그 업종 매장이 여럿이고 어느 곳인지 근거(로고·간판·근처 거리)가 없으면
  하나를 짐작해서 고르지 말고 candidate_id 0, brand_name "", category 에 그 업종을 쓰세요. 사용자가 직접 고릅니다.
- 가맹점 단서가 전혀 없으면(예: 축구공, 구단·후원사 로고) candidate_id 0, brand_name "", category "기타" 로 하세요.
- 후보를 골랐으면 brand_name 은 "" 로, category 는 그 후보의 업종으로, category_match 는 "exact" 로 쓰세요.
- reason 은 사용자에게 보여줄 한국어 한 문장(30자 이내)으로 쓰세요.

사진 분석 참고: {hints}

후보:
{options}"""


def enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _jpeg_b64(image_bytes: bytes) -> str:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return base64.standard_b64encode(buf.getvalue()).decode()


def pick(image_bytes: bytes, options: list, hints: str):
    """options: [{id, name, category, distance_m(없으면 None)}] → {brand_id, new_brand, category, confidence, reason}.
    후보 중 하나면 brand_id, 목록 밖 브랜드면 new_brand={name, category},
    둘 다 None이면 category 로 '업종만 앎'(기타면 단서 없음). 호출 실패면 None"""
    try:
        image_b64 = _jpeg_b64(image_bytes)
    except Exception as e:   # HEIC 등 못 여는 형식이면 규칙 결과로
        print(f"ai_pick image error: {e}")
        return None

    lines = "\n".join(
        f'{o["id"]}: {o["name"]} ({o["category"]}'
        + (f', 현재 위치에서 {o["distance_m"]}m' if o.get("distance_m") is not None else "") + ")"
        for o in options)
    client = anthropic.Anthropic(timeout=20.0, max_retries=1)
    try:
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}},
                {"type": "text", "text": PROMPT.format(hints=hints, options=lines)},
            ]}],
        )
    except anthropic.RateLimitError as e:
        print(f"ai_pick rate limited: {e.message}")
        return None
    except anthropic.APIStatusError as e:
        print(f"ai_pick API error {e.status_code}: {e.message}")
        return None
    except anthropic.APIConnectionError as e:
        print(f"ai_pick connection error: {e}")
        return None

    if resp.stop_reason == "refusal":
        return None
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        return None
    data = json.loads(text)
    valid = {o["id"] for o in options}
    brand_id = data["candidate_id"] if data["candidate_id"] in valid else None
    name = data["brand_name"].strip()
    return {"brand_id": brand_id,
            "new_brand": {"name": name, "category": data["category"],
                          "estimated": data.get("category_match") == "similar"} if name and brand_id is None else None,
            "category": data["category"],
            "confidence": max(0.0, min(1.0, float(data["confidence"]))),
            "reason": data["reason"]}
