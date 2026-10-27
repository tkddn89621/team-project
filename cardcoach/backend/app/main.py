from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
import calendar
import os
import re
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

KST = timezone(timedelta(hours=9))  # tzdata 없는 Windows에서도 동작하게 고정 오프셋


def _load_dotenv():
    """backend/.env 의 KEY=VALUE 를 환경변수로 (이미 설정된 값이 우선). 키를 매번 터미널에 치지 않게"""
    path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


_load_dotenv()

from .models import SessionLocal, Brand, WalletCard, Recognition, Selection
from .seed import seed, reset as reset_seed
from .recognize import detect, decide, seeded_near, brand_in_text, CONFIDENCE_AUTO, GPS_RADIUS_M
from . import places, ai_pick, catalog, engine

app = FastAPI(title="내 지갑 카드 코치 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

LOGO_DIR = os.path.join(os.path.dirname(__file__), "..", "logos")
os.makedirs(LOGO_DIR, exist_ok=True)
app.mount("/logos", StaticFiles(directory=LOGO_DIR), name="logos")
LOGO_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".svg")


_SITES: dict = {}   # 브랜드명 → 공식 사이트 도메인 (시작할 때 db에서 읽음)


def logo_url(name: str) -> str:
    """로고 주소. ① backend/logos/ 에 '브랜드명.png'(jpg·webp·svg도 가능)가 있으면 그 파일
    ② 없으면 공식 사이트 아이콘(브라우저가 직접 불러옴, 인터넷 필요) ③ 둘 다 없으면 ""(프론트가 이니셜 배지).
    파일은 요청마다 확인하므로 서버를 켜 둔 채로 넣어도 바로 반영된다."""
    for ext in LOGO_EXTS:
        if os.path.exists(os.path.join(LOGO_DIR, name + ext)):
            return f"/logos/{name}{ext}"
    site = _SITES.get(name)
    if site:
        return f"https://www.google.com/s2/favicons?domain={site}&sz=128"
    return ""


@app.on_event("startup")
def _startup():
    seed()
    db = SessionLocal()
    try:
        _SITES.update({b.name: b.site for b in db.query(Brand).all() if b.site})
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DEFAULT_AMOUNT = 10000  # 예상 금액 미입력 시 혜택액 비교 기준


# ---------- 1. 가맹점(브랜드) 인식 ----------
def resolve_place(db: Session, p: dict, known: list):
    """카카오 매장 → 브랜드. 프랜차이즈('스타벅스 상암DMC점')는 등록된 브랜드로,
    처음 보는 동네 가게는 카카오 업종 그대로 새 브랜드로 등록 (업종 혜택으로 추천됨)"""
    for b in known:
        if brand_in_text(b, p["name"]):
            return b
    b = db.query(Brand).filter(Brand.kakao_place_id == p["id"]).first()
    if not b:
        b = Brand(name=p["name"], industry_code=p["code"], category=p["category"], aliases=p["name"].lower(),
                  lat=p["lat"], lng=p["lng"], kakao_place_id=p["id"])
        db.add(b)
        db.flush()
    return b


def brand_from_ai(db: Session, nb: dict, known: list, near: list) -> Brand:
    """Claude가 알아본 목록 밖 브랜드명 → 등록 브랜드('스타벅스')나 근처 카카오 매장('BHC치킨 상암점')과 같으면 그것,
    아니면 'ai:이름'으로 등록 (업종 혜택)"""
    for b in known:
        if brand_in_text(b, nb["name"]):
            return b
    name = nb["name"].lower().replace(" ", "")
    for b, _ in near:
        if name in b.name.lower().replace(" ", ""):
            return b
    key = f'ai:{nb["name"].lower()}'
    b = db.query(Brand).filter(Brand.kakao_place_id == key).first()
    if not b:
        b = Brand(name=nb["name"], industry_code=catalog.code_by_name().get(nb["category"]), category=nb["category"],
                  aliases=nb["name"].lower(), kakao_place_id=key)
        db.add(b)
        db.flush()
    return b


