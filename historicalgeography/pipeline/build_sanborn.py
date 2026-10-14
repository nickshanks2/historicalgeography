"""Warp georeferenced Sanborn sheets into overlay tiles.

Reads the control points saved by /admin/georef (data/georef/<atlas>/
sheet-<n>.json), downloads each sheet at full resolution from the Library
of Congress, warps it (an affine fit from 3+ points)
and tiles it like the other overlays. Each atlas becomes one map set in
data/overlays.json, listing the sheets georeferenced so far.

    python3 pipeline/build_sanborn.py
"""

import json
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.control import GroundControlPoint
from rasterio.enums import Resampling
from rasterio.transform import from_gcps
from rasterio.warp import calculate_default_transform, reproject, transform_bounds

from build_overlays import OUT_DIR, OUT_INDEX, ROOT, SOURCES, tile

GEOREF = ROOT / "data" / "georef"
INDEX = ROOT / "data" / "reference" / "sanborn.json"
RAW = ROOT / "pipeline" / "raw" / "sanborn"
HEADERS = {"User-Agent": "historicalgeography.io data pipeline"}
PUBLISHER = "Sanborn Map Company (Library of Congress)"
CREDIT = "Library of Congress, Geography and Map Division, Sanborn Maps Collection"


def download(iiif, dest: Path):
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(f"{iiif}/full/full/0/default.jpg", headers=HEADERS)
        dest.write_bytes(urllib.request.urlopen(req, timeout=300).read())
    return dest


def _bounds(affine, width, height):
    """West, south, east, north of an affine-placed (possibly rotated) image."""
    corners = [affine * (c, r) for c, r in ((0, 0), (width, 0), (width, height), (0, height))]
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


def warp(image: Path, gcps, out: Path):
    """Affine fit (least squares) from the control points, then warp to Web Mercator.

    Sanborn sheets are plans drawn to scale, so an affine fit is the right
    model; /admin/georef shows its residuals while the points are picked.
    """
    points = [GroundControlPoint(row=g["py"], col=g["px"], x=g["lng"], y=g["lat"]) for g in gcps]
    affine = from_gcps(points)
    with rasterio.open(image) as src:
        data = src.read()
        transform, width, height = calculate_default_transform(
            "EPSG:4326", "EPSG:3857", src.width, src.height,
            *_bounds(affine, src.width, src.height),
        )
        rgba = np.zeros((4, height, width), np.uint8)
        for b in range(3):
            reproject(
                data[min(b, src.count - 1)], rgba[b],
                src_transform=affine, src_crs="EPSG:4326",
                dst_transform=transform, dst_crs="EPSG:3857", resampling=Resampling.bilinear,
            )
        reproject(
            np.full((src.height, src.width), 255, np.uint8), rgba[3],
            src_transform=affine, src_crs="EPSG:4326",
            dst_transform=transform, dst_crs="EPSG:3857", resampling=Resampling.nearest,
        )
    profile = dict(driver="GTiff", width=width, height=height, count=4, dtype="uint8",
                   crs="EPSG:3857", transform=transform, compress="deflate",
                   photometric="RGB", alpha="YES")
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(rgba)
    with rasterio.open(out) as m:
        return [round(v, 5) for v in transform_bounds(m.crs, "EPSG:4326", *m.bounds)]


def main():
    atlases = {a["id"]: a for a in json.loads(INDEX.read_text())["atlases"]}
    index = json.loads(OUT_INDEX.read_text()) if OUT_INDEX.exists() else {"sets": []}
    sets = {s["id"]: s for s in index["sets"]}
    sources = {s["id"]: s for s in json.loads(SOURCES.read_text())}

    for atlas_dir in sorted(p for p in GEOREF.iterdir() if p.is_dir()) if GEOREF.exists() else []:
        atlas = atlases[atlas_dir.name]
        source_id = f"map-{atlas['id']}"
        sources[source_id] = {"id": source_id, "title": f"{atlas['title']} ({CREDIT})", "url": atlas["item_url"]}
        sheets = []
        for path in sorted(atlas_dir.glob("sheet-*.json"), key=lambda p: int(p.stem.split("-")[1])):
            georef = json.loads(path.read_text())
            if len(georef["gcps"]) < 3:
                continue
            sheet_id = f"{atlas['id']}-{georef['sheet']}"
            print(f"- {sheet_id} ({len(georef['gcps'])} points)", flush=True)
            image = download(georef["iiif"], RAW / atlas["id"] / f"sheet-{georef['sheet']}.jpg")
            with tempfile.TemporaryDirectory() as tmp:
                merc = Path(tmp) / "warped.tif"
                bounds = warp(image, georef["gcps"], merc)
                out = OUT_DIR / f"{sheet_id}.pmtiles"
                max_zoom = tile(merc, out)
            print(f"  -> {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)")
            sheets.append({
                "id": sheet_id,
                "year": atlas["year"],
                "url": f"/data/overlays/{sheet_id}.pmtiles",
                "bounds": bounds,
                "maxzoom": max_zoom,
                "source_id": source_id,
            })
        if sheets:
            sets[atlas["id"]] = {
                "id": atlas["id"],
                "title": f"Sanborn fire insurance maps, {atlas['place']}, {atlas['year']}",
                "publisher": PUBLISHER,
                "start_year": atlas["year"],
                "end_year": atlas["year"],
                "sheets": sheets,
            }

    OUT_INDEX.write_text(json.dumps({"sets": list(sets.values())}, indent=1, ensure_ascii=False) + "\n")
    SOURCES.write_text(json.dumps(list(sources.values()), indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
