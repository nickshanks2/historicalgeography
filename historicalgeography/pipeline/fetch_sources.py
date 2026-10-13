"""Download the raw source data into pipeline/raw/ (gitignored).

Skips files that are already present. LANDFIRE is a 2 GB national file;
build_landscape.py reads just our region from inside the zip.

    python3 pipeline/fetch_sources.py
"""

import gzip
import json
import math
import sys
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent / "raw"

BALLONA = "https://ballonahe.org/downloads/geo_data/"
TSHEETS = "https://nsde.ngs.noaa.gov/downloads/"

FILES = {
    "ballona/Habitat_Shapefile.zip": BALLONA + "Habitat_Shapefile.zip",
    "ballona/Channels_Shapefile.zip": BALLONA + "Channels_Shapefile.zip",
    "ballona/Springs_Shapefile.zip": BALLONA + "Springs_Shapefile.zip",
    "landfire/LF2020_BPS_CONUS.zip": (
        "https://landfire.gov/data-downloads/CONUS_LF2020/LF2020_BPS_CONUS.zip"
    ),
    "nhd/NHD_H_18070104_HU8_GPKG.zip": (
        "https://prd-tnm.s3.amazonaws.com/StagedProducts/Hydrography/NHD/HU8/GPKG/"
        "NHD_H_18070104_HU8_GPKG.zip"
    ),
    "naturalearth/ne_10m_coastline.geojson": (
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
        "ne_10m_coastline.geojson"
    ),
    # NOAA T-sheets: each zip holds the scan plus the project's digitized
    # shoreline geodatabase (CA34A07 = 1870s surveys, CA34C01 = 1933).
    "noaa/T-01427.zip": TSHEETS + "T-01427.zip",
    "noaa/T-04828.zip": TSHEETS + "T-04828.zip",
}


# NOAA's T-sheet index (vector tiles behind nsde.ngs.noaa.gov/tsheet.html).
TSHEET_INDEX = "https://nsde.ngs.noaa.gov/tsheets/tsheetidx/{z}/{x}/{y}.pbf"
REGION = (-118.95, 33.70, -118.25, 34.15)


def fetch_tsheet_index(dest: Path):
    """Save the index records (title, date, scale, links) for our region."""
    import mapbox_vector_tile

    z = 10
    n = 2**z

    def tile(lon, lat):
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return int((lon + 180) / 360 * n), int(y)

    (x0, y1), (x1, y0) = tile(REGION[0], REGION[1]), tile(REGION[2], REGION[3])
    records = {}
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            raw = urllib.request.urlopen(TSHEET_INDEX.format(z=z, x=x, y=y), timeout=60).read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            for layer in mapbox_vector_tile.decode(raw).values():
                for feature in layer["features"]:
                    props = feature["properties"]
                    records[props["SURV_CODE"]] = props
    dest.write_text(json.dumps(dict(sorted(records.items())), indent=1) + "\n")
    print(f"{len(records)} T-sheet index records -> {dest.relative_to(RAW.parent)}")


def main():
    for rel, url in FILES.items():
        dest = RAW / rel
        if dest.exists():
            print(f"have  {rel}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"fetch {rel}", flush=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(dest)

    index = RAW / "noaa" / "tsheet_index.json"
    if not index.exists():
        fetch_tsheet_index(index)


if __name__ == "__main__":
    sys.exit(main())