def ask_ai(image_bytes: bytes, det: dict, cands: list, near: list, known: list, db: Session, located: bool = False):
    """애매한 사진 → Claude가 후보 중 하나를 고름. 고르면 맨 앞에 source='ai'로.
    '맞는 매장 없음'이면 근처라는 이유만으로 붙은 후보(gps)는 뺀다. 호출 실패면 원래 후보 그대로"""
    dist = {}
    for b, d in near:
        dist[b.id] = min(d, dist.get(b.id, d))
    by_id = {b.id: b for b, _ in near}
    if not by_id:   # 위치를 모르면 등록 브랜드 전체에서
        by_id = {b.id: b for b in known}
    for c in cands:
        by_id.setdefault(c["brand_id"], None)
    options = []
    for bid, b in list(by_id.items())[:20]:
        c = next((x for x in cands if x["brand_id"] == bid), None)
        options.append({"id": bid, "name": b.name if b else c["name"], "category": b.category if b else c["category"],
                        "code": b.industry_code if b else c.get("industry_code"),
                        "distance_m": round(dist[bid]) if bid in dist else None})

    labels = ", ".join(l for l, _ in det["labels"][:6])
    text = " ".join(det["text"].split())[:80]
    logos = ", ".join(l for l, _ in det["logos"])
    hints = f"사물: {labels or '없음'} / 글씨: {text or '없음'} / 로고: {logos or '없음'}"

    choice = ai_pick.pick(image_bytes, options, hints)
    if not choice:
        return cands, None
    if choice["new_brand"]:   # 후보 밖 브랜드 (예: 집에서 찍은 bhc 포장지) → 등록 브랜드에 있으면 그것, 없으면 자동 등록
        b = brand_from_ai(db, choice["new_brand"], known, near)
        if b.id not in {o["id"] for o in options}:
            options.append({"id": b.id, "name": b.name, "category": b.category, "code": b.industry_code, "distance_m": None})
        choice["brand_id"] = b.id
    if choice["brand_id"] is None and choice["category"] != "기타":
        # 업종만 앎 (예: 껌 → 편의점): 하나를 짐작하지 않고 그 업종 매장들을 고르게 함. 근처 매장이 있으면 그 안에서,
        # 근처에 그 업종이 없으면(GPS 오차·미등록 매장일 수도) 막지 않고 등록 브랜드로 — '근처엔 없어요'라고 알려줌
        same = [o for o in options if o["category"] == choice["category"]]
        none_nearby = False
        if not same:
            same = [{"id": b.id, "name": b.name, "category": b.category, "code": b.industry_code, "distance_m": None}
                    for b in known if b.category == choice["category"]]
            none_nearby = located and bool(same)
        same.sort(key=lambda o: (o["distance_m"] is None, o["distance_m"] or 0))
        if same:
            return [{"brand_id": o["id"], "name": o["name"], "category": o["category"], "industry_code": o["code"], "confidence": 0.5,
                     "source": "ai_category", "ai_reason": choice["reason"], "none_nearby": none_nearby,
                     **({"distance_m": o["distance_m"]} if o["distance_m"] is not None else {})}
                    for o in same[:4]], choice
    if choice["brand_id"] is None:   # 예: 집에서 찍은 담배 + 근처엔 곱창집뿐 → '근처 곱창집이 맞나요?'라고 묻지 않음
        return [c for c in cands if c["source"] != "gps"], choice
    opt = next(o for o in options if o["id"] == choice["brand_id"])
    top = {"brand_id": opt["id"], "name": opt["name"], "category": opt["category"], "industry_code": opt["code"],
           "confidence": round(choice["confidence"], 2), "source": "ai", "ai_reason": choice["reason"]}
    if opt["distance_m"] is not None:
        top["distance_m"] = opt["distance_m"]
    rest = [c for c in cands if c["brand_id"] != opt["id"]]
    return [top] + rest[:2], choice


