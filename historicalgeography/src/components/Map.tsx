"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  BASEMAP_STYLE_URL,
  INITIAL_VIEW,
  TERRAIN_ATTRIBUTION,
  TERRAIN_EXAGGERATION,
  TERRAIN_TILES_URL,
} from "@/config/map";
import {
  DEFAULT_ERA_ID,
  ERAS,
  PLACEHOLDER_COASTLINE_URL,
} from "@/config/eras";

const coastlineLayerId = (eraId: string) => `era-coastline-${eraId}`;

type MapProps = {
  eraId: string;
};

export default function Map({ eraId }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);

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
      attributionControl: { compact: true },
    });
    mapRef.current = map;

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

      map.addSource("era-coastline", {
        type: "geojson",
        data: PLACEHOLDER_COASTLINE_URL,
        attribution: "Made with Natural Earth",
      });
      // One layer per era, shown one at a time. (Toggling visibility rather
      // than changing paint, which terrain's draped-layer cache ignores.)
      for (const era of ERAS) {
        map.addLayer({
          id: coastlineLayerId(era.id),
          type: "line",
          source: "era-coastline",
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: era.id === DEFAULT_ERA_ID ? "visible" : "none",
          },
          paint: {
            "line-color": era.color,
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 6],
          },
        });
      }

      setLoaded(true);
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const map = mapRef.current;
    if (!map) return;
    for (const era of ERAS) {
      map.setLayoutProperty(
        coastlineLayerId(era.id),
        "visibility",
        era.id === eraId ? "visible" : "none",
      );
    }
  }, [eraId, loaded]);

  return <div ref={containerRef} className="h-full w-full" />;
}
