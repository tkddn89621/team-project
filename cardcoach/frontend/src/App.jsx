import { useEffect, useRef, useState } from "react";
import { recognize, getBrands, getRecommendations, postSelection } from "./api.js";

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

/* ---------------- ① 가맹점 인식 (FIND) ---------------- */
function FindScreen({ onConfirm }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | loading | result | fail
  const [rec, setRec] = useState(null);
  const [brands, setBrands] = useState([]);
  const [picker, setPicker] = useState(false);

  useEffect(() => { getBrands().then(setBrands).catch(() => {}); }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setPhase("loading");
    try {
      const r = await recognize(file);
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

  const top = rec?.candidates?.[0];

  return (
    <div className="screen find">
      <div className="camera" style={preview ? { backgroundImage: `url(${preview})` } : undefined}>
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
              <div className="title">{top.name}</div>
              <div className="sub">{top.category} · 신뢰도 {Math.round(top.confidence * 100)}%</div>
            </div>
          </div>
          {rec.candidates.length > 1 && (
            <div className="cands">
              {rec.candidates.slice(1).map((c) => (
                <button key={c.brand_id} className="chip" onClick={() => onConfirm(c, rec.recognition_id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="btnrow">
            <button className="btn ghost" onClick={() => setPicker(true)}>다른 가맹점</button>
            <button className="btn primary" onClick={() => onConfirm(top, rec.recognition_id)}>맞아요</button>
          </div>
        </div>
      )}

      {phase === "fail" && (
        <div className="sheet">
          <div className="title">가맹점을 찾지 못했어요</div>
          <div className="sub">다시 찍거나 목록에서 직접 선택해 주세요</div>
          <div className="btnrow">
            <button className="btn ghost" onClick={() => setPicker(true)}>직접 선택</button>
            <button className="btn primary" onClick={() => inputRef.current.click()}>다시 찍기</button>
          </div>
        </div>
      )}

      {(phase === "idle" || phase === "loading") && (
        <div className="shutterbar">
          <button className="textbtn" onClick={() => setPicker(true)}>직접 선택</button>
          <button className="shutter" disabled={phase === "loading"} onClick={() => inputRef.current.click()} aria-label="촬영" />
          <span className="textbtn muted">사진</span>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {picker && (
        <div className="modal" onClick={() => setPicker(false)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="title">가맹점 선택</div>
            <div className="grid">
              {brands.map((b) => (
                <button key={b.brand_id} className="gridcell" onClick={() => { setPicker(false); onConfirm(b, rec?.recognition_id ?? null); }}>
                  <BrandMark name={b.name} size={40} />
                  <span>{b.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- ② 최대 혜택 추천 (REC) ---------------- */
function RecScreen({ brand, recognitionId, onBack, onDone }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("all"); // all | mine
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const amt = amount ? Number(amount) : undefined;
    getRecommendations(brand.brand_id, amt).then((d) => {
      setData(d);
      setSelected((s) => s ?? d.best_card_id);
    });
  }, [brand.brand_id, amount]);

  if (!data) return <div className="screen center"><div className="spinner dark" /></div>;

  const list = data.cards.filter((c) => (tab === "mine" ? c.is_woori : true));
  const mineCount = data.cards.filter((c) => c.is_woori).length;

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

      <div className="tabs">
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>전체 ({data.cards.length})</button>
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>내 카드 ({mineCount})</button>
        <span className="tab-static">추천 순</span>
      </div>

      <div className="cards">
        {list.map((c) => {
          const best = c.card_id === data.best_card_id;
          return (
            <button key={c.card_id} className={`cardrow ${best ? "best" : ""} ${!c.has_benefit ? "none" : ""}`}
                    onClick={() => c.has_benefit && setSelected(c.card_id)}>
              {best && <div className="badge">👑 가장 큰 혜택</div>}
              <div className="row">
                <CardThumb color={c.color} />
                <div className="grow">
                  <div className="cardname">
                    {c.name} {c.is_woori && <span className="pill">내 카드</span>}
                  </div>
                  <div className={`rate ${best ? "accent" : ""}`}>{c.rate_label}</div>
                  {c.has_benefit && (
                    <div className="sub">
                      월 최대 {won(c.monthly_max_amount)} · 이번 결제 예상 {won(c.expected_benefit)}
                    </div>
                  )}
                </div>
                {c.has_benefit && <div className={`radio ${selected === c.card_id ? "on" : ""}`} />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="cta">
        <button className="btn primary big" disabled={!selected} onClick={choose}>이 카드로 결제할게요</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  const [screen, setScreen] = useState("find");
  const [brand, setBrand] = useState(null);
  const [recId, setRecId] = useState(null);

  return (
    <div className="phone">
      {screen === "find" && (
        <FindScreen onConfirm={(b, id) => { setBrand(b); setRecId(id); setScreen("rec"); }} />
      )}
      {screen === "rec" && brand && (
        <RecScreen brand={brand} recognitionId={recId} onBack={() => setScreen("find")} onDone={() => setScreen("find")} />
      )}
    </div>
  );
}
