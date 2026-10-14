// Development-only storage for Sanborn sheet control points (/admin/georef).
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEV = process.env.NODE_ENV === "development";
const DIR = path.join(process.cwd(), "data/georef");
const SAFE = /^[a-z0-9-]+$/;

const notFound = () => new Response("Not found", { status: 404 });
const file = (atlas: string, sheet: number) => path.join(DIR, atlas, `sheet-${sheet}.json`);

export async function GET(request: Request) {
  if (!DEV) return notFound();
  const params = new URL(request.url).searchParams;
  const atlas = params.get("atlas") ?? "";
  if (!SAFE.test(atlas)) return Response.json({ error: "bad atlas" }, { status: 400 });
  const sheet = params.get("sheet");
  if (sheet === null) {
    // Which sheets of this atlas already have control points.
    const done = await readdir(path.join(DIR, atlas)).catch(() => [] as string[]);
    return Response.json({ sheets: done.map((f) => Number(f.match(/\d+/)?.[0])).filter(Boolean) });
  }
  try {
    return new Response(await readFile(file(atlas, Number(sheet)), "utf8"), {
      headers: { "content-type": "application/json" },
    });
  } catch {
    return Response.json({ gcps: [] });
  }
}

type Gcp = { px: number; py: number; lng: number; lat: number };

export async function POST(request: Request) {
  if (!DEV) return notFound();
  const body = (await request.json()) as {
    atlas: string;
    sheet: number;
    iiif: string;
    width: number;
    height: number;
    gcps: Gcp[];
  };
  if (!SAFE.test(body.atlas) || !Number.isInteger(body.sheet)) {
    return Response.json({ error: "bad atlas or sheet" }, { status: 400 });
  }
  const ok = body.gcps.every((g) => [g.px, g.py, g.lng, g.lat].every(Number.isFinite));
  if (!ok) return Response.json({ error: "bad control points" }, { status: 422 });
  await mkdir(path.join(DIR, body.atlas), { recursive: true });
  await writeFile(file(body.atlas, body.sheet), JSON.stringify(body, null, 1) + "\n");
  return Response.json({ saved: body.gcps.length });
}