@app.post("/recognitions")
async def create_recognition(image: UploadFile = File(...),
                             lat: Optional[float] = Form(None), lng: Optional[float] = Form(None),
                             db: Session = Depends(get_db)):
    data = await image.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "이미지는 10MB 이하여야 합니다")
    coords = (lat, lng) if lat is not None and lng is not None else None
    # Vision(사진 분석)과 카카오 로컬(근처 매장) 검색을 동시에
    with ThreadPoolExecutor(1) as ex:
        kakao = ex.submit(places.nearby, lat, lng, GPS_RADIUS_M) if coords else None
        det = detect(data, image.filename or "")
        kakao_places = kakao.result() if kakao else []

    known = db.query(Brand).filter(Brand.kakao_place_id.is_(None)).all()
    # 카카오 키가 있으면 실제 매장만. seed.py 가짜 좌표(오로르·버거킹·스타벅스)와 섞이면 없는 매장이 '근처'로 뜬다
    if places.enabled():
        near = [(resolve_place(db, p, known), p["distance_m"]) for p in kakao_places]
    else:
        near = seeded_near(known, coords)
    # 매칭 대상: 등록된 브랜드 + 지금 근처에 있는 동네 가게 (다른 곳에서 등록된 동네 가게는 제외)
    pool = known + list({b.id: b for b, _ in near if b.kakao_place_id}.values())
    cands = decide(det, pool, near)

    raw = det["raw"]
    if coords:
        raw["gps"] = list(coords)
        raw["kakao_places"] = [f'{p["name"]} {p["distance_m"]}m' for p in kakao_places[:10]]

    # 규칙으로 확실하지 않을 때만 Claude에게 (실제 사진일 때만, 키가 있을 때만)
    if (not cands or cands[0]["confidence"] < CONFIDENCE_AUTO) and det["mode"] == "vision" and ai_pick.enabled():
        # located: 실제 매장 검색(카카오)으로 근처를 확인했을 때만 '근처엔 없어요'라고 말할 수 있음
        cands, raw["ai"] = ask_ai(data, det, cands, near, known, db, located=bool(coords) and places.enabled())
    status = "done" if cands else "not_found"
    rec = Recognition(status=status, candidates=cands, raw=raw)
    db.add(rec); db.commit(); db.refresh(rec)
    auto_confirm = len(cands) == 1 and cands[0]["confidence"] >= CONFIDENCE_AUTO
    return {
        "recognition_id": rec.id,
        "status": status,
        "auto_confirm": auto_confirm,          # true면 FIND에서 바로 REC로
        "candidates": [{**c, "logo_url": logo_url(c["name"])} for c in cands],  # source: logo | text | image | gps | ai(+ai_reason) | ai_category(업종만, 고르게 함), 근처면 distance_m
    }


# ---------- 브랜드 목록 (인식 실패 fallback 선택용) ----------
@app.get("/brands")
def list_brands(db: Session = Depends(get_db)):
    return [{"brand_id": b.id, "name": b.name, "category": b.category, "industry_code": b.industry_code,
             "logo_url": logo_url(b.name)}
            for b in db.query(Brand).filter(Brand.kakao_place_id.is_(None)).order_by(Brand.id).all()]


# ---------- 내 카드 상태 (실적·한도) ----------
def mask_number(last4: str) -> str:
    return f"**** **** **** {last4 or '****'}"


def month_info():
    """(이번 달 남은 일수(오늘 포함), 이번 달 시작 시각 UTC, 오늘 시작 시각 UTC) — 한국 시간 기준"""
    now = datetime.now(KST)
    last_day = calendar.monthrange(now.year, now.month)[1]
    to_utc = lambda d: d.astimezone(timezone.utc).replace(tzinfo=None)
    month_start = to_utc(datetime(now.year, now.month, 1, tzinfo=KST))
    today_start = to_utc(datetime(now.year, now.month, now.day, tzinfo=KST))
    return last_day - now.day + 1, month_start, today_start


def usage_this_month(db: Session) -> dict:
    """이번 달 결제 기록 → 혜택별·영역별 받은 할인, 혜택별 월·오늘 횟수, 카드별 합계"""
    _, month_start, today_start = month_info()
    u = {"benefit": {}, "group": {}, "card": {}, "count_month": {}, "count_today": {}}
    for s in db.query(Selection).filter(Selection.created_at >= month_start, Selection.discount > 0).all():
        u["card"][s.card_id] = u["card"].get(s.card_id, 0) + s.discount
        if s.benefit_id:
            k = (s.card_id, s.benefit_id)
            u["benefit"][k] = u["benefit"].get(k, 0) + s.discount
            u["count_month"][k] = u["count_month"].get(k, 0) + 1
            if s.created_at >= today_start:
                u["count_today"][k] = u["count_today"].get(k, 0) + 1
        if s.limit_group:
            k = (s.card_id, s.limit_group)
            u["group"][k] = u["group"].get(k, 0) + s.discount
    return u


def is_woori(card: dict) -> bool:
    return card["issuer"] == "우리카드"


