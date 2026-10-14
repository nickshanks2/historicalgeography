"use client";

// Development-only tool for georeferencing Sanborn fire insurance sheets:
// click a point on the sheet (a street corner), then the same point on
// today's map. Three or more pairs give a preview of the warped sheet; the
// pairs are saved to data/georef/<atlas>/sheet-<n>.json and warped into an
// overlay by pipeline/build_sanborn.py.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { INITIAL_VIEW, MODERN_STYLE_URL } from "@/config/map";
import sanborn from "../../../../data/reference/sanborn.json";

type Sheet = { n: number; iiif: string; width: number; height: number };
type Atlas = { id: string; title: string; year: number; sheets: Sheet[] };
type Gcp = { px: number; py: number; lng: number; lat: number };

const ATLASES = (sanborn as { atlases: Atlas[] }).atlases;
/** Sheet images are shown 2400 px wide in a pixel-space map (1 px = DEG degrees). */
const SHOWN_WIDTH = 2400;
const DEG = 0.0001;

/** Least-squares affine fit: pixel (px, py) -> local metres (x, y). */
function fitAffine(gcps: Gcp[]) {
  const lat0 = gcps.reduce((s, g) => s + g.lat, 0) / gcps.length;
  const lng0 = gcps.reduce((s, g) => s + g.lng, 0) / gcps.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const toXY = (g: Gcp) => [(g.lng - lng0) * kx, (g.lat - lat0) * 111_320];
  // Normal equations for [a b c] with rows [px py 1].
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atx = [0, 0, 0];
  const aty = [0, 0, 0];
  for (const g of gcps) {
    const row = [g.px, g.py, 1];
    const [x, y] = toXY(g);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i][j] += row[i] * row[j];
      atx[i] += row[i] * x;
      aty[i] += row[i] * y;
    }
  }
  const solve = (m: number[][], v: number[]) => {
    const a = m.map((r, i) => [...r, v[i]]);
    for (let c = 0; c < 3; c++) {
      const p = a.slice(c).reduce((best, r, i) => (Math.abs(r[c]) > Math.abs(a[best][c]) ? i + c : best), c);
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
    }
    return a.map((r, i) => r[3] / r[i]);
  };
  const cx = solve(ata, atx);
  const cy = solve(ata, aty);
  const toLngLat = (px: number, py: number): [number, number] => {
    const x = cx[0] * px + cx[1] * py + cx[2];
    const y = cy[0] * px + cy[1] * py + cy[2];
    return [lng0 + x / kx, lat0 + y / 111_320];
  };
  const residuals = gcps.map((g) => {
    const [lng, lat] = toLngLat(g.px, g.py);
    return Math.hypot((lng - g.lng) * kx, (lat - g.lat) * 111_320);
  });
  return { toLngLat, residuals };
}

function numberedMarker(n: number, color: string) {
  const el = document.createElement("div");
  el.textContent = String(n);
  el.style.cssText = `background:${color};color:#fff;font:600 11px system-ui;border:2px solid #fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.4)`;
  return el;
}

