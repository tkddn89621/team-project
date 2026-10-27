# 💳 카드 코치 (Card Coach)

> 찍어서 혜택 챙기고, 전월 실적까지 관리해 주는 AI 결제 비서

매장 간판·음식을 찍으면 → 어떤 가맹점인지 인식하고 → 내 카드 중 **결제금액이 가장 적어지는 카드**를 추천합니다.
할인이 같으면 **이번 달 실적이 더 급한 카드**, 그것도 같으면 **우리카드**를 우선합니다.

시연 페르소나: **김우리(26)** · 우리 카드의정석 TEN · 우리 카드의정석2 SHOPPING+ · 신한카드 처음 3장 보유 (기획서 페르소나, 가상 인물. 카드 혜택은 실제 상품 기준)

- 기획·명세: [Card_Coach_Spec.md](Card_Coach_Spec.md)
- 코드 상세(API·인식 로직): [cardcoach/README.md](cardcoach/README.md)
- 변경 기록: [CHANGELOG.md](CHANGELOG.md)

---

## 폴더 구조

```
team-project/
├─ Card_Coach_Spec.md        기획서
├─ CHANGELOG.md              변경 기록
└─ cardcoach/
   ├─ backend/               FastAPI + SQLite (인식·추천 API)
   │  └─ app/
   │     ├─ main.py          API 엔드포인트, 추천·코칭
   │     ├─ engine.py        혜택 계산 (할인율·건당/월/영역 한도·시간·요일·횟수 조건)
   │     ├─ catalog.py       카드 상품 DB·업종코드 읽기 (카카오 업종·사진 라벨 → 업종코드)
   │     ├─ recognize.py     가맹점 인식 (로고·글자·사진·GPS)
   │     ├─ places.py        카카오 근처 매장 검색
   │     ├─ ai_pick.py       애매한 사진을 Claude가 판단
   │     ├─ seed.py          시연용 데이터 (페르소나 지갑·실적·이번 달 사용 내역)  ← 시연 숫자 바꿀 땐 여기
   │     └─ models.py        DB 테이블
   │  └─ logos/              브랜드 로고 (브랜드명.png 넣으면 표시, 없으면 업종 이모지)
   ├─ data/benefits/         카드 상품 DB: 인기 카드 100장 혜택(cards/), 업종코드(taxonomy), 브랜드↔업종 연결표(mapping)
   └─ frontend/              React + Vite (모바일 웹)
      └─ src/App.jsx         화면 전부 (인식 / 추천 / 내 카드·실적)
```

## 처음 실행하기

필요한 것: Python 3.10+, Node.js 20+

**1) 코드 받기**
```
git clone https://github.com/tkddn89621/team-project.git
cd team-project/cardcoach
```

**2) 백엔드** (터미널 1, 켜둔 채로)
```
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000 --host 0.0.0.0
```
`Application startup complete` 가 나오면 성공. DB(`cardcoach.db`)는 자동으로 만들어집니다.

**3) 프론트** (터미널 2, 켜둔 채로)
```
cd frontend
npm install
npm run dev -- --host
```

**4) 접속**
- PC: http://localhost:5173
- 폰: PC와 **같은 와이파이**에서 `https://<PC IP>:5173` (프론트 터미널의 `Network:` 주소, `certs/` 없으면 http)
- 폰 데이터로: Cloudflare 임시 터널 ([cardcoach/README.md](cardcoach/README.md) 참고). 테스트 끝나면 터널 끄기

> 백엔드 명령은 `backend` 폴더에서, 프론트 명령은 `frontend` 폴더에서 실행해야 합니다.
> `No module named 'app'` 이 나오면 폴더를 잘못 찾아간 것.

## 설정 파일 (.env) — GitHub에 올라가지 않음

| 파일 | 내용 | 없으면 |
|---|---|---|
| `backend/.env` | `GOOGLE_VISION_API_KEY=...` | 사진 대신 **파일 이름**으로 인식하는 시연 모드 (`starbucks.jpg` → 스타벅스) |
| `backend/.env` | `KAKAO_REST_API_KEY=...` | 근처 실제 매장 검색 없이 seed.py 시연용 좌표만 사용 |
| `backend/.env` | `ANTHROPIC_API_KEY=...` | 애매한 사진을 Claude가 판단하는 단계를 건너뜀 (규칙 결과 그대로) |
| `frontend/.env` | `VITE_DEMO_GPS=37.56650,126.97800` | 폰의 실제 GPS 사용 (https에서만) |

`.env.example` 을 복사해서 `.env` 로 만들고 값을 채우세요.

**Vision API 키 받기** (실제 사진 인식용)
1. https://console.cloud.google.com → 새 프로젝트 → 결제 계정 연결 (월 1,000건/기능 무료 ≈ 사진 330장)
2. `Cloud Vision API` 검색 → 사용
3. `사용자 인증 정보` → 사용자 인증 정보 만들기 → **API 키** → API 제한: Cloud Vision API만 체크
4. `backend/.env` 에 `GOOGLE_VISION_API_KEY=AIza...` 저장 → 백엔드 재시작

