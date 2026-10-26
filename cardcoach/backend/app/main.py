from typing import Optional
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session
import os

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
async def create_recognition(image: UploadFile = File(...), db: Session = Depends(get_db)):
    data = await image.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "이미지는 10MB 이하여야 합니다")
    brands = db.query(Brand).all()
    result = recognize(data, image.filename or "", brands)
    cands = result["candidates"]
    status = "done" if cands else "not_found"
    rec = Recognition(status=status, candidates=cands, raw=result["raw"])
    db.add(rec); db.commit(); db.refresh(rec)
    auto_confirm = len(cands) == 1 and cands[0]["confidence"] >= CONFIDENCE_AUTO
    return {
        "recognition_id": rec.id,
        "status": status,
        "auto_confirm": auto_confirm,          # true면 FIND에서 바로 REC로
        "candidates": cands,
    }


# ---------- 브랜드 목록 (인식 실패 fallback 선택용) ----------
@app.get("/brands")
def list_brands(db: Session = Depends(get_db)):
    return [{"brand_id": b.id, "name": b.name, "category": b.category, "logo_url": b.logo_url}
            for b in db.query(Brand).order_by(Brand.id).all()]


# ---------- 2. 내 카드 중 최대 혜택 추천 ----------
@app.get("/recommendations")
def recommendations(brand_id: int = Query(...), amount: Optional[int] = Query(None), db: Session = Depends(get_db)):
    brand = db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(404, "브랜드 없음")
    base_amount = amount or DEFAULT_AMOUNT
    cards = db.query(Card).order_by(Card.id).all()
    rules = {r.card_id: r for r in db.query(BenefitRule).filter(BenefitRule.brand_id == brand_id).all()}

    rows = []
    for c in cards:
        r = rules.get(c.id)
        if r:
            raw = int(base_amount * r.rate)
            expected = min(raw, r.monthly_max_amount) if r.monthly_max_amount else raw
            rows.append({
                "card_id": c.id, "name": c.name, "issuer": c.issuer, "is_woori": c.is_woori, "color": c.color,
                "has_benefit": True, "benefit_type": r.benefit_type, "rate": r.rate,
                "rate_label": f"{int(r.rate*100)}% {r.benefit_type}",
                "monthly_max_amount": r.monthly_max_amount,
                "expected_benefit": expected,
            })
        else:
            rows.append({
                "card_id": c.id, "name": c.name, "issuer": c.issuer, "is_woori": c.is_woori, "color": c.color,
                "has_benefit": False, "benefit_type": None, "rate": 0, "rate_label": "이 가맹점 혜택 없음",
                "monthly_max_amount": 0, "expected_benefit": 0,
            })

    # 추천 엔진: 실제 받을 혜택액 내림차순, 동률이면 우리카드 우선
    rows.sort(key=lambda x: (-x["expected_benefit"], not x["is_woori"]))
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    best = rows[0] if rows and rows[0]["has_benefit"] else None
    return {
        "brand": {"brand_id": brand.id, "name": brand.name, "category": brand.category, "logo_url": brand.logo_url},
        "amount": base_amount,
        "cards": rows,
        "best_card_id": best["card_id"] if best else None,
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
