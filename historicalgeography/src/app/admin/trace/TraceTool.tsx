"use client";

// Development-only tool for tracing the built environment from historical
// maps into data/features/built.geojson (see CLAUDE.md, Data model).
// An old map is shown under the time-ranged features; draw or correct
// streets, buildings, piers and rail, or adopt a modern OSM street whose
// course is unchanged, then set its years and sources and save.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawRenderMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Era } from "@/config/eras";
import { DEFAULT_OVERLAY_OPACITY, INITIAL_VIEW } from "@/config/map";
import { type Overlay, setsForEra, useOverlaySets } from "@/map/overlays";
import { STYLE_IMAGE_PIXEL_RATIO, makeStyleImage } from "@/map/patterns";
import { buildPastStyle, withOverlay } from "@/map/styles";
import { existsIn } from "@/map/timeFilter";
import sources from "../../../../data/sources.json";

type Source = { id: string; title: string; url: string | null };
const SOURCES = sources as Source[];

const BUILT_TYPES = ["street", "building", "pier", "rail", "streetcar", "park", "water"] as const;
const TYPE_COLORS: Record<string, `#${string}`> = {
  street: "#d9480f",
  building: "#7048e8",
  pier: "#8c6d3f",
  rail: "#212529",
  streetcar: "#c2255c",
  park: "#2f9e44",
  water: "#1c7ed6",
};
/** Our properties; anything else in a feature (Terra Draw's bookkeeping) is dropped on save. */
const KEYS = [
  "id", "type", "name", "start_year", "start_approx", "end_year", "end_approx",
  "observed_year", "confidence", "source_ids", "source_note", "sample",
] as const;
type Props = {
  id: string;
  type: string;
  name?: string | null;
  start_year?: number | null;
  start_approx?: boolean;
  end_year?: number | null;
  end_approx?: boolean;
  observed_year?: number | null;
  confidence: "documented" | "inferred" | "modeled";
  source_ids: string[];
  source_note?: string | null;
  sample?: boolean;
};
type Feature = { type: "Feature"; properties: Props; geometry: GeoJSON.Geometry };

const MODE_FOR: Record<string, string> = {
  Point: "point",
  LineString: "linestring",
  Polygon: "polygon",
};

/** Parts of a line inside an axis-aligned box (Liang–Barsky per segment). */
function clipLine(line: number[][], [w, s, e, n]: number[]): number[][][] {
  const parts: number[][][] = [];
  let current: number[][] = [];
  const close = () => {
    if (current.length > 1) parts.push(current);
    current = [];
  };
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    for (const [p, q] of [[-dx, x0 - w], [dx, e - x0], [-dy, y0 - s], [dy, n - y0]]) {
      if (p === 0) {
        if (q < 0) inside = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!inside || t0 > t1) {
      close();
      continue;
    }
    const a = [x0 + t0 * dx, y0 + t0 * dy];
    const b = [x0 + t1 * dx, y0 + t1 * dy];
    const last = current[current.length - 1];
    if (!last || last[0] !== a[0] || last[1] !== a[1]) {
      close();
      current.push(a);
    }
    current.push(b);
    if (t1 < 1) close();
  }
  close();
  return parts;
}

const metres = (line: number[][]) =>
  line.slice(1).reduce((sum, [x, y], i) => {
    const [px, py] = line[i];
    const kx = 111_320 * Math.cos((y * Math.PI) / 180);
    return sum + Math.hypot((x - px) * kx, (y - py) * 111_320);
  }, 0);

const newId = (type: string) => `${type}-${crypto.randomUUID().slice(0, 8)}`;

function ourProps(p: Record<string, unknown>): Props {
  return Object.fromEntries(KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) as Props;
}

/** Round coordinates to 7 decimals (~1 cm): Terra Draw rejects float noise. */
function roundCoords<T>(c: T): T {
  return (Array.isArray(c)
    ? typeof c[0] === "number"
      ? c.map((v: number) => Math.round(v * 1e7) / 1e7)
      : c.map(roundCoords)
    : c) as T;
}

