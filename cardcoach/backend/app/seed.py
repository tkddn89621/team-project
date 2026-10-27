"""시드 데이터: 페르소나 '김우리' 1명의 지갑(카드 3장) + 가게(브랜드). 카드 혜택은 seed가 아니라 카드 상품 DB에서 읽는다.

[카드 상품 DB] data/benefits/cards/*.json — 인기 카드 100장의 실제 혜택 (catalog.py). 혜택 규칙은 여기에만 있다.
[가게] data/benefits/mapping.json 의 매장 브랜드 + 업종코드, 그리고 시연용 카페 오로르

[페르소나] 김우리(26) · 입사 1년차 · 우리은행 급여통장 · 카드 3장을 나눠 씀 (가상 인물, 기획서 페르소나)
  - 우리 카드의정석 TEN (woori-2699)         : 생활비 카드(커피·편의점). 지난달 41만 → 혜택 받음, 이번 달 18만 (22만 더 써야 다음 달 유지)
  - 우리 카드의정석2 SHOPPING+ (woori-2687) : 장보기·올리브영·다이소. 지난달 33만, 이번 달 27만 (3만만 더 쓰면 다음 달 유지). 오프라인 한도 6천 중 4천 이미 씀
  - 신한카드 처음 (shinhan-2759)             : 대학 졸업 때 만든 카드. 지난달 32만, 이번 달 15만 (15만 더)
  → 우리 WON 앱은 우리카드 2장만 안다. 신한카드는 보유 사실조차 모르다가 마이데이터를 연동하면 실적·한도와 함께 나타남
  실적·이번 달 사용 내역·카드번호 끝 4자리는 가상의 사용 상황
"""
from datetime import datetime, timedelta, timezone
from sqlalchemy import inspect
from . import catalog
from .models import Base, engine, SessionLocal, Brand, WalletCard, Selection, SeedMeta, Recognition

# 시드 데이터(지갑·브랜드)를 고치면 이 값을 바꾼다 → 다음 시작 때 db를 자동으로 새로 만듦 (인식·결제 기록도 초기화)
SEED_VERSION = "2026-10-27-catalog-v3-cardcolors"
KST = timezone(timedelta(hours=9))

# 시연 기준 위치. 프론트 .env 의 VITE_DEMO_GPS 와 맞춰 쓰면 '근처 매장' 매칭을 시연할 수 있음 (카카오 키가 없을 때만 사용)
DEMO_GPS = (37.56650, 126.97800)

# 내 지갑: (카드 상품 id, 색, 끝4자리, 지난달 실적, 이번 달 실적, 고르지 않은 택1 혜택)
WALLET = [
    ("woori-2699",   "#1E1E22", "1234", 410000, 180000, []),
    ("woori-2687",   "#E0383E", "5678", 330000, 270000, []),
    ("shinhan-2759", "#2A3A6B", "9012", 320000, 150000, []),
]

# 이번 달 이미 받은 할인 (결제 기록으로 넣어서 한도·횟수 계산에 그대로 반영): (카드, 브랜드, 금액, 혜택, 할인)
HISTORY = [
    ("woori-2699",   "스타벅스", 20000, "woori-2699-b01", 2000),
    ("woori-2687",   "이마트",   40000, "woori-2687-b03", 4000),
    ("shinhan-2759", "GS25",     10000, "shinhan-2759-b03", 500),
]

# 별칭 보강 (로고 감지명·OCR 표기). 연결표(mapping.json) 별칭에 더해짐
EXTRA_ALIASES = {
    "버거킹": "burger king,burgerking,whopper", "스타벅스": "starbucks coffee",
    "GS25": "gs 25,지에스25", "CU": "씨유,bgf retail", "CGV": "씨지브이", "교보문고": "kyobo book",
    "맥도날드": "mcdonald,mcdonalds,mcdonald's", "투썸플레이스": "a twosome place,twosome,투썸",
    "카페 오로르": "오로르,cafe aurore,café aurore", "이디야커피": "ediya coffee,이디야",
    "메가MGC커피": "mega mgc coffee,mega coffee,megacoffee,mgc coffee,메가커피,메가엠지씨커피",
    "컴포즈커피": "compose coffee,composecoffee,컴포즈", "매머드커피": "mammoth coffee,mammoth express,매머드",
    "세븐일레븐": "7-eleven,7eleven,seven eleven,코리아세븐",
}

