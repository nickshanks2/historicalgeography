"""Tile historical maps (pipeline/overlays.json) into raster PMTiles overlays.

For each sheet:
- USGS topos: download the georeferenced GeoTIFF, cut away the map collar
  (margins and legend) at the quadrangle's neatline, so adjacent sheets fit
- NOAA T-sheets: use the georeferenced scan inside the T-sheet zip
- warp to Web Mercator and write WEBP tiles (MBTiles with overviews), then
  convert to PMTiles

Outputs data/overlays/<sheet>.pmtiles, data/overlays.json (what the map's
"Old maps" menu reads) and a data/sources.json entry per sheet.

    python3 pipeline/build_overlays.py [set-id ...]
"""

import json
import math
import sqlite3
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import rasterio
import rasterio.features
import rasterio.shutil
from pmtiles.convert import mbtiles_to_pmtiles
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import calculate_default_transform, reproject, transform_bounds
from shapely.geometry import Polygon, mapping

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "pipeline" / "overlays.json"
RAW = ROOT / "pipeline" / "raw"
OUT_DIR = ROOT / "data" / "overlays"
OUT_INDEX = ROOT / "data" / "overlays.json"
SOURCES = ROOT / "data" / "sources.json"

USGS_BUCKET = "https://prd-tnm.s3.amazonaws.com/"
# Possible quadrangle sizes in degrees by map scale. Standard series are
# 7.5', 15' and 30'; early Los Angeles 1:24,000 sheets were 6' (0.1 degree).
QUAD_DEGREES = {24000: (0.125, 0.1), 62500: (0.25,), 125000: (0.5,)}
# Coarsest zoom tiled; the finest is chosen from each scan's own resolution.
MIN_ZOOM = 10


def download(url, dest: Path):
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"  fetch {dest.name}", flush=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(dest)
    return dest


def usgs_source(sheet):
    url = USGS_BUCKET + urllib.parse.quote(sheet["key"])
    return download(url, RAW / "overlays" / Path(sheet["key"]).name)


def tsheet_source(sheet, tmp):
    zip_path = download(
        f"https://nsde.ngs.noaa.gov/downloads/{sheet['zip']}.zip", RAW / "noaa" / f"{sheet['zip']}.zip"
    )
    out = Path(tmp) / sheet["id"]
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(("_dd.jpg", "_dd.jgw", "_dd.tif", "_dd.tfw"))]
        zf.extractall(out, members=names)
    return next(out.rglob("*_dd.jpg"), None) or next(out.rglob("*_dd.tif"))


def neatline(src, scale):
    """The quadrangle's neatline (NAD27 degrees), as a polygon in the source CRS.

    USGS quads are aligned to whole fractions of a degree in NAD27; the
    neatline is the box of the right quad size inside the scanned sheet that
    covers most of it.
    """
    w, s, e, n = transform_bounds(src.crs, "EPSG:4267", *src.bounds)
    sheet_area = (e - w) * (n - s)
    best = None
    for step in QUAD_DEGREES[scale]:
        box = (
            math.ceil(w / step - 1e-6) * step,
            math.ceil(s / step - 1e-6) * step,
            math.floor(e / step + 1e-6) * step,
            math.floor(n / step + 1e-6) * step,
        )
        area = max(0, box[2] - box[0]) * max(0, box[3] - box[1])
        if area > 0.6 * sheet_area and (best is None or area > best[0]):
            best = (area, box)
    if best is None:
        raise ValueError(f"no quadrangle neatline found inside {src.name}")
    box = best[1]
    # Densify edges so the curved (projected) neatline is followed closely.
    pts = []
    for (x0, y0), (x1, y1) in [
        ((box[0], box[1]), (box[2], box[1])),
        ((box[2], box[1]), (box[2], box[3])),
        ((box[2], box[3]), (box[0], box[3])),
        ((box[0], box[3]), (box[0], box[1])),
    ]:
        pts += [(x0 + (x1 - x0) * t / 50, y0 + (y1 - y0) * t / 50) for t in range(50)]
    to_src = Transformer.from_crs("EPSG:4267", src.crs, always_xy=True)
    return Polygon([to_src.transform(x, y) for x, y in pts]), box


def warp_to_mercator(src_path, out_path, cutline=None):
    """Reproject to EPSG:3857 as RGBA, transparent outside `cutline` (source CRS)."""
    with rasterio.open(src_path) as src:
        crs = src.crs or "EPSG:4269"  # T-sheet scans with a world file are NAD83 degrees
        transform, width, height = calculate_default_transform(
            crs, "EPSG:3857", src.width, src.height, *src.bounds
        )
        rgb = np.zeros((3, height, width), np.uint8)
        valid = np.zeros((height, width), np.uint8)
        for b in range(3):
            # Read into memory: warping straight from a band ignores src_crs
            # when the file itself has no CRS (scans with only a world file).
            reproject(
                src.read(min(b + 1, src.count)), rgb[b],
                src_transform=src.transform, src_crs=crs,
                dst_transform=transform, dst_crs="EPSG:3857", resampling=Resampling.bilinear,
            )
        ones = np.ones((src.height, src.width), np.uint8)
        reproject(
            ones, valid, src_transform=src.transform, src_crs=crs,
            dst_transform=transform, dst_crs="EPSG:3857", resampling=Resampling.nearest,
        )
        alpha = valid * 255
        if cutline is not None:
            to_merc = Transformer.from_crs(crs, "EPSG:3857", always_xy=True)
            merc = Polygon([to_merc.transform(x, y) for x, y in cutline.exterior.coords])
            inside = rasterio.features.geometry_mask(
                [mapping(merc)], out_shape=(height, width), transform=transform, invert=True
            )
            alpha = np.where(inside, alpha, 0).astype(np.uint8)

    profile = dict(driver="GTiff", width=width, height=height, count=4, dtype="uint8",
                   crs="EPSG:3857", transform=transform, compress="deflate",
                   photometric="RGB", alpha="YES")
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(rgb, [1, 2, 3])
        dst.write(alpha, 4)


