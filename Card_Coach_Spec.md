# 💳 카드 코치 (Card Coach) - 서비스 기획 및 개발 명세서

---

## 1. 프로젝트 개요 & 타깃층

### 1.1 서비스 한 줄 정의
> **"찍어서 혜택 챙기고, 전월 실적까지 관리해 주는 AI 초개인화 결제 비서, 카드 코치"**

### 1.2 핵심 타깃층 (Target Persona)
* **메인 타깃:** 매일 카페, 편의점, 외식을 이용하며 3~4개 카드를 혼용하지만 카드별 실적과 할인 한도를 외우지 못해 매달 혜택을 놓치는 **2030 직장인 및 사회초년생 (김우리, 26세)**
* **서브 타깃:** 
  * 여러 카드 혜택을 꼼꼼하게 챙기고 싶지만 결제 직전 어떤 카드를 내야 할지 고민되는 **체리피커 및 스마트 소비층**
  * 카드사 전월 실적 조건 달성이 아슬아슬하게 부족해 다음 달 혜택을 박탈당하는 **금융 이탈 가능 고객**

---

## 2. 서비스 목적 및 기대효과 (Business & User Value)

### 2.1 사용자 관점 (User Value)
* **실질적 금전 이익:** 결제 직전 매장 간판/메뉴판 촬영 한 번으로 소지 카드 중 **최대 할인(최저 결제금액) 카드**를 즉시 안내받아 연간 약 20만 원 이상의 혜택 복원.
* **실적 관리 스트레스 해소:** "어떤 카드 실적이 남아있지?" 고민할 필요 없이, 알고리즘이 **이번 달 실적 달성이 시급한 카드**를 자동으로 우선 코칭.

### 2.2 카드사/우리금융 관점 (Business Value)
* **지갑 점유율 이전 (Share Shift):** 신한·현대·삼성 등 타사 카드로 결제될 뻔한 내역을 우리카드로 전환하여 **우리카드 결제 승인액 및 M/S 증대**.
* **우리WON뱅킹 DAU/MAU 폭발:** 단순 자산 조회가 아닌 '결제 직전 매일 카메라를 켜는 습관'을 형성하여 **우리WON뱅킹 일일 방문자 수 및 체류 시간 증대**.
* **마이데이터 신규 가입 유도:** 마이데이터 미연동 유저에게 실적 정밀 계산 제약을 안내하여 **우리WON뱅킹 마이데이터 가입 기폭제로 활용**.

---

## 3. 핵심 알고리즘 및 추천 로직 (Core Algorithm)

### 3.1 3단계 정렬 규칙 (Sorting Rules)
매장 카테고리 및 예상 결제 금액이 입력되었을 때, 보유 카드를 아래 3단계 정렬 기준에 따라 다변화 평가합니다.

1. **1순위 (최대 혜택):** `최종 결제 금액 (원금 - 할인액)` **오름차순** (사용자가 실제로 지불하는 금액이 가장 작은 카드)
2. **2순위 (실적 시급도):** 1순위 금액이 동일할 경우, `실적 달성까지 남은 금액 (목표 실적 - 현재 실적)` **내림차순** (이번 달 실적을 채우는 게 더 시급한 카드)
3. **3순위 (자사 우대):** 결제액과 실적 시급도까지 동일할 경우, `우리카드 여부` **우선**

### 3.2 핵심 추천 엔진 코드 (Logic Flow)
```javascript
function recommendBestCard(cards, category, estimatedPrice) {
  return cards.map(card => {
    const rule = card.benefit_rules[category] || { discount_rate: 0, max_discount_per_txn: 0 };
    
    // 건당 한도 및 월 잔여 한도 계산
    let calculatedDiscount = estimatedPrice * rule.discount_rate;
    calculatedDiscount = Math.min(calculatedDiscount, rule.max_discount_per_txn);
    calculatedDiscount = Math.min(calculatedDiscount, card.monthly_discount_limit_remaining);

    const finalPayment = estimatedPrice - calculatedDiscount;
    const urgencyScore = Math.max(0, card.target_spend - card.current_spend);

    return { ...card, calculatedDiscount, finalPayment, urgencyScore };
  }).sort((a, b) => {
    if (a.finalPayment !== b.finalPayment) return a.finalPayment - b.finalPayment; // 1순위
    if (a.urgencyScore !== b.urgencyScore) return b.urgencyScore - a.urgencyScore; // 2순위
    return (b.is_woori ? 1 : 0) - (a.is_woori ? 1 : 0);                            // 3순위
  });
}
```

