// 기본값: 같은 개발 서버의 /api → vite.config.js 프록시가 PC의 백엔드(8000)로 전달
// (https 페이지에서 http 백엔드를 직접 부르면 막히기 때문. IP가 바뀌어도 .env 수정 불필요)
export const API = import.meta.env.VITE_API_URL || "/api";

/* 현재 위치. VITE_DEMO_GPS="위도,경도"가 있으면 그 값(시연용), 없으면 브라우저 GPS. 실패하면 null */
export function getPosition() {
  const demo = import.meta.env.VITE_DEMO_GPS;
  if (demo) {
    const [lat, lng] = demo.split(",").map(Number);
    return Promise.resolve({ lat, lng });
  }
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 3000, maximumAge: 60000 },
    ),
  );
}

export async function recognize(file, pos) {
  const fd = new FormData();
  fd.append("image", file, file.name || "photo.jpg");
  if (pos) {
    fd.append("lat", pos.lat);
    fd.append("lng", pos.lng);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000); // 문서: 15초 초과 → 다시 찍기/수동 선택
  try {
    const r = await fetch(`${API}/recognitions`, { method: "POST", body: fd, signal: ctrl.signal });
    if (!r.ok) throw new Error("인식 요청 실패");
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

/* 매장 확정 기록 (관리자 화면용). 실패해도 사용자 흐름은 그대로라 기다리지 않음 */
export function confirmRecognition(recognitionId, brandId) {
  fetch(`${API}/recognitions/${recognitionId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brand_id: brandId }),
  }).catch(() => {});
}

export async function getBrands() {
  const r = await fetch(`${API}/brands`);
  return r.json();
}

export async function getCards(mydata) {
  const r = await fetch(`${API}/cards?mydata=${!!mydata}`);
  return r.json();
}

/* 혜택별 모아보기: 업종마다 내 카드들의 이번 달 남은 혜택 */
export async function getBenefitsByCategory(mydata) {
  const r = await fetch(`${API}/benefits/by-category?mydata=${!!mydata}`);
  if (!r.ok) throw new Error("혜택을 불러오지 못했어요");
  return r.json();
}

/* 내 카드 상세: 카드 상태 + 이번 달 남은 혜택 + 이번 달 결제 기록 */
export async function getCardDetail(cardId, mydata) {
  const r = await fetch(`${API}/cards/${cardId}/detail?mydata=${!!mydata}`);
  if (!r.ok) throw new Error("카드 정보를 불러오지 못했어요");
  return r.json();
}

export async function getRecommendations(brandId, amount, mydata) {
  const q = new URLSearchParams({ brand_id: brandId, mydata: !!mydata });
  if (amount) q.set("amount", amount);
  // 시연용 결제 시각. 비우면 서버가 지금(한국 시간) 기준 → 신한 카페 할인은 07~15시에만 보임
  const demoHour = import.meta.env.VITE_DEMO_HOUR;
  if (demoHour) q.set("hour", demoHour);
  const r = await fetch(`${API}/recommendations?${q}`);
  return r.json();
}

/* 고른 카드로 결제했다고 반영 → 실적·사용 한도가 바뀐 카드 상태를 돌려줌 (추천과 같은 시각 기준) */
export async function postSelection(body) {
  const demoHour = import.meta.env.VITE_DEMO_HOUR;
  const r = await fetch(`${API}/selections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, hour: demoHour ? Number(demoHour) : null }),
  });
  if (!r.ok) throw new Error("결제 반영 실패");
  return r.json();
}

/* 마이데이터 새로고침: 타사 카드 새 승인내역을 실적에 반영.
   시연에선 계산대에서 실물 카드로 냈다고 기억해 둔 결제(approvals)를 승인내역 대신 보냄 */
export async function refreshMydata(approvals) {
  const r = await fetch(`${API}/mydata/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvals }),
  });
  if (!r.ok) throw new Error("마이데이터 새로고침 실패");
  return r.json();
}

/* 시연 데이터 처음으로 (실적·한도·결제 기록 초기화) */
export async function resetDemo() {
  const r = await fetch(`${API}/demo/reset`, { method: "POST" });
  return r.json();
}
