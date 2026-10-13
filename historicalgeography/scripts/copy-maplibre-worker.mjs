// MapLibre loads its web worker from a separate file that the Next.js
// bundler doesn't emit, so serve a copy from public/ (matches installed version).
import { copyFileSync } from "node:fs";

copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre-gl-worker.mjs",
);