---

## 4. 3일 해커톤 구현 요소 (MVP Scope)

### 4.1 AI & OCR 파이프라인 (AI Engine)
* **간판/메뉴판 OCR:** Google Vision API 또는 OpenCV/Tesseract를 활용한 매장 상호명 텍스트 추출.
* **버거/음식 이미지 추론 (멀티모달 뻥카/시연용):** 글씨가 모호한 경우 버거 이미지를 파싱해 "버거킹" 카테고리를 추론하는 예외 처리 스토리텔링.
* **GPS 위치 연동:** 모호한 영문 간판(예: 'Aurore') 촬영 시 GPS 반경 30m 내 카카오/네이버 지도 API 매장 매칭.

### 4.2 디테일 예외 처리 UX (Fallbacks & Security)
1. **인식 결과 직접 수정 UI:** OCR 오인식 시 사용자가 매장명을 수동 검색/수정할 수 있는 2차 화면.
2. **2차 후보 매장 선택 팝업:** 상호명이 모호할 때 "근처 '카페 오로르'가 맞나요?" 후보 칩(Chip) 노출.
3. **보안 강화 마스킹 (Security):** 카드 실적 등록 시 카드 번호/CVV는 스캔하지 않고 표기 시 **자동 마스킹(***) 처리**됨을 안내.
4. **마이데이터 연동 유도 팝업:** 미연동 유저에게 "마이데이터 연동 시 실적 부족액까지 고려한 정밀 코칭이 가능합니다" 안내.

### 4.3 목업 데이터 구축 (Mock Data)
* `user_wallet.json`: 보유 카드 3종, 카드별 현재 실적, 목표 실적, 잔여 할인 한도.
* `merchants.json`: 스타벅스, 카페 오로르(영문 예외), 버거킹(이미지 추론) GPS 및 키워드 데이터.
* `card_benefits.json`: 업종별(CAFE, FASTFOOD 등) 카드 할인율 및 한도 데이터.

---

## 5. 팀원 역할 분담 (R&R)

* **기획 · PM (1명):** Lean Canvas 작성, 발표자료(PDF) 및 1분 영상 제작, 1/2차 현직자 멘토링 주도.
* **AI · 데이터 (1명):** Vision OCR 연동, 가맹점/업종 파싱, 목업 데이터(JSON) 구축 및 알고리즘 개발.
* **프론트엔드 (1~2명):** 카메라 촬영/업로드 UI, 추천 결과 팝업, 예외 처리 팝업(수정/후보선택/마이데이터) 구현.
* **백엔드 · 통합 (1명):** API 통신 연결, GitHub 저장소 관리, 기술 멘토링 대응 및 시연 테스트.

---

## 6. 심사 기준 및 발표 피칭 포인트

1. **문제 정의 (25점):** 편리함이 아닌 "실적 미달성으로 매달 버려지는 20만 원의 손실"로 문제의 심각성 어필.
2. **AI 활용 적절성 (25점):** 단순 DB 검색이 아닌 **[OCR 텍스트 + 이미지 + GPS 위치]**를 멀티모달로 결합한 당위성 제시.
3. **구현 완성도 (25점):** 오인식 수정 화면 및 예외 처리 UI를 시연에서 직접 보여주며 현장 대응 완성도 입증.
4. **실현 가능성 및 보안 (15점):** 우리카드 결제 점유율(M/S) 확대 + 카드 번호 마스킹 보안 정책 명시.
5. **발표 & 협업 (10점):** 팀원 전체 역할 분담 명시 및 동작하는 MVP 시연 연출.
