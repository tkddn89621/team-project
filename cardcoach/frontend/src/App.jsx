import { useEffect, useRef, useState } from "react";
import { API, recognize, getBrands, getCards, getRecommendations, postSelection, getPosition, resetDemo, refreshMydata } from "./api.js";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
// 40000 → "4만 원", 15000 → "1.5만 원", 8000 → "8천 원"
const shortWon = (n) => (n >= 10000 ? `${n / 10000}만 원` : n % 1000 === 0 ? `${n / 1000}천 원` : won(n));
// 금액 구간 표시 (서버는 1천 원 단위): "4만 원 미만", "4만 원 ~ 5만 원", "5만 원 이상"
function rangeLabel(s) {
  const end = s.to == null ? null : s.to + 1000;
  if (end == null) return s.from ? `${shortWon(s.from)} 이상` : "금액 상관없이";
  return s.from ? `${shortWon(s.from)} ~ ${shortWon(end)}` : `${shortWon(end)} 미만`;
}
// 카드 이름 끝 글자의 받침: 0 없음, 8 ㄹ, 그 밖 있음. 괄호 안 영문 표기는 빼고 판단, 영문 끝 L·M·N은 받침으로 봄
function jongOf(name) {
  const base = name.replace(/\([^)]*\)\s*$/, "").trim() || name;
  const ch = base[base.length - 1];
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) return code % 28;
  return /[MN]/i.test(ch) ? 1 : /L/i.test(ch) ? 8 : 0;
}
const ro = (name) => { const j = jongOf(name); return j && j !== 8 ? "으로" : "로"; };   // 로/으로
const eul = (name) => (jongOf(name) ? "을" : "를");                                      // 을/를

/* ---------------- 아이콘 ---------------- */
const CameraIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
  </svg>
);
const ChevronIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B95A1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const BackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
  </svg>
);
const AlbumIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" />
  </svg>
);
const HomeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z" /></svg>
);
const CardIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" />
  </svg>
);

/* 업종코드(data/benefits/taxonomy.json) → 이모지. 로고가 없는 가게는 업종 이모지로 보여줌 */
const INDUSTRY_EMOJI = {
  "FD-REST": "🍚", "FD-FAST": "🍔", "FD-FAMILY": "🍽️", "FD-BAKERY": "🥐", "FD-SNACK": "🍢", "FD-CAFE": "☕", "FD-BAR": "🍺",
  "RT-CVS": "🏪", "RT-MART": "🛒", "RT-WAREHOUSE": "📦", "RT-SSM": "🧺", "RT-DEPT": "🏬", "RT-OUTLET": "🛍️",
  "RT-DUTYFREE": "🛂", "RT-HB": "💄", "RT-LIVING": "🧴", "RT-BOOK": "📚", "RT-FASHION": "👕", "RT-OPTICAL": "👓",
  "RT-LIQUOR": "🍷", "RT-PET": "🐾", "RT-MARKET": "🥬", "RT-PX": "🎖️",
  "HL-HOSP": "🏥", "HL-PHARM": "💊", "HL-VET": "🐶",
  "LS-CINEMA": "🎬", "LS-THEME": "🎢", "LS-SPORTS": "🏋️", "LS-GOLF": "⛳", "LS-PCROOM": "🖥️", "LS-KARAOKE": "🎤", "LS-TICKET": "🎟️",
  "SV-HAIR": "💇", "SV-LAUNDRY": "👔", "SV-EDU": "📝", "SV-STUDY": "📖", "SV-EXAM": "✏️",
  "TR-FUEL": "⛽", "TR-LPG": "🔥", "TR-EV": "🔌", "TR-PARK": "🅿️", "TR-CARCARE": "🧽", "TR-CARSHARE": "🚗", "TR-TAXI": "🚕",
  "TV-HOTEL": "🏨", "TV-AGENCY": "🧳", "TV-AIR": "✈️",
};

/* 브랜드 로고. backend/logos/ 파일이나 공식 사이트 아이콘이 있으면 로고, 없거나 못 불러오면 업종 이모지 */
function BrandMark({ name, logo, code, size = 44 }) {
  const [broken, setBroken] = useState(false);
  const [wide, setWide] = useState(false); // 가로로 긴 글자 로고(CU·GS25·세븐일레븐)는 가로형 배지로
  if (logo && !broken) {
    const style = wide
      ? { width: Math.round(size * 1.75), height: size, borderRadius: 10, padding: "6px 7px" }
      : { width: size, height: size };
    return (
      <img className="brandmark logo" src={logo.startsWith("http") ? logo : API + encodeURI(logo)} alt={name}
           style={style} onError={() => setBroken(true)}
           onLoad={(e) => {
             const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
             if (w < 32) setBroken(true); // 너무 작은 아이콘은 흐려서 이니셜로
             else if (w / h > 1.4) setWide(true);
           }} />
    );
  }
  return (
    <div className="brandmark emoji" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
         role="img" aria-label={name}>
      {INDUSTRY_EMOJI[code] || "🏷️"}
    </div>
  );
}

function CardThumb({ color }) {
  return <div className="cardthumb" style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }} />;
}

/* 이번 달 실적 진행 바. 타사 카드는 마이데이터 미연동이면 알 수 없음 */
const man = (n) => (n == null ? "?" : `${(n / 10000).toLocaleString("ko-KR")}만`); // 한도 정보가 없는 카드 상품은 ?

