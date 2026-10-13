# HistoricalGeography.io

Live domain: historicalgeography.io (www redirects to the bare domain).

Interactive map that shows what real places looked like centuries ago. Users drag a time slider and the modern map fades into a reconstructed landscape: coastline, creeks, wetlands, plant communities, wildlife and the people who lived there.

Pilot region: Santa Monica Bay, from the Santa Monica Mountains to the Ballona wetlands and Baldwin Hills.

## Eras (v1)

| id | Label | Confidence |
| --- | --- | --- |
| `today` | Today | documented |
| `1900` | 1900 | documented |
| `1800` | 1800 | documented-inferred |
| `1600` | 1600 | inferred |
| `1000` | ~1000 | modeled |

Eras are defined in one config file (`src/config/eras.ts`). Never hard-code era lists anywhere else.

## Stack

- Next.js (App Router, TypeScript), deployed on Vercel
- MapLibre GL JS for the map, with terrain
- Vector layers as PMTiles, one file per era per region
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

## Layer data model

Each era layer is a PMTiles file with features that carry:

- `type`: one of `water`, `wetland`, `dune`, `scrub`, `grassland`, `woodland`, `riparian`, `village`, `trail`
- `name` (optional), `name_tongva` (optional)
- `confidence`: `documented` | `inferred` | `modeled`
- `source_ids`: list of ids from `data/sources.json`

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

## Key sources (start here)

- Ballona Historical Ecology Project GIS: https://www.ballonahe.org/
- LANDFIRE Biophysical Settings: https://www.landfire.gov/node/26
- NOAA historical T-sheets: https://shoreline.chs.coast.noaa.gov/data/datasheets/t-sheets.html
- USGS topoView: https://ngmdb.usgs.gov/topoview/about/
- Wieslander VTM: https://guides.lib.berkeley.edu/wieslander
