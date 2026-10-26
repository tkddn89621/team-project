export const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function recognize(file) {
  const fd = new FormData();
  fd.append("image", file, file.name || "photo.jpg");
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

export async function getRecommendations(brandId, amount) {
  const q = new URLSearchParams({ brand_id: brandId });
  if (amount) q.set("amount", amount);
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
