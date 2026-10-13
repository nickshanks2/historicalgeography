// Copies build inputs into public/ (these copies are gitignored):
// - MapLibre's web worker, which the Next.js bundler doesn't emit
// - the map tiles and small GeoJSON datasets the map loads
// - a summary of every dataset (type, years, sample flag) for the legend,
//   so the browser never has to download the full canonical GeoJSON
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

mkdirSync("public/data/features", { recursive: true });
mkdirSync("public/data/tiles", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre-gl-worker.mjs",
);
copyFileSync("data/landmarks.geojson", "public/data/landmarks.geojson");
copyFileSync("data/features/built.geojson", "public/data/features/built.geojson");
for (const file of readdirSync("data/tiles")) {
  if (file.endsWith(".pmtiles")) copyFileSync(`data/tiles/${file}`, `public/data/tiles/${file}`);
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