/** Split multi-part geometries: Terra Draw edits single parts. */
function toDrawFeatures(f: Feature): GeoJSONStoreFeatures[] {
  const g = { ...f.geometry, coordinates: roundCoords((f.geometry as GeoJSON.LineString).coordinates) } as GeoJSON.Geometry;
  const parts: GeoJSON.Geometry[] =
    g.type === "MultiLineString"
      ? g.coordinates.map((c) => ({ type: "LineString", coordinates: c }))
      : g.type === "MultiPolygon"
        ? g.coordinates.map((c) => ({ type: "Polygon", coordinates: c }))
        : g.type === "MultiPoint"
          ? g.coordinates.map((c) => ({ type: "Point", coordinates: c }))
          : [g];
  return parts.map((geometry, i) => ({
    type: "Feature",
    id: parts.length > 1 ? `${f.properties.id}-${i + 1}` : f.properties.id,
    geometry,
    properties: {
      ...f.properties,
      id: parts.length > 1 ? `${f.properties.id}-${i + 1}` : f.properties.id,
      mode: MODE_FOR[geometry.type],
    },
  })) as GeoJSONStoreFeatures[];
}

function traceEra(year: number): Era {
  return { id: `trace-${year}`, label: String(year), year, confidence: "documented", style: "built" };
}