**카카오 키** (근처 실제 매장): https://developers.kakao.com → 앱 → 앱 생성 → 플랫폼 키의 **REST API 키** → 제품 설정 → 카카오맵 사용 ON. 장소 검색 하루 10만 건 무료 (사진 1장당 5건)

**Claude 키** (애매한 사진 판단): https://console.anthropic.com → API 키. 유료(애매한 사진 1장당 약 15~20원)지만 Claude Max·Team 구독자는 claude.ai 결제 설정 → API credits에서 월 크레딧 연결 가능

> ⚠️ API 키는 커밋·단톡방 공유 금지. 각자 발급하거나 1:1로 전달.
> 서비스 계정 키(JSON)는 조직 정책으로 막혀 있을 수 있어서 API 키 방식을 씁니다.

## 시연 시나리오

결제 금액은 입력하지 않아도 됩니다. 안 넣으면 "얼마 이상이면 어떤 카드" 구간으로 안내하고, 아래 금액은 '결제 금액을 알면 정확히 계산해요'로 넣은 경우.

자세한 대본(7장면)과 카드별 실적·한도는 [cardcoach/README.md](cardcoach/README.md#페르소나와-시연-대본) 참고.

| 해보기 | 결과 |
|---|---|
| 버거킹 9,000원, 마이데이터 연동 전 | 우리카드 2장 모두 혜택 없음 → "할인되는 카드가 없어요" + 연동 안내 |
| → **연동하기** | 신한 처음 450원 1등 + 코칭 "할인은 450원 적지만 SHOPPING+로 내면 다음 달 혜택 1.5만 원을 지켜요" |
| 스타벅스 6,000원 | TEN 600원 = SHOPPING+ 600원 → 코칭 "할인은 같아요. 실적 3만 원 남은 SHOPPING+로" |
| 올리브영 30,000원 | SHOPPING+는 오프라인 한도가 2천 원만 남아 2,000원 (신한 1,500원) |
| → **우리페이로 결제하기** | SHOPPING+ 실적 30만 달성 → 다이소는 '이번 달 할인 한도 소진', 신한 1등 |
| 동네 식당 (카카오 근처 매장) | 음식점 업종코드로 추천: 신한 500원 > TEN 300원 |
| 홈 **내 카드 · 실적** | 다음 달 혜택이 걸린 카드와 남은 실적·남은 날 |

인식 가능한 브랜드 124개 (카드 100장 혜택에 나오는 매장 브랜드) + 카카오로 찾은 처음 보는 동네 가게는 업종코드로 추천.
(실적·이번 달 사용 내역·좌표는 가상 데이터. 카드 혜택 수치는 시연 전 카드사 홈페이지에서 재확인)

## 기획서 대비 구현 현황

| 기획서 | 상태 |
|---|---|
| 3.1 추천 3단계 정렬 (결제금액 → 실적 시급도 → 우리카드) | ✅ |
| 전월실적 구간·시간대·정액·최소금액 조건 | ✅ |
| 4.1 간판 OCR (Google Vision 로고·글자) | ✅ |
| 4.1 음식 사진 → 업종 추론 | ✅ 업종까지 + 애매하면 Claude가 사진·근처 매장 보고 판단 |
| 4.1 GPS 반경 매장 매칭 | ✅ 카카오 로컬 API로 실제 근처 매장 (반경 50m, 실내 GPS 오차 고려) |
| 4.2 인식 결과 직접 검색·수정 / 후보 칩 | ✅ |
| 4.2 카드번호 마스킹 | ⚠️ 끝 4자리 마스킹 표기만, 보안 안내 문구는 없음 |
| 4.2 마이데이터 연동 유도 팝업 | ✅ 연동 전엔 우리카드만, 연동하면 타사 카드 등장 (목업) |
| 결제 후 실적·한도 반영 | ✅ 우리카드: 우리페이·실물 카드 목업 결제 → 바로 반영 / 타사 카드: 실물 카드 결제 후 마이데이터 새로고침 → 추정 반영 |
| 다음 달 실적 코칭 | ✅ 1등이 아니어도 다음 달 혜택을 지키는 카드를 권함 |

## 협업 규칙

1. **작업 전엔 항상 `git pull`** — 남이 올린 최신 코드부터 받기
2. 기능 단위로 **브랜치** 만들어 작업 → GitHub에서 **PR(Pull Request)** 로 올리기
   ```
   git checkout -b feat/기능이름
   git add .
   git commit -m "무엇을 왜 바꿨는지"
   git push origin feat/기능이름
   ```
   PR 설명에 바뀐 내용·테스트 방법을 적고, 팀원 한 명이 보고 Merge
3. 눈에 띄는 변경은 [CHANGELOG.md](CHANGELOG.md) 에 한 줄 추가
4. **`.env`, API 키, `cardcoach.db` 는 절대 커밋하지 않기** (`.gitignore` 에 등록돼 있음)
5. 시연 지갑·실적은 `backend/app/seed.py`, 카드 혜택은 `data/benefits/cards/*.json`. seed를 바꾸면 `SEED_VERSION` 값도 변경 → 백엔드 재시작하면 DB 자동 재생성
