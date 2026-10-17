# HistoricalGeography.io

Live domain: historicalgeography.io (www redirects to the bare domain).

Interactive map that shows what real places looked like centuries ago. Users drag a time slider and the modern map fades into a reconstructed landscape: coastline, creeks, wetlands, plant communities, wildlife and the people who lived there.

Pilot region: Santa Monica Bay, from the Santa Monica Mountains to the Ballona wetlands and Baldwin Hills.

Purpose: let anyone see what the ground they stand on looked like in each era, for personal, professional and research use. It must be as engaging as it is informative, and accuracy wins: more sourced detail is always better than more decoration.

Core interactions: drag the time slider (or press `[` / `]`); tap anywhere for "this spot through time" (what the data records there in every era, with sources); search places, addresses and historical names; share or cite a view by link (`?era=1850#view=zoom/lat/lng/bearing/pitch`).

Long-term goal: a fully navigable, Google-Earth-like 3D model with renderings for every era. The current 2.5D MapLibre map is the beta; keep data and styling choices compatible with that direction (time-ranged 3D-ready geometry, sourced heights where available).

## Eras

| id | Label | Year | Confidence | Map style |
| --- | --- | --- | --- | --- |
| `1000` | ~1000 | 1000 | modeled | painted |
| `1600` | 1600 | 1600 | inferred | painted |
| `1800` | 1800 | 1800 | documented-inferred | painted |
| `1850` | 1850 | 1850 | documented-inferred | painted |
| `1900` | 1900 | 1900 | documented | built |
| `1925` | 1925 | 1925 | documented | built |
| `1950` | 1950 | 1950 | documented | built |
| `today` | Today | current year | documented | modern |

Eras are defined in one config file (`src/config/eras.ts`). Never hard-code era lists anywhere else. The slider runs oldest to newest, left to right, and must stay usable one-handed on a phone.

## Era map styles