export default function TraceTool() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const yearRef = useRef(1902);
  const [ready, setReady] = useState(false);
  const [year, setYear] = useState(1902);
  const [mode, setMode] = useState("select");
  const [selected, setSelected] = useState<Props | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [showOsm, setShowOsm] = useState(true);
  const overlaySets = useOverlaySets();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [defaults, setDefaults] = useState<Omit<Props, "id">>({
    type: "street",
    start_year: 1902,
    start_approx: true,
    observed_year: 1902,
    confidence: "documented",
    source_ids: [],
  });

  const era = useMemo(() => traceEra(year), [year]);
  // Default to the old map closest to the tracing year.
  const closestSet = useMemo(() => setsForEra(overlaySets, era)[0] ?? null, [overlaySets, era]);
  const shownOverlay = useMemo(
    () => overlay ?? (closestSet ? { set: closestSet, opacity: DEFAULT_OVERLAY_OPACITY } : null),
    [overlay, closestSet],
  );

  // --- map and Terra Draw setup ---
  useEffect(() => {
    if (!containerRef.current) return;
    maplibregl.setWorkerUrl(new URL("/maplibre-gl-worker.mjs", window.location.origin).href);
    const pmtiles = new Protocol();
    maplibregl.addProtocol("pmtiles", pmtiles.tile);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      ...INITIAL_VIEW,
      zoom: 15,
      pitch: 0,
      bearing: 0,
      maxZoom: 20,
      hash: "view",
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    map.addControl(new maplibregl.ScaleControl({}), "bottom-right");
    map.setMissingStyleImageResolver((id) => {
      const canvas = makeStyleImage(id);
      if (!canvas || map.hasImage(id)) return;
      const ctx = canvas.getContext("2d")!;
      map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), {
        pixelRatio: STYLE_IMAGE_PIXEL_RATIO,
      });
    });
    map.once("load", () => setReady(true));
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { hgMap: maplibregl.Map }).hgMap = map;
    }
    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      mapRef.current = null;
      map.remove();
      maplibregl.removeProtocol("pmtiles");
    };
  }, []);

  /** Select a feature from code (Terra Draw only reports clicks) and show it in the form. */
  const selectNow = useCallback((draw: TerraDraw, id: string) => {
    draw.selectFeature(id);
    const f = draw.getSnapshotFeature(id);
    if (f) setSelected(ourProps(f.properties));
  }, []);

  /** The old-map sheets under a point: the default source for what is traced there. */
  const overlayRef = useRef(shownOverlay);
  useEffect(() => {
    overlayRef.current = shownOverlay;
  }, [shownOverlay]);
  const withSources = useCallback((props: Props, geometry: GeoJSON.Geometry): Props => {
    if (props.source_ids.length) return props;
    // First coordinate of any geometry type.
    const [lng, lat] = JSON.stringify(geometry).match(/-?\d+\.\d+/g)?.map(Number) ?? [];
    const source_ids = (overlayRef.current?.set.sheets ?? [])
      .filter(({ bounds: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n)
      .map((sheet) => sheet.source_id);
    return { ...props, source_ids };
  }, []);

  const defaultsRef = useRef(defaults);
  const modeRef = useRef(mode);
  const adoptAreaRef = useRef(false);
  const osmRef = useRef<{ features: Feature[] } | null>(null);

  /** Adopt every OSM street inside a rectangle, clipped to it. */
  const adoptArea = useCallback(
    async (draw: TerraDraw, rect: GeoJSON.Polygon) => {
      osmRef.current ??= await (await fetch("/admin/trace/api?data=osm")).json();
      const xs = rect.coordinates[0].map((c) => c[0]);
      const ys = rect.coordinates[0].map((c) => c[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const added: GeoJSONStoreFeatures[] = [];
      for (const osm of osmRef.current!.features) {
        const name = String((osm.properties as unknown as { osm_name: string }).osm_name);
        const g = osm.geometry;
        const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
        const pieces = lines.flatMap((l) => clipLine(l, box)).filter((l) => metres(l) > 25);
        if (!pieces.length) continue;
        const geometry: GeoJSON.Geometry =
          pieces.length === 1
            ? { type: "LineString", coordinates: pieces[0] }
            : { type: "MultiLineString", coordinates: pieces };
        added.push(
          ...toDrawFeatures({
            type: "Feature",
            geometry,
            properties: withSources(
              {
                ...defaultsRef.current,
                type: "street",
                id: newId("street"),
                name,
                source_note: `Course follows today's ${name} (OpenStreetMap), checked against the old map.`,
              },
              geometry,
            ),
          }),
        );
      }
      const failed = draw.addFeatures(added).filter((v) => !v.valid).length;
      setStatus(
        `Adopted ${added.length - failed} street pieces in the area${failed ? ` (${failed} failed)` : ""}. ` +
          `Delete any the old map doesn't show, and fix names that differ.`,
      );
      setMode("select");
    },
    [withSources],
  );

  useEffect(() => {
    defaultsRef.current = defaults;
  }, [defaults]);
  useEffect(() => {
    modeRef.current = mode;
    adoptAreaRef.current = mode === "adopt-area";
    const drawMode = mode === "adopt-area" ? "rectangle" : mode;
    // Re-entering the current mode would clear a selection made from code.
    if (drawRef.current && drawRef.current.getMode() !== drawMode) drawRef.current.setMode(drawMode);
  }, [mode]);

  const snapshotRef = useRef<GeoJSONStoreFeatures[] | null>(null);
  /** Ids loaded from the file, and ids deleted on purpose: Save refuses to drop any other. */
  const loadedIdsRef = useRef<Set<string> | null>(null);
  const deletedIdsRef = useRef(new Set<string>());
  /** Whether the current Terra Draw instance has finished loading features. */
  const drawLoadedRef = useRef(false);

  const startDraw = useCallback(async (map: maplibregl.Map) => {
    const exists = (f: { properties: Record<string, unknown> }) =>
      existsIn(f.properties as Props, yearRef.current);
    const color = (f: { properties: Record<string, unknown> }) =>
      TYPE_COLORS[String(f.properties.type)] ?? "#495057";
    const fade = (f: { properties: Record<string, unknown> }, on: number) => (exists(f) ? on : 0.18);
    const editable = {
      feature: {
        draggable: true,
        coordinates: { midpoints: true, draggable: true, deletable: true },
      },
    };
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      idStrategy: {
        isValidId: (id) => typeof id === "string" && id.length > 0,
        getId: () => newId("feature"),
      },
      modes: [
        new TerraDrawSelectMode({
          flags: { linestring: editable, polygon: editable, rectangle: editable, point: editable },
        }),
        new TerraDrawLineStringMode({
          styles: {
            lineStringColor: color,
            lineStringWidth: (f) => (exists(f) ? 4 : 2),
            lineStringOpacity: (f) => fade(f, 0.95),
          },
        }),
        new TerraDrawPolygonMode({
          styles: {
            fillColor: color,
            fillOpacity: (f) => fade(f, 0.35),
            outlineColor: color,
            outlineWidth: 2,
            outlineOpacity: (f) => fade(f, 1),
          },
        }),
        new TerraDrawRectangleMode({
          styles: { fillColor: color, fillOpacity: (f) => fade(f, 0.35), outlineColor: color, outlineWidth: 2 },
        }),
        new TerraDrawPointMode({
          styles: { pointColor: color, pointWidth: 6, pointOpacity: (f) => fade(f, 1) },
        }),
        new TerraDrawRenderMode({ modeName: "adopt", styles: {} }),
      ],
    });
    draw.start();
    drawRef.current = draw;

    if (snapshotRef.current) {
      draw.addFeatures(snapshotRef.current);
    } else {
      const res = await fetch("/admin/trace/api?data=built");
      const fc = (await res.json()) as { features: Feature[] };
      if (drawRef.current !== draw) return; // replaced while loading
      const parts = fc.features.flatMap(toDrawFeatures);
      const results = draw.addFeatures(parts);
      const problems = results.filter((v) => !v.valid);
      // Every id in the file counts, loaded or not, so Save can't drop any.
      loadedIdsRef.current = new Set(parts.map((f) => String(f.id)));
      setStatus(
        problems.length
          ? `Loaded ${parts.length - problems.length}; ${problems.length} could not be loaded: ${problems
              .slice(0, 3)
              .map((v) => `${v.id} (${v.reason})`)
              .join(", ")}`
          : `Loaded ${parts.length} features`,
      );
    }
    drawLoadedRef.current = true;

    draw.on("select", (id) => {
      const f = draw.getSnapshotFeature(id);
      if (f) setSelected(ourProps(f.properties));
    });
    draw.on("deselect", () => setSelected(null));
    draw.on("change", (_ids, type) => {
      if (type !== "styling") setDirty(true);
    });
    draw.on("finish", (id, ctx) => {
      if (ctx.action !== "draw") return;
      const f = draw.getSnapshotFeature(id);
      if (!f) return;
      if (adoptAreaRef.current) {
        // The rectangle only marks the area: adopt every OSM street inside it.
        draw.removeFeatures([id]);
        void adoptArea(draw, f.geometry as GeoJSON.Polygon);
        return;
      }
      // A new feature: give it a readable id and the current defaults.
      const props = withSources(
        { ...defaultsRef.current, id: newId(defaultsRef.current.type) },
        f.geometry,
      );
      draw.removeFeatures([id]);
      draw.addFeatures([{ ...f, id: props.id, properties: { ...props, mode: f.properties.mode } }]);
      draw.setMode("select");
      setMode("select");
      selectNow(draw, props.id);
    });
    draw.setMode(modeRef.current === "adopt-area" ? "rectangle" : modeRef.current);
  }, [selectNow, withSources, adoptArea]);


  // Base map for the tracing year (our built style without the built
  // dataset, which Terra Draw renders), the old map, and OSM reference.
  const overlayKey = shownOverlay ? `${shownOverlay.set.id}` : "";
  const opacity = shownOverlay?.opacity ?? 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const base = buildPastStyle(era, false);
    base.layers = base.layers.filter((l) => !("source" in l) || l.source !== "built");
    const style = withOverlay(base, shownOverlay, false);
    style.sources["osm-ref"] = { type: "geojson", data: "/admin/trace/api?data=osm" };
    style.layers.push(
      {
        id: "osm-ref",
        type: "line",
        source: "osm-ref",
        layout: { visibility: showOsm ? "visible" : "none" },
        paint: { "line-color": "#e64980", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.8 },
      },
      {
        id: "osm-ref-hit",
        type: "line",
        source: "osm-ref",
        layout: { visibility: showOsm ? "visible" : "none" },
        paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 },
      },
      {
        id: "osm-ref-label",
        type: "symbol",
        source: "osm-ref",
        minzoom: 15,
        layout: {
          visibility: showOsm ? "visible" : "none",
          "symbol-placement": "line",
          "text-field": ["concat", "OSM: ", ["get", "osm_name"]],
          "text-font": ["noto-sans-regular"],
          "text-size": 11,
        },
        paint: { "text-color": "#c2255c", "text-halo-color": "#fff", "text-halo-width": 1.5 },
      },
    );
    // Terra Draw's layers don't survive a style swap: keep its features,
    // stop it while its layers still exist, and start a new one afterwards.
    const previous = drawRef.current;
    if (previous && drawLoadedRef.current) {
      snapshotRef.current = previous
        .getSnapshot()
        .filter((f) => f.properties.mode !== "select")
        .map((f) => ({ ...f, properties: { ...ourProps(f.properties), mode: f.properties.mode } }));
    }
    if (previous) {
      previous.stop();
      drawRef.current = null;
      drawLoadedRef.current = false;
    }
    map.setStyle(style, { diff: false });
    const onLoad = () => void startDraw(map);
    map.once("style.load", onLoad);
    return () => {
      map.off("style.load", onLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, era, overlayKey, showOsm]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const l of map.getStyle().layers) {
      if (l.id.startsWith("overlay-")) map.setPaintProperty(l.id, "raster-opacity", opacity);
    }
  }, [opacity]);

  // Feature styles read the tracing year when they re-render.
  useEffect(() => {
    yearRef.current = year;
  }, [year]);
  const changeYear = (next: number) => {
    setYear(next);
    setDefaults((d) => ({ ...d, start_year: next, observed_year: next }));
  };

  // Adopt mode: click a modern OSM street to copy its course.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode !== "adopt") return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["osm-ref-hit"] })[0];
      const draw = drawRef.current;
      if (!hit || !draw) return;
      const osmName = String(hit.properties.osm_name);
      const geometry = hit.geometry as GeoJSON.Geometry;
      const base: Feature = {
        type: "Feature",
        geometry,
        properties: withSources({
          ...defaultsRef.current,
          type: "street",
          id: newId("street"),
          name: osmName,
          source_note: `Course follows today's ${osmName} (OpenStreetMap), checked against the old map.`,
        }, geometry),
      };
      const added = toDrawFeatures(base);
      const results = draw.addFeatures(added);
      const failed = results.filter((v) => !v.valid);
      if (failed.length) {
        setStatus(`Could not adopt ${osmName}: ${failed.map((v) => v.reason).join(", ")}`);
        return;
      }
      setMode("select");
      draw.setMode("select");
      selectNow(draw, added[0].id as string);
      setStatus(`Adopted ${osmName} (${added.length} part${added.length > 1 ? "s" : ""}). Check its name and years for ${yearRef.current}.`);
    };
    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [mode, selectNow, withSources]);

  // --- editing the selected feature ---
  const update = (patch: Partial<Props>) => {
    const draw = drawRef.current;
    if (!draw || !selected) return;
    const next = { ...selected, ...patch };
    draw.updateFeatureProperties(selected.id, patch as Record<string, never>);
    setSelected(next);
    setDirty(true);
  };

  const remove = () => {
    if (!selected) return;
    deletedIdsRef.current.add(selected.id);
    drawRef.current?.removeFeatures([selected.id]);
    setSelected(null);
    setDirty(true);
  };

  const save = async () => {
    const draw = drawRef.current;
    if (!draw) return;
    const features = draw
      .getSnapshot()
      .filter((f) => f.properties.mode !== "select")
      .map((f) => ({ type: "Feature", properties: ourProps(f.properties), geometry: f.geometry }));
    // Never drop features silently: everything loaded must still be here
    // unless it was deleted on purpose.
    const loaded = loadedIdsRef.current;
    const present = new Set(features.map((f) => f.properties.id));
    const missing = loaded
      ? [...loaded].filter((id) => !present.has(id) && !deletedIdsRef.current.has(id))
      : null;
    if (!loaded || missing?.length) {
      setStatus(
        loaded
          ? `Not saved: ${missing!.length} loaded feature(s) are missing (${missing!.slice(0, 3).join(", ")}). Reload the page.`
          : "Not saved: features have not finished loading.",
      );
      return;
    }
    setStatus("Saving…");
    const res = await fetch("/admin/trace/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ features }),
    });
    const body = await res.json();
    if (res.ok) {
      setDirty(false);
      setStatus(`Saved ${body.saved} features to data/features/built.geojson`);
    } else {
      setStatus(`Not saved: ${(body.errors as string[]).slice(0, 4).join("; ")}`);
    }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const keys: Record<string, string> = { s: "select", l: "linestring", a: "polygon", r: "rectangle", p: "point", o: "adopt", g: "adopt-area" };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      if (keys[e.key]) setMode(keys[e.key]);
      if (e.key === "Delete" || e.key === "Backspace") remove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sourceList = useMemo(() => {
    const overlaySources = new Set(shownOverlay?.set.sheets.map((s) => s.source_id) ?? []);
    return [...SOURCES].sort(
      (a, b) => Number(overlaySources.has(b.id)) - Number(overlaySources.has(a.id)),
    );
  }, [shownOverlay]);

  return (
    <div className="flex h-dvh w-full flex-col md:flex-row">
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-1 rounded-lg bg-white/95 p-1 text-sm shadow">
          {[
            ["select", "Select (S)"],
            ["linestring", "Line (L)"],
            ["polygon", "Area (A)"],
            ["rectangle", "Rectangle (R)"],
            ["point", "Point (P)"],
            ["adopt", "Adopt OSM street (O)"],
            ["adopt-area", "Adopt all in area (G)"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`rounded px-2 py-1 ${mode === id ? "bg-stone-800 text-white" : "hover:bg-stone-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <aside className="max-h-[45vh] w-full overflow-y-auto border-t border-stone-300 bg-white p-3 text-sm md:max-h-none md:w-96 md:border-t-0 md:border-l">
        <h1 className="text-base font-semibold">Trace the built environment</h1>
        <p className="text-xs text-stone-500">
          Development only. Saves to data/features/built.geojson; commit the result.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label>
            <span className="block text-xs text-stone-500">Tracing year</span>
            <input
              type="number"
              value={year}
              onChange={(e) => changeYear(Number(e.target.value))}
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <label>
            <span className="block text-xs text-stone-500">Old map</span>
            <select
              value={shownOverlay?.set.id ?? ""}
              onChange={(e) => {
                const set = overlaySets.find((s) => s.id === e.target.value);
                setOverlay(set ? { set, opacity } : null);
              }}
              className="w-full rounded border px-1 py-1"
            >
              {overlaySets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2">
            <span className="block text-xs text-stone-500">Old map opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) =>
                shownOverlay && setOverlay({ ...shownOverlay, opacity: Number(e.target.value) })
              }
              className="w-full"
            />
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={showOsm} onChange={(e) => setShowOsm(e.target.checked)} />
            Show today&apos;s OSM streets (pink, for adopting)
          </label>
        </div>

        <h2 className="mt-4 font-semibold">{selected ? `Selected: ${selected.id}` : "New features"}</h2>
        <PropsForm
          value={selected ?? { ...defaults, id: "" }}
          onChange={(patch) =>
            selected ? update(patch) : setDefaults((d) => ({ ...d, ...patch }))
          }
          sources={sourceList}
        />
        {selected && (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => update({ end_year: year })} className="rounded border px-2 py-1">
              Ends in {year}
            </button>
            <button type="button" onClick={remove} className="rounded border border-red-300 px-2 py-1 text-red-700">
              Delete
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            className={`rounded px-3 py-2 font-medium ${dirty ? "bg-stone-800 text-white" : "bg-stone-200"}`}
          >
            Save{dirty ? " *" : ""}
          </button>
          <span className="text-xs text-stone-600" role="status">
            {status}
          </span>
        </div>
      </aside>
    </div>
  );
}

function PropsForm({
  value,
  onChange,
  sources,
}: {
  value: Props;
  onChange: (patch: Partial<Props>) => void;
  sources: Source[];
}) {
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <div className="mt-1 grid grid-cols-2 gap-2">
      <label>
        <span className="block text-xs text-stone-500">Type</span>
        <select value={value.type} onChange={(e) => onChange({ type: e.target.value })} className="w-full rounded border px-1 py-1">
          {BUILT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="block text-xs text-stone-500">Name (as of then)</span>
        <input value={value.name ?? ""} onChange={(e) => onChange({ name: e.target.value || null })} className="w-full rounded border px-2 py-1" />
      </label>
      <label>
        <span className="block text-xs text-stone-500">Start year</span>
        <input type="number" value={value.start_year ?? ""} onChange={(e) => onChange({ start_year: num(e.target.value) })} className="w-full rounded border px-2 py-1" />
      </label>
      <label className="flex items-end gap-1 pb-1">
        <input type="checkbox" checked={Boolean(value.start_approx)} onChange={(e) => onChange({ start_approx: e.target.checked })} />
        approx. (&quot;by&quot;)
      </label>
      <label>
        <span className="block text-xs text-stone-500">End year</span>
        <input type="number" value={value.end_year ?? ""} onChange={(e) => onChange({ end_year: num(e.target.value) })} className="w-full rounded border px-2 py-1" />
      </label>
      <label className="flex items-end gap-1 pb-1">
        <input type="checkbox" checked={Boolean(value.end_approx)} onChange={(e) => onChange({ end_approx: e.target.checked })} />
        approx.
      </label>
      <label>
        <span className="block text-xs text-stone-500">Recorded in</span>
        <input type="number" value={value.observed_year ?? ""} onChange={(e) => onChange({ observed_year: num(e.target.value) })} className="w-full rounded border px-2 py-1" />
      </label>
      <label>
        <span className="block text-xs text-stone-500">Confidence</span>
        <select value={value.confidence} onChange={(e) => onChange({ confidence: e.target.value as Props["confidence"] })} className="w-full rounded border px-1 py-1">
          <option>documented</option>
          <option>inferred</option>
          <option>modeled</option>
        </select>
      </label>
      <label className="col-span-2">
        <span className="block text-xs text-stone-500">Note</span>
        <input value={value.source_note ?? ""} onChange={(e) => onChange({ source_note: e.target.value || null })} className="w-full rounded border px-2 py-1" />
      </label>
      <fieldset className="col-span-2">
        <legend className="text-xs text-stone-500">Sources</legend>
        <div className="max-h-36 overflow-y-auto rounded border p-1">
          {sources.map((s) => (
            <label key={s.id} className="flex items-start gap-1 text-xs">
              <input
                type="checkbox"
                checked={value.source_ids.includes(s.id)}
                onChange={(e) =>
                  onChange({
                    source_ids: e.target.checked
                      ? [...value.source_ids, s.id]
                      : value.source_ids.filter((x) => x !== s.id),
                  })
                }
              />
              {s.title}
            </label>
          ))}
        </div>
      </fieldset>
      {value.sample && (
        <label className="col-span-2 flex items-center gap-1 text-amber-800">
          <input type="checkbox" checked onChange={() => onChange({ sample: false })} />
          Placeholder (untick once traced from a source)
        </label>
      )}
    </div>
  );
}
