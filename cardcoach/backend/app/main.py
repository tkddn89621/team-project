from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session
import os
from datetime import datetime, timedelta, timezone

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

from .models import SessionLocal, Brand, Card, BenefitRule, BenefitTier, Recognition, Selection
from .seed import seed
from .recognize import recognize, CONFIDENCE_AUTO

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
@app.post("/recognitions")
async def create_recognition(image: UploadFile = File(...),
                             lat: Optional[float] = Form(None), lng: Optional[float] = Form(None),
                             db: Session = Depends(get_db)):
    data = await image.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "이미지는 10MB 이하여야 합니다")
    brands = db.query(Brand).all()
    coords = (lat, lng) if lat is not None and lng is not None else None
    result = recognize(data, image.filename or "", brands, coords)
    cands = result["candidates"]
    status = "done" if cands else "not_found"
    rec = Recognition(status=status, candidates=cands, raw=result["raw"])
    db.add(rec); db.commit(); db.refresh(rec)
    auto_confirm = len(cands) == 1 and cands[0]["confidence"] >= CONFIDENCE_AUTO
    return {
        "recognition_id": rec.id,
        "status": status,
        "auto_confirm": auto_confirm,          # true면 FIND에서 바로 REC로
        "candidates": [{**c, "logo_url": logo_url(c["name"])} for c in cands],  # source: logo | text | image | gps, 근처면 distance_m
    }


# ---------- 브랜드 목록 (인식 실패 fallback 선택용) ----------
@app.get("/brands")
def list_brands(db: Session = Depends(get_db)):
    return [{"brand_id": b.id, "name": b.name, "category": b.category, "logo_url": logo_url(b.name)}
            for b in db.query(Brand).order_by(Brand.id).all()]


# ---------- 내 카드 상태 (실적·한도) ----------
def mask_number(last4: str) -> str:
    return f"**** **** **** {last4 or '****'}"


def tier_at(tiers: list, spend: int):
    """실적 spend로 들어가는 가장 높은 구간 (index, tier). 첫 구간 미만이면 (None, None)"""
    hit = (None, None)
    for i, t in enumerate(tiers):
        if spend >= t.min_spend:
            hit = (i, t)
    return hit


def tiers_by_card(db: Session) -> dict:
    out = {}
    for t in db.query(BenefitTier).order_by(BenefitTier.min_spend).all():
        out.setdefault(t.card_id, []).append(t)
    return out


def visible_cards(db: Session, mydata: bool) -> list:
    """앱이 알고 있는 카드. 우리카드는 자사 고객 정보로 항상 안다.
    타사 카드는 보유 사실 자체를 모르다가 마이데이터를 연동해야 목록에 생긴다."""
    cards = db.query(Card).order_by(Card.id).all()
    return [c for c in cards if c.is_woori or mydata]


