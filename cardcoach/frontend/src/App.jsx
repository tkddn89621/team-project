import { useEffect, useRef, useState } from "react";
import { recognize, getBrands, getCards, getRecommendations, postSelection, getPosition } from "./api.js";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";

/* 브랜드 로고 이미지가 없을 때 쓰는 이니셜 배지 */
function BrandMark({ name, size = 44 }) {
  const palette = ["#2F6BFF", "#FF7A1A", "#00A862", "#8E44AD", "#E53935", "#0097A7"];
  const c = palette[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % palette.length];
  return (
    <div className="brandmark" style={{ width: size, height: size, background: c, fontSize: size * 0.4 }}>
      {name.slice(0, 2)}
    </div>
  );
}

function CardThumb({ color }) {
  return <div className="cardthumb" style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }} />;
}

/* 이번 달 실적 진행 바. 타사 카드는 마이데이터 미연동이면 알 수 없음 */
function SpendBar({ card }) {
  if (!card.spend_known) return <div className="spend unknown">실적 확인 불가 · 마이데이터 연동 필요</div>;
  const pct = card.target_spend ? Math.min(100, (card.current_spend / card.target_spend) * 100) : 100;
  return (
    <div className="spend">
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <div className="sub">
        실적 {won(card.current_spend)} / {won(card.target_spend)}
        {card.spend_gap > 0 ? <b> · {won(card.spend_gap)} 남음</b> : " · 달성"}
      </div>
    </div>
  );
}

function MydataBanner({ linked, onLink }) {
  if (linked) return <div className="mydata on">✓ 마이데이터 연동됨 · 타사 카드 실적·한도까지 반영 중</div>;
  return (
    <div className="mydata">
      <span>마이데이터 연동 시 실적 부족액까지 고려한 정밀 코칭이 가능합니다</span>
      <button onClick={onLink}>연동하기</button>
    </div>
  );
}

