"""Build the pre-1900 landscape dataset from real sources (Phase 2).

Inputs (run fetch_sources.py first):
- Ballona Historical Ecology GIS: lowland habitats, channels and springs
- LANDFIRE Biophysical Settings: pre-settlement vegetation elsewhere
- NOAA T-sheets: the shoreline and ocean as surveyed in the 1870s and 1933
- USGS NHD: named canyon creeks outside the Ballona study area
- pipeline/samples/sketch.geojson: Phase 1 samples still without a source
  (villages, trails, ranchos, adobes, the pre-1825 LA River), kept flagged

Outputs:
- data/features/landscape.geojson   canonical, time-ranged (see CLAUDE.md)
- data/tiles/landscape.pmtiles       what the map loads
- data/sources.json                  source entries for every T-sheet used

Time ranges: natural features carry no start year (they predate our earliest
era). Their end is unknown until Phases 3-4 map later change, so each is
kept until 1900 or the year after its source last saw it, whichever is
later, marked approximate.

    python3 pipeline/build_landscape.py
"""

import heapq
import json
import math
import re
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

import numpy as np
import pyogrio
import rasterio
import rasterio.features
import shapely
import shapely.ops
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, shape

import natural_earth
from esri_mdb import read_table
from geom_utils import polygons, rounded, smooth, to_wgs, to_work

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "pipeline" / "raw"
SKETCH = ROOT / "pipeline" / "samples" / "sketch.geojson"
OUT_GEOJSON = ROOT / "data" / "features" / "landscape.geojson"
OUT_PMTILES = ROOT / "data" / "tiles" / "landscape.pmtiles"
SOURCES = ROOT / "data" / "sources.json"

# Land cover and creeks are built for the pilot region; the ocean extends
# further so the tilted map never shows its edge.
LAND_BBOX = (-118.95, 33.70, -118.20, 34.20)
OCEAN_BBOX = (-119.10, 33.55, -117.90, 34.40)

NATURAL_END_YEAR = 1900

BALLONA_TYPES = {
    "Valley Freshwater Marsh": "wetland",
    "Wet Meadow": "wetland",
    "Alkali Meadow": "wetland",
    "Vernal Pool": "wetland",
    "Salt Marsh/Tidal Marsh": "salt_marsh",
    "Salt Flat/Tidal Flat": "flat",
    "Alkali Flat": "flat",
    "Willow Thicket": "riparian",
    "Open Water": "water",
    "Pond": "water",
    "Lake": "water",
    "Dune": "dune",
    "Beach": "beach",
}

# LANDFIRE Biophysical Settings names -> our land-cover types. Classes not
# listed (open water, barren, tiny conifer patches) are left out: the ocean
# and lowland water come from NOAA and Ballona.
LANDFIRE_TYPES = {
    "Southern California Coastal Scrub": "coastal_sage_scrub",
    "Southern California Dry-Mesic Chaparral": "chaparral",
    "California Mesic Chaparral": "chaparral",
    "California Maritime Chaparral": "chaparral",
    "Northern and Central California Dry-Mesic Chaparral": "chaparral",
    "California Xeric Serpentine Chaparral": "chaparral",
    "Sonora-Mojave Semi-Desert Chaparral": "chaparral",
    "California Montane Woodland and Chaparral": "chaparral",
    "Southern California Oak Woodland and Savanna": "oak_woodland",
    "California Coastal Live Oak Woodland and Savanna": "oak_woodland",
    "California Central Valley Mixed Oak Savanna": "oak_woodland",
    "Central and Southern California Mixed Evergreen Woodland": "oak_woodland",
    "California Montane Riparian Systems": "riparian",
    "California Central Valley and Southern Coastal Grassland": "grassland",
    "California Mesic Serpentine Grassland": "grassland",
    "Pacific Coastal Marsh Systems": "salt_marsh",
}

# Ballona certainty codes -> our confidence levels.
CERTAINTY = {"H": "documented", "M": "inferred", "L": "modeled"}
CONFIDENCE_RANK = ["modeled", "inferred", "documented"]

