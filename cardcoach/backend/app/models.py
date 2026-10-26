from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, JSON, create_engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

DATABASE_URL = "sqlite:///./cardcoach.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class Brand(Base):
    __tablename__ = "brands"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)          # 버거킹
    category = Column(String, nullable=False)      # 패스트푸드
    logo_url = Column(String, default="")
    site = Column(String, default="")              # 공식 사이트 도메인 (로고 파일이 없을 때 이 사이트 아이콘을 표시)
    # 로고 인식/OCR 결과 매칭용 키워드 (소문자, 콤마 구분)
    aliases = Column(String, default="")
    # GPS 매칭용 좌표 (시연용 가상 좌표, 없으면 GPS 매칭 제외)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)


class Card(Base):
    __tablename__ = "cards"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)          # 우리카드 데일리
    issuer = Column(String, nullable=False)        # 우리카드
    is_woori = Column(Boolean, default=False)
    color = Column(String, default="#2F6BFF")      # 카드 이미지 대신 색상
    number_last4 = Column(String, default="")      # 카드번호는 끝 4자리만 저장, 표기 시 마스킹
    # 전월실적 조건·한도는 BenefitTier(구간)에 있음. 구간이 없는 카드만 아래 두 값을 씀
    target_spend = Column(Integer, default=0)      # (구간 없는 카드) 전월실적 조건(원), 0 = 실적 조건 없음
    monthly_discount_limit = Column(Integer, default=0)  # (구간 없는 카드) 월 할인 한도(원), 0 = 한도 없음
    prev_spend = Column(Integer, default=0)        # 지난달 실적(원) → 이번 달 구간(혜택·한도) 결정
    current_spend = Column(Integer, default=0)     # 이번 달 현재 실적(원) → 다음 달 구간 결정
    monthly_discount_used = Column(Integer, default=0)   # 이번 달 이미 받은 할인(원)


class BenefitTier(Base):
    """전월실적 구간. 지난달 실적이 min_spend 이상인 구간 중 가장 높은 구간의 한도를 이번 달에 받는다.
    가장 낮은 구간의 min_spend 미만이면 이번 달 혜택 없음."""
    __tablename__ = "benefit_tiers"
    id = Column(Integer, primary_key=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    min_spend = Column(Integer, nullable=False)       # 구간 시작 금액(원), 예: 400000
    monthly_limit = Column(Integer, nullable=False)   # 이 구간의 월 통합 할인 한도(원)


class BenefitRule(Base):
    __tablename__ = "benefit_rules"
    id = Column(Integer, primary_key=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    # 브랜드 룰(brand_id) / 업종 룰(category) / 전 가맹점 룰(category="*") 중 하나.
    # 같은 카드면 브랜드 > 업종 > 전 가맹점 순으로 우선
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=True)
    category = Column(String, nullable=True)
    benefit_type = Column(String, default="청구할인")  # 청구할인 | 적립 | 캐시백
    rate = Column(Float, default=0)                    # 정률 할인: 0.30 = 30%
    fixed_amount = Column(Integer, default=0)          # 정액 할인(원). 0이 아니면 rate 대신 이 금액
    min_amount = Column(Integer, default=0)            # 최소 결제금액(원). 이보다 적으면 할인 없음
    start_hour = Column(Integer, nullable=True)        # 할인 시간대 시작(시, 포함). 없으면 종일
    end_hour = Column(Integer, nullable=True)          # 할인 시간대 끝(시, 미포함). 예: 7~15 = 07:00~14:59
    max_per_txn = Column(Integer, default=0)           # 건당 최대 할인 금액(원), 0=제한 없음
    note = Column(String, default="")                  # 혜택 설명 (예: "커피 영역(스타벅스·투썸…)")

    card = relationship("Card")
    brand = relationship("Brand")


class Recognition(Base):
    __tablename__ = "recognitions"
    id = Column(Integer, primary_key=True)
    status = Column(String, default="done")   # done | not_found
    candidates = Column(JSON, default=list)
    raw = Column(JSON, default=dict)          # Vision 원본 응답 요약(디버그용)
    created_at = Column(DateTime, default=datetime.utcnow)


class Selection(Base):
    __tablename__ = "selections"
    id = Column(Integer, primary_key=True)
    recognition_id = Column(Integer, nullable=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    expected_amount = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SeedMeta(Base):
    """시드 데이터 버전. seed.py의 SEED_VERSION과 다르면 시작할 때 db를 새로 만든다."""
    __tablename__ = "seed_meta"
    id = Column(Integer, primary_key=True)
    version = Column(String, nullable=False)