def tile(merc_path, pmtiles_path):
    """Write WEBP tiles at the scan's native zoom plus coarser levels; return the native zoom."""
    with tempfile.TemporaryDirectory() as tmp:
        mbtiles = Path(tmp) / "tiles.mbtiles"
        with rasterio.open(merc_path) as src:
            rasterio.shutil.copy(
                src, mbtiles, driver="MBTiles", TILE_FORMAT="WEBP", QUALITY="72",
                ZOOM_LEVEL_STRATEGY="UPPER", RESAMPLING="BILINEAR",
            )
        with sqlite3.connect(mbtiles) as db:
            native = db.execute("SELECT max(zoom_level) FROM tiles").fetchone()[0]
        # Add the coarser zoom levels down to MIN_ZOOM.
        with rasterio.open(mbtiles, "r+") as mb:
            mb.build_overviews([2**i for i in range(1, native - MIN_ZOOM + 1)], Resampling.average)
        pmtiles_path.unlink(missing_ok=True)
        mbtiles_to_pmtiles(str(mbtiles), str(pmtiles_path), maxzoom=None)
    return native


def build_sheet(sheet, tmp):
    print(f"- {sheet['id']}", flush=True)
    merc = Path(tmp) / f"{sheet['id']}.tif"
    if sheet["kind"] == "usgs-topo":
        src_path = usgs_source(sheet)
        with rasterio.open(src_path) as src:
            cut, box = neatline(src, sheet["scale"])
        warp_to_mercator(src_path, merc, cut)
        bounds = list(Transformer.from_crs("EPSG:4267", "EPSG:4326", always_xy=True)
                      .transform_bounds(*box))
    else:
        src_path = tsheet_source(sheet, tmp)
        warp_to_mercator(src_path, merc)
        with rasterio.open(merc) as m:
            bounds = list(transform_bounds(m.crs, "EPSG:4326", *m.bounds))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{sheet['id']}.pmtiles"
    max_zoom = tile(merc, out)
    print(f"  -> {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)")
    return [round(v, 5) for v in bounds], max_zoom


def source_entry(sheet, publisher):
    if sheet["kind"] == "usgs-topo":
        title = f"{publisher}, {sheet['name']} quadrangle, 1:{sheet['scale']:,} ({sheet['year']})"
        url = USGS_BUCKET + urllib.parse.quote(sheet["key"])
    else:
        index = json.loads((RAW / "noaa" / "tsheet_index.json").read_text())
        rec = index.get(sheet["id"], {})
        title = f"NOAA T-sheet {sheet['id']} ({sheet['year']}): {rec.get('SURV_DESC', '')}".strip()
        url = f"https://nsde.ngs.noaa.gov/downloads/{sheet['zip']}.zip"
    return {"id": f"map-{sheet['id']}", "title": title, "url": url}


def main(only):
    config = json.loads(CONFIG.read_text())
    index = json.loads(OUT_INDEX.read_text()) if OUT_INDEX.exists() else {"sets": []}
    built = {s["id"]: s for s in index["sets"]}
    sources = {s["id"]: s for s in json.loads(SOURCES.read_text())}

    with tempfile.TemporaryDirectory() as tmp:
        for map_set in config["sets"]:
            if only and map_set["id"] not in only:
                continue
            sheets = []
            for sheet in map_set["sheets"]:
                bounds, max_zoom = build_sheet(sheet, tmp)
                entry = source_entry(sheet, map_set["publisher"])
                sources[entry["id"]] = entry
                sheets.append({
                    "id": sheet["id"],
                    "year": sheet["year"],
                    "url": f"/data/overlays/{sheet['id']}.pmtiles",
                    "bounds": bounds,
                    "maxzoom": max_zoom,
                    "source_id": entry["id"],
                })
            years = [s["year"] for s in sheets]
            built[map_set["id"]] = {
                "id": map_set["id"],
                "title": map_set["title"],
                "publisher": map_set["publisher"],
                "start_year": min(years),
                "end_year": max(years),
                "sheets": sheets,
            }

    # Config sets in config order, then any others (e.g. Sanborn atlases from
    # build_sanborn.py), which are kept as they are.
    configured = [s["id"] for s in config["sets"]]
    ordered = [built[i] for i in configured if i in built]
    ordered += [s for i, s in built.items() if i not in configured]
    OUT_INDEX.write_text(json.dumps({"sets": ordered}, indent=1, ensure_ascii=False) + "\n")
    SOURCES.write_text(json.dumps(list(sources.values()), indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(set(sys.argv[1:]))
