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
    target_spend = Column(Integer, default=0)      # 전월 실적 목표(원)
    current_spend = Column(Integer, default=0)     # 이번 달 현재 실적(원)
    monthly_discount_limit = Column(Integer, default=0)  # 월 통합 할인 한도(원)
    monthly_discount_used = Column(Integer, default=0)   # 이번 달 이미 받은 할인(원)


class BenefitRule(Base):
    __tablename__ = "benefit_rules"
    id = Column(Integer, primary_key=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    # 브랜드 룰(brand_id) 또는 업종 룰(category) 중 하나. 같은 카드면 브랜드 룰 우선
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=True)
    category = Column(String, nullable=True)
    benefit_type = Column(String, default="청구할인")  # 청구할인 | 적립 | 캐시백
    rate = Column(Float, nullable=False)               # 0.30 = 30%
    max_per_txn = Column(Integer, default=0)           # 건당 최대 할인 금액(원), 0=제한 없음

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
