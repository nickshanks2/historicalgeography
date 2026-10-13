// Builds a complete MapLibre style per era. Past eras use only our own
// layers; the modern basemap appears only in "today" (see CLAUDE.md).

import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SkySpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { type Era, eraYear } from "@/config/eras";
import {
  DATASETS,
  GLYPHS_URL,
  TERRAIN_ATTRIBUTION,
  TERRAIN_EXAGGERATION,
  TERRAIN_TILES_URL,
} from "@/config/map";
import { BUILT, BUILT_LAND, LAND_COVER_TYPES, PAINTED, PAINTED_INK } from "./featureTypes";
import { existsInFilter } from "./timeFilter";

const FONT_REGULAR = ["noto-sans-regular"];
const FONT_ITALIC = ["noto-sans-italic"];
const FONT_SEMIBOLD = ["open-sans-semibold"];

/** Layers whose features open the inspect panel when tapped. */
export const INSPECTABLE_LAYER_PREFIX = "hg-";

function terrainSources(): Record<string, SourceSpecification> {
  const dem = {
    type: "raster-dem" as const,
    tiles: [TERRAIN_TILES_URL],
    encoding: "terrarium" as const,
    tileSize: 256,
    maxzoom: 15,
  };
  // Separate sources for terrain and hillshade, as MapLibre recommends.
  return { terrain: { ...dem, attribution: TERRAIN_ATTRIBUTION }, hillshade: dem };
}

function datasetSources(): Record<string, SourceSpecification> {
  return {
    landscape: {
      type: "vector",
      url: `pmtiles://${absolute(DATASETS.landscape)}`,
      attribution:
        "Ballona Historical Ecology Project · LANDFIRE · NOAA T-sheets · USGS NHD · Made with Natural Earth",
    },
    built: { type: "geojson", data: DATASETS.built },
    landmarks: {
      type: "geojson",
      data: DATASETS.landmarks,
      attribution: "Landmarks © OpenStreetMap contributors",
    },
  };
}

function absolute(path: string) {
  return new URL(path, window.location.origin).href;
}

/** Vector-tile layers need the tile layer name; ours matches the source. */
function withSourceLayers(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((layer) =>
    "source" in layer && layer.source === "landscape"
      ? ({ ...layer, "source-layer": "landscape" } as LayerSpecification)
      : layer,
  );
}

function typeFilter(types: readonly string[], year: number): FilterSpecification {
  return [
    "all",
    ["in", ["get", "type"], ["literal", [...types]]],
    existsInFilter(year),
  ] as FilterSpecification;
}

/** A `match` on feature type: { type: value }, else `fallback`. */
function byType<T extends string | number>(
  values: Record<string, T>,
  fallback: T,
): ExpressionSpecification {
  return [
    "match",
    ["get", "type"],
    ...Object.entries(values).flat(),
    fallback,
  ] as unknown as ExpressionSpecification;
}

/** Draw order for land cover: later entries paint on top. */
const landCoverSortKey = byType(
  Object.fromEntries(LAND_COVER_TYPES.map((type, i) => [type, i])),
  0,
);

const lineWidth = (z10: number, z15: number): ExpressionSpecification => [
  "interpolate",
  ["exponential", 1.6],
  ["zoom"],
  10,
  z10,
  15,
  z15,
];

function landmarkLayer(): LayerSpecification {
  return {
    id: "hg-landmarks",
    type: "symbol",
    source: "landmarks",
    minzoom: 10,
    layout: {
      "icon-image": "icon-landmark",
      "icon-size": 1,
      "text-field": ["concat", "today: ", ["get", "name"]],
      "text-font": FONT_REGULAR,
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 12],
      "text-anchor": "left",
      "text-offset": [0.6, 0],
      "text-optional": true,
      "text-padding": 4,
      "text-max-width": 9,
    },
    paint: {
      "text-color": PAINTED_INK.landmark,
      "text-halo-color": "rgba(255,255,255,0.7)",
      "text-halo-width": 1.2,
      "text-opacity": 0.85,
      "icon-opacity": 0.85,
    },
  };
}

