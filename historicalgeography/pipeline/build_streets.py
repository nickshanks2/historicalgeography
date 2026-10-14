"""Streets with their historical names, from data/street_names.json.

For each atlas listed there, takes today's course of each street from the
OpenStreetMap reference (data/reference/osm_streets.geojson), keeps the part
inside the atlas's georeferenced sheets, and writes it as a time-ranged
street feature with the name printed on the map. A dated rename ends the old
name and starts the new one; an undated one ends the old name the year after
it was last seen. Replaces earlier output for the same atlas (and the sample
features it supersedes) in data/features/built.geojson.

Run after georef_from_corners.py:

    python3 pipeline/build_streets.py
"""

import json
import re
from pathlib import Path

import numpy as np
import shapely
from rasterio.control import GroundControlPoint
from rasterio.transform import from_gcps
from shapely.geometry import LineString, Polygon, mapping, shape

ROOT = Path(__file__).resolve().parent.parent
NAMES = ROOT / "data" / "street_names.json"
OSM = ROOT / "data" / "reference" / "osm_streets.geojson"
INDEX = ROOT / "data" / "reference" / "sanborn.json"
GEOREF = ROOT / "data" / "georef"
BUILT = ROOT / "data" / "features" / "built.geojson"
SOURCES = ROOT / "data" / "sources.json"
CREDIT = "Library of Congress, Geography and Map Division, Sanborn Maps Collection"
GAP_DEG = 0.0002  # about 20 m
MIN_LENGTH_DEG = 0.0003  # drop scraps under ~30 m left by clipping


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def footprint(georef):
    """The ground a georeferenced sheet (or its cropped part) covers."""
    x0, y0, x1, y1 = georef.get("crop") or (0, 0, georef["width"], georef["height"])
    affine = from_gcps([GroundControlPoint(row=g["py"], col=g["px"], x=g["lng"], y=g["lat"]) for g in georef["gcps"]])
    return Polygon([affine * (x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))])


def straight_course(course, area):
    """A straight street drawn through where today's course is broken up (e.g.
    the 3rd Street Promenade's planters, or a mall built across it): the line
    through today's pieces near the sheets."""
    near = course.intersection(area.buffer(0.003))
    points = np.array([c for g in getattr(near, "geoms", [near]) for c in g.coords])
    centre = points.mean(axis=0)
    direction = np.linalg.svd(points - centre)[2][0]
    return LineString([centre - direction * 0.05, centre + direction * 0.05])


def main():
    config = json.loads(NAMES.read_text())
    atlases = {a["id"]: a for a in json.loads(INDEX.read_text())["atlases"]}
    sources = {s["id"]: s for s in json.loads(SOURCES.read_text())}
    osm = {}
    for f in json.loads(OSM.read_text())["features"]:
        osm.setdefault(f["properties"]["osm_name"], []).append(shape(f["geometry"]))

    def ensure_source(source_id):
        if source_id not in sources:
            atlas = atlases[source_id.removeprefix("map-")]
            sources[source_id] = {"id": source_id, "title": f"{atlas['title']} ({CREDIT})", "url": atlas["item_url"]}

    built = json.loads(BUILT.read_text())["features"]
    features, drop = [], set()
    for entry in config["atlases"]:
        atlas_id = entry["atlas"]
        atlas = atlases[atlas_id]
        year = atlas["year"]
        source_id = f"map-{atlas_id}"
        ensure_source(source_id)
        drop.update(entry.get("replaces_samples", []))
        prefix = f"street-{atlas['year']}-"
        drop.update(str(f["properties"]["id"]) for f in built if str(f["properties"]["id"]).startswith(prefix))
        parts = {p.stem.removeprefix("sheet-"): footprint(json.loads(p.read_text()))
                 for p in (GEOREF / atlas_id).glob("sheet-*.json")}
        # Neighbouring sheets are cropped to the centre of the street between
        # them; a small buffer closes the slivers so that street isn't cut up.
        groups = {name: shapely.unary_union([parts[s] for s in sheets if s in parts]).buffer(GAP_DEG)
                  for name, sheets in entry["groups"].items()}

        for street in entry["streets"]:
            area = groups[street["within"]]
            if "not_within" in street:
                area = area.difference(groups[street["not_within"]])
            course = shapely.line_merge(shapely.unary_union([g for n in street["osm"] for g in osm.get(n, [])]))
            if street.get("straight"):
                course = straight_course(course, area)
            clipped = course.intersection(area)
            lines = [g for g in getattr(clipped, "geoms", [clipped]) if g.geom_type == "LineString" and g.length > MIN_LENGTH_DEG]
            if not lines:
                print(f"  {street['name']}: not on the georeferenced sheets, skipped")
                continue
            geometry = mapping(shapely.MultiLineString(lines) if len(lines) > 1 else lines[0])
            geometry = json.loads(json.dumps(geometry), parse_float=lambda v: round(float(v), 7))
            base = {
                "type": "street",
                "start_year": year - 2, "start_approx": True,
                "observed_year": year,
                "confidence": "documented",
            }
            note = (f"Named as printed on the {atlas['title']}; course from today's street "
                    f"({', '.join(street['osm'])}), kept where the map shows it.")
            renamed, last_seen = street.get("renamed"), street.get("last_seen")
            props = {"id": f"{prefix}{slug(street['name'])}", "name": street["name"], **base,
                     "source_ids": [source_id], "source_note": note}
            if renamed:
                ensure_source(renamed["source"])
                props.update(end_year=renamed["by"], end_approx=True,
                             source_ids=[source_id, renamed["source"]],
                             source_note=f"{note} {renamed['note']}")
                features.append({"type": "Feature", "properties": props, "geometry": geometry})
                features.append({"type": "Feature", "geometry": geometry, "properties": {
                    "id": f"{prefix}{slug(street['name'])}-later-{slug(renamed['to'])}",
                    "name": renamed["to"], "type": "street",
                    "start_year": renamed["by"], "start_approx": True,
                    "confidence": "documented",
                    "source_ids": [renamed["source"], source_id],
                    "source_note": f"Formerly {street['name']}. {renamed['note']} Course as mapped in {year}.",
                }})
            else:
                if last_seen:
                    ensure_source(last_seen["source"])
                    props.update(end_year=last_seen["year"] + 1, end_approx=True,
                                 source_ids=[source_id, last_seen["source"]],
                                 source_note=f"{note} Still {street['name']} on the {last_seen['year']} map; "
                                             "when it was renamed is not yet known.")
                elif street["name"] not in street["osm"]:
                    # Renamed at an unknown date: kept until the year after it was mapped.
                    props.update(end_year=year + 1, end_approx=True,
                                 source_note=f"{note} Known by this name in {year}; when it was renamed is not yet known.")
                features.append({"type": "Feature", "properties": props, "geometry": geometry})
            print(f"  {street['name']}: {len(lines)} piece(s)")

    kept = [f for f in built if str(f["properties"]["id"]) not in drop]
    merged = sorted(kept + features, key=lambda f: str(f["properties"]["id"]))
    BUILT.write_text('{"type":"FeatureCollection","features":[\n'
                     + ",\n".join(json.dumps(f, separators=(",", ":"), ensure_ascii=False) for f in merged)
                     + "\n]}\n")
    SOURCES.write_text(json.dumps(list(sources.values()), indent=2, ensure_ascii=False) + "\n")
    print(f"{len(features)} streets; removed {len(built) - len(kept)} old or sample features -> {BUILT.name}")


if __name__ == "__main__":
    main()
