// Copies build inputs into public/ (these copies are gitignored):
// - MapLibre's web worker, which the Next.js bundler doesn't emit
// - the canonical datasets from data/, served to the map as GeoJSON
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

mkdirSync("public/data/features", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre-gl-worker.mjs",
);
copyFileSync("data/landmarks.geojson", "public/data/landmarks.geojson");
for (const file of readdirSync("data/features")) {
  if (file.endsWith(".geojson")) {
    copyFileSync(`data/features/${file}`, `public/data/features/${file}`);
  }
}