function hillshade(shadow: string, highlight: string, accent: string, exaggeration: number) {
  return {
    id: "hillshade",
    type: "hillshade",
    source: "hillshade",
    paint: {
      "hillshade-shadow-color": shadow,
      "hillshade-highlight-color": highlight,
      "hillshade-accent-color": accent,
      "hillshade-exaggeration": exaggeration,
    },
  } as LayerSpecification;
}

function paintedLayers(year: number): LayerSpecification[] {
  const water = ["river", "creek"];
  return [
    { id: "paper", type: "background", paint: { "background-pattern": "paper" } },
    {
      id: "hg-landcover",
      type: "fill",
      source: "landscape",
      filter: typeFilter(LAND_COVER_TYPES, year),
      layout: { "fill-sort-key": landCoverSortKey },
      paint: {
        "fill-pattern": ["concat", "lc-", ["get", "type"]],
        "fill-opacity": 0.92,
        "fill-antialias": false,
      },
    },
    // Watercolour "bleed": a soft darker edge inside every patch.
    {
      id: "landcover-edge",
      type: "line",
      source: "landscape",
      filter: typeFilter(LAND_COVER_TYPES, year),
      paint: {
        "line-color": byType(
          Object.fromEntries(LAND_COVER_TYPES.map((t) => [t, PAINTED[t].ink])),
          "#777",
        ),
        "line-width": 5,
        "line-blur": 5,
        "line-opacity": 0.35,
      },
    },
    hillshade("#4a3a2a", "#fff6e2", "#6b5a45", 0.55),
    {
      id: "hg-ocean",
      type: "fill",
      source: "landscape",
      filter: typeFilter(["ocean"], year),
      paint: { "fill-pattern": "lc-ocean" },
    },
    {
      id: "coast-wash",
      type: "line",
      source: "landscape",
      filter: typeFilter(["coastline"], year),
      paint: {
        "line-color": PAINTED_INK.coast,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 6, 15, 18],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 9, 6, 15, 18],
        "line-opacity": 0.35,
      },
    },
    {
      id: "hg-coastline",
      type: "line",
      source: "landscape",
      filter: typeFilter(["coastline"], year),
      paint: { "line-color": PAINTED_INK.coast, "line-width": 1.2, "line-opacity": 0.8 },
    },
    {
      id: "hg-water-lines",
      type: "line",
      source: "landscape",
      filter: typeFilter(water, year),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": PAINTED_INK.water,
        // Rivers about twice as wide as creeks.
        "line-width": [
          "interpolate",
          ["exponential", 1.6],
          ["zoom"],
          10,
          byType({ river: 2.2 }, 1.2),
          15,
          byType({ river: 7 }, 3.5),
        ],
        "line-blur": 0.6,
        "line-opacity": 0.85,
      },
    },
    {
      id: "hg-rancho",
      type: "line",
      source: "landscape",
      filter: typeFilter(["rancho"], year),
      paint: {
        "line-color": PAINTED_INK.rancho,
        "line-width": 1.6,
        "line-dasharray": [4, 2, 1, 2],
        "line-opacity": 0.75,
      },
    },
    {
      id: "hg-trail",
      type: "line",
      source: "landscape",
      filter: typeFilter(["trail"], year),
      layout: { "line-cap": "round" },
      paint: {
        "line-color": PAINTED_INK.trail,
        "line-width": 1.6,
        "line-dasharray": [0.1, 2.2],
        "line-opacity": 0.8,
      },
    },
    {
      id: "water-labels",
      type: "symbol",
      source: "landscape",
      filter: [
        "all",
        typeFilter(water, year),
        ["has", "name"],
      ] as FilterSpecification,
      minzoom: 11,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": FONT_ITALIC,
        "text-size": 12,
        "text-letter-spacing": 0.05,
      },
      paint: {
        "text-color": PAINTED_INK.water,
        "text-halo-color": "rgba(241,232,212,0.85)",
        "text-halo-width": 1.5,
      },
    },
    {
      id: "rancho-labels",
      type: "symbol",
      source: "landscape",
      filter: typeFilter(["rancho"], year),
      layout: {
        "text-field": ["coalesce", ["get", "name_spanish"], ["get", "name"]],
        "text-font": FONT_ITALIC,
        "text-size": 12,
        "text-max-width": 8,
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
      },
      paint: {
        "text-color": PAINTED_INK.rancho,
        "text-halo-color": "rgba(241,232,212,0.8)",
        "text-halo-width": 1.5,
        "text-opacity": 0.8,
      },
    },
    landmarkLayer(),
    {
      id: "hg-places",
      type: "symbol",
      source: "landscape",
      filter: typeFilter(["village", "adobe", "spring"], year),
      layout: {
        "icon-image": ["concat", "icon-", ["get", "type"]],
        "icon-allow-overlap": true,
        // Tongva name first, other names beneath it.
        "text-field": [
          "format",
          ["coalesce", ["get", "name_tongva"], ["get", "name"], ""],
          { "font-scale": 1 },
          ["case", ["all", ["has", "name_tongva"], ["has", "name"]], ["concat", "\n", ["get", "name"]], ""],
          { "font-scale": 0.8 },
        ] as ExpressionSpecification,
        "text-font": FONT_SEMIBOLD,
        "text-size": 13,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-optional": true,
      },
      paint: {
        "text-color": PAINTED_INK.village,
        "text-halo-color": "rgba(241,232,212,0.9)",
        "text-halo-width": 1.6,
      },
    },
  ];
}