# NOAA T-sheet shoreline generations: the project geodatabase inside each zip.
TSHEET_GENERATIONS = [
    {"zip": "T-01427", "project": "CA34A07", "start_year": None, "end_year": 1933},
    {"zip": "T-04828", "project": "CA34C01", "start_year": 1933, "end_year": None},
]

# Phase 1 sample types kept until a sourced dataset replaces them.
SAMPLE_TYPES_KEPT = {"village", "trail", "rancho", "adobe", "river"}


def feature(geom, **props):
    return {"type": "Feature", "properties": props, "geometry": shapely.geometry.mapping(geom)}


def natural_end(observed_year):
    return max(NATURAL_END_YEAR, (observed_year or 0) + 1)


def first_year(*texts):
    years = [int(y) for t in texts if t for y in re.findall(r"\b(1[6-9]\d\d)\b", str(t))]
    return min(years) if years else None


def lowest(*levels):
    levels = [l for l in levels if l]
    return min(levels, key=CONFIDENCE_RANK.index) if levels else "inferred"


# --- NOAA T-sheets ---------------------------------------------------------


def tsheet_generation(gen, ne_ocean, index, tmp):
    """Ocean polygon + coastline for one survey generation, in UTM."""
    outer = zipfile.ZipFile(RAW / "noaa" / f"{gen['zip']}.zip")
    inner = next(n for n in outer.namelist() if n.endswith(f"{gen['project']}.zip"))
    outer.extract(inner, tmp)
    zipfile.ZipFile(Path(tmp) / inner).extractall(tmp)
    mdb = next(p for p in Path(tmp).iterdir() if p.name.lower() == f"{gen['project'].lower()}.mdb")
    project = gen["project"].lower()

    water, covered = [], []
    for row, _, parts in read_table(str(mdb), f"{project}polys_83"):
        if not parts:
            continue
        poly = shapely.make_valid(Polygon(parts[0], parts[1:]))
        covered.append(poly)
        if (row.get("f_name") or row.get("F_NAME") or "").lower() == "water":
            water.append(poly)

    # Which surveys drew the shoreline inside our region.
    region = box(*LAND_BBOX)
    survey_ids = Counter()
    for row, _, parts in read_table(str(mdb), f"{project}lines_83"):
        sid = row.get("Source_ID") or row.get("T_SHEET_") or ""
        if parts and any(region.intersects(LineString(p)) for p in parts if len(p) > 1):
            survey_ids[normalise_survey(sid)] += 1
    survey_ids = sorted(s for s in survey_ids if s in index)

    bbox = box(*OCEAN_BBOX)
    water_u = shapely.unary_union(water).intersection(bbox)
    covered_u = shapely.unary_union(covered).intersection(bbox)
    # Natural Earth fills in only where the survey doesn't reach.
    ocean = shapely.unary_union([water_u, ne_ocean.difference(covered_u)])
    ocean_w = to_work(ocean).buffer(40).buffer(-40)  # close seams between sources
    years = [index[s]["SURV_DATE"] for s in survey_ids]
    return ocean_w, survey_ids, (min(years), max(years))


