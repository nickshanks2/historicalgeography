"""Georeference Sanborn sheets from block corners read off the sheet.

Readings live in pipeline/samples/<atlas>-corners.json: for each sheet, the
pixel position (on a preview SHOWN_WIDTH px wide) of block corners, the
avenue and street meeting there (by today's names), which side of each the
block lies on, and the street widths printed on the sheet. The real corner
is the OSM centreline intersection offset by half of each street's width:

  sSide +1: block on the inland (higher-numbered) side of the street
  aSide +1: block on the south-east (Colorado-ward) side of the avenue

A street written "4th Street|3rd Street" is the alley midway between them.
A part with "similarity": true is fitted with scale, rotation and shift only,
for sheets whose surviving corners lie along a single street.

Writes data/georef/<atlas>/sheet-<n>.json for build_sanborn.py and prints
each sheet's affine residuals.

    python3 pipeline/georef_from_corners.py sanborn-santa-monica-1902-07
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape
from shapely.ops import nearest_points

ROOT = Path(__file__).resolve().parent.parent
OSM = ROOT / "data" / "reference" / "osm_streets.geojson"
INDEX = ROOT / "data" / "reference" / "sanborn.json"
FT = 0.3048


def main(atlas_id):
    readings = json.loads((ROOT / "pipeline" / "samples" / f"{atlas_id}-corners.json").read_text())
    shown = readings["shown_width"]
    atlas = next(a for a in json.loads(INDEX.read_text())["atlases"] if a["id"] == atlas_id)
    streets = {}
    for f in json.loads(OSM.read_text())["features"]:
        streets.setdefault(f["properties"]["osm_name"], []).append(shape(f["geometry"]))
    merged = {name: shapely.unary_union(parts) for name, parts in streets.items()}

    aliases = readings.get("aliases", {})

    def street_line(name):
        names = aliases.get(name, [name])
        return shapely.unary_union([merged[n] for n in names if n in merged])

    def crossing(a, b):
        # "4th Street|3rd Street" is the alley midway between two streets.
        if "|" in b:
            p, q = (crossing(a, s) for s in b.split("|"))
            return shapely.Point((p.x + q.x) / 2, (p.y + q.y) / 2)
        la, lb = street_line(a), street_line(b)
        hit = la.intersection(lb)
        if not hit.is_empty:
            return hit.centroid
        # A street that ends at a T-junction is sometimes drawn stopping just
        # short of the other: take the point on the through street.
        pa, pb = nearest_points(la, lb)
        if pa.distance(pb) * 111_320 > 30:
            raise ValueError(f"{a} and {b} don't meet in OSM")
        ends_a = min(pa.distance(e) for g in getattr(la, "geoms", [la]) for e in g.boundary.geoms)
        return pb if ends_a < 1e-6 else pa

    kx = 111_320 * math.cos(math.radians(34.02))

    def unit(p, q):
        dx, dy = (q.x - p.x) * kx, (q.y - p.y) * 111_320
        n = math.hypot(dx, dy)
        return dx / n, dy / n

    grid = readings["grid"]
    u_inland = unit(crossing(*grid["inland"][0]), crossing(*grid["inland"][1]))
    u_se = unit(crossing(*grid["southeast"][0]), crossing(*grid["southeast"][1]))

    for sheet_n, entry in readings["sheets"].items():
        sheet = next(s for s in atlas["sheets"] if s["n"] == int(sheet_n))
        scale = sheet["width"] / shown
        # A sheet is either a list of points, or separate parts (insets drawn
        # on one page), each with its own crop and points.
        parts = entry["parts"] if isinstance(entry, dict) else [{"id": "", "points": entry}]
        for part in parts:
            gcps = []
            for x, y, avenue, street, a_side, s_side, *widths in part["points"]:
                aw, sw = widths if widths else (80, 80)
                c = crossing(avenue, street)
                dx = (s_side * sw / 2 * u_inland[0] + a_side * aw / 2 * u_se[0]) * FT
                dy = (s_side * sw / 2 * u_inland[1] + a_side * aw / 2 * u_se[1]) * FT
                gcps.append({
                    "px": round(x * scale), "py": round(y * scale),
                    "lng": round(c.x + dx / kx, 7), "lat": round(c.y + dy / 111_320, 7),
                    "corner": f"{avenue} / {street}",
                })
            lat0, lng0 = np.mean([g["lat"] for g in gcps]), np.mean([g["lng"] for g in gcps])
            x = np.array([(g["lng"] - lng0) * kx for g in gcps])
            y = np.array([(g["lat"] - lat0) * 111_320 for g in gcps])
            if part.get("similarity"):
                # Corners along one line only (the rest of the old grid is
                # gone): fit scale, rotation and shift, which a sheet drawn to
                # scale allows, and add the sheet corners it implies so the
                # affine warp in build_sanborn.py reproduces it.
                z = np.array([complex(g["px"], -g["py"]) for g in gcps])
                w = x + 1j * y
                (m, b), *_ = np.linalg.lstsq(np.stack([z, np.ones_like(z)], 1), w, rcond=None)
                res = np.abs(m * z + b - w)
                x0, y0, x1, y1 = (v * scale for v in part.get("crop", (0, 0, shown, sheet["height"] / scale)))
                for cxp, cyp in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
                    q = m * complex(cxp, -cyp) + b
                    gcps.append({
                        "px": round(cxp), "py": round(cyp),
                        "lng": round(lng0 + q.real / kx, 7), "lat": round(lat0 + q.imag / 111_320, 7),
                        "corner": "sheet corner implied by the fit (scale, rotation, shift)",
                    })
            else:
                # Affine residuals in metres.
                a = np.array([[g["px"], g["py"], 1] for g in gcps], float)
                cx = np.linalg.lstsq(a, x, rcond=None)[0]
                cy = np.linalg.lstsq(a, y, rcond=None)[0]
                res = np.hypot(a @ cx - x, a @ cy - y)
            name = f"{sheet_n}{part['id']}"
            print(f"sheet {name}: {len(res)} points{' (similarity)' if part.get('similarity') else ''}, "
                  f"rms {np.sqrt((res ** 2).mean()):.1f} m, max {res.max():.1f} m (point {int(res.argmax()) + 1})")
            out = ROOT / "data" / "georef" / atlas_id / f"sheet-{name}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            record = {
                "atlas": atlas_id, "sheet": int(sheet_n), "part": part["id"], "iiif": sheet["iiif"],
                "width": sheet["width"], "height": sheet["height"], "gcps": gcps,
                "note": "Block corners read off the sheet; real corners from OSM street centrelines "
                        "offset by half the street widths printed on the sheet "
                        f"(pipeline/samples/{atlas_id}-corners.json).",
            }
            if "crop" in part:
                record["crop"] = [round(v * scale) for v in part["crop"]]
            out.write_text(json.dumps(record, indent=1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