function MydataModal({ onLink, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="title">타사 카드 실적, 아직 모르고 있어요</div>
        <p className="body">
          마이데이터를 연동하면 신한·삼성 등 다른 카드의 이번 달 실적과 남은 할인 한도까지 반영해서
          <b> 실적 부족액까지 고려한 정밀 코칭</b>이 가능합니다.
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
  return null;
}

/* ---------------- ① 가맹점 인식 (FIND) ---------------- */
function FindScreen({ onConfirm, onWallet }) {
  const inputRef = useRef(null);
  const posRef = useRef(null);
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

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setPhase("loading");
    try {
      const r = await recognize(file, await posRef.current);
      setRec(r);
      if (r.status === "not_found" || r.candidates.length === 0) { setPhase("fail"); return; }
      if (r.auto_confirm) { onConfirm(r.candidates[0], r.recognition_id); return; }
      setPhase("result");
    } catch {
      setPhase("fail");
    } finally {
      e.target.value = "";
    }
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
      <div className="camera" style={preview ? { backgroundImage: `url(${preview})` } : undefined}>
        <button className="walletbtn" onClick={onWallet}>내 카드 · 실적</button>
        {!preview && (
          <div className="camera-hint">
            <div className="frame" />
            <p>간판이나 로고가 프레임 안에<br />들어오도록 찍어주세요</p>
          </div>
        )}
        {phase === "loading" && (
          <div className="overlay">
            <div className="spinner" />
            <p>가맹점을 찾는 중…</p>
          </div>
        )}
      </div>

      {phase === "result" && top && (
        <div className="sheet">
          <div className="row">
            <BrandMark name={top.name} />
            <div className="grow">
              {top.source === "gps" ? (
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
            <button className="btn ghost" onClick={openPicker}>직접 검색</button>
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
            <button className="btn primary" onClick={() => inputRef.current.click()}>다시 찍기</button>
          </div>
        </div>
      )}

      {(phase === "idle" || phase === "loading") && (
        <div className="shutterbar">
          <button className="textbtn" onClick={openPicker}>직접 검색</button>
          <button className="shutter" disabled={phase === "loading"} onClick={() => inputRef.current.click()} aria-label="촬영" />
          <span className="textbtn muted">사진</span>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {picker && (
        <div className="modal" onClick={() => setPicker(false)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="title">가맹점 검색</div>
            <input className="search" autoFocus placeholder="매장 이름 또는 업종 (예: 오로르, 카페)"
                   value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="grid">
              {shown.map((b) => (
                <button key={b.brand_id} className="gridcell" onClick={() => { setPicker(false); onConfirm(b, rec?.recognition_id ?? null); }}>
                  <BrandMark name={b.name} size={40} />
                  <span>{b.name}</span>
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
  const [toast, setToast] = useState("");

  useEffect(() => {
    const amt = amount ? Number(amount) : undefined;
    getRecommendations(brand.brand_id, amt, mydata).then((d) => {
      setData(d);
      setSelected(d.best_card_id); // 조건이 바뀌면 다시 최선 카드로
    });
  }, [brand.brand_id, amount, mydata]);

  if (!data) return <div className="screen center"><div className="spinner dark" /></div>;

  const list = data.cards.filter((c) => (tab === "woori" ? c.is_woori : true));
  const wooriCount = data.cards.filter((c) => c.is_woori).length;

  async function choose() {
    await postSelection({ recognition_id: recognitionId, brand_id: brand.brand_id, card_id: selected, expected_amount: amount ? Number(amount) : null });
    setToast("선택이 기록됐어요");
    setTimeout(() => { setToast(""); onDone(); }, 1200);
  }

  return (
    <div className="screen rec">
      <header className="topbar"><button className="iconbtn" onClick={onBack}>‹</button></header>

      <div className="hero row">
        <BrandMark name={data.brand.name} size={52} />
        <div className="grow">
          <div className="headline">{data.message}</div>
          <div className="sub">{data.brand.category}</div>
        </div>
      </div>

      <div className="amountrow">
        <label>예상 결제금액</label>
        <input inputMode="numeric" placeholder="미입력 시 10,000원 기준" value={amount}
               onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
      </div>

      <div className="pad"><MydataBanner linked={mydata} onLink={onLinkMydata} /></div>

      <div className="tabs">
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>전체 ({data.cards.length})</button>
        <button className={tab === "woori" ? "on" : ""} onClick={() => setTab("woori")}>우리카드 ({wooriCount})</button>
        <span className="tab-static">추천 순</span>
      </div>

      <div className="cards">
        {list.map((c) => {
          const best = c.card_id === data.best_card_id;
          const usable = c.expected_benefit > 0;
          return (
            <button key={c.card_id} className={`cardrow ${best ? "best" : ""} ${!usable ? "none" : ""}`}
                    onClick={() => usable && setSelected(c.card_id)}>
              {best && (
                <div className="bestline">
                  <span className="badge">👑 가장 큰 혜택</span>
                  {data.best_reason && <span className="reason">{data.best_reason}</span>}
                </div>
              )}
              <div className="row">
                <CardThumb color={c.color} />
                <div className="grow">
                  <div className="cardname">
                    {c.name} {c.is_woori && <span className="pill">우리</span>}
                  </div>
                  <div className={`rate ${best ? "accent" : ""}`}>{c.rate_label}</div>
                  {usable && (
                    <div className="sub">
                      결제 예상 <b>{won(c.final_payment)}</b> (할인 {won(c.expected_benefit)})
                      {c.limited_by_monthly && " · 월 한도 남은 만큼만"}
                    </div>
                  )}
                  {c.has_benefit && (
                    <div className="sub">
                      {c.max_per_txn ? `건당 최대 ${won(c.max_per_txn)} · ` : ""}
                      이번 달 남은 한도 {won(c.monthly_remaining)}{!c.spend_known && "(추정)"}
                    </div>
                  )}
                  <SpendBar card={c} />
                </div>
                {usable && <div className={`radio ${selected === c.card_id ? "on" : ""}`} />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="cta">
        <button className="btn primary big" disabled={!selected} onClick={choose}>이 카드로 결제할게요</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
      {askMydata && !mydata && (
        <MydataModal onLink={() => { onMydataAsked(); onLinkMydata(); }} onClose={onMydataAsked} />
      )}
    </div>
  );
}

/* ---------------- ③ 내 카드 · 실적 관리 (WALLET) ---------------- */
function WalletScreen({ mydata, onLinkMydata, onBack }) {
  const [cards, setCards] = useState(null);

  useEffect(() => { getCards(mydata).then(setCards).catch(() => setCards([])); }, [mydata]);

  const urgent = cards?.filter((c) => c.spend_gap > 0).sort((a, b) => b.spend_gap - a.spend_gap)[0];

  return (
    <div className="screen rec wallet">
      <header className="topbar row">
        <button className="iconbtn" onClick={onBack}>‹</button>
        <div className="title">내 카드 · 이번 달 실적</div>
      </header>

      <div className="pad">
        <div className="secure">
          🔒 카드번호·CVV는 <b>스캔하거나 저장하지 않아요</b>. 카드번호는 끝 4자리만 보관하고,
          화면에는 자동으로 마스킹(****)해서 보여드려요.
        </div>
        <MydataBanner linked={mydata} onLink={onLinkMydata} />
        {urgent && (
          <div className="urgent">이번 달 실적이 가장 급한 카드는 <b>{urgent.name}</b> — {won(urgent.spend_gap)} 더 쓰면 다음 달 혜택 유지</div>
        )}
      </div>

      {!cards ? (
        <div className="screen center"><div className="spinner dark" /></div>
      ) : (
        <div className="cards">
          {cards.map((c) => (
            <div key={c.card_id} className="cardrow">
              <div className="row">
                <CardThumb color={c.color} />
                <div className="grow">
                  <div className="cardname">{c.name} {c.is_woori && <span className="pill">우리</span>}</div>
                  <div className="sub mono">{c.masked_number}</div>
                  <SpendBar card={c} />
                  <div className="sub">
                    월 할인 한도 {won(c.monthly_discount_limit)} 중 {won(c.monthly_remaining)} 남음{!c.spend_known && "(추정)"}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
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

/* ---------------- App ---------------- */
export default function App() {
  const [screen, setScreen] = useState("find");
  const [brand, setBrand] = useState(null);
  const [recId, setRecId] = useState(null);
  const [mydata, setMydata] = useState(loadMydata);
  const [mydataAsked, setMydataAsked] = useState(false); // 연동 유도 팝업은 세션당 한 번만

  function linkMydata() {
    saveMydata();
    setMydata(true);
  }

  return (
    <div className="phone">
      {screen === "find" && (
        <FindScreen onConfirm={(b, id) => { setBrand(b); setRecId(id); setScreen("rec"); }}
                    onWallet={() => setScreen("wallet")} />
      )}
      {screen === "rec" && brand && (
        <RecScreen brand={brand} recognitionId={recId} mydata={mydata} onLinkMydata={linkMydata}
                   askMydata={!mydataAsked} onMydataAsked={() => setMydataAsked(true)}
                   onBack={() => setScreen("find")} onDone={() => setScreen("find")} />
      )}
      {screen === "wallet" && (
        <WalletScreen mydata={mydata} onLinkMydata={linkMydata} onBack={() => setScreen("find")} />
      )}
    </div>
  );
}
