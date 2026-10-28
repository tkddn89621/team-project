/* WON픽 관리자 대시보드 (PC 전용). 고객 앱이 쌓은 인식·확정·결제 기록을 5초마다 가져와 보여 준다.
   배포 서버(wonpick.onrender.com)의 기록을 보려면 그 서버의 ADMIN_PASSWORD를 입력. 내 PC 서버는 비밀번호 없이도 열림 */
import { useCallback, useEffect, useState } from "react";

const SERVERS = {
  deploy: { label: "배포 서버", base: import.meta.env.VITE_ADMIN_SERVER || "https://wonpick.onrender.com" },
  local: { label: "내 PC", base: "/api" },
};
const REFRESH_MS = 5000;
const SOURCE = { logo: "로고", text: "글자", image: "사진", gps: "근처 매장", ai: "AI 판단", ai_category: "AI 업종" };

/* 브라우저 저장소: 막혀 있어도(시크릿 창 등) 화면은 그대로 동작 */
function load(kind, key) {
  try { return (kind === "session" ? sessionStorage : localStorage).getItem(key); } catch { return null; }
}
function save(kind, key, value) {
  try {
    const s = kind === "session" ? sessionStorage : localStorage;
    value == null ? s.removeItem(key) : s.setItem(key, value);
  } catch { /* 이번 창에서만 기억 */ }
}

const num = (n) => (n ?? 0).toLocaleString("ko-KR");
const won = (n) => `${num(n)}원`;
const pct = (n) => (n == null ? "–" : `${n}%`);

function Meter({ used, total, label }) {
  const p = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const level = p >= 95 ? "critical" : p >= 80 ? "warning" : "";
  return (
    <div className="meter-wrap">
      <div className={`meter ${level}`} role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-label={label}>
        <div style={{ width: `${p}%` }} />
      </div>
      <div className="meter-text">
        {level && <span className={`status ${level}`}>{level === "critical" ? "✕ 한도 도달" : "! 거의 다 씀"}</span>}
        <span>{num(used)} / {num(total)}</span>
      </div>
    </div>
  );
}

