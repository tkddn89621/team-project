"""카카오 로컬 API: 현재 위치 반경 안의 실제 매장 찾기.

환경변수 (backend/.env)
  KAKAO_REST_API_KEY=REST API 키   → 없으면 사용 안 함 (seed.py 시연용 좌표로만 GPS 매칭)
"""
import json
import os
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from . import catalog

URL = "https://dapi.kakao.com/v2/local/search/category.json"
# 카카오 카테고리 그룹: 카페, 음식점, 편의점, 대형마트, 문화시설(영화관), 주유소·충전소, 병원, 약국
CATEGORY_CODES = ["CE7", "FD6", "CS2", "MT1", "CT1", "OL7", "HP8", "PM9"]


def enabled() -> bool:
    return bool(os.getenv("KAKAO_REST_API_KEY"))


def _search(code: str, lat: float, lng: float, radius: int, key: str) -> list:
    q = urllib.parse.urlencode({"category_group_code": code, "x": lng, "y": lat,
                                "radius": radius, "sort": "distance"})
    req = urllib.request.Request(f"{URL}?{q}", headers={"Authorization": f"KakaoAK {key}"})
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.load(r)["documents"]
    except Exception as e:   # 키 오류·네트워크 문제여도 인식은 계속 (GPS 없이)
        print(f"kakao local {code} error: {e}")
        return []


def nearby(lat: float, lng: float, radius: int) -> list:
    """반경 안 매장 [{id, name, code(업종코드), category(업종 이름), distance_m, lat, lng}] 거리순. 키가 없거나 실패하면 []"""
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key:
        return []
    with ThreadPoolExecutor(len(CATEGORY_CODES)) as ex:
        docs = [d for res in ex.map(lambda c: _search(c, lat, lng, radius, key), CATEGORY_CODES) for d in res]

    places = {}
    for d in docs:
        code = catalog.kakao_code(d.get("category_name", ""), d.get("place_name", ""), d.get("category_group_code", ""))
        if code and d["id"] not in places:   # 카드 혜택 업종으로 연결 안 되는 곳(관광지 등)은 뺌
            places[d["id"]] = {"id": d["id"], "name": d["place_name"], "code": code, "category": catalog.code_name(code),
                               "distance_m": int(d.get("distance") or 0),
                               "lat": float(d["y"]), "lng": float(d["x"])}
    return sorted(places.values(), key=lambda p: p["distance_m"])
