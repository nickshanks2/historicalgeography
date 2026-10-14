"""Harvest today's named streets from OpenStreetMap as tracing reference.

Reads OpenFreeMap's vector tiles (OpenMapTiles schema, zoom 14) for the
tracing area and merges each street's pieces into lines. The /admin/trace
tool shows these so a historical street that still follows the same course
can be adopted (with its own start_year and sources) instead of redrawn.
Never shown on the public map.

    python3 pipeline/build_osm_reference.py
"""

import gzip
import json
import math
import urllib.request
from collections import defaultdict
from pathlib import Path

import mapbox_vector_tile
import shapely
from shapely.geometry import LineString, mapping

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "reference" / "osm_streets.geojson"
TILEJSON = "https://tiles.openfreemap.org/planet"
# Santa Monica, Venice, Pacific Palisades, Sawtelle and Ocean Park.
TRACE_BBOX = (-118.56, 33.96, -118.42, 34.08)
ZOOM = 14
STREET_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"}
# Pedestrian malls such as the Third Street Promenade were ordinary streets.
PEDESTRIAN_SUBCLASSES = {"pedestrian"}


HEADERS = {"User-Agent": "historicalgeography.io data pipeline"}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60).read()


def tile_range(bbox, z):
    n = 2**z

    def xy(lon, lat):
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return int((lon + 180) / 360 * n), int(y)

    (x0, y1), (x1, y0) = xy(bbox[0], bbox[1]), xy(bbox[2], bbox[3])
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def to_lnglat(x, y, z, extent):
    def convert(px, py):
        n = 2**z
        lon = (x + px / extent) / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / extent) / n))))
        return round(lon, 6), round(lat, 6)

    return convert


def main():
    template = json.loads(fetch(TILEJSON))["tiles"][0]
    pieces = defaultdict(list)
    tiles = tile_range(TRACE_BBOX, ZOOM)
    for i, (x, y) in enumerate(tiles):
        raw = fetch(template.format(z=ZOOM, x=x, y=y))
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        layer = mapbox_vector_tile.decode(raw).get("transportation_name")
        if not layer:
            continue
        convert = to_lnglat(x, y, ZOOM, layer["extent"])
        for f in layer["features"]:
            p = f["properties"]
            street = p.get("class") in STREET_CLASSES or (
                p.get("class") == "path" and p.get("subclass") in PEDESTRIAN_SUBCLASSES
            )
            if not street or not p.get("name"):
                continue
            g = f["geometry"]
            lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
            for line in lines:
                pieces[(p["name"], p["class"])].append(LineString([convert(*c) for c in line]))
        print(f"\r{i + 1}/{len(tiles)} tiles", end="", flush=True)
    print()

    features = []
    for (name, cls), lines in sorted(pieces.items()):
        merged = shapely.line_merge(shapely.unary_union(lines))
        features.append({
            "type": "Feature",
            "properties": {"osm_name": name, "class": cls},
            "geometry": mapping(merged),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
    print(f"{len(features)} named streets -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
