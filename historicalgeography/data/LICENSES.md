# Data and image licenses

Every data file and image used by the site gets an entry here.

| Source | Used for | License | Attribution text |
| --- | --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org/) "Liberty" style, serving [OpenStreetMap](https://www.openstreetmap.org/copyright) data | Modern basemap (`today` era) | Data: ODbL 1.0; style and tiles: free, no key | © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors |
| [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen) | Terrain elevation and hillshading | Mixed open sources, see [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) | Terrain: Mapzen, AWS Open Data (USGS 3DEP, SRTM, and others) |
| [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) 1:10m coastline, processed by `pipeline/build_landscape.py` → `data/features/landscape.geojson` | Ocean outside the NOAA survey coverage | Public domain | Made with Natural Earth |
| `data/landmarks.geojson`: positions of modern landmarks taken from [OpenStreetMap](https://www.openstreetmap.org/copyright) | "today: ..." orientation labels in past eras | ODbL 1.0 | © OpenStreetMap contributors |
| `pipeline/samples/sketch.geojson` | Placeholder villages, trails, ranchos, adobes, LA River course and built-environment samples (flagged `sample: true`) | Our own work | None |
| Map label fonts in `public/fonts/` (Noto Sans Regular/Italic, Open Sans Semibold), glyph files from [maplibre/demotiles](https://github.com/maplibre/demotiles) | Labels in past eras | SIL Open Font License 1.1 | None required |
| [Ballona Historical Ecology Project](https://ballonahe.org/) GIS (habitat, channels, springs), SCCWRP Technical Report 671 (Dark, Stein et al., 2011) → `data/features/landscape.geojson` | Lowland wetlands, flats, dunes, beach, Ballona creeks and springs (pre-1900 eras) | No license stated on the download page; permission to publish requested from SCCWRP (pending) | Ballona Historical Ecology Project (SCCWRP, 2011) |
| [LANDFIRE Biophysical Settings](https://landfire.gov/vegetation/bps) LF 2020 → `data/features/landscape.geojson` | Modeled pre-settlement vegetation outside the Ballona study area | Public domain (US Government) | LANDFIRE, USGS / USDA Forest Service |
| NOAA T-sheets T-01153, T-01231, T-01427, T-01432A/B (1870–1876) and the 1933 surveys, digitized shorelines from the [NOAA Shoreline Data Explorer](https://nsde.ngs.noaa.gov/) → `data/features/landscape.geojson` | Ocean and coastline for pre-1933 and 1933+ eras | Public domain (US Government) | NOAA National Geodetic Survey |
| [USGS National Hydrography Dataset](https://www.usgs.gov/national-hydrography) HU8 18070104 → `data/features/landscape.geojson` | Canyon creeks outside the Ballona study area | Public domain (US Government) | USGS National Hydrography Dataset |
