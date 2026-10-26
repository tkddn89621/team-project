"""카드 혜택 계산: 가게(브랜드·업종코드) × 내 카드의 혜택 규칙(catalog). AI 없이 규칙으로만 계산한다.

할인액 = min(금액 × 할인율 또는 정액, 건당 한도, 혜택별 월 한도 남은 것, 영역(통합) 한도 남은 것)
조건: 혜택별 전월실적, 시간대, 요일, 최소 결제금액, 월·일 횟수
"""
import re

from . import catalog

REWARD_LABEL = {"discount": "할인", "cashback": "캐시백", "point": "적립", "mileage": "마일리지 적립"}
WEEKDAYS = "월화수목금토일"


# ---------- 카드 구간·한도 ----------
def tier_index(card: dict, spend: int):
    """실적 spend로 들어가는 가장 높은 구간 index. 첫 구간 미만이면 None"""
    hit = None
    for i, t in enumerate(card["tiers"]):
        if spend >= (t.get("min_prev_spend") or 0):
            hit = i
    return hit


def enabled_benefits(card: dict, disabled: set) -> list:
    """택1 혜택 중 고르지 않은 것(disabled)을 뺀 이 카드의 혜택"""
    return [b for b in card["benefits"] if b["benefit_id"] not in disabled]


def limits_in_name(group: str) -> list:
    """영역 이름에 적힌 구간별 한도: '오프라인(6천/1.2만/2.4만원)' → [6000, 12000, 24000]. 없으면 []"""
    inside = re.search(r"\(([^)]*)\)", group or "")
    if not inside:
        return []
    amounts = [float(n) * (10000 if unit == "만" else 1000) for n, unit in re.findall(r"(\d+(?:\.\d+)?)\s*(천|만)", inside.group(1))]
    return [int(a) for a in amounts]


def group_limit(card: dict, group: str, tier_idx, benefits: list):
    """영역(통합) 한도. ① limit_groups 표 ② 영역 이름에 적힌 구간별 한도 ③ 구간 월 한도
    ④ 그 영역 혜택들의 월 한도 중 큰 값. 모르면 None(한도 없음)"""
    lg = next((g for g in card.get("limit_groups") or [] if g["group"] == group), None)
    if lg and tier_idx is not None and tier_idx < len(lg["limits"]):
        return lg["limits"][tier_idx]
    named = limits_in_name(group)
    if named and tier_idx is not None:
        return named[min(tier_idx, len(named) - 1)]
    if tier_idx is not None and card["tiers"] and card["tiers"][tier_idx].get("monthly_limit") and not card.get("limit_groups"):
        return card["tiers"][tier_idx]["monthly_limit"]
    caps = [b["monthly_cap"] for b in benefits if b.get("shared_limit_group") == group and b.get("monthly_cap")]
    return max(caps) if caps else None


def card_limit(card: dict, tier_idx, benefits: list):
    """카드 전체 월 할인 한도 (표시·다음 달 코칭용). 영역 한도 합 + 영역 없는 혜택의 월 한도. 알 수 없으면 None"""
    if tier_idx is None:
        return 0
    if card.get("limit_groups") and card["tiers"][tier_idx].get("monthly_limit"):
        return card["tiers"][tier_idx]["monthly_limit"]
    total = 0
    for g in {b["shared_limit_group"] for b in benefits if b.get("shared_limit_group")}:
        total += group_limit(card, g, tier_idx, benefits) or 0
    total += sum(b["monthly_cap"] for b in benefits if not b.get("shared_limit_group") and b.get("monthly_cap"))
    return total or None


# ---------- 혜택 적용 대상 ----------
def in_store(b: dict) -> bool:
    """매장에서 카드로 결제할 때 받을 수 있는 혜택 (온라인·간편결제·해외·자동납부 제외)"""
    return b["target_kind"] in ("brands", "category", "all_merchants") and b.get("channel") in ("any", "offline")


def applies(b: dict, merchant_name: str, merchant_code) -> bool:
    """이 가게에 적용되는 혜택인가: 지정 브랜드면 브랜드로, 업종 혜택이면 업종코드로, 전 가맹점이면 항상"""
    if b["target_kind"] == "all_merchants":
        return True
    if catalog.canonical_brand(merchant_name) in {catalog.canonical_brand(x) for x in b.get("brands") or []}:
        return True
    return b["target_kind"] == "category" and merchant_code in catalog.benefit_codes(b["benefit_id"])


def specificity(b: dict) -> int:
    """같은 할인액이면 지정 브랜드 > 업종 > 전 가맹점 순으로 보여줌"""
    return {"brands": 0, "category": 1, "all_merchants": 2}.get(b["target_kind"], 3)


# ---------- 조건 ----------
def _hours(spec):
    """'07:00-15:00' → (7, 15)"""
    a, b = spec.split("-")
    return int(a.split(":")[0]), int(b.split(":")[0])


def in_hours(spec, hour: int) -> bool:
    if not spec:
        return True
    start, end = _hours(spec)
    return start <= hour < end if start < end else (hour >= start or hour < end)   # 21:00-09:00 처럼 자정 넘김


def on_days(spec, weekday: int) -> bool:
    """'토,일' 또는 '월-금'. weekday: 0=월"""
    if not spec:
        return True
    day = WEEKDAYS[weekday]
    if "-" in spec:
        a, b = spec.split("-")
        return WEEKDAYS.index(a.strip()) <= weekday <= WEEKDAYS.index(b.strip())
    return day in [d.strip() for d in spec.split(",")]


