# 내 지갑 카드 코치 — ① 가맹점 인식 + ② 최대 혜택 추천

사진 한 장 → 브랜드 인식 → 내 카드(우리카드 앱에 등록된 것으로 가정, 시드) 중 혜택이 가장 큰 카드 추천.

## 실행

### 백엔드 (FastAPI + SQLite)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
- 첫 실행 시 `cardcoach.db` 자동 생성 + 시드(브랜드 10개 · 카드 4장 · 혜택 룰 20개). 시드 수정은 `app/seed.py` 고친 뒤 db 파일 삭제.
- Swagger: http://localhost:8000/docs

### 프론트 (React + Vite, 모바일 웹)
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```
폰에서 테스트하려면 `npm run dev -- --host` 로 띄우고 같은 와이파이에서 접속. 그때 `frontend/.env` 에
`VITE_API_URL=http://<PC IP>:8000` 추가.

## 인식 모드
| 모드 | 조건 | 동작 |
|---|---|---|
| mock (기본) | `GOOGLE_APPLICATION_CREDENTIALS` 없음 | 업로드 파일명에 브랜드 alias(`starbucks`, `gs25`…)가 있으면 그 브랜드, 없으면 버거킹. 시연 플랜 B |
| vision | `GOOGLE_APPLICATION_CREDENTIALS=서비스계정.json` | Google Vision 로고 감지 + OCR → `seed.py`의 alias와 매칭 |

Vision 키 발급: GCP 콘솔 → Cloud Vision API 사용 설정 → 서비스 계정 키(JSON) 다운로드 → 백엔드 실행 전 `export GOOGLE_APPLICATION_CREDENTIALS=/path/key.json`.
강제로 mock 쓰려면 `RECOG_MODE=mock`.

## API
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/recognitions` (multipart `image`) | 브랜드 후보 + 신뢰도. `auto_confirm=true`면 바로 추천 화면 |
| GET | `/brands` | 인식 실패 시 직접 선택용 목록 |
| GET | `/recommendations?brand_id=&amount=` | 카드별 혜택·예상 혜택액, 추천 순 정렬, `best_card_id` |
| POST | `/selections` | '이 카드로 결제할게요' 선택 기록 (결제 아님) |

추천 엔진: `expected_benefit = min(amount × rate, monthly_max_amount)` 내림차순, 동률이면 우리카드 우선. amount 미입력 시 10,000원 기준.

## 다음에 붙일 것 (설계문서 기준)
- 월 잔여 횟수·한도 (`card_monthly_state`) → 소진 시 차순위 승격
- 혜택 상세 바텀시트(REC-04), GPS 거리(FIND-03), 실적 관리(③)
