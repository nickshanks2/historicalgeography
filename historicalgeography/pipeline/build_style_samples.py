"""Build the Phase 1 style-review datasets.

Combines the hand-drawn sample sketch (pipeline/samples/sketch.geojson)
with shapes derived from the Natural Earth coastline: the ocean polygon,
the coastline itself, a beach strip and riparian strips along creeks.
Everything except the coastline is flagged `sample: true`. Phase 2
replaces this with sourced data. Standard library only.

    python3 pipeline/build_style_samples.py ne_10m_coastline.geojson
"""

import json
import math
import sys
from pathlib import Path

from clip_coastline import clip_line

ROOT = Path(__file__).resolve().parent.parent
SKETCH = ROOT / "pipeline" / "samples" / "sketch.geojson"
OUT_DIR = ROOT / "data" / "features"

# Wider than the pilot region so the tilted map never shows an edge.
BBOX = (-119.10, 33.55, -117.90, 34.40)
BEACH_LAT = (33.84, 34.042)  # beach strip from Redondo to Santa Monica Canyon
BEACH_WIDTH_M = 140
RIPARIAN_WIDTH_M = 110


def merge_lines(lines):
    """Join clipped pieces end to end into one line."""
    lines = [list(l) for l in lines]
    merged = lines.pop(0)
    while lines:
        best = None
        for i, line in enumerate(lines):
            for rev in (False, True):
                cand = line[::-1] if rev else line
                for at_end in (True, False):
                    a = merged[-1] if at_end else merged[0]
                    b = cand[0] if at_end else cand[-1]
                    d = math.dist(a, b)
                    if best is None or d < best[0]:
                        best = (d, i, cand, at_end)
        _, i, cand, at_end = best
        lines.pop(i)
        merged = merged + cand if at_end else cand + merged
    return merged


def on_edge(p, bbox, eps=1e-6):
    x, y = p
    return (
        abs(x - bbox[0]) < eps
        or abs(x - bbox[2]) < eps
        or abs(y - bbox[1]) < eps
        or abs(y - bbox[3]) < eps
    )


def point_in_polygon(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def ocean_ring(coast, bbox):
    """Close the coastline into an ocean polygon via the bbox's southern corners."""
    xmin, ymin, xmax, ymax = bbox
    line = coast if coast[0][0] < coast[-1][0] else coast[::-1]  # west -> east
    assert on_edge(line[0], bbox) and on_edge(line[-1], bbox), "coast must cross bbox"
    ring = line + [[xmax, ymin], [xmin, ymin], line[0]]
    return ring


def offset(points, metres, side):
    """Offset a polyline sideways by `metres` (side = +1 left, -1 right)."""
    out = []
    for i, (x, y) in enumerate(points):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, len(points) - 1)]
        kx = 111320 * math.cos(math.radians(y))
        dx, dy = (b[0] - a[0]) * kx, (b[1] - a[1]) * 111320
        n = math.hypot(dx, dy) or 1
        nx, ny = -dy / n * side, dx / n * side
        out.append([round(x + nx * metres / kx, 6), round(y + ny * metres / 111320, 6)])
    return out


def strip(points, metres):
    """Polygon of `metres` total width centred on a polyline."""
    left = offset(points, metres / 2, +1)
    right = offset(points, metres / 2, -1)
    return [left + right[::-1] + [left[0]]]


def sample_props(id, type, **extra):
    props = {
        "id": id,
        "type": type,
        "name": None,
        "start_year": None,
        "end_year": None,
        "confidence": "modeled",
        "source_ids": ["style-sample"],
        "sample": True,
    }
    props.update(extra)
    return props


def main(ne_path):
    world = json.loads(Path(ne_path).read_text())
    pieces = []
    for feature in world["features"]:
        geom = feature["geometry"]
        parts = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
        for part in parts:
            pieces.extend(clip_line(part, BBOX))
    # Closed rings are islands (e.g. Terminal Island); leave them out for now.
    pieces = [p for p in pieces if p[0] != p[-1]]
    coast = merge_lines(pieces)
    ring = ocean_ring(coast, BBOX)

    derived = [
        {
            "type": "Feature",
            "properties": {
                "id": "coastline-modern",
                "type": "coastline",
                "name": None,
                "start_year": None,
                "end_year": None,
                "confidence": "documented",
                "source_ids": ["natural-earth-coastline"],
                # Modern coastline standing in for every era until Phase 2.
                "sample": True,
            },
            "geometry": {"type": "LineString", "coordinates": coast},
        },
        {
            "type": "Feature",
            "properties": sample_props("ocean", "ocean", name="Pacific Ocean"),
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        },
    ]

    # Beach: offset the coast inland (whichever side is not ocean).
    beach_coast = [p for p in coast if BEACH_LAT[0] <= p[1] <= BEACH_LAT[1]]
    for side in (+1, -1):
        inland = offset(beach_coast, BEACH_WIDTH_M, side)
        if not point_in_polygon(inland[len(inland) // 2], ring):
            break
    derived.append(
        {
            "type": "Feature",
            "properties": sample_props("beach-santa-monica-bay", "beach"),
            "geometry": {
                "type": "Polygon",
                "coordinates": [beach_coast + inland[::-1] + [beach_coast[0]]],
            },
        }
    )

    sketch = json.loads(SKETCH.read_text())["features"]
    for feature in sketch:
        p = feature["properties"]
        if p["type"] in ("creek", "river"):
            derived.append(
                {
                    "type": "Feature",
                    "properties": sample_props(
                        f"riparian-{p['id']}",
                        "riparian",
                        start_year=p["start_year"],
                        end_year=p["end_year"],
                    ),
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": strip(feature["geometry"]["coordinates"], RIPARIAN_WIDTH_M),
                    },
                }
            )

    datasets = {"landscape": derived, "built": []}
    for feature in sketch:
        props = dict(feature["properties"])
        dataset = props.pop("dataset")
        datasets[dataset].append({**feature, "properties": props})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, features in datasets.items():
        path = OUT_DIR / f"{name}.geojson"
        path.write_text(
            json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
            + "\n"
        )
        print(f"{len(features):3d} features -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1])
