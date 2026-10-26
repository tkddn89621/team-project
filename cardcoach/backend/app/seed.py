"""시드 데이터: 페르소나 '김지훈' 1명의 지갑 (신한·우리·국민 카드 3장) + 브랜드 16개 + 혜택 룰.

[페르소나] 김지훈(31) · 상암 IT회사 4년차 · 우리은행 급여통장 · 카드 3장을 나눠 씀 (가상 인물)
  - 신한카드 Discount Plan+ : 메인 생활비 카드. 지난달 85만 → 2구간(80만↑, 한도 1만), 이번 달 52만 (28만 더 써야 2구간 유지)
  - 우리 카드의정석 TEN     : 급여통장 따라 만든 카드. 지난달 41만 → 1구간(40만↑, 한도 1만), 이번 달 18만 (22만 더 써야 혜택 유지)
  - KB국민 My WE:SH         : 놀 때 쓰는 카드. 지난달 43만으로 겨우 통과, 이번 달 28만 (12만 더 써야 다음 달 유지)
  → 우리 WON 앱은 우리카드만 안다. 신한·국민카드는 보유 사실조차 모르다가 마이데이터를 연동하면 실적·한도와 함께 나타남

[카드 혜택] 실제 상품 기준 (카드고릴라·ajd.co.kr 카드 상세 정리, 시연 전 각 카드사 홈페이지에서 재확인 필요)
  - 우리 카드의정석 TEN : 커피(스타벅스·투썸·이디야·메가MGC·컴포즈·매머드)·편의점(CU·GS25·세븐일레븐) 10%,
                          음식점 1%. 전월실적 구간: 40만↑ 통합 월 1만 / 80만↑ 월 2만
  - 신한 Discount Plan+ : 카페 10% 07~15시 / 편의점 10% 18~22시 / 음식점(패스트푸드 포함) 10% 07~15시,
                          1회 1만원까지만 할인 대상(=건당 최대 1,000원).
                          Time Plan 구간: 40만↑ 5천 / 80만↑ 1만 / 120만↑ 1.5만 / 180만↑ 2만.
                          영화(CGV·롯데시네마) 1.2만원 이상 결제 시 5,000원 정액, 월 1회. 마트 10%
  - KB국민 My WE:SH     : '노는데 진심' 선택 기준. 공통 음식점·편의점(GS25·CU) 10% 건당 2,500원·월 5천,
                          커피 5%·월 5천, 영화관 30%(연 4회·연 2만). 구간 없이 전월 40만 이상 하나

[단순화·가정]
  - 영역별·플랜별 한도는 카드 통합 한도 하나로 계산. 월 횟수 제한(영화 월 1회 등)은 설명에만 표기
  - 영화 할인(신한 Monthly Plan, KB 연 2만)도 카드 통합 한도 안에서 계산
  - 실적·사용 한도·카드번호 끝 4자리는 가상의 사용 상황
"""
from sqlalchemy import inspect
from .models import Base, engine, SessionLocal, Brand, Card, BenefitRule, BenefitTier, SeedMeta

# 시드 데이터(카드·혜택·실적)를 고치면 이 값을 바꾼다 → 다음 시작 때 db를 자동으로 새로 만듦 (인식·선택 기록도 초기화)
SEED_VERSION = "2026-10-27-persona-v4"

# 시연 기준 위치. 프론트 .env 의 VITE_DEMO_GPS 와 맞춰 쓰면 '근처 매장' 매칭을 시연할 수 있음
DEMO_GPS = (37.56650, 126.97800)