def grid_cells(geom, size):
    x0, y0, x1, y1 = geom.bounds
    for x in range(int(x0 // size), int(x1 // size) + 1):
        for y in range(int(y0 // size), int(y1 // size) + 1):
            part = geom.intersection(box(x * size, y * size, (x + 1) * size, (y + 1) * size))
            if not part.is_empty and part.area > 1:
                yield part


def normalise_survey(sid):
    m = re.match(r"T-?0*(\d+)([A-Z]?)", sid.strip().upper())
    return f"T-{int(m.group(1)):05d}{m.group(2)}" if m else sid


def tsheet_features(index):
    ne_ring = natural_earth.ocean_ring(RAW / "naturalearth" / "ne_10m_coastline.geojson", OCEAN_BBOX)
    ne_ocean = Polygon(ne_ring)
    out, land_by_gen, source_ids = [], [], set()
    edge = to_work(box(*OCEAN_BBOX).exterior).buffer(5)
    with tempfile.TemporaryDirectory() as tmp:
        for gen in TSHEET_GENERATIONS:
            ocean_w, surveys, (y0, y1) = tsheet_generation(gen, ne_ocean, index, tmp)
            ids = [f"noaa-{s}" for s in surveys] + ["natural-earth-coastline"]
            source_ids.update(surveys)
            label = f"{y0}" if y0 == y1 else f"{y0}–{y1}"
            common = {
                "start_year": gen["start_year"],
                "end_year": gen["end_year"],
                "observed_year": y0,
                "confidence": "documented",
                "source_ids": ids,
                "source_note": f"NOAA shoreline surveys of {label}; Natural Earth where they don't reach.",
            }
            # Cut the ocean into 10 km squares: one huge polygon overflows
            # MapLibre's per-tile fill buffers.
            for i, cell in enumerate(grid_cells(ocean_w, 10_000)):
                out.append(feature(rounded(to_wgs(cell)), id=f"ocean-{y0}-{i}", type="ocean",
                                   name="Pacific Ocean", **common))
            coast = ocean_w.boundary.difference(edge)
            out.append(feature(rounded(to_wgs(coast.simplify(3))), id=f"coastline-{y0}",
                               type="coastline", **common))
            land_by_gen.append(to_work(box(*LAND_BBOX)).difference(ocean_w))
    return out, land_by_gen[0], sorted(source_ids)


# --- Ballona Historical Ecology ----------------------------------------------


def ballona_features():
    out, footprint = [], []
    base = "/vsizip/" + str(RAW / "ballona")

    def rows(zip_name, shp):
        meta, _, geoms, field_data = pyogrio.raw.read(f"{base}/{zip_name}/{shp}")
        names = list(meta["fields"])
        crs = meta["crs"]
        for i, wkb in enumerate(geoms):
            props = {n: _clean(field_data[j][i]) for j, n in enumerate(names)}
            yield props, to_work(shapely.from_wkb(wkb), crs)

    for props, geom in rows("Habitat_Shapefile.zip", "Habitat.shp"):
        kind = BALLONA_TYPES.get(props["Habitat_Ty"])
        if not kind or geom.is_empty:
            continue
        footprint.append(geom)
        observed = first_year(props["S_Digitize"])
        out.append(feature(
            rounded(to_wgs(smooth(geom.simplify(4), 1))),
            id=f"ballona-habitat-{props['ID']}",
            type=kind,
            subtype=props["Habitat_Ty"],
            start_year=None,
            end_year=natural_end(observed),
            end_approx=True,
            observed_year=observed,
            confidence=lowest(CERTAINTY.get(props["Interp_Cer"]), CERTAINTY.get(props["Shape_Cert"])),
            source_ids=["ballona-he"],
            source_note=_source_note(props),
        ))

    channels = []
    for props, geom in rows("Channels_Shapefile.zip", "Channels.shp"):
        if geom.is_empty:
            continue
        channels.append(geom)
        observed = first_year(props["S_Digitize"])
        out.append(feature(
            rounded(to_wgs(geom.simplify(3))),
            id=f"ballona-channel-{props['ID']}",
            type="creek",
            name=props.get("Name"),
            start_year=None,
            end_year=natural_end(observed),
            end_approx=True,
            observed_year=observed,
            confidence=lowest(CERTAINTY.get(props["Interp_Cer"]), CERTAINTY.get(props["Shape_Cert"])),
            source_ids=["ballona-he"],
            source_note=_source_note(props),
        ))

    for i, (props, geom) in enumerate(rows("Springs_Shapefile.zip", "Springs.shp")):
        observed = first_year(props["S_Digitize"])
        out.append(feature(
            rounded(to_wgs(geom)),
            id=f"ballona-spring-{i + 1}",
            type="spring",
            start_year=None,
            end_year=natural_end(observed),
            end_approx=True,
            observed_year=observed,
            confidence=lowest(CERTAINTY.get(props["Interp_Cer"]), CERTAINTY.get(props["Loc_Cert"])),
            source_ids=["ballona-he"],
            source_note=_source_note(props),
        ))

    study_area = shapely.unary_union(footprint + [c.buffer(150) for c in channels]).convex_hull
    return out, shapely.unary_union(footprint), study_area, channels


def _clean(value):
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, str):
        value = value.strip()
        return value or None
    if isinstance(value, float) and np.isnan(value):
        return None
    return value.item() if hasattr(value, "item") else value


def _source_note(props):
    digitized = props.get("S_Digitize")
    interp = [props.get("S_Interp1"), props.get("S_Interp2")]
    note = f"Mapped from: {digitized}." if digitized else ""
    interp = [i for i in interp if i]
    if interp:
        note += f" Interpreted with: {', '.join(interp)}."
    return note.strip() or None


# --- LANDFIRE Biophysical Settings --------------------------------------------


def landfire_features(land_w, ballona_footprint_w):
    zip_path = f"/vsizip/{RAW / 'landfire' / 'LF2020_BPS_CONUS.zip'}/LF2020_BPS_CONUS/Tif"
    meta, _, _, field_data = pyogrio.raw.read(f"{zip_path}/LF2020_BPS_CONUS.tif.vat.dbf")
    names = list(meta["fields"])
    values = field_data[names.index("Value")]
    bps_names = field_data[names.index("BPS_NAME")]
    type_ids = {t: i + 1 for i, t in enumerate(sorted(set(LANDFIRE_TYPES.values())))}
    lookup = {int(v): type_ids[LANDFIRE_TYPES[n]] for v, n in zip(values, bps_names) if n in LANDFIRE_TYPES}
    subtype_of = {int(v): n for v, n in zip(values, bps_names)}

    with rasterio.open(f"{zip_path}/LF2020_BPS_CONUS.tif") as src:
        bounds = transform_bounds("EPSG:4326", src.crs, *LAND_BBOX)
        window = from_bounds(*bounds, src.transform).round_offsets().round_lengths()
        bps = src.read(1, window=window)
        transform = src.window_transform(window)
        crs = src.crs.to_string()

    classes = np.zeros(bps.shape, np.uint8)
    for value, type_id in lookup.items():
        classes[bps == value] = type_id
    # Merge patches under ~4 ha into their surroundings so polygons read as
    # landscape, not pixels.
    classes = rasterio.features.sieve(classes, size=45, connectivity=8)

    # Most common BpS name per type, for the inspect panel.
    dominant = {}
    for type_name, type_id in type_ids.items():
        mask = classes == type_id
        if mask.any():
            common = Counter(bps[mask].tolist()).most_common(1)[0][0]
            dominant[type_name] = subtype_of.get(common)

    keep_out = ballona_footprint_w.buffer(10)
    names_by_id = {i: t for t, i in type_ids.items()}
    out, n = [], 0
    for geom, value in rasterio.features.shapes(classes, mask=classes > 0, transform=transform):
        type_name = names_by_id[int(value)]
        poly = to_work(shape(geom), crs).simplify(18)
        # Smooth, then thin the extra vertices smoothing adds.
        poly = smooth(poly, 2).simplify(6).intersection(land_w).difference(keep_out)
        for part in polygons(poly):
            if part.area < 40_000:  # 4 ha
                continue
            n += 1
            out.append(feature(
                rounded(to_wgs(part)),
                id=f"landfire-{n}",
                type=type_name,
                subtype=dominant.get(type_name),
                start_year=None,
                end_year=NATURAL_END_YEAR,
                end_approx=True,
                confidence="modeled",
                source_ids=["landfire-bps"],
                source_note="Modeled pre-settlement vegetation (LANDFIRE Biophysical Settings, 30 m).",
            ))
    return out


# --- USGS NHD creeks -------------------------------------------------------------


def nhd_features(study_area_w, land_w):
    path = f"/vsizip/{RAW / 'nhd' / 'NHD_H_18070104_HU8_GPKG.zip'}/NHD_H_18070104_HU8_GPKG.gpkg"
    meta, _, geoms, field_data = pyogrio.raw.read(
        path, layer="NHDFlowline", columns=["permanent_identifier", "gnis_name", "ftype"],
        where="ftype = 460", bbox=LAND_BBOX,
    )
    names = list(meta["fields"])
    outside = land_w.difference(study_area_w)
    out = []
    for i, wkb in enumerate(geoms):
        line = shapely.force_2d(to_work(shapely.from_wkb(wkb), meta["crs"])).intersection(outside)
        name = _clean(field_data[names.index("gnis_name")][i])
        # Named streams, plus unnamed ones long enough to read at our zooms.
        if line.is_empty or (not name and line.length < 1200):
            continue
        out.append(feature(
            rounded(to_wgs(line.simplify(5))),
            id=f"nhd-{_clean(field_data[names.index('permanent_identifier')][i])}",
            type="creek",
            name=name,
            start_year=None,
            end_year=None,
            confidence="inferred",
            source_ids=["usgs-nhd"],
            source_note="Modern USGS mapping of a natural canyon stream, assumed largely unchanged.",
        ))
    return out


# --- Output ------------------------------------------------------------------------


def kept_samples(channels_w, land_w):
    out = []
    for f in json.loads(SKETCH.read_text())["features"]:
        props = dict(f["properties"])
        if props.pop("dataset") != "landscape" or props["type"] not in SAMPLE_TYPES_KEPT:
            continue
        geom = to_work(shape(f["geometry"]))
        if props["id"] == "river-la-via-ballona":
            geom = route_via_channels(geom, channels_w)
            props["source_ids"] = ["style-sample", "ballona-he"]
            props["source_note"] = (
                "Sample: the upper course is sketched; below the Ballona Gap it follows "
                "the channels mapped by the Ballona Historical Ecology Project."
            )
        if props["type"] in ("river", "trail"):
            parts = [g for g in getattr(geom.intersection(land_w), "geoms", [geom.intersection(land_w)])
                     if g.length > 150]
            geom = shapely.line_merge(shapely.MultiLineString(parts)) if parts else geom
        out.append(feature(rounded(to_wgs(geom)), **props))
    return out


def route_via_channels(sketch, channels, bridge=150.0):
    """Route a sketched river along the mapped channel network.

    The network is noded where channels cross and small gaps are bridged,
    then the river follows the shortest channel path from where the sketch
    first meets the main network to the point on it nearest the sketch's mouth."""
    noded = shapely.node(shapely.MultiLineString(
        [list(p.coords) for line in channels for p in getattr(line, "geoms", [line])]
    ))
    graph, nodes = {}, set()
    for seg in noded.geoms:
        pts = [tuple(round(c, 1) for c in pt) for pt in seg.coords]
        for a, b in zip(pts, pts[1:]):
            d = math.dist(a, b)
            graph.setdefault(a, []).append((b, d))
            graph.setdefault(b, []).append((a, d))
            nodes.update((a, b))
    # Bridge small gaps between dangling ends and nearby nodes.
    tree_nodes = list(nodes)
    tree = shapely.STRtree([Point(n) for n in tree_nodes])
    for n in [n for n, edges in graph.items() if len(edges) == 1]:
        for i in tree.query(Point(n).buffer(bridge)):
            m = tree_nodes[i]
            if m != n and all(m != e for e, _ in graph[n]):
                d = math.dist(n, m)
                graph[n].append((m, d))
                graph[m].append((n, d))

    def shortest(start, goal):
        dist, prev, queue = {start: 0.0}, {}, [(0.0, start)]
        while queue:
            d, node = heapq.heappop(queue)
            if node == goal:
                break
            if d > dist.get(node, math.inf):
                continue
            for nxt, w in graph[node]:
                if d + w < dist.get(nxt, math.inf):
                    dist[nxt], prev[nxt] = d + w, node
                    heapq.heappush(queue, (d + w, nxt))
        if goal not in dist:
            return None
        path = [goal]
        while path[-1] != start:
            path.append(prev[path[-1]])
        return path[::-1]

    # The river runs along the main (largest connected) channel network.
    seen, linked = set(), []
    for start in graph:
        if start in seen:
            continue
        component, todo = [start], [start]
        seen.add(start)
        while todo:
            for nxt, _ in graph[todo.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    todo.append(nxt)
                    component.append(nxt)
        if len(component) > len(linked):
            linked = component
    linked_tree = shapely.STRtree([Point(n) for n in linked])
    goal = linked[linked_tree.nearest(Point(sketch.coords[-1]))]

    # Keep the sketch until it first reaches that network, then follow the
    # network's shortest path to the mouth.
    for d in range(0, int(sketch.length), 100):
        pt = sketch.interpolate(d)
        node = linked[linked_tree.nearest(pt)]
        if math.dist(node, pt.coords[0]) < 150:
            path = shortest(node, goal)
            upper = shapely.ops.substring(sketch, 0, d)
            return LineString(list(upper.coords) + path)
    return sketch


def update_sources(index, survey_ids):
    sources = json.loads(SOURCES.read_text())
    by_id = {s["id"]: s for s in sources}
    for sid in survey_ids:
        rec = index[sid]
        by_id[f"noaa-{sid}"] = {
            "id": f"noaa-{sid}",
            "title": f"NOAA T-sheet {sid} ({rec['SURV_DATE']}): {rec['SURV_DESC']}",
            "url": f"https://nsde.ngs.noaa.gov/downloads/{sid}.zip",
        }
    SOURCES.write_text(json.dumps(list(by_id.values()), indent=2, ensure_ascii=False) + "\n")


def write_outputs(features):
    OUT_GEOJSON.write_text(
        json.dumps({"type": "FeatureCollection", "features": features},
                   separators=(",", ":"), ensure_ascii=False) + "\n"
    )
    # Vector tiles can't hold arrays or nulls: store source_ids as JSON text
    # and leave empty properties out.
    with tempfile.TemporaryDirectory() as tmp:
        flat = Path(tmp) / "flat.geojsonseq"
        with flat.open("w") as fh:
            for f in features:
                props = {k: (json.dumps(v) if isinstance(v, list) else v)
                         for k, v in f["properties"].items() if v is not None}
                fh.write(json.dumps({**f, "properties": props}) + "\n")
        OUT_PMTILES.parent.mkdir(parents=True, exist_ok=True)
        OUT_PMTILES.unlink(missing_ok=True)
        meta, _, geoms, field_data = pyogrio.raw.read(str(flat))
        pyogrio.raw.write(
            str(OUT_PMTILES), geoms, field_data, list(meta["fields"]),
            driver="PMTiles", layer="landscape", crs="EPSG:4326",
            geometry_type="Unknown",
            dataset_options={"MINZOOM": "6", "MAXZOOM": "14", "NAME": "landscape",
                             # In tile units (4096 per tile, ~8 per screen pixel): under a pixel.
                             "SIMPLIFICATION": "6", "SIMPLIFICATION_MAX_ZOOM": "2"},
            layer_options={"MINZOOM": "6", "MAXZOOM": "14"},
        )


def main():
    index = json.loads((RAW / "noaa" / "tsheet_index.json").read_text())
    coast, land_w, survey_ids = tsheet_features(index)
    ballona, ballona_footprint_w, study_area_w, channels_w = ballona_features()
    landfire = landfire_features(land_w, ballona_footprint_w)
    creeks = nhd_features(study_area_w, land_w)
    samples = kept_samples(channels_w, land_w)

    features = coast + landfire + ballona + creeks + samples
    update_sources(index, survey_ids)
    write_outputs(features)

    counts = Counter(f["properties"]["type"] for f in features)
    print(f"{len(features)} features: " + ", ".join(f"{t} {n}" for t, n in counts.most_common()))
    print(f"-> {OUT_GEOJSON.relative_to(ROOT)} ({OUT_GEOJSON.stat().st_size / 1e6:.1f} MB), "
          f"{OUT_PMTILES.relative_to(ROOT)} ({OUT_PMTILES.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