function builtLayers(year: number): LayerSpecification[] {
  const landFill = byType(
    Object.fromEntries(LAND_COVER_TYPES.map((t) => [t, BUILT_LAND[t]])),
    "#e8e4d8",
  );
  return [
    { id: "background", type: "background", paint: { "background-color": BUILT.background } },
    {
      id: "hg-landcover",
      type: "fill",
      source: "landscape",
      filter: typeFilter(LAND_COVER_TYPES, year),
      layout: { "fill-sort-key": landCoverSortKey },
      paint: { "fill-color": landFill },
    },
    hillshade("#5c574f", "#ffffff", "#6e6a62", 0.35),
    {
      id: "hg-ocean",
      type: "fill",
      source: "landscape",
      filter: typeFilter(["ocean"], year),
      paint: { "fill-color": BUILT_LAND.ocean },
    },
    {
      id: "hg-coastline",
      type: "line",
      source: "landscape",
      filter: typeFilter(["coastline"], year),
      paint: { "line-color": "#8fb0bb", "line-width": 1 },
    },
    {
      id: "hg-built-water",
      type: "fill",
      source: "built",
      filter: typeFilter(["water"], year),
      paint: { "fill-color": BUILT_LAND.water, "fill-outline-color": "#8fb0bb" },
    },
    {
      id: "hg-park",
      type: "fill",
      source: "built",
      filter: typeFilter(["park"], year),
      paint: { "fill-color": BUILT.park },
    },
    {
      id: "hg-water-lines",
      type: "line",
      source: "landscape",
      filter: typeFilter(["river", "creek"], year),
      paint: { "line-color": "#86aebb", "line-width": lineWidth(1, 3) },
    },
    {
      id: "street-casing",
      type: "line",
      source: "built",
      filter: typeFilter(["street"], year),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": BUILT.streetCasing, "line-width": lineWidth(2.5, 12) },
    },
    {
      id: "hg-street",
      type: "line",
      source: "built",
      filter: typeFilter(["street"], year),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": BUILT.street, "line-width": lineWidth(1.5, 9) },
    },
    {
      id: "hg-rail",
      type: "line",
      source: "built",
      filter: typeFilter(["rail"], year),
      paint: {
        "line-color": BUILT.rail,
        "line-width": 2.5,
        "line-dasharray": [3, 1.5],
      },
    },
    {
      id: "hg-streetcar",
      type: "line",
      source: "built",
      filter: typeFilter(["streetcar"], year),
      paint: { "line-color": BUILT.streetcar, "line-width": 2 },
    },
    {
      id: "hg-pier",
      type: "fill",
      source: "built",
      filter: typeFilter(["pier"], year),
      paint: { "fill-color": BUILT.pier, "fill-outline-color": "#8c7458" },
    },
    {
      id: "hg-building",
      type: "fill",
      source: "built",
      filter: typeFilter(["building"], year),
      paint: { "fill-color": BUILT.building, "fill-outline-color": BUILT.buildingLine },
    },
    {
      id: "street-labels",
      type: "symbol",
      source: "built",
      filter: typeFilter(["street"], year),
      minzoom: 13,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": FONT_REGULAR,
        "text-size": 12,
      },
      paint: {
        "text-color": BUILT.label,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
    landmarkLayer(),
  ];
}

/** Sky and distance haze, so a tilted view reads as a landscape to the horizon. */
const SKY: Record<Era["style"], SkySpecification> = {
  painted: {
    "sky-color": "#bcd3db",
    "horizon-color": "#efe4cc",
    "fog-color": "#efe4cc",
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.75,
  },
  built: {
    "sky-color": "#c9dbe4",
    "horizon-color": "#f2eee6",
    "fog-color": "#f2eee6",
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.8,
  },
  modern: {
    "sky-color": "#9cc8eb",
    "horizon-color": "#e6eef4",
    "fog-color": "#e6eef4",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.85,
  },
};

function withTerrain(style: StyleSpecification, terrainOn: boolean): StyleSpecification {
  const withSources = { ...style, sources: { ...style.sources, ...terrainSources() } };
  return terrainOn
    ? { ...withSources, terrain: { source: "terrain", exaggeration: TERRAIN_EXAGGERATION } }
    : withSources;
}

/** Our own style for a past era. */
export function buildPastStyle(era: Era, terrainOn: boolean): StyleSpecification {
  const year = eraYear(era);
  return withTerrain(
    {
      version: 8,
      name: `era-${era.id}`,
      glyphs: absolute(GLYPHS_URL).replace(
        /%7B(\w+)%7D/g,
        "{$1}",
      ),
      sources: datasetSources(),
      sky: SKY[era.style],
      layers: withSourceLayers(era.style === "painted" ? paintedLayers(year) : builtLayers(year)),
    },
    terrainOn,
  );
}

/**
 * Invisible layers that make MapLibre load our datasets in the Today era,
 * so "this spot through time" can read them.
 */
function probeLayers(): LayerSpecification[] {
  return withSourceLayers(
    (["landscape", "built"] as const).map((source) => ({
      id: `probe-${source}`,
      type: "fill" as const,
      source,
      paint: { "fill-opacity": 0 },
    })),
  );
}

/** The modern basemap with our terrain and hillshade added. */
export function buildModernStyle(base: StyleSpecification, terrainOn: boolean): StyleSpecification {
  const firstSymbol = base.layers.findIndex((layer) => layer.type === "symbol");
  const layers = [...probeLayers(), ...base.layers];
  layers.splice(
    firstSymbol === -1 ? layers.length : firstSymbol + 2,
    0,
    hillshade("#000000", "#ffffff", "#000000", 0.4),
  );
  const sources = { ...base.sources, ...datasetSources() };
  return withTerrain({ ...base, sources, layers, sky: SKY.modern }, terrainOn);
}

/** Feature types each era style draws, for the legend. */
export const STYLE_TYPES: Record<"painted" | "built", readonly string[]> = {
  painted: [
    ...LAND_COVER_TYPES,
    "ocean",
    "coastline",
    "river",
    "creek",
    "trail",
    "rancho",
    "village",
    "adobe",
    "spring",
    "landmark",
  ],
  built: [
    ...LAND_COVER_TYPES,
    "ocean",
    "coastline",
    "river",
    "creek",
    "park",
    "street",
    "rail",
    "streetcar",
    "pier",
    "building",
    "landmark",
  ],
};
