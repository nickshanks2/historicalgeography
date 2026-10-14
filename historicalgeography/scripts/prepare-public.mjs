// Copies build inputs into public/ (these copies are gitignored):
// - MapLibre's web worker, which the Next.js bundler doesn't emit
// - the map tiles and small GeoJSON datasets the map loads
// - a summary of every dataset (type, years, sample flag) for the legend,
//   so the browser never has to download the full canonical GeoJSON
// - a search index of every named feature (name, place, years)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

mkdirSync("public/data/features", { recursive: true });
mkdirSync("public/data/tiles", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre-gl-worker.mjs",
);
copyFileSync("data/landmarks.geojson", "public/data/landmarks.geojson");
copyFileSync("data/features/built.geojson", "public/data/features/built.geojson");
// Tile files are served from external storage when NEXT_PUBLIC_TILES_BASE_URL
// is set (upload them with scripts/upload-tiles.mjs); otherwise from this site.
const serveTiles = !process.env.NEXT_PUBLIC_TILES_BASE_URL;
for (const file of readdirSync("data/tiles")) {
  if (serveTiles && file.endsWith(".pmtiles")) copyFileSync(`data/tiles/${file}`, `public/data/tiles/${file}`);
}
// Historical map overlays (pipeline/build_overlays.py).
mkdirSync("public/data/overlays", { recursive: true });
copyFileSync("data/overlays.json", "public/data/overlays.json");
for (const file of readdirSync("data/overlays")) {
  if (serveTiles && file.endsWith(".pmtiles")) copyFileSync(`data/overlays/${file}`, `public/data/overlays/${file}`);
}

const seen = new Set();
const summary = [];
const datasets = [
  "data/landmarks.geojson",
  ...readdirSync("data/features")
    .filter((f) => f.endsWith(".geojson"))
    .map((f) => `data/features/${f}`),
];
for (const path of datasets) {
  for (const { properties: p } of JSON.parse(readFileSync(path, "utf8")).features) {
    const row = {
      type: p.type,
      start_year: p.start_year ?? null,
      end_year: p.end_year ?? null,
      sample: Boolean(p.sample),
    };
    const key = JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      summary.push(row);
    }
  }
}
writeFileSync("public/data/summary.json", JSON.stringify(summary));

/** A representative point: the point itself, a line's middle vertex, or a polygon's vertex average. */
function anchor(geom) {
  const lines =
    geom.type === "Point" ? [[geom.coordinates]]
    : geom.type === "MultiPoint" || geom.type === "LineString" ? [geom.coordinates]
    : geom.type === "MultiLineString" || geom.type === "Polygon" ? geom.coordinates
    : geom.type === "MultiPolygon" ? geom.coordinates.flat()
    : [];
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), []);
  if (!longest.length) return null;
  if (geom.type.includes("Polygon")) {
    const n = longest.length;
    return longest.reduce(([x, y], [px, py]) => [x + px / n, y + py / n], [0, 0]);
  }
  return longest[Math.floor(longest.length / 2)];
}

const round = (v) => Math.round(v * 1e5) / 1e5;
const index = new Map();
for (const path of datasets) {
  for (const { properties: p, geometry } of JSON.parse(readFileSync(path, "utf8")).features) {
    const names = [p.name_tongva, p.name, p.name_spanish].filter(Boolean);
    if (!names.length || p.type === "ocean") continue;
    const key = `${names[0]}|${p.type}`;
    if (index.has(key)) continue; // e.g. a creek split into many segments
    const at = anchor(geometry);
    if (!at) continue;
    index.set(key, {
      names,
      type: p.type,
      at: at.map(round),
      start_year: p.start_year ?? null,
      end_year: p.end_year ?? null,
      sample: Boolean(p.sample),
    });
  }
}
writeFileSync("public/data/search.json", JSON.stringify([...index.values()]));