BRANDS = [
    # name, category, aliases(소문자, 로고감지명/OCR 텍스트/승인내역 가맹점명에 들어갈 법한 것들)
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
    # TEN·신한 카페 혜택은 지정 브랜드만이라 여기선 안 됨 → 업종 단위인 KB 커피 5%만 해당
    ("카페 오로르", "카페",    "카페 오로르,오로르,cafe aurore,café aurore"),
    # 카드의정석 TEN·신한 Discount Plan+ 지정 브랜드 (실제 혜택 목록에 있어서 추가)
    ("이디야커피", "카페",     "ediya,ediya coffee,이디야,이디야커피"),
    ("메가MGC커피", "카페",    "mega mgc coffee,mega coffee,megacoffee,mgc coffee,메가커피,메가엠지씨커피,메가mgc커피"),
    ("컴포즈커피", "카페",     "compose coffee,composecoffee,컴포즈커피,컴포즈"),
    ("매머드커피", "카페",     "mammoth coffee,mammoth express,매머드커피,매머드"),
    ("세븐일레븐", "편의점",   "7-eleven,7eleven,seven eleven,세븐일레븐,코리아세븐"),
]

# 공식 사이트 도메인 → 로고 파일이 없으면 이 사이트의 아이콘을 화면에 표시 (카페 오로르는 가상 가게라 없음 → 이니셜)
SITES = {
    "버거킹": "burgerking.co.kr", "스타벅스": "starbucks.co.kr", "GS25": "gs25.gsretail.com",
    "올리브영": "oliveyoung.co.kr", "롯데마트": "lottemart.com", "CGV": "cgv.co.kr",
    "CU": "cu.bgfretail.com", "교보문고": "kyobobook.co.kr", "맥도날드": "mcdonalds.co.kr",
    "투썸플레이스": "twosome.co.kr", "이디야커피": "ediya.com", "메가MGC커피": "mega-mgccoffee.com",
    "컴포즈커피": "composecoffee.com", "매머드커피": "mmthcoffee.com", "세븐일레븐": "7-eleven.co.kr",
}

# 시연용 가상 좌표: 오로르 ~4m, 버거킹 ~20m (반경 30m 안), 스타벅스 ~120m (밖)
COORDS = {
    "카페 오로르": (37.56653, 126.97803),
    "버거킹":     (37.56668, 126.97800),
    "스타벅스":   (37.56760, 126.97800),
}

CARDS = [
    # name, issuer, is_woori, color, 끝4자리, 지난달 실적, 이번 달 실적, 이번 달 받은 할인
    ("카드의정석 TEN",          "우리카드",   True,  "#1B3A8A", "1234", 410000, 180000, 2000),
    ("신한카드 Discount Plan+", "신한카드",   False, "#2B5BD7", "5678", 850000, 520000, 4000),
    ("KB국민 My WE:SH",         "KB국민카드", False, "#E0A100", "9012", 430000, 280000, 0),
]

# 전월실적 구간: (구간 시작 금액, 월 통합 할인 한도)
TIERS = {
    # 5대 일상영역 통합 한도 (영역별 한도 5천/1만은 통합 한도로 단순화)
    "카드의정석 TEN": [(400000, 10000), (800000, 20000)],
    # Time Plan(카페·편의점·음식점·배달) 월 한도
    "신한카드 Discount Plan+": [(400000, 5000), (800000, 10000), (1200000, 15000), (1800000, 20000)],
    # 구간 없이 40만 하나. 공통 음식점·편의점 월 5천 + 선택(노는데 진심) 택시·커피 월 5천 = 1만으로 합산
    "KB국민 My WE:SH": [(400000, 10000)],
}

# Rule(card, 대상, 혜택 유형, ...) 대상: 브랜드명 | "업종:카페" | "*"(전 가맹점)
def R(card, target, btype, rate=0.0, fixed=0, min_amount=0, hours=None, max_per_txn=0, note=""):
    return dict(card=card, target=target, btype=btype, rate=rate, fixed=fixed, min_amount=min_amount,
                hours=hours, max_per_txn=max_per_txn, note=note)


TEN, SH, KB = "카드의정석 TEN", "신한카드 Discount Plan+", "KB국민 My WE:SH"
TEN_COFFEE = "커피 영역(스타벅스·투썸·이디야·메가MGC·컴포즈·매머드)"
TEN_CVS = "편의점 영역(CU·GS25·세븐일레븐)"
SH_CAFE = "Time Plan 카페 DAY (1회 1만원까지 할인)"
SH_CVS = "Time Plan 편의점 NIGHT (1회 1만원까지 할인)"

