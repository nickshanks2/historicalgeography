# Data pipeline

Turns the raw historical sources into the time-ranged datasets the site uses
(see "Data model" in `CLAUDE.md`). It never runs on the website; run it
locally and commit the outputs in `data/`.

## Setup

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r pipeline/requirements.txt   # GDAL comes inside the pyogrio/rasterio wheels
sudo apt-get install mdbtools               # reads NOAA's .mdb shoreline geodatabases
```

## Run

```bash
python3 pipeline/fetch_sources.py        # downloads ~2 GB into pipeline/raw/ (gitignored)
python3 pipeline/build_landscape.py      # -> data/features/landscape.geojson, data/tiles/landscape.pmtiles
python3 pipeline/build_built_samples.py  # Phase 1 samples -> data/features/built.geojson (keeps sourced features)
```

Overlays and tracing reference:

```bash
python3 pipeline/build_overlays.py          # old maps -> data/overlays/*.pmtiles, data/overlays.json
python3 pipeline/build_osm_reference.py     # today's named streets -> data/reference/osm_streets.geojson
python3 pipeline/fetch_sanborn_index.py     # LOC Sanborn atlases -> data/reference/sanborn.json
python3 pipeline/build_sanborn.py           # pinned Sanborn sheets (data/georef/) -> overlays
```

Sanborn atlases (after pinning sheets, or reading block corners into
`pipeline/samples/<atlas>-corners.json`):

```bash
python3 pipeline/georef_from_corners.py sanborn-santa-monica-1902-07        # corners -> data/georef/<atlas>/sheet-*.json
python3 pipeline/build_sanborn.py                                           # -> overlays
python3 pipeline/extract_sanborn_buildings.py sanborn-santa-monica-1902-07  # building outlines -> built.geojson
python3 pipeline/build_streets.py                                           # data/street_names.json -> named streets in built.geojson
```

`extract_sanborn_buildings.py` and `build_streets.py` replace only their own
earlier output in `data/features/built.geojson` (ids `<atlas>-bldg-*` and
`street-<year>-*`); everything else there, including features traced in
`/admin/trace`, is kept. Correct a traced building in `/admin/trace` by
giving it a new id (or the extractor will overwrite it on its next run).

`build_landscape.py` also adds an entry to `data/sources.json` for every
NOAA T-sheet it uses. Record any new source in `data/LICENSES.md` too.

## Sources

| Source | What we take |
| --- | --- |
| Ballona Historical Ecology Project GIS | Lowland habitats, channels, springs, with per-feature certainty and source |
| LANDFIRE Biophysical Settings (LF 2020) | Modeled pre-settlement vegetation everywhere else |
| NOAA T-sheets (1870s, 1933) | Ocean and coastline per survey generation |
| USGS NHD | Named canyon creeks outside the Ballona study area |
| Natural Earth 10m coastline | Ocean where no survey reaches |
