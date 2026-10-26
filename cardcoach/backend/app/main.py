from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session
import os


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

from .models import SessionLocal, Brand, Card, BenefitRule, Recognition, Selection
from .seed import seed
from .recognize import recognize, CONFIDENCE_AUTO

app = FastAPI(title="내 지갑 카드 코치 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

LOGO_DIR = os.path.join(os.path.dirname(__file__), "..", "logos")
os.makedirs(LOGO_DIR, exist_ok=True)
app.mount("/logos", StaticFiles(directory=LOGO_DIR), name="logos")


@app.on_event("startup")
def _startup():
    seed()


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
        "candidates": cands,                   # source: logo | text | image | gps, 근처면 distance_m
    }


# ---------- 브랜드 목록 (인식 실패 fallback 선택용) ----------
@app.get("/brands")
def list_brands(db: Session = Depends(get_db)):
    return [{"brand_id": b.id, "name": b.name, "category": b.category, "logo_url": b.logo_url}
            for b in db.query(Brand).order_by(Brand.id).all()]


# ---------- 내 카드 상태 (실적·한도) ----------
def mask_number(last4: str) -> str:
    return f"**** **** **** {last4 or '****'}"


def card_state(c: Card, mydata: bool) -> dict:
    """우리카드는 자사 데이터로 실적/한도를 안다. 타사 카드는 마이데이터 연동 시에만 안다."""
    known = c.is_woori or mydata
    return {
        "card_id": c.id, "name": c.name, "issuer": c.issuer, "is_woori": c.is_woori, "color": c.color,
        "masked_number": mask_number(c.number_last4),
        "spend_known": known,
        "target_spend": c.target_spend,
        "current_spend": c.current_spend if known else None,
        # 실적 달성까지 남은 금액 = 실적 시급도. 모르면 0으로 보고 정렬
        "spend_gap": max(0, c.target_spend - c.current_spend) if known else 0,
        "monthly_discount_limit": c.monthly_discount_limit,
        # 모르면 한도 전체가 남았다고 가정 (실제로는 소진됐을 수 있음 → 마이데이터 유도 포인트)
        "monthly_remaining": max(0, c.monthly_discount_limit - c.monthly_discount_used) if known else c.monthly_discount_limit,
    }


@app.get("/cards")
def list_cards(mydata: bool = Query(False), db: Session = Depends(get_db)):
    return [card_state(c, mydata) for c in db.query(Card).order_by(Card.id).all()]


# ---------- 2. 내 카드 중 최대 혜택 추천 ----------
@app.get("/recommendations")
def recommendations(brand_id: int = Query(...), amount: Optional[int] = Query(None),
                    mydata: bool = Query(False), db: Session = Depends(get_db)):
    brand = db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(404, "브랜드 없음")
    base_amount = amount or DEFAULT_AMOUNT
    cards = db.query(Card).order_by(Card.id).all()
    # 같은 카드에 브랜드 룰과 업종 룰이 다 있으면 브랜드 룰 우선
    rules = {r.card_id: r for r in db.query(BenefitRule).filter(BenefitRule.category == brand.category).all()}
    rules.update({r.card_id: r for r in db.query(BenefitRule).filter(BenefitRule.brand_id == brand_id).all()})

    rows = []
    for c in cards:
        row = card_state(c, mydata)
        r = rules.get(c.id)
        if r:
            # 할인액 = min(금액 × 할인율, 건당 한도, 월 잔여 한도)
            discount = int(base_amount * r.rate)
            if r.max_per_txn:
                discount = min(discount, r.max_per_txn)
            limited = discount > row["monthly_remaining"]
            discount = min(discount, row["monthly_remaining"])
            label = f"{int(r.rate*100)}% {r.benefit_type}" + ("" if r.brand_id else f" ({brand.category} 업종)")
            row.update({
                "has_benefit": True, "benefit_type": r.benefit_type, "rate": r.rate,
                "rate_label": label if row["monthly_remaining"] else "이번 달 할인 한도 소진",
                "max_per_txn": r.max_per_txn, "limited_by_monthly": limited,
                "expected_benefit": discount,
            })
        else:
            row.update({
                "has_benefit": False, "benefit_type": None, "rate": 0, "rate_label": "이 가맹점 혜택 없음",
                "max_per_txn": 0, "limited_by_monthly": False, "expected_benefit": 0,
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
        "brand": {"brand_id": brand.id, "name": brand.name, "category": brand.category, "logo_url": brand.logo_url},
        "amount": base_amount,
        "mydata_linked": mydata,
        "cards": rows,
        "best_card_id": best["card_id"] if best else None,
        "best_reason": reason,
        "message": f"{brand.name}에서 받을 수 있는 최대 혜택을 찾았어요!" if best else f"{brand.name}에서 혜택이 있는 카드가 없어요",
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
