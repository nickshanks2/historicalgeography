// Upload the tile files (*.pmtiles) to a Cloudflare R2 bucket, keeping the
// site paths (data/tiles/..., data/overlays/...), so that setting
// NEXT_PUBLIC_TILES_BASE_URL to the bucket's public URL serves them from R2.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//     node scripts/upload-tiles.mjs <bucket-name>
//
// Uses Wrangler (Cloudflare's CLI) through npx. Uploads only files whose
// size changed since the last upload (recorded in .tiles-uploaded.json).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

const bucket = process.argv[2];
if (!bucket) {
  console.error("usage: node scripts/upload-tiles.mjs <bucket-name>");
  process.exit(1);
}
for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
  if (!process.env[key]) {
    console.error(`Set ${key} first (see README, "Tile storage").`);
    process.exit(1);
  }
}

const LOG = ".tiles-uploaded.json";
const uploaded = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};
const files = ["tiles", "overlays"].flatMap((dir) =>
  readdirSync(`data/${dir}`)
    .filter((f) => f.endsWith(".pmtiles"))
    .map((f) => `data/${dir}/${f}`),
);

for (const path of files) {
  const size = statSync(path).size;
  if (uploaded[path] === size) continue;
  console.log(`upload ${path} (${(size / 1e6).toFixed(1)} MB)`);
  execFileSync(
    "npx",
    ["--yes", "wrangler@4", "r2", "object", "put", `${bucket}/${path}`, "--file", path,
     "--content-type", "application/octet-stream", "--remote"],
    { stdio: "inherit" },
  );
  uploaded[path] = size;
  writeFileSync(LOG, JSON.stringify(uploaded, null, 1));
}
console.log(`${files.length} tile files in ${bucket}`);
