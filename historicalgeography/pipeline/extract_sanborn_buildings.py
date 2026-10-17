"""Extract building footprints from georeferenced Sanborn sheets by colour.

Sanborn maps colour each building by how it was built (1902 key: yellow
frame, pink brick, blue stone, grey-green iron or special). For every sheet
part pinned in data/georef/<atlas>/, this finds those fills, closes the holes
left by lettering, splits buildings at the black walls drawn between them,
and places the outlines with the same affine fit build_sanborn.py uses.

The footprints replace earlier ones from the same atlas in
data/features/built.geojson (other features are kept). They are labelled
documented and sourced to the atlas, with how they were made in source_note.

    python3 pipeline/extract_sanborn_buildings.py sanborn-santa-monica-1902-07 [--preview DIR]
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
import rasterio.features
import rasterio.windows
from rasterio.control import GroundControlPoint
from rasterio.enums import Resampling
from rasterio.transform import from_gcps
from scipy import ndimage
from shapely import unary_union
from shapely.geometry import mapping, shape
from shapely.strtree import STRtree

from build_sanborn import GEOREF, INDEX, RAW, download

BUILT = Path(__file__).resolve().parent.parent / "data" / "features" / "built.geojson"
# Work at half the scan's resolution (about 9 px per metre): plenty for
# outlines, and four times less to process.
DECIMATE = 2
MIN_AREA_M2 = 1  # privies and sheds are drawn; specks of colour are not buildings
MIN_STONE_M2 = 12
MAX_AREA_M2 = 6000  # bigger "buildings" are the coloured sea on beach sheets
CLOSE_DEG = 0.000007  # about 0.7 m
EDGE_DEG = 0.000001  # about 0.1 m
CLASSES = {1: "frame", 2: "brick", 3: "stone", 4: "iron or special"}
# Machine-readable construction, for map colours.
MATERIALS = {"frame": "frame", "brick": "brick", "stone": "stone", "iron or special": "iron_or_special"}
SUBTYPES = {
    "frame": "Frame (wood) building",
    "brick": "Brick building",
    "stone": "Stone building",
    "iron or special": "Iron-clad or special building",
}


def classify(rgb):
    """Label each pixel 0 (paper, ink) or a construction class from its colour."""
    r, g, b = (rgb[i].astype(np.int16) for i in range(3))
    labels = np.zeros(r.shape, np.uint8)
    labels[(r > 200) & (g > 185) & (g - b > 35) & (np.abs(r - g) < 35)] = 1  # yellow
    labels[(r > 180) & (r - g > 35) & (r - b > 25)] = 2  # pink / red
    labels[(b - r > 20) & (b > 140) & (b - g > 0)] = 3  # blue
    labels[(g - r > 8) & (g > 120) & (g < 200) & (g - b > 0)] = 4  # grey-green
    return labels


def pixel_area_m2(affine, lat):
    """Ground area of one (decimated) pixel, from the lng/lat affine."""
    kx = 111_320 * math.cos(math.radians(lat))
    return abs(affine.a * affine.e - affine.b * affine.d) * kx * 111_320


def extract_part(georef, image):
    x0, y0, x1, y1 = georef.get("crop") or (0, 0, None, None)
    gcps = [
        GroundControlPoint(row=(g["py"] - y0) / DECIMATE, col=(g["px"] - x0) / DECIMATE, x=g["lng"], y=g["lat"])
        for g in georef["gcps"]
    ]
    affine = from_gcps(gcps)
    with rasterio.open(image) as src:
        window = rasterio.windows.Window.from_slices((y0, y1 or src.height), (x0, x1 or src.width))
        h, w = int(window.height) // DECIMATE, int(window.width) // DECIMATE
        rgb = src.read(window=window, out_shape=(src.count, h, w), resampling=Resampling.average)
    labels = classify(rgb)
    filled = ndimage.binary_fill_holes(ndimage.binary_opening(labels > 0, iterations=1))
    # Lettering inside a building leaves holes; give them the building's class.
    nearest = ndimage.distance_transform_edt(labels == 0, return_distances=False, return_indices=True)
    labels = np.where(filled, labels[tuple(nearest)], 0).astype(np.uint8)
    components, count = ndimage.label(filled)
    px_area = pixel_area_m2(affine, georef["gcps"][0]["lat"])
    px_deg_to_m2 = px_area / abs(affine.a * affine.e - affine.b * affine.d)

    found = []
    sizes = ndimage.sum_labels(np.ones_like(components), components, index=np.arange(1, count + 1))
    keep = {i + 1 for i, n in enumerate(sizes) if MIN_AREA_M2 <= n * px_area <= MAX_AREA_M2}
    for geom, value in rasterio.features.shapes(components.astype(np.int32), mask=components > 0, transform=affine):
        if value not in keep:
            continue
        poly = shape(geom)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.geom_type != "Polygon":
            poly = max(getattr(poly, "geoms", [poly]), key=lambda p: p.area)
        poly = shape({"type": "Polygon", "coordinates": [list(poly.exterior.coords)]})
        # Thin slivers are lines drawn in colour (e.g. the shore), not buildings.
        rect = poly.minimum_rotated_rectangle
        edges = [math.dist(a, b) for a, b in zip(rect.exterior.coords, list(rect.exterior.coords)[1:3])]
        if min(edges) / max(edges) < 0.04:
            continue
        cls = np.bincount(labels[components == value], minlength=5)[1:].argmax() + 1
        # Close notches left where lettering or an "x" touches the wall, and
        # take back the half of the black wall line the colour stops at.
        poly = poly.buffer(CLOSE_DEG, join_style="mitre").buffer(-CLOSE_DEG + EDGE_DEG, join_style="mitre")
        if poly.geom_type != "Polygon":
            poly = max(poly.geoms, key=lambda p: p.area)
        found.append((poly.simplify(0.000003), CLASSES[cls]))
    found = merge_crossed(found)
    # Small blue circles are water tanks and blue ribbons are pools or the
    # sea, not stone buildings.
    return [
        (p, c) for p, c in found
        if rectangularity(p) >= 0.3 and not (c == "stone" and p.area * px_deg_to_m2 < MIN_STONE_M2)
    ]


def rectangularity(poly):
    return poly.area / poly.minimum_rotated_rectangle.area


def merge_crossed(found):
    """Rejoin buildings drawn with an X across them, which split into triangles.

    Small pieces that are not rectangles themselves are merged, two to four
    at a time, when they lie within the X's line width (up to ~0.7 m) of each
    other and together span a rectangle. Neighbouring buildings that don't
    make up a rectangle together are kept apart.
    """
    odd = [i for i, (p, _) in enumerate(found) if rectangularity(p) < 0.75 and p.area < 4e-9]
    tree = STRtree([found[i][0].buffer(0.0000035) for i in odd])
    touching = {i: {odd[j] for j in tree.query(found[i][0]) if odd[j] != i} for i in odd}

    def fill(members):
        union = unary_union([found[i][0] for i in members])
        rect = union.minimum_rotated_rectangle
        if union.area / rect.area < 0.5:
            return 0, rect
        return union.convex_hull.area / rect.area, rect

    used, merged = set(), []
    for i in odd:
        if i in used:
            continue
        best = None
        sets, frontier = set(), {frozenset([i])}
        for _ in range(3):  # grow to groups of up to four pieces
            frontier = {g | {n} for g in frontier for m in g for n in touching[m] if n not in g and n not in used}
            sets |= frontier
        for members in sets:
            score, rect = fill(members)
            if score > 0.8 and (best is None or (len(members), score) > (len(best[0]), best[1])):
                best = (members, score, rect)
        if best:
            used |= best[0]
            merged.append((best[2], found[i][1]))
    return [f for i, f in enumerate(found) if i not in used] + merged


def main(atlas_id, preview):
    atlas = next(a for a in json.loads(INDEX.read_text())["atlases"] if a["id"] == atlas_id)
    source_id = f"map-{atlas_id}"
    year = atlas["year"]
    prefix = f"{atlas_id}-bldg-"

    def part_order(p):
        name = p.stem.split("-", 1)[1]
        return int("".join(c for c in name if c.isdigit())), name

    placed, features = [], []
    for path in sorted((GEOREF / atlas_id).glob("sheet-*.json"), key=part_order):
        georef = json.loads(path.read_text())
        image = download(georef["iiif"], RAW / atlas_id / f"sheet-{georef['sheet']}.jpg")
        part = f"{georef['sheet']}{georef.get('part', '')}"
        found = extract_part(georef, image)
        tree = STRtree([p for p, _ in placed]) if placed else None
        added = 0
        for poly, cls in found:
            ring = []
            for x, y in poly.exterior.coords:
                point = [round(x, 6), round(y, 6)]  # about 10 cm
                if not ring or point != ring[-1]:
                    ring.append(point)
            if len(ring) < 4:
                continue
            # Sheets and insets overlap a little at their edges: keep the first.
            if tree is not None and any(
                poly.intersection(placed[i][0]).area > 0.5 * min(poly.area, placed[i][0].area)
                for i in tree.query(poly)
            ):
                continue
            placed.append((poly, cls))
            added += 1
            features.append({
                "type": "Feature",
                "properties": {
                    "id": f"{prefix}{part}-{added}",
                    "type": "building",
                    "subtype": SUBTYPES[cls],
                    "material": MATERIALS[cls],
                    # Standing when the map was drawn; when each was built is
                    # unknown. Later atlases will set real end years.
                    "start_year": year - 2, "start_approx": True,
                    "end_year": year + 1, "end_approx": True,
                    "observed_year": year,
                    "confidence": "documented",
                    "source_ids": [source_id],
                    "source_note": f"Outline traced by computer from its colour on sheet {georef['sheet']}; "
                                   "porches and adjoining buildings may be merged or split.",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [ring],
                },
            })
        counts = {c: sum(1 for _, k in found if k == c) for c in CLASSES.values()}
        print(f"sheet {part}: {added} buildings ({', '.join(f'{n} {c}' for c, n in counts.items() if n)})", flush=True)
        if preview:
            Path(preview).mkdir(parents=True, exist_ok=True)
            (Path(preview) / f"{part}.geojson").write_text(json.dumps({
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "properties": {"c": c}, "geometry": mapping(p)} for p, c in found],
            }))

    built = json.loads(BUILT.read_text())
    kept = [f for f in built["features"] if not str(f["properties"]["id"]).startswith(prefix)]
    merged = sorted(kept + features, key=lambda f: str(f["properties"]["id"]))
    BUILT.write_text('{"type":"FeatureCollection","features":[\n'
                     + ",\n".join(json.dumps(f, separators=(",", ":"), ensure_ascii=False) for f in merged)
                     + "\n]}\n")
    print(f"{len(features)} buildings from {atlas_id}; {len(kept)} other features kept -> {BUILT.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas")
    parser.add_argument("--preview", help="also write each part's raw outlines here")
    args = parser.parse_args()
    main(args.atlas, args.preview)
