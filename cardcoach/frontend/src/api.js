// 기본값: 화면을 연 주소와 같은 PC의 8000번 (PC=localhost, 폰=PC IP). IP가 바뀌어도 .env 수정 불필요
export const API = import.meta.env.VITE_API_URL || `http://${location.hostname}:8000`;

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

export async function getBrands() {
  const r = await fetch(`${API}/brands`);
  return r.json();
}

export async function getCards(mydata) {
  const r = await fetch(`${API}/cards?mydata=${!!mydata}`);
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

export async function postSelection(body) {
  const r = await fetch(`${API}/selections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
