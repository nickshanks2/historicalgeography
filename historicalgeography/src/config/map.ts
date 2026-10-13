import type { LngLatLike } from "maplibre-gl";

// Free, keyless modern basemap from OpenFreeMap (OpenStreetMap data).
// Used only in the "today" era.
export const MODERN_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Open elevation tiles (AWS Open Data "Terrain Tiles", Terrarium encoding).
export const TERRAIN_TILES_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen, AWS Open Data</a>';
export const TERRAIN_EXAGGERATION = 1.5;

// Self-hosted label fonts for our own era styles (see data/LICENSES.md).
export const GLYPHS_URL = "/fonts/{fontstack}/{range}.pbf";

// Time-ranged datasets, copied from data/ at build time.
export const DATASETS = {
  landscape: "/data/features/landscape.geojson",
  built: "/data/features/built.geojson",
  landmarks: "/data/landmarks.geojson",
} as const;
export type DatasetId = keyof typeof DATASETS;

// Pilot region: Santa Monica Bay.
export const INITIAL_VIEW = {
  center: [-118.4912, 34.0195] as LngLatLike,
  zoom: 11.5,
  pitch: 55,
  bearing: -20,
};
