"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import type { Era } from "@/config/eras";
import { INITIAL_VIEW, MODERN_STYLE_URL, TERRAIN_EXAGGERATION } from "@/config/map";
import { type FeatureInfo, toFeatureInfo } from "@/map/featureInfo";
import { STYLE_IMAGE_PIXEL_RATIO, makeStyleImage } from "@/map/patterns";
import type { Overlay } from "@/map/overlays";
import {
  INSPECTABLE_LAYER_PREFIX,
  OVERLAY_LAYER_PREFIX,
  buildModernStyle,
  buildPastStyle,
  withOverlay,
} from "@/map/styles";
import { type SpotHistory, spotHistory } from "@/map/throughTime";

export type Tap = { feature: FeatureInfo | null; history: SpotHistory };

export type FlyTarget = { center: [number, number]; zoom: number; id: number };

type MapProps = {
  era: Era;
  overlay: Overlay | null;
  onTap: (tap: Tap) => void;
  flyTo: FlyTarget | null;
};

const TAP_TOLERANCE_PX = 10;
const GEOMETRY_PRIORITY: Record<string, number> = {
  Point: 0,
  MultiPoint: 0,
  LineString: 1,
  MultiLineString: 1,
  Polygon: 2,
  MultiPolygon: 2,
};

/** Lower wins: points, then lines, then areas; landmarks only as a last resort. */
function tapPriority(feature: maplibregl.MapGeoJSONFeature) {
  const landmark = feature.properties.type === "landmark" ? 10 : 0;
  return landmark + (GEOMETRY_PRIORITY[feature.geometry.type] ?? 3);
}

/**
 * The camera from a shared link (#view=zoom/lat/lng/bearing/pitch), read once
 * on first load: removing a map clears the hash, which would lose it if the
 * map is ever created twice.
 */
let sharedView: Partial<maplibregl.CameraOptions> | null | undefined;
function viewFromUrl() {
  if (sharedView !== undefined) return sharedView;
  const m = window.location.hash.match(/view=([-\d.]+)\/([-\d.]+)\/([-\d.]+)(?:\/([-\d.]+))?(?:\/([-\d.]+))?/);
  sharedView = m
    ? {
        zoom: Number(m[1]),
        center: [Number(m[3]), Number(m[2])],
        bearing: Number(m[4] ?? 0),
        pitch: Number(m[5] ?? 0),
      }
    : null;
  return sharedView;
}

let modernBase: Promise<maplibregl.StyleSpecification> | null = null;
function loadModernBase() {
  modernBase ??= fetch(MODERN_STYLE_URL).then((res) => {
    if (!res.ok) throw new Error(`Basemap style: HTTP ${res.status}`);
    return res.json();
  });
  return modernBase;
}

export default function Map({ era, overlay, onTap, flyTo }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const terrainOnRef = useRef(true);
  const onTapRef = useRef(onTap);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onTapRef.current = onTap;
  }, [onTap]);

  useEffect(() => {
    if (!containerRef.current) return;

    maplibregl.setWorkerUrl(
      new URL("/maplibre-gl-worker.mjs", window.location.origin).href,
    );
    // Our vector tiles are single PMTiles files read with range requests.
    const pmtiles = new Protocol();
    maplibregl.addProtocol("pmtiles", pmtiles.tile);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      ...INITIAL_VIEW,
      ...viewFromUrl(),
      // Look out toward the horizon, not just down at the ground.
      maxPitch: 85,
      maxZoom: 19,
      // Keep the camera in the URL (#view=zoom/lat/lng/bearing/pitch) so a
      // place can be shared, bookmarked or cited.
      hash: "view",
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { hgMap: maplibregl.Map }).hgMap = map;
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({}), "top-right");
    map.addControl(
      new maplibregl.TerrainControl({ source: "terrain", exaggeration: TERRAIN_EXAGGERATION }),
      "top-right",
    );
    // Remember the user's terrain toggle across era switches. (Not the map's
    // "terrain" event: that also fires while a new style replaces the old.)
    map
      .getContainer()
      .querySelector(".maplibregl-ctrl-terrain, .maplibregl-ctrl-terrain-enabled")
      ?.addEventListener("click", () => {
        terrainOnRef.current = Boolean(map.getTerrain());
      });
    map.addControl(new maplibregl.ScaleControl({}), "bottom-right");

    // Textures and icons are drawn on demand, so they survive style switches.
    map.setMissingStyleImageResolver((id) => {
      const canvas = makeStyleImage(id);
      if (!canvas || map.hasImage(id)) return;
      const ctx = canvas.getContext("2d")!;
      map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), {
        pixelRatio: STYLE_IMAGE_PIXEL_RATIO,
      });
    });

    // On a phone MapLibre opens the credits when they first load; fold them
    // behind the (i) button once each era has loaded, so they don't cover
    // the map and legend button.
    map.on("style.load", () => {
      map.once("idle", () => {
        map
          .getContainer()
          .querySelector(".maplibregl-ctrl-attrib")
          ?.classList.remove("maplibregl-compact-show");
      });
    });

    map.on("click", (e) => {
      const { x, y } = e.point;
      const t = TAP_TOLERANCE_PX;
      const layers = map
        .getStyle()
        .layers.map((layer) => layer.id)
        .filter((id) => id.startsWith(INSPECTABLE_LAYER_PREFIX));
      const hits = map
        .queryRenderedFeatures(
          [
            [x - t, y - t],
            [x + t, y + t],
          ],
          { layers },
        )
        .map((feature, order) => ({ feature, order }))
        .sort((a, b) => tapPriority(a.feature) - tapPriority(b.feature) || a.order - b.order);
      onTapRef.current({
        feature: hits.length ? toFeatureInfo(hits[0].feature.properties) : null,
        history: spotHistory(map, e.lngLat),
      });
    });

    setReady(true);
    return () => {
      mapRef.current = null;
      map.remove();
      maplibregl.removeProtocol("pmtiles");
    };
  }, []);

  // Rebuild the style when the era or the chosen old map changes (opacity
  // changes are applied in place below).
  const overlaySet = overlay?.set ?? null;
  const opacityRef = useRef(overlay?.opacity ?? 0);
  useEffect(() => {
    opacityRef.current = overlay?.opacity ?? 0;
  }, [overlay?.opacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;

    (async () => {
      const terrainOn = terrainOnRef.current;
      const base =
        era.style === "modern"
          ? buildModernStyle(await loadModernBase(), terrainOn)
          : buildPastStyle(era, terrainOn);
      const style = withOverlay(
        base,
        overlaySet && { set: overlaySet, opacity: opacityRef.current },
        era.style === "modern",
      );
      if (!cancelled) map.setStyle(style);
    })().catch((err) => console.error(err));

    return () => {
      cancelled = true;
    };
  }, [era, overlaySet, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !overlay || !map.isStyleLoaded()) return;
    for (const layer of map.getStyle().layers) {
      if (layer.id.startsWith(OVERLAY_LAYER_PREFIX)) {
        map.setPaintProperty(layer.id, "raster-opacity", overlay.opacity);
      }
    }
  }, [overlay, ready]);

  useEffect(() => {
    if (!ready || !flyTo) return;
    mapRef.current?.flyTo({
      center: flyTo.center,
      zoom: flyTo.zoom,
      pitch: Math.min(mapRef.current.getPitch(), 60),
      duration: 2500,
      essential: true,
    });
  }, [flyTo, ready]);

  return <div ref={containerRef} className="h-full w-full" />;
}