def daily_once(b: dict) -> bool:
    return "일 1회" in (b.get("notes") or "")


def hours_label(spec) -> str:
    start, end = _hours(spec)
    return f"{start:02d}~{end:02d}시"


# ---------- 할인액 ----------
def rate_for(b: dict, tier_idx, amount: int):
    if b.get("rate_by_tier"):
        rates = b["rate_by_tier"]
        return rates[min(tier_idx, len(rates) - 1)] if tier_idx is not None else None
    if b.get("rate_by_amount"):
        hit = [x for x in b["rate_by_amount"] if amount >= x["min_amount"]]
        return max(hit, key=lambda x: x["min_amount"])["rate"] if hit else None
    return b.get("rate")


def label(b: dict, tier_idx, amount: int, merchant_code) -> str:
    reward = REWARD_LABEL.get(b.get("reward_type"), "할인")
    rate = rate_for(b, tier_idx, amount)
    if b.get("unit") == "원" and b.get("fixed_amount"):
        text = f"{b['fixed_amount']:,}원 {reward}" + (f" ({b['min_amount']:,}원 이상)" if b.get("min_amount") else "")
    elif b.get("unit") == "원/L" and rate is not None:
        text = f"리터당 {rate:g}원 {reward}"
    elif rate is not None:
        text = f"{rate:g}% {reward}"
    else:
        text = reward
    if b["target_kind"] == "category":
        text += f" ({catalog.code_name(merchant_code)} 업종)"
    elif b["target_kind"] == "all_merchants":
        text += " (전 가맹점)"
    if b.get("hours"):
        text += f" · {hours_label(b['hours'])}"
    if b.get("days"):
        text += f" · {b['days']}"
    return text


def evaluate(card: dict, b: dict, benefits: list, tier_idx, prev_spend, amount: int, hour: int, weekday: int,
             usage: dict, wallet_id: int, merchant_code) -> dict:
    """혜택 하나를 이 결제에 적용. usage: 이번 달 사용 내역 (main.usage_this_month)"""
    bid, group = b["benefit_id"], b.get("shared_limit_group")
    need = b.get("min_prev_spend")
    if need is None:
        need = (card["tiers"][0].get("min_prev_spend") or 0) if card["tiers"] else 0
    rate = rate_for(b, tier_idx, amount)
    computable = b.get("reward_type") != "mileage" and (
        (b.get("unit") == "%" and rate is not None) or (b.get("unit") == "원" and b.get("fixed_amount")))

    blocked = None
    if prev_spend is not None and prev_spend < need:
        blocked = "지난달 실적 미달 · 이번 달 혜택 없음"
    elif not in_hours(b.get("hours"), hour):
        blocked = f"할인 시간 아님 ({hours_label(b['hours'])}만)"
    elif not on_days(b.get("days"), weekday):
        blocked = f"할인 요일 아님 ({b['days']}만)"
    elif b.get("min_amount") and amount < b["min_amount"]:
        blocked = f"{b['min_amount']:,}원 이상 결제해야 할인"
    elif b.get("monthly_count") and usage["count_month"].get((wallet_id, bid), 0) >= b["monthly_count"]:
        blocked = f"이번 달 사용 횟수 소진 (월 {b['monthly_count']}회)"
    elif daily_once(b) and usage["count_today"].get((wallet_id, bid), 0) >= 1:
        blocked = "오늘 이미 받았어요 (하루 1회)"
    elif b["target_kind"] == "all_merchants" and b.get("unit") == "원":
        # 예: '분기 실적 300만원 이상 시 5천원' — 결제마다 받는 할인이 아니라 실적 달성 보너스
        blocked = "결제마다 받는 할인이 아니에요 (실적 달성 보너스)"
    elif not computable:
        blocked = "할인액 자동 계산 불가 · 약관 확인"

    # 남은 한도: 혜택별 월 한도, 영역(통합) 한도
    caps = []
    if b.get("monthly_cap"):
        caps.append(b["monthly_cap"] - usage["benefit"].get((wallet_id, bid), 0))
    glimit = group_limit(card, group, tier_idx, benefits) if group else None
    if glimit is not None:
        caps.append(glimit - usage["group"].get((wallet_id, group), 0))
    remaining = max(0, min(caps)) if caps else None
    if not blocked and remaining == 0:
        blocked = "이번 달 할인 한도 소진"

    discount, limited = 0, False
    if not blocked:
        discount = b["fixed_amount"] if b.get("unit") == "원" else int(amount * rate / 100)
        discount = min(discount, amount)
        if b.get("max_per_txn"):
            discount = min(discount, b["max_per_txn"])
        if remaining is not None and discount > remaining:
            discount, limited = remaining, True

    text = label(b, tier_idx, amount, merchant_code)
    return {
        "has_benefit": True, "benefit_id": bid, "limit_group": group,
        "benefit_type": REWARD_LABEL.get(b.get("reward_type"), "할인"), "rate": rate or 0,
        "fixed_amount": b.get("fixed_amount") or 0, "min_amount": b.get("min_amount") or 0,
        "rate_label": blocked or text, "benefit_label": text, "blocked_reason": blocked,
        "benefit_note": b.get("target_raw") or "",
        "max_per_txn": b.get("max_per_txn") or 0, "limited_by_monthly": limited,
        "benefit_remaining": remaining,
        "expected_benefit": discount,
    }
