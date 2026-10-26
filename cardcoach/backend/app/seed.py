"""시드 데이터: 브랜드 11개, 내 카드 4장(우리카드 앱에 등록돼 있다고 가정), 혜택 룰.
수치는 시연용 예시값입니다. 실제 상품 약관과 다릅니다."""
from sqlalchemy import inspect
from .models import Base, engine, SessionLocal, Brand, Card, BenefitRule

# 시연 기준 위치. 프론트 .env 의 VITE_DEMO_GPS 와 맞춰 쓰면 '근처 매장' 매칭을 시연할 수 있음
DEMO_GPS = (37.56650, 126.97800)

BRANDS = [
    # name, category, aliases(소문자, 로고감지명/OCR 텍스트에 들어갈 법한 것들)
    ("버거킹",   "패스트푸드", "burger king,burgerking,버거킹,whopper"),
    ("스타벅스", "카페",       "starbucks,스타벅스,starbucks coffee"),
    ("GS25",     "편의점",     "gs25,gs 25,지에스25"),
    ("올리브영", "뷰티",       "olive young,oliveyoung,올리브영"),
    ("롯데마트", "마트",       "lotte mart,lottemart,롯데마트"),
    ("CGV",      "영화",       "cgv,씨지브이"),
    ("CU",       "편의점",     "cu,씨유,bgf retail"),
    ("교보문고", "서점",       "kyobo,kyobo book,교보문고"),
    ("맥도날드", "패스트푸드", "mcdonald,mcdonalds,mcdonald's,맥도날드"),
    ("투썸플레이스", "카페",   "a twosome place,twosome,투썸플레이스,투썸"),
    # 영문 간판 'AURORE'만으로는 특정이 안 되는 동네 카페 → GPS로 매칭하는 시나리오
    ("카페 오로르", "카페",    "카페 오로르,오로르,cafe aurore,café aurore"),
]

# 시연용 가상 좌표: 오로르 ~4m, 버거킹 ~20m (반경 30m 안), 스타벅스 ~120m (밖)
COORDS = {
    "카페 오로르": (37.56653, 126.97803),
    "버거킹":     (37.56668, 126.97800),
    "스타벅스":   (37.56760, 126.97800),
}

CARDS = [
    # name, issuer, is_woori, color, 끝4자리, 목표실적, 현재실적, 월 할인한도, 이번달 받은 할인
    ("우리카드 데일리",     "우리카드", True,  "#2F6BFF", "1234", 300000, 120000, 20000, 8000),
    ("우리카드 카드의정석", "우리카드", True,  "#1B3A8A", "5678", 300000, 280000, 15000, 2000),
    ("신한카드 Deep",       "신한카드", False, "#4A4A5A", "9012", 300000, 310000, 10000, 9000),
    ("삼성카드 taptap",     "삼성카드", False, "#C98BB9", "3456", 300000, 150000, 10000, 0),
]

# (card_name, 대상, type, rate, 건당 최대) — 대상은 브랜드명 또는 "업종:카페" 같은 업종 룰
RULES = [
    ("우리카드 데일리", "버거킹",   "청구할인", 0.30, 3000),
    ("우리카드 데일리", "스타벅스", "청구할인", 0.20, 2000),
    ("우리카드 데일리", "GS25",     "청구할인", 0.10, 1000),
    ("우리카드 데일리", "올리브영", "청구할인", 0.10, 2000),
    ("우리카드 데일리", "CGV",      "청구할인", 0.15, 2000),
    ("우리카드 데일리", "업종:카페", "청구할인", 0.10, 1000),

    ("우리카드 카드의정석", "롯데마트", "청구할인", 0.10, 5000),
    ("우리카드 카드의정석", "교보문고", "적립",     0.05, 2000),
    ("우리카드 카드의정석", "맥도날드", "청구할인", 0.15, 2000),
    ("우리카드 카드의정석", "스타벅스", "청구할인", 0.10, 2000),
    ("우리카드 카드의정석", "CU",       "청구할인", 0.05, 1000),

    ("신한카드 Deep", "버거킹",   "할인",   0.20, 5000),
    ("신한카드 Deep", "스타벅스", "할인",   0.30, 3000),
    ("신한카드 Deep", "CGV",      "할인",   0.20, 3000),
    ("신한카드 Deep", "투썸플레이스", "할인", 0.20, 3000),

    ("삼성카드 taptap", "버거킹",   "할인",   0.10, 2000),
    ("삼성카드 taptap", "맥도날드", "할인",   0.10, 2000),
    ("삼성카드 taptap", "올리브영", "캐시백", 0.15, 3000),
    ("삼성카드 taptap", "GS25",     "캐시백", 0.10, 1000),
    ("삼성카드 taptap", "CU",       "캐시백", 0.05, 1000),
    ("삼성카드 taptap", "롯데마트", "할인",   0.05, 3000),
    ("삼성카드 taptap", "업종:카페", "할인",  0.05, 1000),
]


def _schema_outdated() -> bool:
    """예전 버전 db 파일이면(모델에 있는 컬럼이 없으면) True → 새로 만든다."""
    insp = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        if {c.name for c in table.columns} - existing:
            return True
    return False


def seed():
    if _schema_outdated():
        print("db schema changed → recreate")
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.query(Brand).count() > 0:
            return
        brands = {}
        for name, cat, aliases in BRANDS:
            lat, lng = COORDS.get(name, (None, None))
            b = Brand(name=name, category=cat, aliases=aliases, logo_url=f"/logos/{name}.png", lat=lat, lng=lng)
            db.add(b)
            brands[name] = b
        cards = {}
        for name, issuer, is_woori, color, last4, target, current, limit, used in CARDS:
            c = Card(name=name, issuer=issuer, is_woori=is_woori, color=color, number_last4=last4,
                     target_spend=target, current_spend=current,
                     monthly_discount_limit=limit, monthly_discount_used=used)
            db.add(c)
            cards[name] = c
        db.flush()
        for card_name, target, btype, rate, mx in RULES:
            if target.startswith("업종:"):
                rule = BenefitRule(category=target.split(":", 1)[1])
            else:
                rule = BenefitRule(brand_id=brands[target].id)
            rule.card_id = cards[card_name].id
            rule.benefit_type, rule.rate, rule.max_per_txn = btype, rate, mx
            db.add(rule)
        db.commit()
        print("seeded")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
