"""관리자 대시보드 API (/admin/dashboard). 화면은 PC에서만 띄운다 (frontend/admin.html, 배포 빌드에는 안 들어감).
보호: 서버에 ADMIN_PASSWORD가 있으면 X-Admin-Password 헤더가 같아야 함.
없으면 이 PC(127.0.0.1)에서 온 요청만 허용 → 배포 서버에 비밀번호를 안 넣으면 아무도 못 봄"""
import hmac
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .models import SessionLocal, Recognition, Confirmation, Selection, WalletCard
from . import catalog

KST = timezone(timedelta(hours=9))
CLAUDE_COST_USD = 0.03     # Claude 판단 1회 대략 (Opus 5.5, 사진 1장 + 짧은 답)
VISION_FREE_MONTH = 1000   # Google Vision 월 무료 (기능별)
RECENT = 30


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_admin(request: Request, x_admin_password: Optional[str] = Header(None)):
    pw = os.getenv("ADMIN_PASSWORD")
    if pw:
        if not x_admin_password or not hmac.compare_digest(x_admin_password.encode(), pw.encode()):
            raise HTTPException(401, "관리자 비밀번호가 맞지 않아요")
    elif not request.client or request.client.host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "서버에 ADMIN_PASSWORD를 설정해야 볼 수 있어요")


router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


def _since(month: bool = False) -> datetime:
    """오늘(또는 이번 달) 0시(한국 시간)를 DB 저장 형식(UTC, 시간대 없음)으로"""
    now = datetime.now(KST)
    start = now.replace(day=1 if month else now.day, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def _kst(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).astimezone(KST).strftime("%m/%d %H:%M:%S")


def _clues(raw: dict) -> str:
    """사진에서 읽은 단서 한 줄 (로고 > 글자 첫 줄 > 파일 이름)"""
    if raw.get("mode") == "mock":
        return f'파일 이름 "{raw.get("filename", "")}"'
    logos = [l[0] for l in raw.get("logos") or []]
    if logos:
        return "로고 " + ", ".join(logos[:2])
    text = (raw.get("text") or "").strip().splitlines()
    if text:
        return f'글자 "{text[0][:30]}"'
    labels = [l[0] for l in raw.get("labels") or []]
    return "사물 " + ", ".join(labels[:3]) if labels else "단서 없음"


def _latest_confirmations(db: Session, rec_ids: list) -> dict:
    out = {}
    if rec_ids:
        for c in db.query(Confirmation).filter(Confirmation.recognition_id.in_(rec_ids)).order_by(Confirmation.id):
            out[c.recognition_id] = c   # 같은 사진을 여러 번 확정했으면 마지막 것
    return out


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    today = db.query(Recognition).filter(Recognition.created_at >= _since()).all()
    month = db.query(Recognition).filter(Recognition.created_at >= _since(month=True)).all()
    recent = db.query(Recognition).order_by(Recognition.id.desc()).limit(RECENT).all()
    found = sum(r.status == "done" for r in today)
    claude = sum("ai" in (r.raw or {}) for r in today)
    limit = int(os.getenv("DAILY_RECOG_LIMIT") or 0) or None

    conf_today = _latest_confirmations(db, [r.id for r in today])
    via = Counter(c.via for c in conf_today.values())
    pays_today = db.query(Selection).filter(Selection.created_at >= _since()).all()

    # 최근 인식 목록: 위치는 좌표 대신 가장 가까운 매장 이름만 보여 줌
    ids = [r.id for r in recent]
    conf = _latest_confirmations(db, ids)
    pays = {s.recognition_id: s for s in db.query(Selection).filter(Selection.recognition_id.in_(ids)).order_by(Selection.id)} if ids else {}
    cards = {w.id: catalog.cards()[w.card_id]["name"] for w in db.query(WalletCard)}
    rows = []
    for r in recent:
        raw, cands = r.raw or {}, r.candidates or []
        top, ai, c, p = (cands[0] if cands else None), raw.get("ai"), conf.get(r.id), pays.get(r.id)
        rows.append({
            "id": r.id,
            "time": _kst(r.created_at),
            "found": r.status == "done",
            "top": top and {"name": top["name"], "source": top.get("source"), "confidence": top.get("confidence")},
            "others": [x["name"] for x in cands[1:]],
            "clues": _clues(raw),
            "nearby": (raw.get("kakao_places") or [None])[0],
            "located": bool(raw.get("gps")),
            "ai_called": "ai" in raw,
            "ai_reason": ai.get("reason") if isinstance(ai, dict) else None,
            "confirmed": c and {"name": c.brand_name, "via": c.via},
            "paid": p and {"card": cards.get(p.card_id, "삭제된 카드"), "amount": p.expected_amount, "discount": p.discount},
        })

    # 보강이 필요한 매장: 1순위가 틀려 고친 매장 + AI가 목록 밖 브랜드로 알아본 매장
    watch = db.query(Recognition).order_by(Recognition.id.desc()).limit(500).all()
    wconf = _latest_confirmations(db, [r.id for r in watch])
    need, why = Counter(), {}
    for r in watch:
        c, ai = wconf.get(r.id), (r.raw or {}).get("ai")
        if c and c.via != "top":
            need[c.brand_name] += 1
            why.setdefault(c.brand_name, "직접 검색으로 고침" if c.via == "search" else "다른 후보로 고침")
        if isinstance(ai, dict) and ai.get("new_brand"):
            name = ai["new_brand"].get("name")
            if name:
                need[name] += 1
                why.setdefault(name, "목록에 없는 브랜드 (AI가 알아봄)")
    failed = [{"id": r.id, "time": _kst(r.created_at), "clues": _clues(r.raw or {})}
              for r in watch if r.status != "done"][:10]

    return {
        "now": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
        "today": {
            "recognitions": len(today), "found": found,
            "success_rate": round(found * 100 / len(today)) if today else None,
            "limit": limit, "remaining": max(0, limit - len(today)) if limit else None,
            "claude_calls": claude, "claude_cost_usd": round(claude * CLAUDE_COST_USD, 2),
            "confirmed": len(conf_today), "via": {k: via[k] for k in ("top", "candidate", "search")},
            "top_rate": round(via["top"] * 100 / len(conf_today)) if conf_today else None,
            "payments": len(pays_today),
            "pay_amount": sum(p.expected_amount or 0 for p in pays_today),
            "pay_discount": sum(p.discount or 0 for p in pays_today),
        },
        "month": {"vision": sum((r.raw or {}).get("mode") == "vision" for r in month), "vision_free": VISION_FREE_MONTH},
        "recent": rows,
        "need": [{"name": n, "count": k, "why": why[n]} for n, k in need.most_common(10)],
        "failed": failed,
    }
