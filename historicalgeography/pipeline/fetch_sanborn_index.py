"""List the Library of Congress Sanborn atlases for the pilot area.

Writes data/reference/sanborn.json: each atlas with its sheets' IIIF image
services, for the /admin/georef tool and build_sanborn.py. The images are
public domain (Library of Congress, Geography and Map Division, Sanborn
Maps Collection).

    python3 pipeline/fetch_sanborn_index.py
"""

import http.client
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "reference" / "sanborn.json"
HEADERS = {"User-Agent": "historicalgeography.io data pipeline"}
SEARCH = "https://www.loc.gov/collections/sanborn-maps/?q={q}&fo=json&c=100"
# Places in or next to the pilot area that have their own atlases.
PLACES = ["Santa Monica", "Venice", "Ocean Park", "Sawtelle", "Playa del Rey", "Culver City"]


def fetch_json(url, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except (OSError, http.client.HTTPException):
            if attempt == tries - 1:
                raise
            time.sleep(2 ** (attempt + 1))


def main():
    atlases = {}
    for place in PLACES:
        results = fetch_json(SEARCH.format(q=urllib.request.quote(place.lower())))["results"]
        for r in results:
            title = r.get("title", "")
            if f"from {place}," not in title or "California" not in title:
                continue
            item_id = r["id"].rstrip("/").split("/")[-1]
            item = fetch_json(f"https://www.loc.gov/item/{item_id}/?fo=json")
            if not item.get("resources"):
                continue  # catalogued without scanned sheets
            date = item["item"].get("date", "")
            year = int(re.match(r"\d{4}", date).group())
            sheets = []
            for n, files in enumerate(item["resources"][0]["files"], start=1):
                iiif = next(
                    (f["url"] for f in files if f.get("mimetype") == "image/jpeg" and "iiif" in f.get("url", "")),
                    None,
                )
                full = next((f for f in files if f.get("mimetype") == "image/jp2"), {})
                if iiif:
                    # Keep the image service base; clients add /full/<size>/0/default.jpg.
                    iiif = re.sub(r"/full/.*$", "", iiif)
                    sheets.append({"n": n, "iiif": iiif, "width": full.get("width"), "height": full.get("height")})
            slug = place.lower().replace(" ", "-")
            atlas_id = f"sanborn-{slug}-{date[:7]}"
            atlases[atlas_id] = {
                "id": atlas_id,
                "place": place,
                "title": f"Sanborn Fire Insurance Map, {place}, {date}",
                "year": year,
                "item_url": f"https://www.loc.gov/item/{item_id}/",
                "sheets": sheets,
            }
            print(f"{atlas_id}: {len(sheets)} sheets")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"atlases": sorted(atlases.values(), key=lambda a: (a["place"], a["year"]))}, indent=1) + "\n")


if __name__ == "__main__":
    main()
