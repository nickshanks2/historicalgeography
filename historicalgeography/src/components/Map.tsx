"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  BASEMAP_STYLE_URL,
  INITIAL_VIEW,
  TERRAIN_ATTRIBUTION,
  TERRAIN_EXAGGERATION,
  TERRAIN_TILES_URL,
} from "@/config/map";

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    maplibregl.setWorkerUrl(
      new URL("/maplibre-gl-worker.mjs", window.location.origin).href,
    );

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      ...INITIAL_VIEW,
      maxPitch: 75,
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    map.addControl(new maplibregl.GeolocateControl({}), "top-right");
    map.addControl(new maplibregl.ScaleControl({}), "bottom-left");

    map.on("load", () => {
      const terrainSource = {
        type: "raster-dem" as const,
        tiles: [TERRAIN_TILES_URL],
        encoding: "terrarium" as const,
        tileSize: 256,
        maxzoom: 15,
        attribution: TERRAIN_ATTRIBUTION,
      };
      map.addSource("terrain", terrainSource);
      map.addSource("hillshade", terrainSource);

      // Draw hillshading beneath labels and roads.
      const firstSymbolLayer = map
        .getStyle()
        .layers.find((layer) => layer.type === "symbol");
      map.addLayer(
        {
          id: "hillshade",
          type: "hillshade",
          source: "hillshade",
          paint: { "hillshade-exaggeration": 0.4 },
        },
        firstSymbolLayer?.id,
      );

      map.setTerrain({ source: "terrain", exaggeration: TERRAIN_EXAGGERATION });
      map.addControl(
        new maplibregl.TerrainControl({
          source: "terrain",
          exaggeration: TERRAIN_EXAGGERATION,
        }),
        "top-right",
      );
    });

    return () => map.remove();
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
