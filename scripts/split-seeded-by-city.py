import json
import re
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

SOURCE = Path("src/data/seededPlaces.json")
OUT_DIR = Path("src/data/seeded-cities")
META_PATH = Path("src/data/seededCitiesMeta.json")

DEFAULT_CITY_CENTERS = {
    "Berlin": {"lat": 52.52, "lon": 13.405},
    "Tel Aviv": {"lat": 32.0853, "lon": 34.7818},
    "Jerusalem": {"lat": 31.7804, "lon": 35.2240},
    "Haifa": {"lat": 32.7940, "lon": 34.9896},
    "Ramat Gan": {"lat": 32.0827, "lon": 34.8020},
    "Ra'anana": {"lat": 32.1976, "lon": 34.8711},
    "Paris": {"lat": 48.8566, "lon": 2.3522},
    "Amsterdam": {"lat": 52.3676, "lon": 4.9041},
    "Copenhagen": {"lat": 55.6761, "lon": 12.5683},
    "Barcelona": {"lat": 41.3874, "lon": 2.1686},
    "Madrid": {"lat": 40.4168, "lon": -3.7038},
    "Lisbon": {"lat": 38.7223, "lon": -9.1393},
    "Porto": {"lat": 41.1579, "lon": -8.6291},
    "London": {"lat": 51.5074, "lon": -0.1278},
    "Rome": {"lat": 41.9028, "lon": 12.4964},
    "Vienna": {"lat": 48.2082, "lon": 16.3738},
    "Prague": {"lat": 50.0755, "lon": 14.4378},
    "New York": {"lat": 40.7128, "lon": -74.0060},
}


def slugify(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    stripped = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", stripped).strip("-").lower()
    return slug or "city"


def compute_center(places: List[Dict]) -> Optional[Dict]:
    points: List[Tuple[float, float]] = []
    for place in places:
        try:
            lat = float(place.get("lat"))
            lon = float(place.get("lon"))
            points.append((lat, lon))
        except Exception:
            continue

    if not points:
        return None

    return {
        "lat": sum(lat for lat, _ in points) / len(points),
        "lon": sum(lon for _, lon in points) / len(points),
    }


def main() -> None:
    data = json.loads(SOURCE.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    used_slugs: Set[str] = set()
    cities_meta: List[Dict] = []

    for city_name, places_raw in data.items():
        places = places_raw if isinstance(places_raw, list) else []

        base = slugify(city_name)
        slug = base
        suffix = 2
        while slug in used_slugs:
            slug = f"{base}-{suffix}"
            suffix += 1
        used_slugs.add(slug)

        file_name = f"{slug}.json"
        (OUT_DIR / file_name).write_text(json.dumps(places, ensure_ascii=False))

        center = DEFAULT_CITY_CENTERS.get(city_name) or compute_center(places)
        if center:
            cities_meta.append(
                {
                    "name": city_name,
                    "lat": center["lat"],
                    "lon": center["lon"],
                    "file": file_name,
                }
            )

    cities_meta.sort(key=lambda item: item["name"])
    META_PATH.write_text(json.dumps({"cities": cities_meta}, ensure_ascii=False, indent=2) + "\n")

    print(f"created {len(cities_meta)} city files")


if __name__ == "__main__":
    main()