# 공식 사이트 도메인 → 로고 파일이 없으면 이 사이트의 아이콘을 화면에 표시 (나머지 브랜드는 이니셜)
# 버거킹·맥도날드는 한국 사이트 아이콘이 작아서 글로벌 사이트 사용. GS25·CU·세븐일레븐은 backend/logos 파일 사용
SITES = {
    "버거킹": "burgerking.com", "스타벅스": "starbucks.co.kr", "GS25": "gs25.gsretail.com",
    "올리브영": "oliveyoung.co.kr", "롯데마트": "lottemart.com", "CGV": "cgv.co.kr",
    "CU": "cu.bgfretail.com", "교보문고": "kyobobook.co.kr", "맥도날드": "mcdonalds.com",
    "투썸플레이스": "twosome.co.kr", "이디야커피": "ediya.com", "메가MGC커피": "mega-mgccoffee.com",
    "컴포즈커피": "composecoffee.com", "매머드커피": "mmthcoffee.com", "세븐일레븐": "7-eleven.co.kr",
}

# 시연용 가상 좌표 (카카오 키가 없을 때만): 오로르 ~4m, 버거킹 ~20m (반경 안), 스타벅스 ~120m (밖)
COORDS = {
    "카페 오로르": (37.56653, 126.97803),
    "버거킹":     (37.56668, 126.97800),
    "스타벅스":   (37.56760, 126.97800),
}


def _schema_outdated() -> bool:
    """예전 버전 db 파일이면(모델에 있는 테이블·컬럼이 없으면) True → 새로 만든다."""
    insp = inspect(engine)
    if not insp.get_table_names():
        return False   # 빈 db (처음 실행)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue   # 없는 테이블은 create_all이 만들어 줌 (시연 초기화 뒤 인식 기록만 남은 경우 등)
        existing = {c["name"] for c in insp.get_columns(table.name)}
        if {c.name for c in table.columns} - existing:
            return True
    return False


def _seed_outdated() -> bool:
    db = SessionLocal()
    try:
        meta = db.query(SeedMeta).first()
        return meta is None or meta.version != SEED_VERSION
    finally:
        db.close()


def _history_time(i: int) -> datetime:
    """이번 달 1일 오전(한국 시간)에 있었던 결제로 넣음 (UTC naive). 지금보다 미래가 되지 않게"""
    now = datetime.now(KST)
    t = datetime(now.year, now.month, 1, 9, 0, tzinfo=KST) + timedelta(minutes=10 * i)
    return min(t, now - timedelta(minutes=1)).astimezone(timezone.utc).replace(tzinfo=None)


def seed():
    if _schema_outdated():
        print("db schema changed → recreate")
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    if _seed_outdated():
        print(f"seed version → {SEED_VERSION}, recreate")
        _drop_demo_tables()
        Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.query(Brand).count() > 0:
            return
        brands = {}
        for x in catalog.store_brands():
            name = x["brand"]
            aliases = [name.lower(), *[a.lower() for a in x.get("aliases", [])], *EXTRA_ALIASES.get(name, "").split(",")]
            lat, lng = COORDS.get(name, (None, None))
            b = Brand(name=name, industry_code=x["code"], category=catalog.code_name(x["code"]),
                      aliases=",".join(dict.fromkeys(a.strip() for a in aliases if a.strip())),
                      logo_url=f"/logos/{name}.png", site=SITES.get(name, ""), lat=lat, lng=lng)
            db.add(b)
            brands[name] = b
        wallet = {}
        for card_id, color, last4, prev, current, disabled in WALLET:
            if card_id not in catalog.cards():
                raise RuntimeError(f"카드 상품 DB에 {card_id} 가 없어요 (data/benefits/cards)")
            w = WalletCard(card_id=card_id, color=color, number_last4=last4, prev_spend=prev,
                           current_spend=current, disabled_benefits=disabled)
            db.add(w)
            wallet[card_id] = w
        db.flush()
        for i, (card_id, brand, amount, benefit_id, discount) in enumerate(HISTORY):
            group = next(b.get("shared_limit_group") for b in catalog.cards()[card_id]["benefits"] if b["benefit_id"] == benefit_id)
            db.add(Selection(brand_id=brands[brand].id, card_id=wallet[card_id].id, expected_amount=amount,
                             benefit_id=benefit_id, limit_group=group, discount=discount, created_at=_history_time(i)))
        db.add(SeedMeta(version=SEED_VERSION))
        db.commit()
        print(f"seeded: {len(brands)} brands, {len(wallet)} wallet cards, catalog {len(catalog.cards())} cards")
    finally:
        db.close()


def reset():
    """시연 데이터 처음으로: 실적·결제 기록·자동 등록 가게를 모두 지우고 다시 시드.
    인식 기록(recognitions)은 남김 — 잘못 인식한 사례를 나중에 확인할 수 있게 (다른 테이블과 연결 없음)"""
    _drop_demo_tables()
    seed()


def _drop_demo_tables():
    """인식 기록(recognitions)만 남기고 지움"""
    keep = {Recognition.__tablename__}
    Base.metadata.drop_all(engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in keep])


if __name__ == "__main__":
    seed()