- **The modern basemap (today's streets, buildings, parks, labels) appears ONLY in `today`.** Every other era is drawn entirely from our own layers, with nothing from the modern basemap.
- **Orientation in past eras is landmark labels only**, no modern streets: small, subtle "today: ..." labels from `data/landmarks.geojson` (about 15 to 20 well-known points).
- **Painted (pre-1900: 1000, 1600, 1800, 1850):** soft, hand-drawn land-cover look on terrain hillshade, with a textured fill per land type (wetland, salt marsh, dune, beach, coastal sage scrub, chaparral, grassland, oak woodland, willow/riparian, open water). Shows creeks, the era's coastline and river course, and Tongva villages and trails, with Tongva names where sources give them. 1850 adds rancho boundaries and adobes.
- **The LA River reaches the ocean through Ballona Creek in 1000, 1600 and 1800.** It shifted to San Pedro Bay in the 1825 flood.
- **Built (1900, 1925, 1950):** the built environment redrawn as clean styled layers: streets with their names as of that year, building footprints, piers, rail and streetcar lines and parks, plus whatever natural land cover still remained (e.g. Ballona wetlands, open fields).
- Every era has a legend, and tapping a feature opens an inspect panel with its name, dates, confidence and sources.

## Stack

- Next.js (App Router, TypeScript), deployed on Vercel
- MapLibre GL JS for the map, with terrain
- Vector layers as PMTiles built from the time-ranged datasets (see Data model); small or sample layers may be served as GeoJSON
- Tailwind CSS for styling
- Place-page content in Markdown/MDX under `content/places/<region>/<place>/<era>.mdx`
- Data pipeline in Python + GDAL under `pipeline/` (never runs on the website)

Use free/open map sources only. No paid Mapbox or Google Maps keys.

## Non-negotiable rules

1. **Every reconstruction is labeled a reconstruction.** Each map layer and page shows its confidence level: documented, inferred, or modeled.
2. **Every fact has a source.** Layer metadata and every content page carry a `sources` list (title + URL). No source, no publish.
3. **Historical facts never live in code.** Facts, descriptions, species lists and dates go in content or data files, not in components.
4. **Indigenous history is part of the landscape.** Tongva villages, trails and land use are shown as present in pre-1900 eras, not as an absence of people. Use Tongva place names alongside Spanish/English ones where sources allow.
5. **Track licenses.** Every data file and image gets an entry in `data/LICENSES.md` (source, license, attribution text).
6. **Ads never cover the map canvas.**

## Data model

**Never make a separate copy of the map per era.** Features live in time-ranged datasets, and each era is a filter on years. This applies to the built environment (streets, buildings, piers, rail) and to natural features that changed (river course, wetlands, dunes, coastline). Adding an era later must need no new data, only a new entry in `src/config/eras.ts`.

A feature is shown in an era with year `Y` when `start_year <= Y` and (`end_year` is null or `Y < end_year`). For `today`, `Y` is the current year.

Every feature carries:

- `id`: stable, unique within its dataset
- `type`: see the type list below
- `name` (optional), `name_tongva` (optional), `name_spanish` (optional)
- `start_year`: year it appeared, or null if it predates the earliest era
- `end_year`: year it was removed or changed, or null if it still exists
- `start_approx` / `end_approx` (optional booleans): the year is approximate ("built ~1909")
- `confidence`: `documented` | `inferred` | `modeled`
- `source_ids`: list of ids from `data/sources.json`
- `sample` (optional boolean): placeholder geometry for style review only. Sample features are always labelled as samples in the UI and must be replaced by sourced data before launch.
- `subtype` (optional): the source's finer class, e.g. "Valley Freshwater Marsh"
- `observed_year` (optional): year the source map, survey or photo recorded the feature
- `source_note` (optional): how the source mapped it, e.g. "Mapped from: Tsheet Chase 1867."
- Buildings also: `material` (`frame` | `brick` | `stone` | `iron_or_special`, from the Sanborn colour) and `stories` (as lettered on the map, e.g. 1.5; absent where none was read). The map draws buildings in 3D at `STOREY_HEIGHT_M` per storey (`src/config/map.ts`), a rendering assumption shown as such in the inspect panel.

Natural features with no known end date are kept until 1900 or the year after their source last recorded them, whichever is later, and marked `end_approx`. Phases 3 and 4 refine this from later maps.

Feature types:

- Land cover (polygons): `water`, `wetland`, `salt_marsh`, `flat` (salt or tidal flat), `dune`, `beach`, `coastal_sage_scrub`, `chaparral`, `grassland`, `oak_woodland`, `riparian`, `open_field`, `ocean`
- Water: `coastline`, `river`, `creek` (lines), `spring` (point)
- People and places: `village` (point), `trail` (line), `rancho` (polygon), `adobe` (point)
- Built: `street`, `building`, `pier`, `rail`, `streetcar`, `park`
- Orientation: `landmark` (in `data/landmarks.geojson`, shown only in past eras)

Canonical datasets live in `data/` (GeoJSON). The landscape is built by `pipeline/build_landscape.py` into `data/features/landscape.geojson` and `data/tiles/landscape.pmtiles`; `scripts/prepare-public.mjs` copies what the map loads into `public/data/` at build time. Never edit generated files in `public/data/`. See `pipeline/README.md` for running the pipeline.

## Pages

- `/` home: map + time slider, centered on Santa Monica
- `/places/[region]/[place]` place overview
- `/places/[region]/[place]/[era]` place-in-era page (main SEO page)
- `/about/methods` how reconstructions are made
- `/sources` full source list

Every place-era page needs: title answering the search question ("What did Santa Monica look like in 1800?"), meta description, Open Graph share image, a viewpoint image, a short sourced write-up, an embedded map view, links to adjacent eras and places.

## Working style

- Small steps. Make one change, run it, show me a Vercel preview link.
- Mobile first: the map and slider must work one-handed on a phone.
- Keep the site fast: static generation where possible, lazy-load the map.
- Explain anything I need to do outside the code (DNS, accounts, API keys) in plain steps.
- Never commit secrets. Use `.env.local` and Vercel environment variables.

## Build phases

1. Era styles and basemap switch: 8 eras, modern basemap only in `today`, hillshade, landmark labels, painted style with sample polygons, legend, inspect panel.
2. Pre-1900 landscape from real data: Ballona Historical Ecology GIS, LANDFIRE Biophysical Settings, NOAA T-sheets, processed in `pipeline/` (Python + GDAL) to PMTiles.
3. The 1900 city: georeferenced USGS historical topos and Sanborn maps, a dev-only tracing tool at `/admin/trace`, reusing OSM street geometry with `start_year` where streets match.
4. 1925 and 1950: later topos, Sanborn updates and UCSB aerial photos, adding and ending features by year.

Stop after each phase with a Vercel preview for review.

## Tracing tools (development only)

Run `npm run dev`, then:

- `/admin/trace`: draw or correct built features over an old map (Line, Area, Rectangle, Point), adopt a modern OSM street whose course is unchanged (`O`), or adopt every OSM street inside a rectangle (`G`) and delete the ones the old map doesn't show. Set the type, the name as of that year, years, confidence and sources (new features default to the old-map sheet under them). Save writes `data/features/built.geojson`; it refuses to drop features it didn't load or to save a feature without a source.
- `/admin/georef`: pin Sanborn sheets to the map. Click a street or block corner on the sheet, then the same corner today; 3+ pairs give a live preview and per-point error (aim for 4–8 points under ~5 m). Block corners are more reliable than street centres: Sanborn sometimes draws streets narrower than they are. Saves `data/georef/<atlas>/sheet-<n>.json`; then run `python3 pipeline/build_sanborn.py` to turn pinned sheets into overlays.

Both pages and their APIs return 404 in production. Commit the data files they write.

Batch alternatives in `pipeline/` (see `pipeline/README.md`): `georef_from_corners.py` pins a whole atlas from block corners read off the sheets; `extract_sanborn_buildings.py` traces every coloured building outline (construction type from the Sanborn colour) into `built.geojson`; `build_streets.py` writes streets named as printed on each atlas, with dated renames, from `data/street_names.json`. Features seen on one map only get `start_year` two years before it (`start_approx`), `observed_year`, and end the year after (`end_approx`) until a later map extends them.

Old maps for every era are offered as overlays ("Old maps" button; `?map=<set>` in links): built by `pipeline/build_overlays.py` (USGS topos, NOAA T-sheets, from `pipeline/overlays.json`) and `pipeline/build_sanborn.py` (Sanborn sheets).

## Key sources (start here)

- Ballona Historical Ecology Project GIS: https://www.ballonahe.org/
- LANDFIRE Biophysical Settings: https://www.landfire.gov/node/26
- NOAA historical T-sheets: https://shoreline.chs.coast.noaa.gov/data/datasheets/t-sheets.html
- USGS topoView: https://ngmdb.usgs.gov/topoview/about/
- Wieslander VTM: https://guides.lib.berkeley.edu/wieslander