/* 실적 구간·한도 + 다음 달 코칭. 이번 달 구간은 지난달 실적, 다음 달 구간은 이번 달 실적으로 정해짐 */
function SpendBar({ card, compact = false }) {
  if (!card.target_spend) return <div className="spend unknown">실적 조건 없음</div>;
  if (!card.spend_known) return <div className="spend unknown">지난달·이번 달 실적 확인 불가 · 마이데이터 연동 필요</div>;
  const tiers = card.tiers || [];
  const met = card.eligibility === "met";
  const t = card.tier_index;
  const nx = card.next_tier_index;
  const up = card.upgrade_gap != null ? (nx == null ? 0 : nx + 1) : null; // 다음 목표 구간 index
  const goal = up != null ? tiers[up].min_spend : (tiers.length ? tiers[tiers.length - 1].min_spend : card.target_spend);
  const pct = Math.min(100, (card.current_spend / goal) * 100);
  const name = (i) => (tiers.length > 1 ? `${i + 1}구간` : "혜택");

  let coach;
  if (up == null) coach = <> · 다음 달 {tiers.length > 1 ? "최고 구간" : "혜택"} 확보</>;
  else if (t != null && up === t) coach = <b> · {won(card.upgrade_gap)} 더 쓰면 다음 달도 {name(t)} 유지 (한도 {won(card.upgrade_limit)})</b>;
  else if (nx == null) coach = <b> · {won(card.upgrade_gap)} 더 쓰면 다음 달 {name(up)} (한도 {won(card.upgrade_limit)})</b>;
  else coach = <> · {won(card.upgrade_gap)} 더 쓰면 다음 달 {name(up)} (한도 {won(card.upgrade_limit)}로 ↑)</>;

  if (compact) {
    return (
      <div className="spend">
        <div className="bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="sub">
          이번 달 실적 {man(card.current_spend)}{card.spend_estimated && "(추정)"}
          {card.upgrade_gap ? ` · 다음 달 혜택까지 ${man(card.upgrade_gap)} 남음` : " · 다음 달 혜택 확보"}
        </div>
      </div>
    );
  }

  return (
    <div className="spend">
      <div className="sub" style={{ color: met ? undefined : "#E53935" }}>
        지난달 {won(card.prev_spend)} →{" "}
        {met
          ? <>{tiers.length > 1 ? `${name(t)}(${man(tiers[t].min_spend)}↑)` : "혜택 받는 중"} · 이번 달 한도 {won(card.monthly_discount_limit)}</>
          : <b>실적 미달({man(card.target_spend)}원 필요), 이번 달 혜택 없음</b>}
      </div>
      {tiers.length > 1 && (
        <div className="sub">구간: {tiers.map((x) => `${man(x.min_spend)}↑ 한도 ${man(x.monthly_limit)}`).join(" · ")}</div>
      )}
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <div className="sub">
        이번 달 {won(card.current_spend)}{card.spend_estimated && "(추정)"}{coach}
      </div>
      {card.spend_estimated && <div className="sub hint">마이데이터 승인내역으로 계산한 추정 실적이에요 (실적 제외 항목은 카드사 확정 때 빠질 수 있어요)</div>}
      {met && nx != null && nx < t && (
        <div className="sub" style={{ color: "#E07B00" }}>지금대로면 다음 달 {name(nx)}(한도 {won(tiers[nx].monthly_limit)})로 내려가요</div>
      )}
      {met && nx == null && (
        <div className="sub" style={{ color: "#E07B00" }}>지금대로면 다음 달 혜택이 없어져요</div>
      )}
    </div>
  );
}

/* 마이데이터 연동 행 — 홈·추천·내 카드 공통 */
function MydataRow({ onLink }) {
  return (
    <section className="hcard hrow">
      <div className="grow">
        <div className="rowtitle">다른 카드사 카드도 비교할까요?</div>
        <div className="sub">마이데이터로 가진 카드를 모두 불러와요</div>
      </div>
      <button className="hbtn accent" onClick={onLink}>연동</button>
    </section>
  );
}

/* 하단 탭바 — 홈·내 카드 공통 */
function TabBar({ active, onHome, onWallet }) {
  return (
    <nav className="tabbar" aria-label="하단 메뉴">
      <button className={active === "home" ? "on" : ""} aria-current={active === "home" ? "page" : undefined} onClick={onHome}>
        <HomeIcon />홈
      </button>
      <button className={active === "wallet" ? "on" : ""} aria-current={active === "wallet" ? "page" : undefined} onClick={onWallet}>
        <CardIcon />내 카드
      </button>
    </nav>
  );
}

function MydataModal({ onLink, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="title">다른 카드도 함께 비교할까요?</div>
        <p className="body">
          지금은 <b>우리카드만</b> 보고 추천했어요. 마이데이터를 연동하면 다른 카드사 카드를
          지난달 실적·남은 한도와 함께 불러와서, <b>이 결제에 가장 이득인 카드</b>를 찾아드려요.
        </p>
        <div className="btnrow">
          <button className="btn ghost" onClick={onClose}>나중에</button>
          <button className="btn primary" onClick={onLink}>마이데이터 연동하기</button>
        </div>
      </div>
    </div>
  );
}

/* 후보 칩/시트에 보여줄 근거 */
function sourceNote(c) {
  if (c.distance_m != null) return `근처 ${c.distance_m}m`;
  if (c.source === "image") return "사진 추정";
  if (c.source === "ai") return "AI 추정";
  return null;
}