def visible_cards(db: Session, mydata: bool) -> list:
    """앱이 알고 있는 카드. 우리카드는 자사 고객 정보로 항상 안다.
    타사 카드는 보유 사실 자체를 모르다가 마이데이터를 연동해야 목록에 생긴다."""
    wallet = db.query(WalletCard).order_by(WalletCard.id).all()
    return [w for w in wallet if is_woori(catalog.cards()[w.card_id]) or mydata]


def card_state(w: WalletCard, mydata: bool, usage: dict) -> dict:
    """이번 달 구간·한도 = 지난달 실적으로 결정, 다음 달 구간 = 이번 달 실적으로 결정"""
    card = catalog.cards()[w.card_id]
    woori = is_woori(card)
    known = woori or mydata
    benefits = engine.enabled_benefits(card, set(w.disabled_benefits or []))
    tiers = card["tiers"]
    tier_info = [{"min_spend": t.get("min_prev_spend") or 0, "monthly_limit": engine.card_limit(card, i, benefits)}
                 for i, t in enumerate(tiers)]
    target = tier_info[0]["min_spend"] if tier_info else 0
    tier_idx = next_idx = None
    upgrade_gap = upgrade_limit = at_stake = None

    if not target:
        eligibility, tier_idx = "none", (0 if tiers else None)
    elif not known:
        eligibility, tier_idx = "assumed", 0   # 모르면 첫 구간은 넘었다고 가정
    else:
        tier_idx = engine.tier_index(card, w.prev_spend)
        eligibility = "met" if tier_idx is not None else "unmet"
        # 다음 달 코칭: 이번 달 실적으로 들어갈 구간, 그 위 구간까지 남은 금액
        next_idx = engine.tier_index(card, w.current_spend)
        up = 0 if next_idx is None else next_idx + 1
        if up < len(tiers):
            upgrade_gap = tier_info[up]["min_spend"] - w.current_spend
            upgrade_limit = tier_info[up]["monthly_limit"]
            # 그 구간에 못 가면 다음 달에 덜 받는 한도 (예: 40만 못 채우면 그 카드 혜택 전부)
            if upgrade_limit is not None:
                at_stake = upgrade_limit - ((tier_info[next_idx]["monthly_limit"] or 0) if next_idx is not None else 0)

    limit = engine.card_limit(card, tier_idx, benefits) if eligibility != "unmet" else 0
    used = usage["card"].get(w.id, 0) if known else 0
    remaining = None if limit is None else max(0, limit - used)
    days_left, _, _ = month_info()
    return {
        "card_id": w.id, "product_id": w.card_id, "name": card["name"], "issuer": card["issuer"], "is_woori": woori,
        "color": w.color, "masked_number": mask_number(w.number_last4),
        "spend_known": known,
        "spend_estimated": known and not woori,     # 타사 카드: 마이데이터 승인내역으로 계산한 추정 실적
        "target_spend": target,                     # 혜택을 받기 위한 최소 실적 (첫 구간)
        "tiers": tier_info,
        "prev_spend": w.prev_spend if known else None,
        "eligibility": eligibility,                 # met | unmet | assumed | none
        "tier_index": tier_idx,                     # 이번 달 구간 (0부터, 미달이면 None)
        "current_spend": w.current_spend if known else None,
        "next_tier_index": next_idx,                # 지금 실적대로면 다음 달 구간
        "upgrade_gap": upgrade_gap,                 # 한 구간 위까지 더 써야 할 금액
        "upgrade_limit": upgrade_limit,             # 그 구간의 월 한도
        "at_stake": at_stake,                       # 그 구간을 못 채우면 다음 달 덜 받는 한도(원)
        "days_left": days_left,                     # 이번 달 남은 일수 (오늘 포함)
        "daily_needed": -(-upgrade_gap // days_left) if upgrade_gap else None,   # 하루 평균 더 써야 할 금액
        # 다음 달 혜택(첫 구간)까지 남은 금액 = 실적 시급도. 모르면 0으로 보고 정렬
        "spend_gap": max(0, target - w.current_spend) if known else 0,
        "monthly_discount_limit": limit,
        "limit_unlimited": limit is None,
        "monthly_remaining": remaining,   # 한도를 모르는 카드는 None
    }


def now_kst():
    return datetime.now(KST)


@app.get("/cards")
def list_cards(mydata: bool = Query(False), db: Session = Depends(get_db)):
    usage = usage_this_month(db)
    return [card_state(w, mydata, usage) for w in visible_cards(db, mydata)]


@app.get("/catalog")
def catalog_summary():
    """카드 상품 DB 요약 (내 지갑은 이 중 몇 장)"""
    cards = catalog.cards().values()
    return {
        "card_count": len(cards),
        "benefit_count": sum(len(c["benefits"]) for c in cards),
        "industry_codes": len(catalog.store_codes()),
        "cards": [{"card_id": c["card_id"], "issuer": c["issuer"], "name": c["name"], "type": c["type"],
                   "store_benefits": sum(1 for b in c["benefits"] if engine.in_store(b))} for c in cards],
    }


# ---------- 2. 내 카드 중 최대 혜택 추천 ----------
NO_BENEFIT = {
    "has_benefit": False, "benefit_id": None, "limit_group": None, "benefit_type": None, "rate": 0, "fixed_amount": 0,
    "min_amount": 0, "rate_label": "이 가맹점 혜택 없음", "benefit_label": "", "blocked_reason": None,
    "benefit_note": "", "max_per_txn": 0, "limited_by_monthly": False, "benefit_remaining": None, "expected_benefit": 0,
}


def wallet_context(db: Session, brand: Brand, mydata: bool) -> list:
    """금액과 상관없는 부분(카드 상태·이 가게에 걸린 혜택)을 한 번만 계산. 금액을 바꿔 가며 rank 할 때 재사용"""
    usage = usage_this_month(db)
    ctx = []
    for w in visible_cards(db, mydata):
        card = catalog.cards()[w.card_id]
        state = card_state(w, mydata, usage)
        benefits = engine.enabled_benefits(card, set(w.disabled_benefits or []))
        here = [b for b in benefits if engine.in_store(b) and engine.applies(b, brand.name, brand.industry_code)]
        ctx.append((w, card, state, benefits, here))
    return [usage, ctx]


def rank(context: list, brand: Brand, amount: int, hour: int, weekday: int) -> list:
    """보이는 카드마다: 이 가게(브랜드·업종코드)에 걸린 혜택 중 가장 큰 것 → 할인액·최종 결제금액 → 추천 순 정렬"""
    usage, ctx = context
    rows = []
    for w, card, state, benefits, here in ctx:
        row = dict(state)
        prev = w.prev_spend if row["spend_known"] else None
        results = [engine.evaluate(card, b, benefits, row["tier_index"], prev, amount, hour, weekday, usage, w.id,
                                   brand.industry_code)
                   for b in here]
        if results:
            spec = {b["benefit_id"]: engine.specificity(b) for b in benefits}
            # 받을 수 있는 할인이 가장 큰 혜택. 다 막혔으면 가장 구체적인 혜택의 막힌 이유를 보여줌
            row.update(max(results, key=lambda r: (r["expected_benefit"], -spec[r["benefit_id"]])))
        else:
            row.update(NO_BENEFIT)
        row["final_payment"] = amount - row["expected_benefit"]
        rows.append(row)

    # 추천 엔진 (기획서 3.1): ① 최종 결제금액 오름차순 ② 이번 달 실적까지 남은 금액 내림차순 ③ 우리카드 우선
    rows.sort(key=lambda x: (x["final_payment"], -x["spend_gap"], not x["is_woori"]))
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    return rows


def evaluate(db: Session, brand: Brand, amount: int, hour: int, weekday: int, mydata: bool) -> list:
    return rank(wallet_context(db, brand, mydata), brand, amount, hour, weekday)


# 금액을 모를 때: 이 금액들로 하나씩 돌려 보고 1등 카드가 바뀌는 지점을 찾는다 (규칙 계산이라 빠름)
AMOUNT_GRID = range(1000, 200001, 1000)


def amount_ranges(context: list, brand: Brand, hour: int, weekday: int) -> list:
    """금액 구간별 1등 카드: [{from, to, card_id, name, is_woori, max_benefit}]. to=None 이면 그 이상 전부.
    card_id=None 구간은 할인되는 카드가 없음 (예: '1만 원 이상 결제 시' 조건)"""
    segs, top = [], None
    for a in AMOUNT_GRID:
        rows = rank(context, brand, a, hour, weekday)
        top = rows[0] if rows and rows[0]["expected_benefit"] > 0 else None
        cid = top["card_id"] if top else None
        if segs and segs[-1]["card_id"] == cid:
            segs[-1]["to"] = a
            segs[-1]["max_benefit"] = top["expected_benefit"] if top else 0
        else:
            segs.append({"from": a, "to": a, "card_id": cid, "name": top["name"] if top else None,
                         "is_woori": top["is_woori"] if top else None,
                         "max_benefit": top["expected_benefit"] if top else 0})
    if segs:
        segs[-1]["to"] = None
        # 끝이 열린 구간: 한도에 막혀 더 안 늘어날 때만 '최대 N원'. 금액 따라 계속 늘면 None (화면은 할인율로)
        capped = top and (top["fixed_amount"] or top["expected_benefit"] < AMOUNT_GRID[-1] * top["rate"] / 100 - 1)
        if top and not capped:
            segs[-1]["max_benefit"] = None
    for s in segs:
        if s["from"] == AMOUNT_GRID[0]:
            s["from"] = 0
    return segs


def ranges_tip(segs: list) -> Optional[str]:
    """구간을 한 문장으로: '4만 원 넘게 결제하면 신한카드 처음이 더 아껴요'"""
    cards = [s for s in segs if s["card_id"]]
    if not cards:
        return None
    first = cards[0]
    if first["from"] > 0:
        return f"{short_won(first['from'])} 이상 결제해야 할인돼요"
    if len(cards) == 1:
        return "얼마를 결제하든 이 카드가 가장 많이 아껴요"
    nxt = cards[1]
    return f"{short_won(nxt['from'])} 넘게 결제하면 {subject(nxt['name'])} 더 아껴요"


def short_won(n: int) -> str:
    """40000 → '4만 원', 15000 → '1.5만 원', 8000 → '8천 원'"""
    if n >= 10000:
        return f"{n / 10000:g}만 원"
    return f"{n // 1000}천 원" if n % 1000 == 0 else f"{n:,}원"


def benefit_ceiling(r: dict) -> Optional[int]:
    """금액이 커져도 이 이상은 못 받는 할인 (건당 한도·이번 달 남은 한도 중 작은 것). 없으면 None"""
    caps = [x for x in (r.get("max_per_txn") or None, r.get("benefit_remaining"), r.get("fixed_amount") or None)
            if x is not None]
    return min(caps) if caps else None


def subject(name: str) -> str:
    """주격 조사: '신한카드 처음(ANNIVERSE)' → '…이', 'SHOPPING+' → '…가'. 괄호 안은 빼고 마지막 글자로 판단"""
    base = re.sub(r"\([^)]*\)\s*$", "", name).strip() or name
    ch = base[-1]
    if "가" <= ch <= "힣":
        return name + ("이" if (ord(ch) - 0xAC00) % 28 else "가")
    return name + ("이" if ch.upper() in "LMNR" else "가")   # TEN→텐이, SHOPPING+→플러스가


COACH_SHARE = 0.10        # 지킬 수 있는 다음 달 한도의 10%까지는 이번 할인을 양보할 만하다고 봄
COACH_SHARE_LATE = 0.20   # 월말(7일 이하)이면 20%까지
COACH_EFFICIENCY = 2.0    # 1등 카드보다 '1원 쓸 때 지키는 다음 달 혜택'이 2배 이상일 때만 (너무 자주 뜨지 않게)


def protect_rate(r: dict) -> float:
    """1원을 더 쓸 때 지키는 다음 달 혜택 = 걸린 혜택 ÷ 남은 실적. 예: KB 2만원 ÷ 12만원 = 0.17"""
    return r["at_stake"] / r["upgrade_gap"] if r["spend_known"] and r["upgrade_gap"] and r["at_stake"] else 0.0


def coach_for(rows: list, best: dict, amount: int, exact: bool = True):
    """1등은 아니지만, 이번 할인을 조금 양보하고 그 카드로 내면 다음 달 혜택을 지키는 데 도움이 되는 카드.
    exact=False: 금액을 몰라서 기준 금액으로 비교한 것 → 양보액을 숫자로 말하지 않음"""
    picks = []
    for r in rows:
        if r is best or not protect_rate(r):
            continue
        if protect_rate(r) < protect_rate(best) * COACH_EFFICIENCY:   # 1등 카드로 내도 비슷하게 다음 달 혜택을 지키면 바꿀 이유 없음
            continue
        give_up = best["expected_benefit"] - r["expected_benefit"]
        share = COACH_SHARE_LATE if r["days_left"] <= 7 else COACH_SHARE
        if 0 <= give_up <= r["at_stake"] * share:   # 0: 할인이 같은데 정렬에서 밀린 카드
            picks.append((r, give_up))
    if not picks:
        return None
    r, give_up = max(picks, key=lambda x: protect_rate(x[0]))
    return {
        "card_id": r["card_id"], "name": r["name"], "give_up": give_up, "at_stake": r["at_stake"],
        "gap_before": r["upgrade_gap"], "gap_after": max(0, r["upgrade_gap"] - amount) if exact else None,
        "days_left": r["days_left"],
        "message": ((("할인은 같아요. " if exact else f"{short_won(amount)}까지는 할인이 같아요. ") if not give_up else
                     f"할인은 {give_up:,}원 적지만, " if exact else "할인은 조금 적지만, ") +
                    f"다음 달 혜택 {r['at_stake']:,}원을 지키려면 "
                    f"이번 달 {r['upgrade_gap']:,}원 더 써야 해요 (남은 {r['days_left']}일)"),
    }


@app.get("/recommendations")
def recommendations(brand_id: int = Query(...), amount: Optional[int] = Query(None),
                    mydata: bool = Query(False),
                    hour: Optional[int] = Query(None, ge=0, le=23, description="결제 시각(시). 비우면 지금(한국 시간)"),
                    db: Session = Depends(get_db)):
    brand = db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(404, "브랜드 없음")
    now = now_kst()
    at_hour = now.hour if hour is None else hour
    context = wallet_context(db, brand, mydata)
    ranges = None
    if amount:
        base_amount = amount
    else:
        # 금액을 모르면: 금액 구간별 1등 카드를 구하고, 첫 구간(소액) 안에서 1만 원 가까이로 목록·코칭을 비교
        ranges = amount_ranges(context, brand, at_hour, now.weekday())
        first = next((s for s in ranges if s["card_id"]), None)
        base_amount = DEFAULT_AMOUNT
        if first:
            base_amount = max(first["from"], AMOUNT_GRID[0], min(DEFAULT_AMOUNT, first["to"] or DEFAULT_AMOUNT))
    rows = rank(context, brand, base_amount, at_hour, now.weekday())
    for r in rows:
        r["benefit_ceiling"] = benefit_ceiling(r) if r["expected_benefit"] > 0 else None
    best = rows[0] if rows and rows[0]["expected_benefit"] > 0 else None

    reason = None
    if best:
        nxt = rows[1] if len(rows) > 1 else None
        if not nxt or nxt["final_payment"] > best["final_payment"]:
            reason = "결제금액이 가장 적어요" if amount else "가장 많이 아껴요"
        elif nxt["spend_gap"] < best["spend_gap"]:
            reason = "할인이 같아서, 이번 달 실적 채우기가 더 급한 카드를 골랐어요"
        else:
            reason = "할인·실적 조건이 같아서 우리카드를 우선했어요"

    return {
        "brand": {"brand_id": brand.id, "name": brand.name, "category": brand.category,
                  "industry_code": brand.industry_code, "logo_url": logo_url(brand.name)},
        "amount": amount,                 # 사용자가 넣은 금액. 없으면 None → ranges 로 안내
        "compare_amount": base_amount,    # 목록 비교에 쓴 금액
        "ranges": ranges,                 # 금액 구간별 1등 카드 (금액을 모를 때만)
        "ranges_tip": ranges_tip(ranges) if ranges else None,
        "hour": at_hour,
        "mydata_linked": mydata,
        "cards": rows,
        "best_card_id": best["card_id"] if best else None,
        "best_reason": reason,
        "coach": coach_for(rows, best, base_amount, exact=bool(amount)) if best else None,   # 다음 달 혜택을 지키는 대안 카드
        "message": f"{brand.name}에서 받을 수 있는 최대 혜택을 찾았어요!" if best else f"{brand.name}에서 지금 할인되는 카드가 없어요",
    }


# ---------- 3. 결제 반영 (앱이 결제하진 않음: 고른 카드로 결제했다는 승인 데이터를 반영) ----------
class SelectionIn(BaseModel):
    recognition_id: Optional[int] = None
    brand_id: int
    card_id: int
    expected_amount: Optional[int] = None
    mydata: bool = False
    hour: Optional[int] = None
    method: str = "pay"   # pay: 우리페이 | card: 계산대에서 실물 카드. 우리카드만 (타사 카드는 마이데이터 새로고침으로 반영)


def payment_source(method: str, woori: bool) -> str:
    """결제 정보가 어떻게 들어와 실적에 반영되는지"""
    if method == "pay":
        return "우리페이 결제 · 우리카드 승인 데이터로 바로 반영"
    if method == "mydata":
        return "마이데이터 승인내역으로 반영 · 실적·할인은 승인 기준 추정 (카드사 확정은 매입 후)"
    return "실물 카드 결제 · 우리카드 승인 데이터로 바로 반영"


def apply_payment(db: Session, brand: Brand, w: WalletCard, amount: int, hour: int, mydata: bool, method: str,
                  recognition_id: Optional[int] = None) -> dict:
    """결제 1건을 이번 달 실적·혜택 사용액에 반영하고, 반영 전후 카드 상태를 돌려줌"""
    now = now_kst()
    row = next((r for r in evaluate(db, brand, amount, hour, now.weekday(), mydata) if r["card_id"] == w.id), None)
    if not row:
        raise HTTPException(400, "마이데이터를 연동해야 쓸 수 있는 카드예요")
    if method == "pay" and not row["is_woori"]:
        raise HTTPException(400, "다른 카드사 카드는 우리페이로 결제할 수 없어요")
    before = {"current_spend": w.current_spend, "upgrade_gap": row["upgrade_gap"], "next_tier_index": row["next_tier_index"]}

    discount = row["expected_benefit"]
    w.current_spend += amount
    s = Selection(recognition_id=recognition_id, brand_id=brand.id, card_id=w.id, expected_amount=amount,
                  benefit_id=row["benefit_id"] if discount else None, limit_group=row["limit_group"] if discount else None,
                  discount=discount)
    db.add(s); db.commit(); db.refresh(s)

    after = card_state(w, mydata, usage_this_month(db))
    return {
        "selection_id": s.id, "ok": True,
        "brand": {"brand_id": brand.id, "name": brand.name, "industry_code": brand.industry_code,
                  "logo_url": logo_url(brand.name), "category": brand.category},
        "amount": amount, "discount": discount, "paid": amount - discount,
        "method": method,
        "source": payment_source(method, after["is_woori"]),
        "before": before, "card": after,
    }


@app.post("/selections")
def create_selection(body: SelectionIn, db: Session = Depends(get_db)):
    """우리카드: 우리페이 또는 실물 카드 결제를 자사 승인 데이터로 바로 반영 (타사 카드는 /mydata/refresh)"""
    brand, w = db.get(Brand, body.brand_id), db.get(WalletCard, body.card_id)
    if not brand or not w:
        raise HTTPException(404, "브랜드 또는 카드 없음")
    if not is_woori(catalog.cards()[w.card_id]):
        raise HTTPException(400, "다른 카드사 카드 결제는 마이데이터 새로고침으로 반영돼요")
    hour = now_kst().hour if body.hour is None else body.hour
    return apply_payment(db, brand, w, body.expected_amount or DEFAULT_AMOUNT, hour, body.mydata, body.method,
                         body.recognition_id)


class ApprovalIn(BaseModel):
    brand_id: int
    card_id: int
    amount: Optional[int] = None
    hour: Optional[int] = None


class MydataRefreshIn(BaseModel):
    # 시연용: 고객이 계산대에서 타사 실물 카드로 낸 결제. 실서비스에선 카드사가 마이데이터로 보내주는 승인내역
    approvals: list[ApprovalIn] = []


@app.post("/mydata/refresh")
def mydata_refresh(body: MydataRefreshIn, db: Session = Depends(get_db)):
    """마이데이터 새로고침: 타사 카드의 새 승인내역을 받아 이번 달 실적·할인 사용액에 반영 (승인 기준이라 추정)"""
    results = []
    for a in body.approvals:
        brand, w = db.get(Brand, a.brand_id), db.get(WalletCard, a.card_id)
        if not brand or not w or is_woori(catalog.cards()[w.card_id]):
            continue   # 우리카드는 자사 승인 데이터로 이미 반영됨
        hour = now_kst().hour if a.hour is None else a.hour
        results.append(apply_payment(db, brand, w, a.amount or DEFAULT_AMOUNT, hour, True, "mydata"))
    return {"approvals": results}


@app.post("/demo/reset")
def demo_reset():
    """시연 데이터 처음으로 (실적·결제 기록·자동 등록 가게 초기화)"""
    reset_seed()
    return {"ok": True}


@app.get("/health")
def health():
    return {"ok": True}
