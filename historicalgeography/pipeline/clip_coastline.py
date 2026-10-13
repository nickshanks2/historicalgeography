"""Clip coastline polylines to a bounding box.

Used by build_style_samples.py. Can also be run on its own to clip the
Natural Earth 10m coastline to the pilot region. Standard library only.

    curl -L -o ne_10m_coastline.geojson \
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson
    python3 pipeline/clip_coastline.py ne_10m_coastline.geojson coastline.geojson
"""

import json
import sys

# Santa Monica Bay pilot region: west, south, east, north.
BBOX = (-118.95, 33.70, -118.25, 34.15)


def clip_segment(p, q, bbox):
    """Liang-Barsky clip of segment p-q; returns clipped (p, q) or None."""
    xmin, ymin, xmax, ymax = bbox
    dx, dy = q[0] - p[0], q[1] - p[1]
    t0, t1 = 0.0, 1.0
    for edge_p, edge_q in (
        (-dx, p[0] - xmin),
        (dx, xmax - p[0]),
        (-dy, p[1] - ymin),
        (dy, ymax - p[1]),
    ):
        if edge_p == 0:
            if edge_q < 0:
                return None
            continue
        t = edge_q / edge_p
        if edge_p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return (
        [round(p[0] + t0 * dx, 6), round(p[1] + t0 * dy, 6)],
        [round(p[0] + t1 * dx, 6), round(p[1] + t1 * dy, 6)],
    )


def clip_line(coords, bbox):
    """Clip a polyline, returning the pieces that fall inside bbox."""
    pieces, current = [], []
    for p, q in zip(coords, coords[1:]):
        clipped = clip_segment(p, q, bbox)
        if clipped is None:
            if len(current) > 1:
                pieces.append(current)
            current = []
            continue
        a, b = clipped
        if not current or current[-1] != a:
            if len(current) > 1:
                pieces.append(current)
            current = [a]
        current.append(b)
    if len(current) > 1:
        pieces.append(current)
    return pieces


def main(src, dst):
    with open(src) as f:
        world = json.load(f)

    lines = []
    for feature in world["features"]:
        geom = feature["geometry"]
        parts = (
            [geom["coordinates"]]
            if geom["type"] == "LineString"
            else geom["coordinates"]
        )
        for part in parts:
            lines.extend(clip_line(part, BBOX))

    out = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "type": "water",
                    "confidence": "documented",
                    "source_ids": ["natural-earth-coastline"],
                },
                "geometry": {"type": "MultiLineString", "coordinates": lines},
            }
        ],
    }
    with open(dst, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(lines)} line(s), {sum(len(l) for l in lines)} points -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