RULES = [
    *[R(TEN, b, "청구할인", rate=0.10, note=TEN_COFFEE)
      for b in ["스타벅스", "투썸플레이스", "이디야커피", "메가MGC커피", "컴포즈커피", "매머드커피"]],
    *[R(TEN, b, "청구할인", rate=0.10, note=TEN_CVS) for b in ["CU", "GS25", "세븐일레븐"]],
    R(TEN, "업종:패스트푸드", "청구할인", rate=0.01, note="음식점·주점 1%"),

    *[R(SH, b, "할인", rate=0.10, hours=(7, 15), max_per_txn=1000, note=SH_CAFE)
      for b in ["스타벅스", "투썸플레이스", "메가MGC커피", "이디야커피"]],
    *[R(SH, b, "할인", rate=0.10, hours=(18, 22), max_per_txn=1000, note=SH_CVS) for b in ["CU", "GS25", "세븐일레븐"]],
    R(SH, "업종:패스트푸드", "할인", rate=0.10, hours=(7, 15), max_per_txn=1000, note="Time Plan 음식점 DAY (패스트푸드 포함)"),
    R(SH, "CGV", "할인", fixed=5000, min_amount=12000, note="Monthly Plan 영화 (월 1회, 예매만)"),
    R(SH, "롯데마트", "할인", rate=0.10, max_per_txn=5000, note="Daily Plan 마트 (1회 5만원까지, 일 1회·월 5회)"),

    *[R(KB, b, "할인", rate=0.10, max_per_txn=2500, note="공통: 편의점 10% (GS25·CU만, 건당 2,500원까지)")
      for b in ["GS25", "CU"]],
    R(KB, "업종:패스트푸드", "할인", rate=0.10, max_per_txn=2500, note="공통: 음식점 10% (건당 2,500원까지)"),
    R(KB, "업종:카페", "할인", rate=0.05, note="선택(노는데 진심): 커피 5%"),
    R(KB, "업종:영화", "할인", rate=0.30, note="선택(노는데 진심): 영화관 30% (연 4회·연 2만원까지)"),
]


def _schema_outdated() -> bool:
    """예전 버전 db 파일이면(모델에 있는 테이블·컬럼이 없으면) True → 새로 만든다."""
    insp = inspect(engine)
    if not insp.get_table_names():
        return False   # 빈 db (처음 실행)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            return True
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


def seed():
    if _schema_outdated():
        print("db schema changed → recreate")
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    if _seed_outdated():
        print(f"seed version → {SEED_VERSION}, recreate")
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.query(Brand).count() > 0:
            return
        brands = {}
        for name, cat, aliases in BRANDS:
            lat, lng = COORDS.get(name, (None, None))
            b = Brand(name=name, category=cat, aliases=aliases, site=SITES.get(name, ""), lat=lat, lng=lng)
            db.add(b)
            brands[name] = b
        cards = {}
        for name, issuer, is_woori, color, last4, prev, current, used in CARDS:
            c = Card(name=name, issuer=issuer, is_woori=is_woori, color=color, number_last4=last4,
                     prev_spend=prev, current_spend=current, monthly_discount_used=used)
            db.add(c)
            cards[name] = c
        db.flush()
        for card_name, tiers in TIERS.items():
            for min_spend, limit in tiers:
                db.add(BenefitTier(card_id=cards[card_name].id, min_spend=min_spend, monthly_limit=limit))
        for x in RULES:
            t = x["target"]
            if t == "*":
                rule = BenefitRule(category="*")
            elif t.startswith("업종:"):
                rule = BenefitRule(category=t.split(":", 1)[1])
            else:
                rule = BenefitRule(brand_id=brands[t].id)
            rule.card_id = cards[x["card"]].id
            rule.benefit_type, rule.rate, rule.fixed_amount = x["btype"], x["rate"], x["fixed"]
            rule.min_amount, rule.max_per_txn, rule.note = x["min_amount"], x["max_per_txn"], x["note"]
            if x["hours"]:
                rule.start_hour, rule.end_hour = x["hours"]
            db.add(rule)
        db.add(SeedMeta(version=SEED_VERSION))
        db.commit()
        print("seeded")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
