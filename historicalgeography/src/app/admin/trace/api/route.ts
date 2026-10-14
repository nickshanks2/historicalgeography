// Development-only data access for the /admin/trace tool. In production
// every request is refused: the canonical data is edited locally and
// committed, never written by the deployed site.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEV = process.env.NODE_ENV === "development";
const ROOT = process.cwd();
const FILES = {
  built: path.join(ROOT, "data/features/built.geojson"),
  osm: path.join(ROOT, "data/reference/osm_streets.geojson"),
} as const;
const PUBLIC_BUILT = path.join(ROOT, "public/data/features/built.geojson");

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: Request) {
  if (!DEV) return notFound();
  const which = new URL(request.url).searchParams.get("data") === "osm" ? "osm" : "built";
  const body = await readFile(FILES[which], "utf8");
  return new Response(body, { headers: { "content-type": "application/json" } });
}

type Feature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

function problems(features: Feature[]) {
  const ids = new Set<string>();
  const out: string[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const id = String(p.id ?? "");
    if (!id) out.push("feature without id");
    else if (ids.has(id)) out.push(`duplicate id ${id}`);
    ids.add(id);
    if (!p.type) out.push(`${id}: no type`);
    if (!["documented", "inferred", "modeled"].includes(String(p.confidence))) {
      out.push(`${id}: confidence must be documented, inferred or modeled`);
    }
    if (!Array.isArray(p.source_ids) || !p.source_ids.length) out.push(`${id}: needs at least one source`);
    if (typeof p.start_year === "number" && typeof p.end_year === "number" && p.end_year <= p.start_year) {
      out.push(`${id}: end_year must be after start_year`);
    }
  }
  return out;
}

export async function POST(request: Request) {
  if (!DEV) return notFound();
  const { features } = (await request.json()) as { features: Feature[] };
  const errors = problems(features);
  if (errors.length) return Response.json({ errors }, { status: 422 });

  // One feature per line keeps git diffs readable.
  const sorted = [...features].sort((a, b) =>
    String(a.properties.id).localeCompare(String(b.properties.id)),
  );
  const body = `{"type":"FeatureCollection","features":[\n${sorted
    .map((f) => JSON.stringify(f))
    .join(",\n")}\n]}\n`;
  await writeFile(FILES.built, body);
  await copyFile(FILES.built, PUBLIC_BUILT); // so the dev map shows it right away
  return Response.json({ saved: sorted.length });
}