/* ---------------- 결제 기록 (이 기기에만 저장 · 홈의 '아낀 돈'과 '최근 확인한 가맹점'에 사용) ---------------- */
const HISTORY_KEY = "history";
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function addHistory(item) {
  const list = [item, ...loadHistory()].slice(0, 200);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* 저장 못 해도 결제 흐름은 계속 */ }
}
function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* 없으면 그만 */ }
}

/* 시연용 '계산대에서 낸 타사 카드 결제'. 추천 화면에서 타사 카드를 고르고 나가면 기억해 두고,
   마이데이터 새로고침 때 카드사 승인내역이 온 것처럼 보냄 (실서비스에선 카드사가 보내는 데이터) */
const PENDING_KEY = "pendingApprovals";
function loadPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; }
}
function addPending(item) {
  // 같은 가게·카드를 다시 보고 나가도 결제 1건으로 (마지막 금액 기준)
  const rest = loadPending().filter((p) => !(p.brand_id === item.brand_id && p.card_id === item.card_id));
  try { localStorage.setItem(PENDING_KEY, JSON.stringify([...rest, item])); } catch { /* 못 남기면 반영 안 됨 */ }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* 없으면 그만 */ }
}

/* 마이데이터 새로고침 행 + 결과 창 — 홈·내 카드 공통. 연동했을 때만 */
function MydataRefresh({ onRefreshed }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // 받아온 승인내역 목록

  async function refresh() {
    setBusy(true);
    try {
      const pending = loadPending();
      const r = await refreshMydata(pending.map(({ brand_id, card_id, amount }) => ({ brand_id, card_id, amount })));
      clearPending();
      for (const a of r.approvals) {
        addHistory({ brand_id: a.brand.brand_id, name: a.brand.name, logo_url: a.brand.logo_url, category: a.brand.category,
                     industry_code: a.brand.industry_code, card_name: a.card.name, benefit: a.discount, at: Date.now() });
      }
      setResult(r.approvals);
      onRefreshed?.();
    } catch {
      setResult([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hcard hrow">
        <div className="grow">
          <div className="rowtitle">마이데이터 연동 중</div>
          <div className="sub">다른 카드사 카드로 결제했다면 새로고침해서 실적에 반영해요</div>
        </div>
        <button className="hbtn" disabled={busy} onClick={refresh}>{busy ? "불러오는 중" : "새로고침"}</button>
      </section>

      {result && (
        <div className="modal" onClick={() => setResult(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="title">{result.length ? `새 결제 ${result.length}건을 불러왔어요` : "새 결제 내역이 없어요"}</div>
            {result.map((a) => (
              <div key={a.selection_id} className="approval">
                <div className="row">
                  <BrandMark name={a.brand.name} logo={a.brand.logo_url} code={a.brand.industry_code} size={40} />
                  <div className="grow">
                    <div className="listname">{a.brand.name}</div>
                    <div className="sub">{a.card.name} · {won(a.amount)} 승인</div>
                  </div>
                </div>
                <div className="kv">
                  <div><span>할인 (추정)</span><b className="accent">-{won(a.discount)}</b></div>
                  <div><span>이번 달 실적 (추정)</span><b>{won(a.before.current_spend)} → {won(a.card.current_spend)}</b></div>
                  <div>
                    <span>다음 달 혜택까지</span>
                    <b>{a.card.upgrade_gap ? `${won(a.card.upgrade_gap)} 남음` : "최고 구간 확보"}</b>
                  </div>
                </div>
              </div>
            ))}
            {result.length > 0 && <div className="sub">{result[0].source}</div>}
            <button className="btn primary big modal-cta" onClick={() => setResult(null)}>확인</button>
          </div>
        </div>
      )}
    </>
  );
}

/* 다음 달 혜택이 가장 많이 걸린 카드 (실적을 아는 카드 중) — 홈·내 카드의 월말 경고 */
function mostAtRisk(cards) {
  return (cards || [])
    .filter((c) => c.spend_known && c.upgrade_gap > 0 && c.at_stake > 0)
    .sort((a, b) => b.at_stake - a.at_stake || a.upgrade_gap - b.upgrade_gap)[0];
}

/* 월말 경고: 제목은 걸린 금액, 보조 글은 카드·남은 실적·남은 일수만 (한눈에 읽히게) */
function RiskNote({ card }) {
  return (
    <>
      <div className="rowtitle">다음 달 혜택 {won(card.at_stake)}이 걸려 있어요</div>
      <div className="sub">{card.name} · {won(card.upgrade_gap)} 더 써야 해요 · {card.days_left}일 남음</div>
    </>
  );
}

/* ---------------- ⓪ 홈 (HOME) ---------------- */
function HomeScreen({ mydata, onLinkMydata, onScan, onWallet, onOpenBrand }) {
  const [history, setHistory] = useState(loadHistory);
  const [cards, setCards] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { getCards(mydata).then(setCards).catch(() => setCards([])); }, [mydata, reloadKey]);
  const risk = mostAtRisk(cards);
  const now = new Date();
  const saved = history
    .filter((h) => { const d = new Date(h.at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); })
    .reduce((sum, h) => sum + (h.benefit || 0), 0);

  const recent = [];
  const seen = new Set();
  for (const h of history) {
    if (seen.has(h.brand_id)) continue;
    seen.add(h.brand_id);
    recent.push(h);
    if (recent.length === 3) break;
  }

  return (
    <div className="screen home">
      <header className="navbar"><div className="navtitle">카드 코치</div></header>
      <div className="home-body">
        <section className="hcard hero-card">
          <div className="hero-title">계산하기 전에<br />간판부터 찍어보세요</div>
          <div className="sub">내 카드 중 혜택이 가장 큰 카드를 알려드려요</div>
          <button className="btn primary big scanbtn" onClick={onScan}><CameraIcon /> 간판 찍기</button>
        </section>

        <section className="hcard hrow">
          <div className="grow">
            <div className="amount">{won(saved)}</div>
            <div className="sub">{saved > 0 ? `${now.getMonth() + 1}월에 추천대로 결제해서 아낀 돈` : "추천 카드로 결제하면 아낀 돈이 여기에 쌓여요"}</div>
          </div>
        </section>

        {risk && (
          <button className="hcard hrow riskcard" onClick={onWallet}>
            <div className="grow">
              <RiskNote card={risk} />
            </div>
            <ChevronIcon />
          </button>
        )}

        {mydata
          ? <MydataRefresh onRefreshed={() => { setHistory(loadHistory()); setReloadKey((k) => k + 1); }} />
          : <MydataRow onLink={onLinkMydata} />}

        {recent.length > 0 && (
          <section className="hcard list">
            <div className="rowtitle">최근 확인한 가맹점</div>
            {recent.map((h) => (
              <button key={h.brand_id} className="listrow" onClick={() => onOpenBrand(h)}>
                <BrandMark name={h.name} logo={h.logo_url} code={h.industry_code} size={40} />
                <div className="grow">
                  <div className="listname">{h.name}</div>
                  <div className="sub">{[h.card_name, h.benefit ? `${won(h.benefit)} 할인` : null].filter(Boolean).join(" · ")}</div>
                </div>
                <ChevronIcon />
              </button>
            ))}
          </section>
        )}
      </div>

      <TabBar active="home" onWallet={onWallet} />
    </div>
  );
}

/* 화면의 네모 틀이 실제 카메라 영상(픽셀)의 어디인지. 영상은 object-fit: cover 라 잘려 보이는 만큼 보정.
   틀보다 사방 margin 만큼 넓게 (간판 끝이 틀에 걸려도 잘리지 않게) */
function frameCrop(v, frameEl, margin = 0.15) {
  const W = v.videoWidth, H = v.videoHeight;
  if (!frameEl) return { x: 0, y: 0, w: W, h: H };
  const vr = v.getBoundingClientRect();
  const fr = frameEl.getBoundingClientRect();
  const scale = Math.max(vr.width / W, vr.height / H);       // 화면 px / 영상 px
  const offX = (W * scale - vr.width) / 2, offY = (H * scale - vr.height) / 2;
  const mx = fr.width * margin, my = fr.height * margin;
  const x0 = Math.max(0, (fr.left - mx - vr.left + offX) / scale);
  const y0 = Math.max(0, (fr.top - my - vr.top + offY) / scale);
  const x1 = Math.min(W, (fr.right + mx - vr.left + offX) / scale);
  const y1 = Math.min(H, (fr.bottom + my - vr.top + offY) / scale);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/* ---------------- ① 가맹점 인식 (FIND) — 앱 안 카메라 ---------------- */
function FindScreen({ onConfirm, onBack }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureRef = useRef(null); // 카메라를 못 쓸 때: 기본 카메라 앱으로 찍기
  const albumRef = useRef(null);   // 앨범에서 고르기
  const frameRef = useRef(null);   // 화면의 네모 틀 → 이 영역만 잘라서 인식
  const posRef = useRef(null);
  const [cam, setCam] = useState("starting"); // starting | live | off
  const [preview, setPreview] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | loading | result | fail
  const [rec, setRec] = useState(null);
  const [brands, setBrands] = useState([]);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getBrands().then(setBrands).catch(() => {});
    posRef.current = getPosition(); // 촬영 전에 미리 위치 요청
  }, []);

  /* 화면에 들어오면 후면 카메라를 켜고, 나가면 끈다. HTTPS 또는 localhost에서만 동작 */
  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCam("off"); return; }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCam("live");
      })
      .catch(() => { if (!cancelled) setCam("off"); });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function analyze(file, previewUrl) {
    setPreview(previewUrl || URL.createObjectURL(file));
    setPhase("loading");
    try {
      const r = await recognize(file, await posRef.current);
      setRec(r);
      if (r.status === "not_found" || r.candidates.length === 0) { setPhase("fail"); return; }
      if (r.auto_confirm) { onConfirm(r.candidates[0], r.recognition_id); return; }
      setPhase("result");
    } catch {
      setPhase("fail");
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) analyze(file);
  }

  /* 셔터: 라이브 화면에서 네모 안(+여유)만 잘라 인식 요청 → 틀 밖 노트북·배경에 끌려가지 않게.
     미리보기는 전체 장면. 카메라를 못 쓰면 기본 카메라 앱으로 (그땐 전체 사진) */
  function shoot() {
    const v = videoRef.current;
    if (cam !== "live" || !v?.videoWidth) { captureRef.current.click(); return; }
    const full = document.createElement("canvas");
    full.width = v.videoWidth;
    full.height = v.videoHeight;
    full.getContext("2d").drawImage(v, 0, 0);

    const c = frameCrop(v, frameRef.current);
    const crop = document.createElement("canvas");
    crop.width = c.w;
    crop.height = c.h;
    crop.getContext("2d").drawImage(full, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    crop.toBlob((blob) => {
      if (blob) analyze(new File([blob], "shot.jpg", { type: "image/jpeg" }), full.toDataURL("image/jpeg", 0.7));
    }, "image/jpeg", 0.92);
  }

  function retake() {
    setPreview(null);
    setRec(null);
    setPhase("idle");
    if (cam !== "live") captureRef.current.click();
  }

  function openPicker() {
    setQuery("");
    setPicker(true);
  }

  const top = rec?.candidates?.[0];
  const q = query.trim().toLowerCase();
  const shown = q ? brands.filter((b) => b.name.toLowerCase().includes(q) || b.category.includes(q)) : brands;

  return (
    <div className="screen find">
      <div className="findbar">
        <button className="iconbtn light" onClick={onBack} aria-label="홈으로"><BackIcon /></button>
        <button className="searchfield" onClick={openPicker}>
          <SearchIcon /><span>찍기 어려우면 가게 이름으로 검색</span>
        </button>
      </div>

      <div className="camera" style={preview ? { backgroundImage: `url(${preview})` } : undefined}>
        <video ref={videoRef} className="camfeed" autoPlay playsInline muted
               style={{ visibility: cam === "live" && !preview ? "visible" : "hidden" }} />
        {!preview && (
          <div className="camera-hint">
            <div className="frame" ref={frameRef} />
            <p>
              {cam === "off"
                ? <>카메라를 바로 켤 수 없어요<br />셔터를 누르면 사진을 찍을 수 있어요</>
                : <>간판이나 로고가<br />네모 안에 들어오게 찍어주세요</>}
            </p>
          </div>
        )}
        {phase === "loading" && (
          <div className="overlay">
            <div className="spinner" />
            <p>가맹점을 찾는 중…</p>
          </div>
        )}
      </div>

      {phase === "result" && top && top.source === "ai_category" && (
        /* 업종만 알 때 (예: 껌 → 편의점): 하나를 짐작하지 않고 그 업종 매장 중에서 고르게 함 */
        <div className="sheet">
          <div className="row">
            <BrandMark name={top.category} code={top.industry_code} />
            <div className="grow">
              <div className="title">{top.category}에서 찍으셨나요?</div>
              <div className="sub">
                AI 판단: {top.ai_reason}
                {top.none_nearby ? ` · 근처 50m에는 ${top.category} 매장이 없어요. 어느 매장인지 골라 주세요` : " · 어느 매장인지 골라 주세요"}
              </div>
            </div>
          </div>
          {/* 대부분은 여기서 매장을 고름 → 크게. 다시 찍기·검색은 가끔 → 작게 */}
          <div className="tiles choices">
            {rec.candidates.map((c) => (
              <button key={c.brand_id} className="tile big" onClick={() => onConfirm(c, rec.recognition_id)}>
                <BrandMark name={c.name} logo={c.logo_url} code={c.industry_code} size={32} />
                <span className="grow">
                  <span className="tilename">{c.name}</span>
                  {c.distance_m != null && <span className="tilesub">근처 {c.distance_m}m</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="textlinks">
            <button onClick={retake}>다시 찍기</button>
            <button onClick={openPicker}>다른 가게 검색</button>
          </div>
        </div>
      )}

      {phase === "result" && top && top.source !== "ai_category" && (
        <div className="sheet">
          <div className="row">
            <BrandMark name={top.name} logo={top.logo_url} code={top.industry_code} />
            <div className="grow">
              {top.source === "ai" ? (
                <>
                  <div className="title">'{top.name}'에서 찍으셨나요?</div>
                  <div className="sub">
                    AI 판단: {top.ai_reason}
                    {top.distance_m != null && ` · 근처 ${top.distance_m}m`}
                  </div>
                </>
              ) : top.source === "gps" ? (
                <>
                  <div className="title">근처 '{top.name}'가 맞나요?</div>
                  <div className="sub">간판 글씨로는 확실하지 않아 현재 위치({top.distance_m}m)로 찾았어요</div>
                </>
              ) : top.source === "image" ? (
                <>
                  <div className="title">'{top.name}' 같아요</div>
                  <div className="sub">간판 대신 사진 속 음식·사물로 {top.category} 업종을 추정했어요</div>
                </>
              ) : (
                <>
                  <div className="title">{top.name}</div>
                  <div className="sub">
                    {top.category} · 신뢰도 {Math.round(top.confidence * 100)}%
                    {top.distance_m != null && ` · 근처 ${top.distance_m}m`}
                  </div>
                </>
              )}
            </div>
          </div>
          {rec.candidates.length > 1 && (
            <div className="cands">
              {rec.candidates.slice(1).map((c) => (
                <button key={c.brand_id} className="chip" onClick={() => onConfirm(c, rec.recognition_id)}>
                  {c.name}{sourceNote(c) && <span className="chipnote"> · {sourceNote(c)}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="btnrow">
            <button className="btn ghost" onClick={retake}>다시 찍기</button>
            <button className="btn primary" onClick={() => onConfirm(top, rec.recognition_id)}>맞아요</button>
          </div>
        </div>
      )}

      {phase === "fail" && (
        <div className="sheet">
          <div className="title">가맹점을 찾지 못했어요</div>
          <div className="sub">다시 찍거나 매장 이름을 직접 검색해 주세요</div>
          <div className="btnrow">
            <button className="btn ghost" onClick={openPicker}>직접 검색</button>
            <button className="btn primary" onClick={retake}>다시 찍기</button>
          </div>
        </div>
      )}

      {(phase === "idle" || phase === "loading") && (
        <div className="shutterbar">
          <div className="shutterhint">내 카드 중 가장 유리한 카드를 알려드려요</div>
          <div className="shutterrow">
            <button className="albumbtn" onClick={() => albumRef.current.click()} aria-label="앨범에서 사진 고르기"><AlbumIcon /></button>
            <button className="shutter" disabled={phase === "loading"} onClick={shoot} aria-label="촬영" />
            <span className="albumspacer" />
          </div>
        </div>
      )}

      <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={albumRef} type="file" accept="image/*" hidden onChange={onFile} />

      {picker && (
        <div className="modal" onClick={() => setPicker(false)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="title">가맹점 검색</div>
            <input className="search" autoFocus placeholder="매장 이름 또는 업종 (예: 오로르, 카페)"
                   value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="tiles">
              {shown.map((b) => (
                <button key={b.brand_id} className="tile" onClick={() => { setPicker(false); onConfirm(b, rec?.recognition_id ?? null); }}>
                  <BrandMark name={b.name} logo={b.logo_url} code={b.industry_code} size={32} />
                  <span className="tilename">{b.name}</span>
                </button>
              ))}
            </div>
            {shown.length === 0 && <div className="sub empty">검색 결과가 없어요</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- ② 최대 혜택 추천 (REC) ---------------- */
function RecScreen({ brand, recognitionId, mydata, onLinkMydata, askMydata, onMydataAsked, onBack, onDone }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("all"); // all | woori
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [showAmount, setShowAmount] = useState(false); // 금액 입력은 선택: 열어야 보임
  const [toast, setToast] = useState("");
  const [paid, setPaid] = useState(null); // 결제 반영 결과

  useEffect(() => {
    const amt = amount ? Number(amount) : undefined;
    getRecommendations(brand.brand_id, amt, mydata).then((d) => {
      setData(d);
      setSelected(d.best_card_id); // 조건이 바뀌면 다시 최선 카드로
    });
  }, [brand.brand_id, amount, mydata]);

  if (!data) return <div className="screen page-bg center"><div className="spinner dark" /></div>;

  const list = data.cards.filter((c) => (tab === "woori" ? c.is_woori : true));
  const wooriCount = data.cards.filter((c) => c.is_woori).length;

  const chosen = data.cards.find((c) => c.card_id === selected);
  const exact = data.amount != null; // 금액을 넣었으면 정확한 할인액, 아니면 금액 구간으로 안내
  const bestCard = data.cards.find((c) => c.card_id === data.best_card_id);
  const segs = (data.ranges || []).filter((s) => s.card_id);
  const showRanges = !exact && (segs.length > 1 || (segs[0] && segs[0].from > 0));

  /* 타사 카드를 고른 채 나가면: 계산대에서 그 카드 실물로 냈다고 보고 기억 → 마이데이터 새로고침 때 승인내역으로 들어옴 */
  function leave() {
    if (chosen && !chosen.is_woori) {
      addPending({ brand_id: brand.brand_id, card_id: chosen.card_id, amount: amount ? Number(amount) : null, at: Date.now() });
    }
    onBack();
  }

  /* 앱이 결제하는 건 아님: 고른 카드로 결제했다고 반영 → 실적·사용 한도가 바로 바뀜 (우리카드 승인 / 타사는 마이데이터) */
  async function choose(method) {
    let r;
    try {
      r = await postSelection({ recognition_id: recognitionId, brand_id: brand.brand_id, card_id: selected,
                                expected_amount: amount ? Number(amount) : null, mydata, method });
    } catch {
      setToast("반영하지 못했어요. 다시 시도해 주세요");
      setTimeout(() => setToast(""), 1500);
      return;
    }
    addHistory({
      brand_id: brand.brand_id,
      name: data.brand.name,
      logo_url: data.brand.logo_url,
      category: data.brand.category,
      industry_code: data.brand.industry_code,
      card_name: r.card.name,
      benefit: r.discount,
      at: Date.now(),
    });
    setPaid(r);
  }

  return (
    <div className="screen page-bg rec">
      <header className="navbar">
        <button className="iconbtn" onClick={leave} aria-label="뒤로"><BackIcon /></button>
        <div className="navtitle">카드 추천</div>
      </header>

      <div className="page">
        <section className="hcard hero-card">
          <div className="row">
            <BrandMark name={data.brand.name} logo={data.brand.logo_url} code={data.brand.industry_code} size={48} />
            <div className="grow">
              <div className="rowtitle">{data.brand.name}</div>
              <div className="sub">{data.brand.category} · {data.hour}시 결제 기준</div>
            </div>
          </div>
          {!bestCard ? (
            <div className="hero-title rec-title">{data.message}</div>
          ) : (
            <>
              <div className="hero-title rec-title"><span className="accent">{bestCard.name}</span>{ro(bestCard.name)} 결제하세요</div>
              {!exact && data.ranges_tip && <div className="sub rec-tip">{data.ranges_tip}</div>}
              {exact && <div className="sub rec-tip">{won(data.amount)} 결제하면 {won(bestCard.expected_benefit)} 아껴요</div>}
            </>
          )}

          {showRanges && (
            <div className="ranges">
              {data.ranges.map((s) => (
                <div key={s.from} className={`range ${s.card_id ? "" : "none"}`}>
                  <span className="range-amt">{rangeLabel(s)}</span>
                  <span className="range-card">{s.name || "할인 없음"}</span>
                  <span className="range-max">{s.card_id && s.max_benefit ? `최대 ${won(s.max_benefit)}` : ""}</span>
                </div>
              ))}
            </div>
          )}

          {showAmount || amount ? (
            <label className="field">
              <span className="field-label">결제 금액</span>
              <span className="field-box">
                <input autoFocus inputMode="numeric" placeholder="10,000"
                       value={amount ? Number(amount).toLocaleString("ko-KR") : ""}
                       onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
                <span>원</span>
              </span>
            </label>
          ) : (
            <button className="amount-link" onClick={() => setShowAmount(true)}>결제 금액을 알면 정확히 계산해요 ›</button>
          )}
        </section>

        {!mydata && <MydataRow onLink={onLinkMydata} />}

        {data.coach && (
          <section className="hcard hrow coachcard">
            <div className="grow">
              <div className="rowtitle">다음 달 혜택 지키기</div>
              <div className="sub"><b>{data.coach.name}</b> · {data.coach.message}</div>
            </div>
            <button className={`hbtn ${selected === data.coach.card_id ? "" : "accent"}`}
                    onClick={() => setSelected(data.coach.card_id)}>
              {selected === data.coach.card_id ? "선택됨" : "이 카드로"}
            </button>
          </section>
        )}

        <section className="hcard list">
          <div className="list-head">
            <div>
              <div className="rowtitle">내 카드 추천 순</div>
              {mydata && <div className="sub">마이데이터 연동 · 다른 카드사 카드까지 비교 중</div>}
            </div>
            <div className="seg">
              <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>전체 {data.cards.length}</button>
              <button className={tab === "woori" ? "on" : ""} onClick={() => setTab("woori")}>우리카드 {wooriCount}</button>
            </div>
          </div>

          {list.map((c) => {
            const best = c.card_id === data.best_card_id;
            const usable = c.expected_benefit > 0;
            const on = selected === c.card_id;
            return (
              <button key={c.card_id} className={`cardopt ${on ? "on" : ""} ${!usable ? "none" : ""}`}
                      onClick={() => usable && setSelected(c.card_id)}>
                {best && (
                  <div className="bestline">
                    <span className="badge">가장 큰 혜택</span>
                    {data.best_reason && <span className="reason">{data.best_reason}</span>}
                  </div>
                )}
                <div className="row top">
                  <CardThumb color={c.color} />
                  <div className="grow">
                    <div className="cardname">{c.name} {c.is_woori && <span className="pill">우리</span>}</div>
                    {/* 혜택은 고른 카드만 펼쳐서 보여줌. 혜택 없는 카드는 못 고르니 이유만 한 줄 */}
                    {(on || !usable) && <div className={`rate ${best ? "accent" : ""}`}>{c.rate_label}</div>}
                  </div>
                  {on && (
                    <div className="optright">
                      {exact && <div className="save">-{won(c.expected_benefit)}</div>}
                      {!exact && c.benefit_ceiling != null && <div className="save">최대 {won(c.benefit_ceiling)}</div>}
                    </div>
                  )}
                </div>
                {on && <div className="optbody">
                  {c.blocked_reason && c.benefit_label && <div className="sub">원래 혜택: {c.benefit_label}</div>}
                  {c.benefit_note && <div className="sub clamp1">{c.benefit_note}</div>}
                  {usable && exact && (
                    <div className="sub">
                      결제 예상 <b>{won(c.final_payment)}</b>
                      {c.limited_by_monthly && " · 월 한도 남은 만큼만"}
                    </div>
                  )}
                  {c.has_benefit && !c.blocked_reason && (
                    <div className="sub">
                      {c.max_per_txn ? `건당 최대 ${won(c.max_per_txn)} · ` : ""}
                      {c.limit_unlimited ? "할인 한도 없음" : <>이번 달 남은 한도 {won(c.monthly_remaining)}{!c.spend_known && "(추정)"}</>}
                    </div>
                  )}
                  <SpendBar card={c} compact />
                </div>}
              </button>
            );
          })}
        </section>
      </div>

      {/* 우리카드는 우리페이로 결제가 기본, 계산대 실물 카드는 보조.
          다른 카드사 카드는 우리페이로 결제할 수 없어서(오픈페이 미지원) 버튼 없이 안내만 */}
      <div className="cta">
        {chosen && !chosen.is_woori ? (
          <div className="cta-note">다른 카드사 카드는 우리페이로 결제할 수 없어요 · 계산대에서 실물 카드로 결제한 뒤 마이데이터를 새로고침하면 실적에 반영돼요</div>
        ) : (
          <div className="btnrow cta-row">
            <button className="btn ghost" disabled={!selected} onClick={() => choose("card")}>실물 카드로</button>
            <button className="btn primary" disabled={!selected} onClick={() => choose("pay")}>우리페이로 결제하기</button>
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
      {paid && (
        <div className="modal">
          <div className="modal-body">
            <div className="row">
              <BrandMark name={data.brand.name} logo={data.brand.logo_url} code={data.brand.industry_code} size={44} />
              <div className="grow">
                <div className="sub">{data.brand.name} · {paid.card.name}</div>
                <div className="paid-amount">{paid.discount > 0 ? `${won(paid.discount)} 아꼈어요` : "결제가 반영됐어요"}</div>
              </div>
            </div>
            <div className="kv">
              <div><span>결제 금액</span><b>{won(paid.amount)}</b></div>
              <div><span>할인</span><b className="accent">-{won(paid.discount)}</b></div>
              <div><span>실제 낸 돈</span><b>{won(paid.paid)}</b></div>
              <div><span>이번 달 실적</span><b>{won(paid.before.current_spend)} → {won(paid.card.current_spend)}</b></div>
              <div>
                <span>다음 달 혜택까지</span>
                <b>{paid.card.upgrade_gap ? `${won(paid.card.upgrade_gap)} 남음` : "최고 구간 확보"}</b>
              </div>
              {!paid.card.limit_unlimited && (
                <div><span>이번 달 남은 할인 한도</span><b>{won(paid.card.monthly_remaining)}</b></div>
              )}
            </div>
            <div className="sub">{paid.source}</div>
            {!amount && <div className="sub">금액을 넣지 않아서 시연용으로 {won(paid.amount)}을 결제했다고 가정했어요 (실제로는 가게 단말기 금액)</div>}
            <button className="btn primary big modal-cta" onClick={onDone}>확인</button>
          </div>
        </div>
      )}
      {askMydata && !mydata && (
        <MydataModal onLink={() => { onMydataAsked(); onLinkMydata(); }} onClose={onMydataAsked} />
      )}
    </div>
  );
}

/* ---------------- ③ 내 카드 · 실적 관리 (WALLET) ---------------- */
function WalletScreen({ mydata, onLinkMydata, onResetMydata, onBack }) {
  const [cards, setCards] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { getCards(mydata).then(setCards).catch(() => setCards([])); }, [mydata, reloadKey]);

  const urgent = mostAtRisk(cards);

  /* 시연을 여러 번 찍을 수 있게: 실적·한도·결제 기록, 홈의 '아낀 돈', 마이데이터 연동까지 처음 상태로 */
  async function reset() {
    if (!window.confirm("시연 데이터를 처음 상태로 되돌릴까요? (실적·한도·결제 기록 초기화, 마이데이터 연동 해제)")) return;
    await resetDemo();
    clearHistory();
    clearPending();
    onResetMydata();
    setCards(null);
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="screen page-bg wallet">
      <header className="navbar"><div className="navtitle">내 카드</div></header>
      <div className="page">

        {urgent && (
          <section className="hcard hrow riskcard">
            <div className="grow">
              <RiskNote card={urgent} />
            </div>
          </section>
        )}

        {mydata
          ? <MydataRefresh onRefreshed={() => setReloadKey((k) => k + 1)} />
          : <MydataRow onLink={onLinkMydata} />}

        {!cards ? (
          <div className="center pad-y"><div className="spinner dark" /></div>
        ) : (
          cards.map((c) => (
            <section key={c.card_id} className="hcard walletcard">
              <div className="row">
                <CardThumb color={c.color} />
                <div className="grow">
                  <div className="cardname">{c.name} {c.is_woori && <span className="pill">우리</span>}</div>
                  <div className="sub mono">{c.masked_number}</div>
                </div>
              </div>
              {c.eligibility !== "unmet" && (
                <div className="limitline">
                  <span>이번 달 남은 할인 한도</span>
                  <b>{c.limit_unlimited ? "한도 없음" : `${won(c.monthly_remaining)}`}</b>
                </div>
              )}
              <SpendBar card={c} />
            </section>
          ))
        )}
        <button className="resetbtn" onClick={reset}>시연 데이터 처음으로</button>
      </div>
      <TabBar active="wallet" onHome={onBack} />
    </div>
  );
}

/* 마이데이터 연동 여부는 이 기기에만 기억 (시연용 목업 연동) */
function loadMydata() {
  try { return localStorage.getItem("mydata") === "1"; } catch { return false; }
}
function saveMydata() {
  try { localStorage.setItem("mydata", "1"); } catch { /* 저장 못 해도 이번 세션은 연동 상태 */ }
}
function clearMydata() {
  try { localStorage.removeItem("mydata"); } catch { /* 없으면 그만 */ }
}

/* ---------------- App ---------------- */
export default function App() {
  const [screen, setScreen] = useState("home");
  const [brand, setBrand] = useState(null);
  const [recId, setRecId] = useState(null);
  const [recBack, setRecBack] = useState("find"); // 추천 화면에서 뒤로 갈 곳
  const [mydata, setMydata] = useState(loadMydata);
  const [mydataAsked, setMydataAsked] = useState(false); // 연동 유도 팝업은 세션당 한 번만

  function linkMydata() {
    saveMydata();
    setMydata(true);
  }

  /* 시연 초기화: 연동 해제 + 연동 유도 팝업도 다시 뜨게 */
  function resetMydata() {
    clearMydata();
    setMydata(false);
    setMydataAsked(false);
  }

  return (
    <div className="phone">
      {screen === "home" && (
        <HomeScreen mydata={mydata} onLinkMydata={linkMydata}
                    onScan={() => setScreen("find")}
                    onWallet={() => setScreen("wallet")}
                    onOpenBrand={(b) => { setBrand(b); setRecId(null); setRecBack("home"); setScreen("rec"); }} />
      )}
      {screen === "find" && (
        <FindScreen onConfirm={(b, id) => { setBrand(b); setRecId(id); setRecBack("find"); setScreen("rec"); }}
                    onBack={() => setScreen("home")} />
      )}
      {screen === "rec" && brand && (
        <RecScreen brand={brand} recognitionId={recId} mydata={mydata} onLinkMydata={linkMydata}
                   askMydata={!mydataAsked} onMydataAsked={() => setMydataAsked(true)}
                   onBack={() => setScreen(recBack)} onDone={() => setScreen("home")} />
      )}
      {screen === "wallet" && (
        <WalletScreen mydata={mydata} onLinkMydata={linkMydata} onResetMydata={resetMydata} onBack={() => setScreen("home")} />
      )}
    </div>
  );
}
