# 개발자용: 내 PC에서 실행하기

> 써 보기만 할 거면 설치 없이 **https://wonpick.onrender.com** ([README](README.md#-바로-써보기)).
> 이 문서는 코드를 고치는 팀원용입니다. 배포 방법은 [cardcoach/README.md](cardcoach/README.md#시연용-배포-render).

## 실행

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

**카카오 키** (근처 실제 매장): https://developers.kakao.com → 앱 → 앱 생성 → 플랫폼 키의 **REST API 키** → 제품 설정 → 카카오맵 사용 ON. 장소 검색 하루 10만 건 무료 (사진 1장당 8건: 카페·음식점·편의점 등 업종별 검색)

**Claude 키** (애매한 사진 판단): https://console.anthropic.com → API 키. 유료(애매한 사진 1장당 약 15~20원)지만 Claude Max·Team 구독자는 claude.ai 결제 설정 → API credits에서 월 크레딧 연결 가능

> ⚠️ API 키는 커밋·단톡방 공유 금지. 각자 발급하거나 1:1로 전달.
> 서비스 계정 키(JSON)는 조직 정책으로 막혀 있을 수 있어서 API 키 방식을 씁니다.