export default function GeorefTool() {
  const sheetDiv = useRef<HTMLDivElement>(null);
  const worldDiv = useRef<HTMLDivElement>(null);
  const sheetMap = useRef<maplibregl.Map | null>(null);
  const worldMap = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(0);
  const [atlasId, setAtlasId] = useState(ATLASES.find((a) => a.year === 1902)?.id ?? ATLASES[0].id);
  const [sheetN, setSheetN] = useState(2);
  const [gcps, setGcps] = useState<Gcp[]>([]);
  const [pending, setPending] = useState<{ px: number; py: number } | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [opacity, setOpacity] = useState(0.6);
  const [status, setStatus] = useState("");

  const atlas = ATLASES.find((a) => a.id === atlasId)!;
  const sheet = atlas.sheets.find((s) => s.n === sheetN) ?? atlas.sheets[0];
  const shownHeight = Math.round((SHOWN_WIDTH * sheet.height) / sheet.width);
  const toFull = sheet.width / SHOWN_WIDTH;
  const fit = useMemo(() => (gcps.length >= 3 ? fitAffine(gcps) : null), [gcps]);

  // Two maps: the sheet (in pixel space) and today's map.
  useEffect(() => {
    maplibregl.setWorkerUrl(new URL("/maplibre-gl-worker.mjs", window.location.origin).href);
    const s = new maplibregl.Map({
      container: sheetDiv.current!,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ddd" } }] },
      center: [0.12, -0.15],
      zoom: 10,
      renderWorldCopies: false,
    });
    s.dragRotate.disable();
    const w = new maplibregl.Map({
      container: worldDiv.current!,
      style: MODERN_STYLE_URL,
      ...INITIAL_VIEW,
      zoom: 15,
      pitch: 0,
      bearing: 0,
      maxZoom: 20,
    });
    w.dragRotate.disable();
    w.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    sheetMap.current = s;
    worldMap.current = w;
    s.once("load", () => setReady((r) => r + 1));
    w.once("load", () => setReady((r) => r + 1));
    return () => {
      s.remove();
      w.remove();
    };
  }, []);

  // Show the chosen sheet and load its saved control points.
  useEffect(() => {
    const s = sheetMap.current;
    if (ready < 2 || !s) return;
    const url = `${sheet.iiif}/full/${SHOWN_WIDTH},/0/default.jpg`;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [0, 0],
      [SHOWN_WIDTH * DEG, 0],
      [SHOWN_WIDTH * DEG, -shownHeight * DEG],
      [0, -shownHeight * DEG],
    ];
    if (s.getLayer("sheet")) s.removeLayer("sheet");
    if (s.getSource("sheet")) s.removeSource("sheet");
    s.addSource("sheet", { type: "image", url, coordinates: coords });
    s.addLayer({ id: "sheet", type: "raster", source: "sheet" });
    s.fitBounds([[0, -shownHeight * DEG], [SHOWN_WIDTH * DEG, 0]], { padding: 10, duration: 0 });
    let cancelled = false;
    fetch(`/admin/georef/api?atlas=${atlas.id}&sheet=${sheet.n}`)
      .then((r) => r.json())
      .then((d: { gcps: Gcp[] }) => {
        if (cancelled) return;
        setGcps(d.gcps ?? []);
        setPending(null);
        setStatus(d.gcps?.length ? `Loaded ${d.gcps.length} saved points` : "No points yet");
      });
    fetch(`/admin/georef/api?atlas=${atlas.id}`)
      .then((r) => r.json())
      .then((d: { sheets: number[] }) => !cancelled && setDone(d.sheets));
    return () => {
      cancelled = true;
    };
  }, [ready, atlas.id, sheet, shownHeight]);

  // Clicks: first on the sheet, then the same spot on today's map.
  useEffect(() => {
    const s = sheetMap.current;
    const w = worldMap.current;
    if (ready < 2 || !s || !w) return;
    const onSheet = (e: maplibregl.MapMouseEvent) => {
      const px = (e.lngLat.lng / DEG) * toFull;
      const py = (-e.lngLat.lat / DEG) * toFull;
      if (px < 0 || py < 0 || px > sheet.width || py > sheet.height) return;
      setPending({ px: Math.round(px), py: Math.round(py) });
      setStatus("Now click the same spot on today's map");
    };
    const onWorld = (e: maplibregl.MapMouseEvent) => {
      if (!pending) {
        setStatus("Click a point on the sheet first");
        return;
      }
      setGcps((g) => [...g, { ...pending, lng: e.lngLat.lng, lat: e.lngLat.lat }]);
      setPending(null);
      setStatus("Point added");
    };
    s.on("click", onSheet);
    w.on("click", onWorld);
    return () => {
      s.off("click", onSheet);
      w.off("click", onWorld);
    };
  }, [ready, pending, sheet, toFull]);

  // Numbered markers on both maps.
  useEffect(() => {
    const s = sheetMap.current;
    const w = worldMap.current;
    if (!s || !w) return;
    for (const m of markers.current) m.remove();
    markers.current = [];
    gcps.forEach((g, i) => {
      markers.current.push(
        new maplibregl.Marker({ element: numberedMarker(i + 1, "#c2255c") })
          .setLngLat([(g.px / toFull) * DEG, -(g.py / toFull) * DEG])
          .addTo(s),
        new maplibregl.Marker({ element: numberedMarker(i + 1, "#c2255c") }).setLngLat([g.lng, g.lat]).addTo(w),
      );
    });
    if (pending) {
      markers.current.push(
        new maplibregl.Marker({ element: numberedMarker(gcps.length + 1, "#1971c2") })
          .setLngLat([(pending.px / toFull) * DEG, -(pending.py / toFull) * DEG])
          .addTo(s),
      );
    }
  }, [gcps, pending, toFull]);

  // Preview the warped sheet on today's map.
  useEffect(() => {
    const w = worldMap.current;
    if (ready < 2 || !w) return;
    if (w.getLayer("preview")) w.removeLayer("preview");
    if (w.getSource("preview")) w.removeSource("preview");
    if (!fit) return;
    const c = [
      fit.toLngLat(0, 0),
      fit.toLngLat(sheet.width, 0),
      fit.toLngLat(sheet.width, sheet.height),
      fit.toLngLat(0, sheet.height),
    ] as [[number, number], [number, number], [number, number], [number, number]];
    w.addSource("preview", { type: "image", url: `${sheet.iiif}/full/${SHOWN_WIDTH},/0/default.jpg`, coordinates: c });
    w.addLayer({ id: "preview", type: "raster", source: "preview", paint: { "raster-opacity": opacity } });
  }, [ready, fit, sheet, opacity]);

  const save = useCallback(async () => {
    const res = await fetch("/admin/georef/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atlas: atlas.id, sheet: sheet.n, iiif: sheet.iiif, width: sheet.width, height: sheet.height, gcps }),
    });
    const body = await res.json();
    setStatus(res.ok ? `Saved ${body.saved} points` : `Not saved: ${body.error}`);
    if (res.ok) setDone((d) => [...new Set([...d, sheet.n])]);
  }, [atlas.id, sheet, gcps]);

  const worst = fit ? Math.max(...fit.residuals) : null;

  return (
    <div className="flex h-dvh flex-col text-sm">
      <header className="flex flex-wrap items-center gap-2 border-b bg-white p-2">
        <strong>Georeference Sanborn sheets</strong>
        <select value={atlasId} onChange={(e) => { setAtlasId(e.target.value); setSheetN(1); }} className="rounded border px-1 py-1">
          {ATLASES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({a.sheets.length} sheets)
            </option>
          ))}
        </select>
        <select value={sheetN} onChange={(e) => setSheetN(Number(e.target.value))} className="rounded border px-1 py-1">
          {atlas.sheets.map((s) => (
            <option key={s.n} value={s.n}>
              Sheet {s.n}
              {done.includes(s.n) ? " ✓" : ""}
            </option>
          ))}
        </select>
        <span>{gcps.length} points{worst !== null && ` · worst error ${worst.toFixed(1)} m`}</span>
        <label className="flex items-center gap-1">
          Preview
          <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
        </label>
        <button type="button" onClick={() => setGcps((g) => g.slice(0, -1))} className="rounded border px-2 py-1">
          Undo point
        </button>
        <button type="button" onClick={save} disabled={gcps.length < 3} className="rounded bg-stone-800 px-3 py-1 text-white disabled:opacity-40">
          Save
        </button>
        <span role="status" className="text-stone-600">{status}</span>
      </header>
      <div className="grid min-h-0 flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
        <div className="relative border-r">
          <div ref={sheetDiv} className="h-full w-full" />
          <p className="absolute top-2 left-2 rounded bg-white/90 px-2 py-1 text-xs">1. Click a street corner on the sheet</p>
        </div>
        <div className="relative">
          <div ref={worldDiv} className="h-full w-full" />
          <p className="absolute top-2 left-2 rounded bg-white/90 px-2 py-1 text-xs">2. Click the same corner today</p>
        </div>
      </div>
      {fit && (
        <footer className="border-t bg-white p-2 text-xs text-stone-600">
          Errors per point (m): {fit.residuals.map((r, i) => `${i + 1}: ${r.toFixed(1)}`).join(" · ")}. Aim for
          4–8 points spread over the sheet, each under ~5 m.
        </footer>
      )}
    </div>
  );
}