def card_state(c: Card, mydata: bool, tiers: list) -> dict:
    """우리카드는 자사 데이터로 실적/구간/한도를 안다. 타사 카드는 마이데이터 연동 시에만 안다.
    이번 달 구간·한도 = 지난달 실적으로 결정, 다음 달 구간 = 이번 달 실적으로 결정"""
    known = c.is_woori or mydata
    tier_info = [{"min_spend": t.min_spend, "monthly_limit": t.monthly_limit} for t in tiers]
    target = tiers[0].min_spend if tiers else c.target_spend
    unlimited = False
    tier_idx = next_idx = None
    upgrade_gap = upgrade_limit = None

    if not tiers:
        # 구간 없는 카드
        unlimited = c.monthly_discount_limit == 0
        limit = c.monthly_discount_limit
        if not target:
            eligibility = "none"
        elif not known:
            eligibility = "assumed"
        else:
            eligibility = "met" if c.prev_spend >= target else "unmet"
    elif not known:
        # 모르면 첫 구간은 넘었다고 가정 (실제로는 미달이라 0원일 수 있음 → 마이데이터 유도 포인트)
        eligibility, tier_idx, limit = "assumed", 0, tiers[0].monthly_limit
    else:
        tier_idx, t = tier_at(tiers, c.prev_spend)
        eligibility = "met" if t else "unmet"
        limit = t.monthly_limit if t else 0
        # 다음 달 코칭: 이번 달 실적으로 들어갈 구간, 그 위 구간까지 남은 금액
        next_idx, _ = tier_at(tiers, c.current_spend)
        up = 0 if next_idx is None else next_idx + 1
        if up < len(tiers):
            upgrade_gap = tiers[up].min_spend - c.current_spend
            upgrade_limit = tiers[up].monthly_limit

    if unlimited:
        remaining = None
    elif known:
        remaining = max(0, limit - c.monthly_discount_used)
    else:
        remaining = limit   # 모르면 한도 전체가 남았다고 가정

    return {
        "card_id": c.id, "name": c.name, "issuer": c.issuer, "is_woori": c.is_woori, "color": c.color,
        "masked_number": mask_number(c.number_last4),
        "spend_known": known,
        "target_spend": target,                     # 혜택을 받기 위한 최소 실적 (첫 구간)
        "tiers": tier_info,
        "prev_spend": c.prev_spend if known else None,
        "eligibility": eligibility,                 # met | unmet | assumed | none
        "tier_index": tier_idx,                     # 이번 달 구간 (0부터, 미달이면 None)
        "current_spend": c.current_spend if known else None,
        "next_tier_index": next_idx,                # 지금 실적대로면 다음 달 구간
        "upgrade_gap": upgrade_gap,                 # 한 구간 위까지 더 써야 할 금액
        "upgrade_limit": upgrade_limit,             # 그 구간의 월 한도
        # 다음 달 혜택(첫 구간)까지 남은 금액 = 실적 시급도. 모르면 0으로 보고 정렬
        "spend_gap": max(0, target - c.current_spend) if known else 0,
        "monthly_discount_limit": limit,
        "limit_unlimited": unlimited,
        "monthly_remaining": remaining,   # 한도 없는 카드는 None
    }


def rate_text(rate: float) -> str:
    return f"{round(rate * 100, 1):g}%"   # 0.012 → 1.2%, 0.1 → 10%


def now_hour() -> int:
    return datetime.now(KST).hour


@app.get("/cards")
def list_cards(mydata: bool = Query(False), db: Session = Depends(get_db)):
    tiers = tiers_by_card(db)
    return [card_state(c, mydata, tiers.get(c.id, [])) for c in visible_cards(db, mydata)]


def rule_label(r: BenefitRule, brand: Brand) -> str:
    if r.fixed_amount:
        text = f"{r.fixed_amount:,}원 {r.benefit_type}"
        if r.min_amount:
            text += f" ({r.min_amount:,}원 이상)"
    else:
        if r.brand_id:
            scope = ""
        elif r.category == "*":
            scope = " (전 가맹점)"
        else:
            scope = f" ({brand.category} 업종)"
        text = f"{rate_text(r.rate)} {r.benefit_type}{scope}"
    if r.start_hour is not None:
        text += f" · {r.start_hour:02d}~{r.end_hour:02d}시"
    return text


def apply_rule(r: BenefitRule, row: dict, amount: int, hour: int, brand: Brand) -> dict:
    """조건(전월실적·시간대·최소금액) 확인 → 할인액 = min(정액 또는 금액×할인율, 건당 한도, 월 잔여 한도)"""
    label = rule_label(r, brand)
    blocked = None
    if row["eligibility"] == "unmet":
        blocked = "지난달 실적 미달 · 이번 달 혜택 없음"
    elif r.start_hour is not None and not (r.start_hour <= hour < r.end_hour):
        blocked = f"할인 시간 아님 ({r.start_hour:02d}~{r.end_hour:02d}시만)"
    elif r.min_amount and amount < r.min_amount:
        blocked = f"{r.min_amount:,}원 이상 결제해야 할인"
    elif row["monthly_remaining"] == 0:
        blocked = "이번 달 할인 한도 소진"

    discount, limited = 0, False
    if not blocked:
        discount = r.fixed_amount if r.fixed_amount else int(amount * r.rate)
        discount = min(discount, amount)
        if r.max_per_txn:
            discount = min(discount, r.max_per_txn)
        remaining = row["monthly_remaining"]
        if remaining is not None and discount > remaining:
            discount, limited = remaining, True

    return {
        "has_benefit": True, "benefit_type": r.benefit_type, "rate": r.rate,
        "fixed_amount": r.fixed_amount, "min_amount": r.min_amount,
        "rate_label": blocked or label,
        "benefit_label": label,           # 조건 충족 여부와 상관없는 원래 혜택 문구
        "blocked_reason": blocked,
        "benefit_note": r.note or "",
        "max_per_txn": r.max_per_txn, "limited_by_monthly": limited,
        "expected_benefit": discount,
    }


