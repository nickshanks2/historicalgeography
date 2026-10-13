# Data and image licenses

Every data file and image used by the site gets an entry here.

| Source | Used for | License | Attribution text |
| --- | --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org/) "Liberty" style, serving [OpenStreetMap](https://www.openstreetmap.org/copyright) data | Modern basemap (`today` era) | Data: ODbL 1.0; style and tiles: free, no key | © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors |
| [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen) | Terrain elevation and hillshading | Mixed open sources, see [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) | Terrain: Mapzen, AWS Open Data (USGS 3DEP, SRTM, and others) |
| [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) 1:10m coastline, processed by `pipeline/build_style_samples.py` → `data/features/landscape.geojson` | Coastline and ocean (stand-in for every era until Phase 2) | Public domain | Made with Natural Earth |
| `data/landmarks.geojson`: positions of modern landmarks taken from [OpenStreetMap](https://www.openstreetmap.org/copyright) | "today: ..." orientation labels in past eras | ODbL 1.0 | © OpenStreetMap contributors |
| `pipeline/samples/sketch.geojson` and the derived beach and riparian strips | Phase 1 style samples (flagged `sample: true`) | Our own work | None |
| Map label fonts in `public/fonts/` (Noto Sans Regular/Italic, Open Sans Semibold), glyph files from [maplibre/demotiles](https://github.com/maplibre/demotiles) | Labels in past eras | SIL Open Font License 1.1 | None required |
