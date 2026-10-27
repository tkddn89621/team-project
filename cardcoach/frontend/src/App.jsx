import { useEffect, useRef, useState } from "react";
import { API, recognize, getBrands, getCards, getRecommendations, postSelection, getPosition, resetDemo, refreshMydata, getCardDetail, getBenefitsByCategory } from "./api.js";

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
function BrandMark({ name, logo, code, size = 44, square = false }) {
  const [broken, setBroken] = useState(false);
  const [wide, setWide] = useState(false); // 가로로 긴 글자 로고(CU·GS25·세븐일레븐)는 가로형 배지로
  if (logo && !broken) {
    const style = wide && !square   // square: 목록 줄 맞춤용 (가로 로고도 원 안에)
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

/* 카드 썸네일: frontend/public/cards/카드상품id.png 가 있으면 실제 카드 이미지(세로), 없으면 카드 색 */
function CardThumb({ color, product }) {
  const [broken, setBroken] = useState(false);
  if (product && !broken) {
    return <img className="cardthumb img" src={`/cards/${product}.png`} alt="" onError={() => setBroken(true)} />;
  }
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

/* 마이데이터 새로고침: 타사 카드 새 승인내역을 받아 반영. 결과는 ApprovalsModal 로 보여줌 */
async function fetchApprovals() {
  const pending = loadPending();
  const r = await refreshMydata(pending.map(({ brand_id, card_id, amount }) => ({ brand_id, card_id, amount })));
  clearPending();
  for (const a of r.approvals) {
    addHistory({ brand_id: a.brand.brand_id, name: a.brand.name, logo_url: a.brand.logo_url, category: a.brand.category,
                 industry_code: a.brand.industry_code, card_name: a.card.name, benefit: a.discount, at: Date.now() });
  }
  return r.approvals;
}

function ApprovalsModal({ approvals, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="title">{approvals.length ? `새 결제 ${approvals.length}건을 불러왔어요` : "새 결제 내역이 없어요"}</div>
        {approvals.map((a) => (
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
        {approvals.length > 0 && <div className="sub">{approvals[0].source}</div>}
        <button className="btn primary big modal-cta" onClick={onClose}>확인</button>
      </div>
    </div>
  );
}

/* 마이데이터 새로고침 행 — 내 카드 화면. 연동했을 때만 */
function MydataRefreshRow({ busy, onRefresh }) {
  return (
    <section className="hcard hrow">
      <div className="grow">
        <div className="rowtitle">마이데이터 연동 중</div>
        <div className="sub">다른 카드사 카드로 결제했다면 새로고침해서 실적에 반영해요</div>
      </div>
      <button className="hbtn" disabled={busy} onClick={onRefresh}>{busy ? "불러오는 중" : "새로고침"}</button>
    </section>
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

/* 우리 WON 로고 모양 (홈 스캔 원 가운데) */
function WonMark() {
  return (
    <svg className="wonmark" viewBox="0 0 160 120" aria-label="WON">
      <defs>
        <linearGradient id="wonL" x1="0" x2="1"><stop offset="0" stopColor="#C7D4FA" /><stop offset="1" stopColor="#A9BCF4" /></linearGradient>
        <linearGradient id="wonR" x1="0" x2="1"><stop offset="0" stopColor="#8EA3F0" /><stop offset="1" stopColor="#6F88E6" /></linearGradient>
        <linearGradient id="wonT" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#8FA4F0" /><stop offset="1" stopColor="#6C84E3" /></linearGradient>
      </defs>
      <rect x="22" y="14" width="78" height="44" rx="22" fill="url(#wonL)" />
      <circle cx="104" cy="36" r="27" fill="url(#wonR)" />
      <text x="80" y="108" textAnchor="middle" fontSize="40" fontWeight="800" letterSpacing="2" fill="url(#wonT)">WON</text>
    </svg>
  );
}

/* 대표카드: 이 기기에만 기억 (없으면 첫 카드) */
const MAIN_CARD_KEY = "mainCard";
function loadMainCard() {
  try { return Number(localStorage.getItem(MAIN_CARD_KEY)) || null; } catch { return null; }
}
function saveMainCard(id) {
  try { localStorage.setItem(MAIN_CARD_KEY, String(id)); } catch { /* 이번 세션만 */ }
}

/* 큰 카드 이미지 (없으면 카드 색) */
function CardArt({ card, className = "" }) {
  const [broken, setBroken] = useState(false);
  if (card.product_id && !broken) {
    return <img className={`cardart ${className}`} src={`/cards/${card.product_id}.png`} alt={card.name} onError={() => setBroken(true)} />;
  }
  return <div className={`cardart ${className}`} style={{ background: `linear-gradient(135deg, ${card.color}, ${card.color}99)` }} />;
}

/* 이번 달 실적 한 덩어리: 금액 / 목표 · 막대 · 안내 (대표카드 칸, 전체 카드 목록 공통) */
function SpendSummary({ card }) {
  if (!card.target_spend) return <div className="sub">실적 조건이 없는 카드예요</div>;
  if (!card.spend_known) return <div className="sub">마이데이터를 연동하면 실적을 볼 수 있어요</div>;
  const { goal } = spendGoal(card);
  const pct = goal ? Math.min(100, Math.round((card.current_spend / goal) * 100)) : 0;
  return (
    <>
      <div className="sumline">
        <b>{won(card.current_spend)}</b>
        <span className="goal"> / {won(goal)}</span>
        {card.spend_estimated && <span className="pill gray">추정</span>}
        <span className="pct">{pct}%</span>
      </div>
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <div className="sub tipline">
        {card.upgrade_gap ? <><b>{won(card.upgrade_gap)}</b> 더 쓰면 다음 달 혜택 유지 · {card.days_left}일 남음</> : "다음 달 혜택 확보"}
      </div>
    </>
  );
}

/* 아래 시트: 접혀 있으면 대표카드, 위로 끌어 올리면 내 카드 전체의 전월·이번 달 실적 */
const SHEET_PEEK = 176;   // 접혔을 때 보이는 높이 (탭바 위)
const SHEET_TOP = 72;     // 펼쳤을 때 화면 위 여백
const TABBAR_H = 82;

function CardsSheet({ cards, mydata, onLinkMydata, onWallet }) {
  const [mainId, setMainId] = useState(loadMainCard);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(null);          // 끄는 중의 위치(px). null이면 open 상태대로
  const [height, setHeight] = useState(() => window.innerHeight - TABBAR_H - SHEET_TOP);
  const start = useRef(null);

  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight - TABBAR_H - SHEET_TOP);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const closedY = Math.max(0, height - SHEET_PEEK);  // 접힘 = 시트를 이만큼 아래로 내림
  const y = drag ?? (open ? 0 : closedY);

  /* 끌기: 손가락·마우스 모두 (pointer events). 놓을 때 빠르게 튕겼거나 절반을 넘었으면 그쪽으로 */
  function onDown(e) {
    start.current = { y: e.clientY, base: y, t: Date.now(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dy) > 4) start.current.moved = true;
    setDrag(Math.min(closedY, Math.max(0, start.current.base + dy)));
  }
  function onUp(e) {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) { setDrag(null); setOpen((o) => !o); return; }   // 톡 누르면 열고 닫기
    const dy = e.clientY - s.y;
    const speed = dy / Math.max(1, Date.now() - s.t);               // px/ms, 위로 튕기면 음수
    const pos = Math.min(closedY, Math.max(0, s.base + dy));
    setOpen(speed < -0.4 ? true : speed > 0.4 ? false : pos < closedY / 2);
    setDrag(null);
  }

  if (!cards || !cards.length) return null;
  const main = cards.find((c) => c.card_id === mainId) || cards[0];
  const pickMain = (id) => { setMainId(id); saveMainCard(id); };

  return (
    <>
      {open && <div className="sheet-dim" onClick={() => setOpen(false)} />}
      <section className={`cardsheet ${drag != null ? "dragging" : ""}`}
               style={{ height, transform: `translateY(${y}px)` }} aria-expanded={open}>
        {/* 끄는 손잡이 + 대표카드 (이 부분을 잡고 올리고 내림) */}
        <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="handle" />
          <div className="sheet-title">
            <span>{open ? "내 카드 실적 한눈에" : "대표카드"}</span>
            {open && <span className="sub">{cards.length}장</span>}
          </div>
          {!open && (
            <div className="maincard">
              <CardArt card={main} />
              <div className="grow">
                <div className="cardname clamp1">{main.name} {main.is_woori && <span className="pill">우리</span>}</div>
                <SpendSummary card={main} />
              </div>
            </div>
          )}
        </div>

        {/* 펼쳤을 때: 카드마다 지난달 → 이번 달 실적 */}
        <div className="sheet-body">
          {cards.map((c) => {
            const isMain = c.card_id === main.card_id;
            return (
              <div key={c.card_id} className="allcard">
                <div className="allcard-head">
                  <CardThumb color={c.color} product={c.product_id} />
                  <div className="grow">
                    <div className="cardname clamp1">{c.name} {c.is_woori && <span className="pill">우리</span>}</div>
                    <div className="sub">
                      {!c.spend_known ? "실적 확인 불가"
                        : c.eligibility === "unmet" ? <span className="warn">지난달 {won(c.prev_spend)} · 실적 미달</span>
                        : <>지난달 {won(c.prev_spend)} · 이번 달 혜택 받는 중</>}
                    </div>
                  </div>
                  {isMain ? <span className="mainbadge">대표</span>
                    : <button className="hbtn" onClick={() => pickMain(c.card_id)}>대표로</button>}
                </div>
                <SpendSummary card={c} />
              </div>
            );
          })}
          {!mydata && <MydataRow onLink={onLinkMydata} />}
          <button className="btn ghost big sheet-more" onClick={onWallet}>카드별 혜택 자세히 보기</button>
        </div>
      </section>
    </>
  );
}

function HomeScreen({ mydata, onLinkMydata, onScan, onWallet }) {
  const [cards, setCards] = useState(null);
  useEffect(() => { getCards(mydata).then(setCards).catch(() => setCards([])); }, [mydata]);
  // 홈에 있는 동안 페이지 자체를 고정 (아이폰은 스크롤할 게 없어도 페이지 전체가 튕겨서 배경이 움직임). 시트 목록만 스크롤
  useEffect(() => {
    document.documentElement.classList.add("lock");
    return () => document.documentElement.classList.remove("lock");
  }, []);

  return (
    <div className="screen home2">
      <header className="home2-top">
        <span className="appmark" aria-hidden><ScanIcon /></span>
        <span className="apptitle">WON픽</span>
      </header>

      <div className="home2-hero">
        <button className="scanorb" onClick={onScan} aria-label="간판 찍고 혜택 찾기">
          <span className="ring r1" /><span className="ring r2" />
          <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
          <WonMark />
        </button>
        <div className="home2-actions">
          <button className="camcircle" onClick={onScan} aria-label="카메라"><CameraIcon size={22} /></button>
          <button className="btn primary scanbtn findbtn" onClick={onScan}>혜택 찾기</button>
        </div>
        <div className="home2-hint">계산하기 전에 간판을 찍으면 혜택이 가장 큰 카드를 알려드려요</div>
      </div>

      <CardsSheet cards={cards} mydata={mydata} onLinkMydata={onLinkMydata} onWallet={onWallet} />
      <TabBar active="home" onWallet={onWallet} />
    </div>
  );
}

const ScanIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M8 12h8" />
  </svg>
);

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
      // 조건이 바뀌면 다시 최선 카드로. 할인되는 카드가 없으면 실적 채우기 좋은 우리카드 → 아무 우리카드 → 첫 카드
      setSelected(d.best_card_id ?? d.fill?.card_id ?? (d.cards.find((c) => c.is_woori) || d.cards[0])?.card_id ?? null);
    });
  }, [brand.brand_id, amount, mydata]);

  if (!data) return <div className="screen page-bg center"><div className="spinner dark" /></div>;

  const list = data.cards.filter((c) => (tab === "woori" ? c.is_woori : true));
  if (data.fill) list.sort((a, b) => (b.card_id === data.fill.card_id) - (a.card_id === data.fill.card_id)); // 실적 채우기 카드를 맨 위로
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
              <div className="sub">{data.brand.category}{data.brand.category_estimated && " (추정)"} · {data.hour}시 결제 기준</div>
            </div>
          </div>
          {!bestCard ? (
            <>
              <div className="hero-title rec-title">{data.message}</div>
              {/* 할인은 0원이지만 다음 달 혜택에 도움 되는 카드 — '가장 큰 혜택'과 구분해서 안내 */}
              {data.fill && (
                <div className="sub rec-tip">결제는 <b>{data.fill.name}</b>{ro(data.fill.name)} 해서 실적을 채워요 · {data.fill.message}</div>
              )}
            </>
          ) : (
            <>
              <div className="hero-title rec-title"><span className="accent">{bestCard.name}</span>{ro(bestCard.name)} 결제하세요</div>
              {!exact && data.ranges_tip && <div className="sub rec-tip">{data.ranges_tip}</div>}
              {exact && <div className="sub rec-tip">{won(data.amount)} 결제하면 {won(bestCard.expected_benefit)} 아껴요</div>}
            </>
          )}

          {data.brand.category_estimated && (
            <div className="estnote">처음 보는 매장이라 가장 가까운 업종({data.brand.category})으로 계산했어요. 카드사에 등록된 업종에 따라 혜택이 다를 수 있어요</div>
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
            const fill = c.card_id === data.fill?.card_id;
            const usable = c.expected_benefit > 0;
            const on = selected === c.card_id;
            return (
              <button key={c.card_id} className={`cardopt ${on ? "on" : ""} ${!usable ? "none" : ""}`}
                      onClick={() => setSelected(c.card_id)}>
                {best && (
                  <div className="bestline">
                    <span className="badge">가장 큰 혜택</span>
                    {data.best_reason && <span className="reason">{data.best_reason}</span>}
                  </div>
                )}
                {fill && (
                  <div className="bestline">
                    <span className="badge fill">실적 채우기</span>
                    <span className="reason fill">할인은 없지만 다음 달 혜택에 도움돼요</span>
                  </div>
                )}
                <div className="row top">
                  <CardThumb color={c.color} product={c.product_id} />
                  <div className="grow">
                    <div className="cardname">{c.name} {c.is_woori && <span className="pill">우리</span>}</div>
                    {/* 혜택은 고른 카드만 펼쳐서 보여줌. 혜택 없는 카드는 이유를 한 줄 (혜택 없어도 결제·실적 반영은 가능) */}
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
          <div className="cta-note">다른 카드사 카드는 우리페이로 결제할 수 없어요 · 계산대에서 실물 카드로 결제한 뒤 내 카드에서 이 카드를 골라 새로고침하면 실적에 반영돼요</div>
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

/* 이번 달 실적 목표: 다음 달에 들어갈(유지·상승) 구간의 기준 금액 */
function spendGoal(card) {
  const tiers = card.tiers || [];
  const nx = card.next_tier_index;
  const up = card.upgrade_gap != null ? (nx == null ? 0 : nx + 1) : null;
  return { up, goal: up != null ? tiers[up].min_spend : (tiers.length ? tiers[tiers.length - 1].min_spend : card.target_spend) };
}

/* 실적 안내: "30,000원 더 사용하면 다음 달도 혜택(한도 15,000원)이 유지돼요" */
function spendTip(card) {
  const tiers = card.tiers || [];
  const t = card.tier_index;
  const { up } = spendGoal(card);
  const name = (i) => (tiers.length > 1 ? `${i + 1}구간` : "혜택");
  if (up == null) return <>다음 달 {tiers.length > 1 ? "최고 구간" : "혜택"}을 이미 확보했어요</>;
  const lim = card.upgrade_limit != null ? `(한도 ${won(card.upgrade_limit)})` : "";
  const what = t != null && up === t ? `다음 달도 ${name(up)}${lim}이 유지돼요`
    : card.next_tier_index == null ? `다음 달 ${name(up)}${lim}을 받아요`
    : `다음 달 ${name(up)}${lim}으로 올라가요`;
  return <><b>{won(card.upgrade_gap)}</b> 더 사용하면 {what}<br /><span className="tip-sub">이번 달 {card.days_left}일 남았어요</span></>;
}

/* 남은 혜택 한 줄: 브랜드 로고 · 혜택 · 남은 한도(또는 횟수) 막대 */
/* 남은 한도(또는 횟수) → 막대 비율과 글자 */
function leftInfo(b) {
  let pct = null, caption;
  if (b.blocked) caption = <span className="warn">{b.blocked}</span>;
  else if (b.count_limit) {
    const left = Math.max(0, b.count_limit - b.count_used);
    pct = (left / b.count_limit) * 100;
    caption = `${left}회 남음 / 월 ${b.count_limit}회`;
  } else if (b.limit != null) {
    pct = b.limit ? (b.remaining / b.limit) * 100 : 0;
    caption = `${won(b.remaining)} 남음 / ${won(b.limit)}`;
  } else caption = "한도 없음";
  return { pct, caption };
}

function LeftBar({ b }) {
  const { pct, caption } = leftInfo(b);
  return (
    <div className="leftbar">
      {pct != null && <div className="bar"><div style={{ width: `${pct}%` }} /></div>}
      <div className="cap">{caption}</div>
      {b.shared_group && !b.blocked && <div className="cap hint">{b.shared_group} 통합 한도</div>}
    </div>
  );
}

function BenefitLeftRow({ b }) {
  return (
    <div className="leftrow">
      <BrandMark name={b.logo_name} logo={b.logo_url} code={b.industry_code} size={44} square />
      <div className="grow">
        <div className="listname">{b.title}</div>
        <div className="sub">{b.rate_text}</div>
      </div>
      <LeftBar b={b} />
    </div>
  );
}

/* 업종 아이콘 아래 짧은 이름 (긴 업종명은 줄임) */
const SHORT_CATEGORY = {
  "FD-CAFE": "카페", "RT-CVS": "편의점", "RT-HB": "드럭스토어", "RT-LIVING": "생활용품", "FD-REST": "음식점",
  "RT-SSM": "슈퍼마켓", "RT-MART": "대형마트", "RT-DEPT": "백화점", "RT-OUTLET": "아울렛", "RT-WAREHOUSE": "창고형마트",
  "FD-FAST": "패스트푸드", "FD-BAR": "주점", "TR-FUEL": "주유소",
};
const shortCategory = (g) => SHORT_CATEGORY[g.code] || g.name.split(/[·(]/)[0];

/* 혜택별 모아보기: 위에 업종 아이콘을 가로로 늘어놓고, 누른 업종의 카드별 남은 혜택을 아래에 보여줌
   (받을 수 있는 혜택 먼저, 비율 높은 순) */
function BenefitsByCategory({ mydata, reloadKey }) {
  const [groups, setGroups] = useState(null);
  const [picked, setPicked] = useState(null);
  useEffect(() => { getBenefitsByCategory(mydata).then(setGroups).catch(() => setGroups([])); }, [mydata, reloadKey]);
  if (!groups) return <div className="center pad-y"><div className="spinner dark" /></div>;
  if (!groups.length) return <section className="hcard pad"><div className="sub">매장에서 받을 수 있는 혜택이 없어요</div></section>;
  const shortBrands = (list) => (list.length <= 2 ? list.join("·") : `${list.slice(0, 2).join("·")} 외 ${list.length - 2}곳`);
  const g = groups.find((x) => x.code === picked) || groups[0];

  return (
    <>
      <section className="hcard catpick">
        <div className="caticons">
          {groups.map((x) => (
            <button key={x.code} className={`caticon ${x.code === g.code ? "on" : ""}`} onClick={() => setPicked(x.code)}>
              <span className="catbox">{INDUSTRY_EMOJI[x.code] || "🏷️"}</span>
              <span className="catlabel">{shortCategory(x)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="hcard list">
        <div className="catdetail-head">
          <div className="rowtitle">{g.name}</div>
          <span className="sub">{g.cards > 1 ? `카드 ${g.cards}장 비교` : "카드 1장"}</span>
        </div>
        {g.items.map((x) => {
          const { pct, caption } = leftInfo(x);
          return (
            <div key={`${x.card_id}-${x.benefit_id}`} className="catitem">
              <div className="catline">
                <CardThumb color={x.color} product={x.product_id} />
                <div className="grow listname clamp1">{x.card_name}</div>
                <div className={`catrate ${x.blocked ? "off" : ""}`}>{x.rate_text}</div>
              </div>
              {x.brands.length > 0 && <div className="sub catbrands">{shortBrands(x.brands)}</div>}
              {pct != null && <div className="bar"><div style={{ width: `${pct}%` }} /></div>}
              <div className="catcap">
                <span>{caption}</span>
                {x.shared_group && !x.blocked && <span className="hint">{x.shared_group} 통합 한도</span>}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

function CardSheet({ cards, selected, onPick, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="title">카드 선택</div>
        <div className="sheetlist">
          {cards.map((c) => (
            <button key={c.card_id} className={`sheetrow ${c.card_id === selected ? "on" : ""}`} onClick={() => onPick(c.card_id)}>
              <CardThumb color={c.color} product={c.product_id} />
              <div className="grow">
                <div className="cardname">{c.name} {c.is_woori && <span className="pill">우리</span>}</div>
                <div className="sub mono">{c.masked_number}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WalletScreen({ mydata, onLinkMydata, onResetMydata, onBack }) {
  const [cards, setCards] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("spend"); // spend: 이번 달 실적 | history: 혜택 내역
  const [view, setView] = useState("card"); // card: 카드별 | benefit: 혜택별 모아보기
  const [sheet, setSheet] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [approvals, setApprovals] = useState(null); // 마이데이터 새로고침 결과
  const [busy, setBusy] = useState(false);

  useEffect(() => { getCards(mydata).then(setCards).catch(() => setCards([])); }, [mydata, reloadKey]);
  // 고른 카드가 목록에 없으면(연동 해제 등) 첫 카드로
  const current = cards?.find((c) => c.card_id === selected) || cards?.[0];
  useEffect(() => {
    if (!current) return;
    getCardDetail(current.card_id, mydata).then(setDetail).catch(() => setDetail(null));
  }, [current?.card_id, mydata, reloadKey]);

  /* 마이데이터 새로고침: 새 승인내역을 받아 반영하고 카드 정보 다시 */
  async function refresh() {
    setBusy(true);
    try { setApprovals(await fetchApprovals()); } catch { setApprovals([]); }
    setReloadKey((k) => k + 1);
    setBusy(false);
  }

  const urgent = mostAtRisk(cards);

  /* 시연을 여러 번 찍을 수 있게: 실적·한도·결제 기록, 홈의 '아낀 돈', 마이데이터 연동까지 처음 상태로 */
  async function reset() {
    if (!window.confirm("시연 데이터를 처음 상태로 되돌릴까요? (실적·한도·결제 기록 초기화, 마이데이터 연동 해제)")) return;
    await resetDemo();
    clearHistory();
    clearPending();
    onResetMydata();
    setCards(null);
    setDetail(null);
    setSelected(null);
    setReloadKey((k) => k + 1);
  }

  const card = detail && current && detail.card.card_id === current.card_id ? detail.card : null;
  const { goal } = card ? spendGoal(card) : { goal: 0 };
  const pct = card && goal ? Math.min(100, Math.round((card.current_spend / goal) * 100)) : 0;

  return (
    <div className="screen page-bg wallet">
      <header className="navbar"><div className="navtitle">내 카드</div></header>
      <div className="page">

        {urgent && (
          <button className="hcard hrow riskcard" onClick={() => { setSelected(urgent.card_id); setTab("spend"); }}>
            <div className="grow">
              <RiskNote card={urgent} />
            </div>
            <ChevronIcon />
          </button>
        )}

        {!mydata && <MydataRow onLink={onLinkMydata} />}

        <section className="hcard viewseg">
          <div className="seg">
            <button className={view === "card" ? "on" : ""} onClick={() => setView("card")}>카드별 모아보기</button>
            <button className={view === "benefit" ? "on" : ""} onClick={() => setView("benefit")}>혜택별 모아보기</button>
          </div>
        </section>

        {view === "benefit" ? (
          <BenefitsByCategory mydata={mydata} reloadKey={reloadKey} />
        ) : !current ? (
          <div className="center pad-y"><div className="spinner dark" /></div>
        ) : (
          <>
            <button className="hcard hrow cardpick" onClick={() => setSheet(true)}>
              <CardThumb color={current.color} product={current.product_id} />
              <div className="grow">
                <div className="cardname">{current.name} {current.is_woori && <span className="pill">우리</span>}</div>
                <div className="sub mono">{current.masked_number}</div>
              </div>
              <ChevronIcon />
            </button>

            {/* 타사 카드: 실물 카드 결제는 마이데이터 새로고침으로 들어옴 */}
            {mydata && !current.is_woori && <MydataRefreshRow busy={busy} onRefresh={refresh} />}

            <section className="hcard wtabs">
              <button className={tab === "spend" ? "on" : ""} onClick={() => setTab("spend")}>이번 달 실적</button>
              <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>혜택 내역</button>
            </section>

            {!card ? (
              <div className="center pad-y"><div className="spinner dark" /></div>
            ) : tab === "spend" ? (
              <>
                <section className="hcard pad">
                  <div className="rowtitle">이번 달 사용 실적{card.spend_estimated && <span className="pill gray">추정</span>}</div>
                  {!card.target_spend ? (
                    <div className="sub">실적 조건이 없는 카드예요</div>
                  ) : (
                    <>
                      <div className="spendline">
                        <span className="spend-now">{won(card.current_spend)}</span>
                        <span className="spend-goal">/ {won(goal)}</span>
                        <span className="spend-pct">{pct}%</span>
                      </div>
                      <div className="bar big"><div style={{ width: `${pct}%` }} /></div>
                      <div className="tipbox">
                        <span className="tip-icon" aria-hidden>🏆</span>
                        <div>{spendTip(card)}</div>
                      </div>
                      <div className="sub prevline">
                        {card.eligibility === "unmet"
                          ? <span className="warn">지난달 {won(card.prev_spend)} · 실적 미달로 이번 달 혜택이 없어요</span>
                          : <>지난달 {won(card.prev_spend)} → 이번 달 할인 한도 {card.limit_unlimited ? "없음" : `${won(card.monthly_discount_limit)} 중 ${won(card.monthly_remaining)} 남음`}</>}
                      </div>
                      {card.spend_estimated && <div className="sub hint">마이데이터 승인내역으로 계산한 추정 실적이에요 (실적 제외 항목은 카드사 확정 때 빠질 수 있어요)</div>}
                    </>
                  )}
                </section>

                <section className="hcard list">
                  <div className="rowtitle">이번 달 남은 혜택</div>
                  {detail.benefits.length === 0 && <div className="sub">매장에서 받을 수 있는 혜택이 없어요</div>}
                  {detail.benefits.map((b) => <BenefitLeftRow key={b.benefit_id} b={b} />)}
                </section>
              </>
            ) : (
              <section className="hcard list">
                <div className="rowtitle">이번 달 결제</div>
                {detail.history.length === 0 && <div className="sub">이번 달 이 카드로 결제한 내역이 없어요</div>}
                {detail.history.map((h) => {
                  const d = new Date(h.at);
                  return (
                    <div key={h.id} className="leftrow">
                      <BrandMark name={h.brand} logo={h.logo_url} code={h.industry_code} size={44} square />
                      <div className="grow">
                        <div className="listname">{h.brand}</div>
                        <div className="sub">{d.getMonth() + 1}월 {d.getDate()}일 · {won(h.amount)} 결제</div>
                      </div>
                      <div className={`histamt ${h.discount ? "" : "zero"}`}>{h.discount ? `-${won(h.discount)}` : "혜택 없음"}</div>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}
        <button className="resetbtn" onClick={reset}>시연 데이터 처음으로</button>
      </div>
      {sheet && cards && (
        <CardSheet cards={cards} selected={current?.card_id}
                   onPick={(id) => { setSelected(id); setSheet(false); }} onClose={() => setSheet(false)} />
      )}
      {approvals && <ApprovalsModal approvals={approvals} onClose={() => setApprovals(null)} />}
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
