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

MODEL = "claude-opus-5-5"
MAX_SIDE = 1024   # 사진을 줄여서 보냄 (토큰·지연 감소)

SCHEMA = {
    "type": "object",
    "properties": {
        "candidate_id": {"type": "integer"},   # 후보 id, 판단 불가면 0
        "confidence": {"type": "number"},      # 0~1
        "reason": {"type": "string"},          # 사용자에게 보여줄 한 문장
    },
    "required": ["candidate_id", "confidence", "reason"],
    "additionalProperties": False,
}

PROMPT = """카드 혜택 추천 앱입니다. 사용자가 결제 직전에 매장 안이나 앞에서 이 사진을 찍었습니다.
아래 후보 중 사진을 찍은 매장일 가능성이 가장 높은 하나를 고르세요.
- 간판·로고·포장지·상품 종류(예: 과자·음료 → 편의점, 커피 → 카페, 버거 → 패스트푸드)와 현재 위치에서의 거리를 함께 고려하세요.
- 거리가 표시된 후보는 지금 근처에 실제로 있는 매장이라 더 유력합니다.
- 근거가 부족하면 candidate_id 를 0 으로 하세요.
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
    """options: [{id, name, category, distance_m(없으면 None)}] → {brand_id, confidence, reason}.
    맞는 후보가 없다고 판단하면 brand_id=None, 호출 실패면 None"""
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
    return {"brand_id": data["candidate_id"] if data["candidate_id"] in valid else None,
            "confidence": max(0.0, min(1.0, float(data["confidence"]))),
            "reason": data["reason"]}