function Tile({ label, value, children, hero }) {
  return (
    <div className={`tile ${hero ? "hero" : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {children && <div className="tile-sub">{children}</div>}
    </div>
  );
}

function Kpis({ today, month }) {
  const v = today.via;
  return (
    <section className="kpis" aria-label="오늘 요약">
      <Tile hero label="오늘 사진 인식" value={<>{num(today.recognitions)}<small>건</small></>}>
        {today.limit
          ? <><Meter used={today.recognitions} total={today.limit} label="하루 인식 제한 사용량" /><div>남은 횟수 {num(today.remaining)}건</div></>
          : <div>하루 인식 제한 없음</div>}
      </Tile>
      <Tile label="인식 성공률" value={pct(today.success_rate)}>
        찾음 {num(today.found)} · 못 찾음 {num(today.recognitions - today.found)}
      </Tile>
      <Tile label="1순위 적중률" value={pct(today.top_rate)}>
        확정 {num(today.confirmed)}건 중 그대로 {num(v.top)} · 다른 후보 {num(v.candidate)} · 직접 검색 {num(v.search)}
      </Tile>
      <Tile label="Claude 호출" value={<>{num(today.claude_calls)}<small>회</small></>}>
        예상 비용 약 ${today.claude_cost_usd.toFixed(2)}
      </Tile>
      <Tile label="Vision 이번 달" value={<>{num(month.vision)}<small>장</small></>}>
        <Meter used={month.vision} total={month.vision_free} label="Google Vision 월 무료 사용량" />
        <div>월 무료 {num(month.vision_free)}장</div>
      </Tile>
    </section>
  );
}

function Confirmed({ c }) {
  if (!c) return <span className="muted">–</span>;
  if (c.via === "top") return <span className="status good">✓ 그대로</span>;
  return (
    <>
      <span className="status warning">✎ {c.via === "search" ? "직접 검색" : "다른 후보"}</span>
      <div className="cell-main">{c.name}</div>
    </>
  );
}

function RecentTable({ rows }) {
  if (!rows.length) {
    return <div className="empty">아직 인식 기록이 없어요. 고객 앱에서 사진을 찍으면 몇 초 안에 여기 나타나요.</div>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>시간</th><th>인식 결과</th><th>사진 단서</th><th>사용자 확정</th><th>결제</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num">{r.time}</td>
              <td>
                {r.found ? (
                  <>
                    <div className="cell-main">{r.top.name}</div>
                    <div className="muted">
                      {SOURCE[r.top.source] || r.top.source}
                      {r.top.confidence != null && ` ${Math.round(r.top.confidence * 100)}%`}
                      {r.others.length > 0 && ` · 후보 ${r.others.join(", ")}`}
                    </div>
                    {r.ai_reason && <div className="ai">AI: {r.ai_reason}</div>}
                  </>
                ) : <span className="status critical">✕ 인식 실패</span>}
              </td>
              <td className="clue">{r.clues}</td>
              <td><Confirmed c={r.confirmed} /></td>
              <td>
                {r.paid ? (
                  <>
                    <div className="cell-main">{r.paid.card}</div>
                    <div className="muted num">{won(r.paid.amount)} · 할인 {won(r.paid.discount)}</div>
                  </>
                ) : <span className="muted">–</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SideLists({ need, failed }) {
  return (
    <aside className="side">
      <section className="panel">
        <h2>보강이 필요한 매장</h2>
        <p className="muted">1순위가 틀려 고쳤거나, 목록에 없어 AI가 알아본 매장이에요. 별칭·로고를 등록하면 다음부터 바로 인식돼요.</p>
        {need.length ? (
          <ul className="list">
            {need.map((n) => (
              <li key={n.name}><span className="cell-main">{n.name}</span><span className="muted">{n.why}</span><span className="count">{n.count}회</span></li>
            ))}
          </ul>
        ) : <div className="empty small">아직 없어요</div>}
      </section>
      <section className="panel">
        <h2>인식 실패</h2>
        <p className="muted">매장을 못 찾은 사진의 단서예요.</p>
        {failed.length ? (
          <ul className="list">
            {failed.map((f) => (
              <li key={f.id}><span className="num muted">{f.time}</span><span className="clue">{f.clues}</span></li>
            ))}
          </ul>
        ) : <div className="empty small">아직 없어요</div>}
      </section>
    </aside>
  );
}

export default function Admin() {
  const [server, setServer] = useState(() => (load("local", "adminServer") in SERVERS ? load("local", "adminServer") : "deploy"));
  const [pw, setPw] = useState(() => load("session", "adminPw") || "");
  const [draft, setDraft] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);   // { auth: true면 비밀번호 필요, msg }

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`${SERVERS[server].base}/admin/dashboard`, { headers: pw ? { "X-Admin-Password": pw } : {} });
      if (r.status === 401 || r.status === 403) {
        const body = await r.json().catch(() => ({}));
        setData(null);
        setError({ auth: true, msg: body.detail || "관리자 비밀번호가 필요해요" });
        return;
      }
      if (r.status === 404) {
        setData(null);
        setError({ msg: "이 서버에는 아직 관리자 기능이 없어요. 관리자 코드를 main에 올려 다시 배포하면 생겨요" });
        return;
      }
      if (!r.ok) throw new Error();
      setData(await r.json());
      setError(null);
    } catch {
      setError({ msg: server === "deploy" ? "배포 서버에 연결할 수 없어요 (서버가 잠들어 있으면 30초쯤 걸려요)" : "내 PC 백엔드(8000번)가 켜져 있는지 확인해 주세요" });
    }
  }, [server, pw]);

  useEffect(() => {
    setData(null);
    fetchData();
    const t = setInterval(() => { if (!document.hidden) fetchData(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  const pickServer = (key) => { setServer(key); save("local", "adminServer", key); };
  const submitPw = (e) => {
    e.preventDefault();
    setPw(draft); save("session", "adminPw", draft); setDraft("");
  };

  return (
    <div className="admin">
      <header className="top">
        <div>
          <h1>WON픽 관리자</h1>
          <div className="muted">고객이 앱을 쓰면 몇 초 안에 여기 쌓여요</div>
        </div>
        <div className="top-right">
          <div className="seg" role="tablist" aria-label="데이터를 가져올 서버">
            {Object.entries(SERVERS).map(([key, s]) => (
              <button key={key} role="tab" aria-selected={server === key} className={server === key ? "on" : ""} onClick={() => pickServer(key)}>{s.label}</button>
            ))}
          </div>
          <div className="refresh muted">
            {data ? <><span className="dot" aria-hidden />{data.now.slice(11)} 갱신 · 5초마다</> : "불러오는 중…"}
          </div>
          {pw && <button className="link" onClick={() => { setPw(""); save("session", "adminPw", null); }}>비밀번호 지우기</button>}
        </div>
      </header>

      {error?.auth && (
        <form className="panel auth" onSubmit={submitPw}>
          <h2>{SERVERS[server].label} 관리자 비밀번호</h2>
          <p className="muted">{error.msg}</p>
          <div className="auth-row">
            <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ADMIN_PASSWORD" autoFocus />
            <button className="primary" disabled={!draft}>확인</button>
          </div>
        </form>
      )}
      {error && !error.auth && <div className="banner">{error.msg}</div>}

      {data && (
        <>
          <Kpis today={data.today} month={data.month} />
          <div className="grid">
            <section className="panel">
              <h2>최근 인식 <span className="muted">최근 {data.recent.length}건</span></h2>
              <RecentTable rows={data.recent} />
            </section>
            <SideLists need={data.need} failed={data.failed} />
          </div>
        </>
      )}
    </div>
  );
}
