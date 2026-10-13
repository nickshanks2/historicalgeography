// "This spot through time": what our datasets record at one point in every
// era. Uses the features in the map's loaded tiles regardless of which era
// is showing, so it works from any era (including Today).

import type { Map as MapLibreMap } from "maplibre-gl";
import { ERAS, type Era, eraYear } from "@/config/eras";
import { type FeatureInfo, toFeatureInfo } from "./featureInfo";
import { TYPE_LABELS } from "./featureTypes";
import { existsIn } from "./timeFilter";

type LngLat = { lng: number; lat: number };
type Geometry = GeoJSON.Geometry;

/** How close a line or point must be to count as "here" (metres). */
const NEAR_M: Record<string, number> = {
  coastline: 150,
  river: 150,
  creek: 80,
  trail: 80,
  street: 25,
  rail: 30,
  streetcar: 30,
  spring: 120,
  village: 400,
  adobe: 150,
};
const DEFAULT_NEAR_M = 40;

/** Area types read as "on" the spot; ranchos as "within". */
const AREA_ORDER = [
  "building",
  "pier",
  "park",
  "water",
  "wetland",
  "salt_marsh",
  "flat",
  "riparian",
  "dune",
  "beach",
  "open_field",
  "grassland",
  "oak_woodland",
  "coastal_sage_scrub",
  "chaparral",
  "ocean",
];

export type SpotFeature = { info: FeatureInfo; relation: "on" | "within" | "near" };

export type SpotEra = { era: Era; features: SpotFeature[] };

export type SpotHistory = { lngLat: LngLat; eras: SpotEra[] };

// --- geometry (lng/lat, metres via a local equirectangular projection) ---

function project(lngLat: LngLat) {
  const kx = 111_320 * Math.cos((lngLat.lat * Math.PI) / 180);
  return ([lng, lat]: number[]) => [(lng - lngLat.lng) * kx, (lat - lngLat.lat) * 111_320];
}

function ringContains(ring: number[][]) {
  // Point is the origin of the projected frame.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance([ax, ay]: number[], [bx, by]: number[]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function lineDistance(line: number[][]) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, segmentDistance(line[i - 1], line[i]));
  return best;
}

/** Relation of a geometry to the origin, or null if it is not "here". */
function relate(geom: Geometry, nearM: number, toXY: (c: number[]) => number[]) {
  switch (geom.type) {
    case "Polygon":
    case "MultiPolygon": {
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      const hit = polys.some((rings) => {
        const [outer, ...holes] = rings.map((r) => r.map(toXY));
        return ringContains(outer) && !holes.some(ringContains);
      });
      return hit ? "on" : null;
    }
    case "LineString":
    case "MultiLineString": {
      const lines = geom.type === "LineString" ? [geom.coordinates] : geom.coordinates;
      const d = Math.min(...lines.map((l) => lineDistance(l.map(toXY))));
      return d <= nearM ? "near" : null;
    }
    case "Point":
    case "MultiPoint": {
      const pts = geom.type === "Point" ? [geom.coordinates] : geom.coordinates;
      const d = Math.min(...pts.map((p) => Math.hypot(...(toXY(p) as [number, number]))));
      return d <= nearM ? "near" : null;
    }
    default:
      return null;
  }
}

// --- query ---

const SOURCES: { source: string; sourceLayer?: string }[] = [
  { source: "landscape", sourceLayer: "landscape" },
  { source: "built" },
];

/** Every feature (any era) recorded at this spot, from the loaded tiles. */
export function featuresAt(map: MapLibreMap, lngLat: LngLat): SpotFeature[] {
  const toXY = project(lngLat);
  const found = new Map<string, SpotFeature>();
  for (const { source, sourceLayer } of SOURCES) {
    if (!map.getSource(source)) continue;
    for (const f of map.querySourceFeatures(source, { sourceLayer })) {
      const info = toFeatureInfo(f.properties as Record<string, unknown>);
      if (!info.id || found.has(info.id) || info.type === "landmark") continue;
      const nearM = NEAR_M[info.type] ?? DEFAULT_NEAR_M;
      const relation = relate(f.geometry as Geometry, nearM, toXY);
      if (!relation) continue;
      found.set(info.id, { info, relation: info.type === "rancho" ? "within" : relation });
    }
  }
  return [...found.values()];
}

function rank(f: SpotFeature) {
  if (f.relation === "on") {
    const i = AREA_ORDER.indexOf(f.info.type);
    return i === -1 ? AREA_ORDER.length : i;
  }
  return f.relation === "near" ? 100 : 200;
}

/** Group features by era: what existed here in each era's year. */
export function spotHistory(map: MapLibreMap, lngLat: LngLat): SpotHistory {
  const features = featuresAt(map, lngLat);
  return {
    lngLat,
    eras: ERAS.map((era) => {
      const year = eraYear(era);
      const here = features
        .filter((f) => existsIn(f.info, year))
        .sort((a, b) => rank(a) - rank(b));
      // One area per spot (the most specific), then nearby lines and points.
      const areas = here.filter((f) => f.relation === "on").slice(0, 1);
      const rest = here.filter((f) => f.relation !== "on");
      const seenTypes = new Set<string>();
      const near = rest.filter((f) => {
        const key = `${f.info.type}:${f.info.name ?? ""}`;
        if (seenTypes.has(key)) return false;
        seenTypes.add(key);
        return true;
      });
      return { era, features: [...areas, ...near] };
    }),
  };
}

export function spotLabel(f: SpotFeature) {
  const type = TYPE_LABELS[f.info.type] ?? f.info.type;
  const name = f.info.name_tongva ?? f.info.name ?? f.info.name_spanish;
  const what = name ? `${name} (${type.toLowerCase()})` : type;
  if (f.relation === "near") return `Near ${name ? what : what.toLowerCase()}`;
  if (f.relation === "within") return `Within ${name ?? type}`;
  return what;
}
