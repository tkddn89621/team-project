"""시드 데이터: 브랜드 10개, 내 카드 4장(우리카드 앱에 등록돼 있다고 가정), 혜택 룰.
수치는 시연용 예시값입니다. 실제 상품 약관과 다릅니다."""
from .models import Base, engine, SessionLocal, Brand, Card, BenefitRule

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
]

CARDS = [
    # name, issuer, is_woori, color
    ("우리카드 데일리", "우리카드", True,  "#2F6BFF"),
    ("우리카드 카드의정석", "우리카드", True, "#1B3A8A"),
    ("신한카드 Deep", "신한카드", False, "#4A4A5A"),
    ("삼성카드 taptap", "삼성카드", False, "#C98BB9"),
]

# (card_name, brand_name, type, rate, monthly_max)
RULES = [
    ("우리카드 데일리", "버거킹",   "청구할인", 0.30, 10000),
    ("우리카드 데일리", "스타벅스", "청구할인", 0.20, 10000),
    ("우리카드 데일리", "GS25",     "청구할인", 0.10, 5000),
    ("우리카드 데일리", "올리브영", "청구할인", 0.10, 5000),
    ("우리카드 데일리", "CGV",      "청구할인", 0.15, 8000),

    ("우리카드 카드의정석", "롯데마트", "청구할인", 0.10, 10000),
    ("우리카드 카드의정석", "교보문고", "적립",     0.05, 5000),
    ("우리카드 카드의정석", "맥도날드", "청구할인", 0.15, 5000),
    ("우리카드 카드의정석", "스타벅스", "청구할인", 0.10, 5000),
    ("우리카드 카드의정석", "CU",       "청구할인", 0.05, 3000),

    ("신한카드 Deep", "버거킹",   "할인",   0.20, 5000),
    ("신한카드 Deep", "스타벅스", "할인",   0.15, 5000),
    ("신한카드 Deep", "CGV",      "할인",   0.20, 5000),
    ("신한카드 Deep", "투썸플레이스", "할인", 0.20, 5000),

    ("삼성카드 taptap", "버거킹",   "할인",   0.10, 3000),
    ("삼성카드 taptap", "맥도날드", "할인",   0.10, 3000),
    ("삼성카드 taptap", "올리브영", "캐시백", 0.15, 5000),
    ("삼성카드 taptap", "GS25",     "캐시백", 0.05, 3000),
    ("삼성카드 taptap", "CU",       "캐시백", 0.05, 3000),
    ("삼성카드 taptap", "롯데마트", "할인",   0.05, 5000),
]


def seed():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.query(Brand).count() > 0:
            return
        brands = {}
        for name, cat, aliases in BRANDS:
            b = Brand(name=name, category=cat, aliases=aliases, logo_url=f"/logos/{name}.png")
            db.add(b)
            brands[name] = b
        cards = {}
        for name, issuer, is_woori, color in CARDS:
            c = Card(name=name, issuer=issuer, is_woori=is_woori, color=color)
            db.add(c)
            cards[name] = c
        db.flush()
        for card_name, brand_name, btype, rate, mx in RULES:
            db.add(BenefitRule(card_id=cards[card_name].id, brand_id=brands[brand_name].id,
                               benefit_type=btype, rate=rate, monthly_max_amount=mx))
        db.commit()
        print("seeded")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