# ---------- 2. 내 카드 중 최대 혜택 추천 ----------
@app.get("/recommendations")
def recommendations(brand_id: int = Query(...), amount: Optional[int] = Query(None),
                    mydata: bool = Query(False),
                    hour: Optional[int] = Query(None, ge=0, le=23, description="결제 시각(시). 비우면 지금(한국 시간)"),
                    db: Session = Depends(get_db)):
    brand = db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(404, "브랜드 없음")
    base_amount = amount or DEFAULT_AMOUNT
    at_hour = now_hour() if hour is None else hour
    cards = visible_cards(db, mydata)
    # 같은 카드에 여러 룰이 있으면 브랜드 > 업종 > 전 가맹점 순으로 덮어쓴다
    rules = {r.card_id: r for r in db.query(BenefitRule).filter(BenefitRule.category == "*").all()}
    rules.update({r.card_id: r for r in db.query(BenefitRule).filter(BenefitRule.category == brand.category).all()})
    rules.update({r.card_id: r for r in db.query(BenefitRule).filter(BenefitRule.brand_id == brand_id).all()})

    tiers = tiers_by_card(db)
    rows = []
    for c in cards:
        row = card_state(c, mydata, tiers.get(c.id, []))
        r = rules.get(c.id)
        if r:
            row.update(apply_rule(r, row, base_amount, at_hour, brand))
        else:
            row.update({
                "has_benefit": False, "benefit_type": None, "rate": 0, "fixed_amount": 0, "min_amount": 0,
                "rate_label": "이 가맹점 혜택 없음", "benefit_label": "", "blocked_reason": None,
                "benefit_note": "", "max_per_txn": 0, "limited_by_monthly": False, "expected_benefit": 0,
            })
        row["final_payment"] = base_amount - row["expected_benefit"]
        rows.append(row)

    # 추천 엔진 (기획서 3.1): ① 최종 결제금액 오름차순 ② 실적까지 남은 금액 내림차순 ③ 우리카드 우선
    rows.sort(key=lambda x: (x["final_payment"], -x["spend_gap"], not x["is_woori"]))
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    best = rows[0] if rows and rows[0]["expected_benefit"] > 0 else None

    reason = None
    if best:
        nxt = rows[1] if len(rows) > 1 else None
        if not nxt or nxt["final_payment"] > best["final_payment"]:
            reason = "결제금액이 가장 적어요"
        elif nxt["spend_gap"] < best["spend_gap"]:
            reason = "할인이 같아서, 이번 달 실적 채우기가 더 급한 카드를 골랐어요"
        else:
            reason = "할인·실적 조건이 같아서 우리카드를 우선했어요"

    return {
        "brand": {"brand_id": brand.id, "name": brand.name, "category": brand.category, "logo_url": logo_url(brand.name)},
        "amount": base_amount,
        "hour": at_hour,
        "mydata_linked": mydata,
        "cards": rows,
        "best_card_id": best["card_id"] if best else None,
        "best_reason": reason,
        "message": f"{brand.name}에서 받을 수 있는 최대 혜택을 찾았어요!" if best else f"{brand.name}에서 지금 할인되는 카드가 없어요",
    }


# ---------- 카드 선택 기록 (결제 아님) ----------
class SelectionIn(BaseModel):
    recognition_id: Optional[int] = None
    brand_id: int
    card_id: int
    expected_amount: Optional[int] = None


@app.post("/selections")
def create_selection(body: SelectionIn, db: Session = Depends(get_db)):
    if not db.get(Brand, body.brand_id) or not db.get(Card, body.card_id):
        raise HTTPException(404, "브랜드 또는 카드 없음")
    s = Selection(**body.model_dump())
    db.add(s); db.commit(); db.refresh(s)
    return {"selection_id": s.id, "ok": True}


@app.get("/health")
def health():
    return {"ok": True}
