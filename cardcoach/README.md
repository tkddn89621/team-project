# 내 지갑 카드 코치 — ① 가맹점 인식 + ② 최대 혜택 추천 + ③ 실적 관리

사진 한 장(+GPS) → 브랜드 인식 → 내 카드(우리카드 앱에 등록된 것으로 가정, 시드) 중 결제금액이 가장 적은 카드 추천, 이번 달 실적이 급한 카드 코칭.

## 실행

### 백엔드 (FastAPI + SQLite)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
- 첫 실행 시 `cardcoach.db` 자동 생성 + 시드(브랜드 11개 · 카드 4장 · 혜택 룰 22개). 시드 수정은 `app/seed.py` 고친 뒤 db 파일 삭제.
- 모델에 컬럼이 추가되면 예전 db는 시작할 때 자동으로 지우고 다시 만든다(인식·선택 기록도 초기화).
- Swagger: http://localhost:8000/docs

### 프론트 (React + Vite, 모바일 웹)
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```
폰에서 테스트하려면 프론트는 `npm run dev -- --host`, 백엔드는 `--host 0.0.0.0` 을 붙여 띄우고 같은 와이파이에서 `http://<PC IP>:5173` 접속.
백엔드 주소는 접속한 주소를 따라가므로 `.env` 수정 불필요.

## 인식 모드
| 모드 | 조건 | 동작 |
|---|---|---|
| mock (기본) | `GOOGLE_APPLICATION_CREDENTIALS` 없음 | 업로드 파일명을 OCR 텍스트·사진 라벨로 취급. `starbucks.jpg` → 로고 인식 성공, `burger.jpg`/`coffee.jpg` → 사진으로 업종 추정, 아무것도 없으면 버거 사진 시나리오. 시연 플랜 B |
| vision | `GOOGLE_APPLICATION_CREDENTIALS=서비스계정.json` | Google Vision 로고 감지 + OCR + 라벨(사물) 감지 → `seed.py`의 alias/업종과 매칭 |

Vision 키 발급: GCP 콘솔 → Cloud Vision API 사용 설정 → 서비스 계정 키(JSON) 다운로드 → 백엔드 실행 전 `export GOOGLE_APPLICATION_CREDENTIALS=/path/key.json`.
강제로 mock 쓰려면 `RECOG_MODE=mock`.

인식 근거(`source`)와 신뢰도
| 근거 | 신뢰도 | 설명 |
|---|---|---|
| `logo` | Vision score | 로고 감지 |
| `text` | 0.75 | 간판 글씨(OCR)에 alias 포함. 영문 alias는 단어 단위로만 매칭(`cu`가 `security`에 안 걸림) |
| `image` | 0.55 | 로고·글씨가 없을 때 사진 속 사물(버거, 커피…)로 업종 추정 → 그 업종 브랜드들 |
| `gps` | 0.50 | 위 근거가 약할 때 반경 30m 안 매장을 후보로 추가 ("근처 '카페 오로르'가 맞나요?") |
다른 근거로 찾은 후보가 30m 안에 있으면 +0.15. 0.80 이상 + 후보 1개면 자동 확정.

GPS 시연: 실제 위치는 시드 좌표 근처가 아니므로 `frontend/.env`에 `VITE_DEMO_GPS=37.56650,126.97800` 을 넣으면 그 위치로 보낸다(카페 오로르 4m · 버거킹 20m · 스타벅스 120m). 폰에서 실제 GPS는 https 또는 localhost에서만 동작.

## API
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/recognitions` (multipart `image`, 선택 `lat`·`lng`) | 브랜드 후보 + 신뢰도 + 근거. `auto_confirm=true`면 바로 추천 화면 |
| GET | `/brands` | 인식 실패 시 직접 검색/선택용 목록 |
| GET | `/recommendations?brand_id=&amount=&mydata=` | 카드별 할인액·최종 결제금액·실적·남은 한도, 추천 순 정렬, `best_card_id`, `best_reason` |
| GET | `/cards?mydata=` | 내 카드 실적·한도 (카드번호는 마스킹된 값만) |
| POST | `/selections` | '이 카드로 결제할게요' 선택 기록 (결제 아님) |

추천 엔진 (기획서 3.1)
- 할인액 = `min(금액 × 할인율, 건당 한도, 이번 달 남은 할인 한도)`, 최종 결제금액 = 금액 − 할인액
- 정렬: ① 최종 결제금액 오름차순 ② 실적 달성까지 남은 금액 내림차순 ③ 우리카드 우선
- 혜택 룰은 브랜드 룰 또는 업종 룰(예: 카페 업종 10%). 같은 카드면 브랜드 룰 우선
- amount 미입력 시 10,000원 기준

마이데이터 (`mydata=false`가 기본)
- 우리카드는 자사 데이터라 실적·한도를 항상 안다. 타사 카드는 연동 전엔 실적을 모르고(시급도 0) 한도는 전부 남았다고 가정
- 시연: 스타벅스 1만 원 → 연동 전엔 신한 Deep(30%) 추천, 연동 후엔 신한의 남은 한도가 1,000원뿐이라 우리카드 데일리로 바뀜
- 프론트의 '연동하기'는 목업(이 기기 localStorage에만 기억)

보안: 카드번호·CVV는 스캔/저장하지 않고 끝 4자리만 보관, 화면에는 `**** **** **** 1234`로 표기.

## 다음에 붙일 것
- 선택 기록을 실적·사용 한도에 반영(지금은 시드 값 고정)
- 혜택 상세 바텀시트(REC-04), 실제 지도 API(카카오/네이버) 매장 매칭
