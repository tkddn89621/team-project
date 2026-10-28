"""DB에는 바뀌는 것만 둔다: 가게(브랜드), 내 지갑(가진 카드 + 실적), 인식·결제 기록.
카드 상품과 혜택 규칙은 data/benefits 파일(catalog.py)에서 읽는다 — 카드 수천 장으로 늘어도 DB 구조는 그대로."""
import os
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, JSON, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# 배포(Railway)에서는 DB_FILE=/data/cardcoach.db 처럼 디스크(Volume) 위치를 지정 → 재배포해도 기록 유지
DATABASE_URL = "sqlite:///" + os.getenv("DB_FILE", "./cardcoach.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class Brand(Base):
    """가게(가맹점 브랜드). 업종코드로 카드 혜택과 연결된다"""
    __tablename__ = "brands"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)          # 버거킹
    industry_code = Column(String, nullable=True)  # FD-FAST (data/benefits/taxonomy.json)
    # 업종을 추정했는지: AI가 알아본 목록 밖 브랜드인데 딱 맞는 업종이 없어 가장 가까운 업종으로 넣은 경우
    category_estimated = Column(Boolean, default=False)
    category = Column(String, nullable=False)      # 업종 이름 (표시용, 업종코드의 name) 예: 패스트푸드·버거
    logo_url = Column(String, default="")
    site = Column(String, default="")              # 공식 사이트 도메인 (로고 파일이 없을 때 이 사이트 아이콘을 표시)
    # 로고 인식/OCR 결과 매칭용 키워드 (소문자, 콤마 구분)
    aliases = Column(String, default="")
    # GPS 매칭용 좌표 (시연용 가상 좌표, 없으면 GPS 매칭 제외)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    # 자동 등록된 가게의 출처 id. 카카오 로컬 장소 id, 또는 Claude가 사진에서 알아본 목록 밖 브랜드면 'ai:브랜드명'
    # seed 브랜드는 None (직접 검색 목록에는 None인 것만 나옴)
    kakao_place_id = Column(String, nullable=True, index=True)


class WalletCard(Base):
    """내 지갑: 고객이 가진 카드. 상품 정보(혜택·구간)는 catalog의 card_id로 찾는다"""
    __tablename__ = "wallet_cards"
    id = Column(Integer, primary_key=True)
    card_id = Column(String, nullable=False)       # 카드 상품 id (data/benefits/cards/{card_id}.json)
    color = Column(String, default="#2F6BFF")      # 카드 이미지 대신 색상
    number_last4 = Column(String, default="")      # 카드번호는 끝 4자리만 저장, 표기 시 마스킹
    prev_spend = Column(Integer, default=0)        # 지난달 실적(원) → 이번 달 구간(혜택·한도) 결정
    current_spend = Column(Integer, default=0)     # 이번 달 현재 실적(원) → 다음 달 구간 결정
    disabled_benefits = Column(JSON, default=list) # 택1 혜택 중 고르지 않은 benefit_id (예: KB '더욱 진심'에서 노는데만 선택)


class Recognition(Base):
    __tablename__ = "recognitions"
    id = Column(Integer, primary_key=True)
    status = Column(String, default="done")   # done | not_found
    candidates = Column(JSON, default=list)
    raw = Column(JSON, default=dict)          # Vision 원본 응답 요약(디버그용)
    created_at = Column(DateTime, default=datetime.utcnow)


class Selection(Base):
    """결제 기록 (앱이 결제하진 않음: 고른 카드로 결제했다는 승인 데이터). 이번 달 사용 한도·횟수 계산에 쓴다"""
    __tablename__ = "selections"
    id = Column(Integer, primary_key=True)
    recognition_id = Column(Integer, nullable=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    card_id = Column(Integer, ForeignKey("wallet_cards.id"), nullable=False)
    expected_amount = Column(Integer, nullable=True)   # 결제 금액(원)
    benefit_id = Column(String, nullable=True)         # 받은 혜택 (월·일 횟수, 혜택별 한도 계산용)
    limit_group = Column(String, nullable=True)        # 그 혜택의 영역(통합) 한도 이름
    discount = Column(Integer, default=0)              # 받은 할인(원)
    created_at = Column(DateTime, default=datetime.utcnow)


class SeedMeta(Base):
    """시드 데이터 버전. seed.py의 SEED_VERSION과 다르면 시작할 때 db를 새로 만든다."""
    __tablename__ = "seed_meta"
    id = Column(Integer, primary_key=True)
    version = Column(String, nullable=False)
