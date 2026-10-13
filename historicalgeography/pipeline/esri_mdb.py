"""Read feature classes from an Esri personal geodatabase (.mdb).

NOAA ships its digitized T-sheet shorelines this way. GDAL's PGeo driver
needs an ODBC setup, so instead this exports rows with `mdb-export` (from
mdbtools: `apt-get install mdbtools`) and decodes the Esri shape blobs.
Supports polylines and polygons (with or without Z/M).
"""

import csv
import io
import struct
import subprocess
from datetime import datetime

# Shoreline blobs can be large (many vertices in one hex field).
csv.field_size_limit(1 << 30)

POLYLINE_TYPES = {3, 13, 23}
POLYGON_TYPES = {5, 15, 25}


def decode_shape(blob: bytes):
    """Return (kind, parts) where parts is a list of [(x, y), ...]."""
    if not blob:
        return None, []
    shape_type = struct.unpack_from("<i", blob, 0)[0] & 0xFF
    if shape_type not in POLYLINE_TYPES | POLYGON_TYPES:
        return None, []
    num_parts, num_points = struct.unpack_from("<ii", blob, 36)
    starts = list(struct.unpack_from(f"<{num_parts}i", blob, 44))
    offset = 44 + 4 * num_parts
    flat = struct.unpack_from(f"<{2 * num_points}d", blob, offset)
    points = list(zip(flat[0::2], flat[1::2]))
    parts = [points[s:e] for s, e in zip(starts, starts[1:] + [num_points])]
    kind = "line" if shape_type in POLYLINE_TYPES else "polygon"
    return kind, parts


def read_table(mdb_path: str, table: str):
    """Yield (row_dict, kind, parts) for each row of a feature class."""
    out = subprocess.run(
        ["mdb-export", "-b", "hex", "-Q", "-d", "\t", "-D", "%Y-%m-%d", mdb_path, table],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    reader = csv.DictReader(io.StringIO(out), delimiter="\t")
    for row in reader:
        blob = bytes.fromhex(row.pop("SHAPE", "") or row.pop("Shape", "") or "")
        kind, parts = decode_shape(blob)
        yield row, kind, parts


def list_tables(mdb_path: str):
    out = subprocess.run(["mdb-tables", "-1", mdb_path], check=True, capture_output=True, text=True)
    return out.stdout.split()


def parse_date(value: str):
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d")
    except ValueError:
        return None
