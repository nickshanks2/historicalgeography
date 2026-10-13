"""Small geometry helpers for the pipeline (shapely 2)."""

import shapely
from pyproj import Transformer
from shapely.geometry import LinearRing, MultiPolygon, Polygon
from shapely.ops import transform

# Work in metres (UTM 11N), publish in WGS84.
WORK_CRS = "EPSG:32611"
_to_work = {}
_to_wgs = Transformer.from_crs(WORK_CRS, "EPSG:4326", always_xy=True)


def to_work(geom, src_crs="EPSG:4326"):
    if src_crs not in _to_work:
        _to_work[src_crs] = Transformer.from_crs(src_crs, WORK_CRS, always_xy=True)
    return transform(_to_work[src_crs].transform, geom)


def to_wgs(geom):
    return transform(_to_wgs.transform, geom)


def _chaikin_ring(coords, iterations):
    pts = list(coords)[:-1]
    for _ in range(iterations):
        out = []
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
            out.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
            out.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
        pts = out
    return pts + pts[:1]


def smooth(geom, iterations=2):
    """Chaikin-smooth polygon rings, turning raster stair-steps into curves."""
    def poly(p: Polygon):
        if len(p.exterior.coords) < 4:
            return p
        holes = [
            _chaikin_ring(r.coords, iterations)
            for r in p.interiors
            if len(r.coords) >= 4
        ]
        return Polygon(_chaikin_ring(p.exterior.coords, iterations), holes)

    if isinstance(geom, Polygon):
        return shapely.make_valid(poly(geom))
    if isinstance(geom, MultiPolygon):
        return shapely.make_valid(MultiPolygon([poly(p) for p in geom.geoms]))
    return geom


def polygons(geom):
    """Flatten any geometry to its list of polygons."""
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def rounded(geom, ndigits=5):  # ~1 m
    return shapely.set_precision(geom, 10 ** -ndigits)


__all__ = ["LinearRing", "WORK_CRS", "polygons", "rounded", "smooth", "to_wgs", "to_work"]
