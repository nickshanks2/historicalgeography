"use client";

import { useMemo, type ReactNode } from "react";
import { type Era, eraYear } from "@/config/eras";
import type { FeatureInfo } from "@/map/featureInfo";
import {
  BUILT,
  BUILT_LAND,
  LAND_COVER_TYPES,
  PAINTED_INK,
  TYPE_LABELS,
  type LandCoverType,
} from "@/map/featureTypes";
import { iconDataUrl, swatchDataUrl } from "@/map/patterns";
import { STYLE_TYPES } from "@/map/styles";
import { existsIn } from "@/map/timeFilter";

type LineLook = { color: string; width: number; dash?: string };

const LINES: Record<"painted" | "built", Record<string, LineLook>> = {
  painted: {
    coastline: { color: PAINTED_INK.coast, width: 2 },
    river: { color: PAINTED_INK.water, width: 4 },
    creek: { color: PAINTED_INK.water, width: 2 },
    trail: { color: PAINTED_INK.trail, width: 2, dash: "1 4" },
    rancho: { color: PAINTED_INK.rancho, width: 2, dash: "8 4 2 4" },
  },
  built: {
    coastline: { color: "#8fb0bb", width: 2 },
    river: { color: "#86aebb", width: 3 },
    creek: { color: "#86aebb", width: 2 },
    street: { color: BUILT.streetCasing, width: 5 },
    rail: { color: BUILT.rail, width: 3, dash: "6 3" },
    streetcar: { color: BUILT.streetcar, width: 2.5 },
  },
};

const BUILT_FILLS: Record<string, string> = {
  park: BUILT.park,
  pier: BUILT.pier,
  building: BUILT.building,
};

const ICONS: Record<string, string> = {
  village: "icon-village",
  adobe: "icon-adobe",
  landmark: "icon-landmark",
};

function Swatch({ style, type }: { style: "painted" | "built"; type: string }): ReactNode {
  const box = "h-5 w-7 shrink-0 rounded-sm border border-black/10";
  const isLand = type === "ocean" || LAND_COVER_TYPES.includes(type as LandCoverType);
  if (isLand && style === "painted") {
    return (
      <span
        className={box}
        style={{
          backgroundImage: `url(${swatchDataUrl(type as LandCoverType)})`,
          backgroundSize: "24px",
        }}
      />
    );
  }
  if (isLand || BUILT_FILLS[type]) {
    const color = isLand ? BUILT_LAND[type as LandCoverType] : BUILT_FILLS[type];
    return <span className={box} style={{ backgroundColor: color }} />;
  }
  const line = LINES[style][type];
  if (line) {
    return (
      <svg width="28" height="20" className="shrink-0" aria-hidden>
        <line
          x1="2"
          y1="10"
          x2="26"
          y2="10"
          stroke={line.color}
          strokeWidth={line.width}
          strokeDasharray={line.dash}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (ICONS[type]) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={iconDataUrl(ICONS[type])} alt="" className="h-5 w-7 object-contain" />;
  }
  return <span className="h-5 w-7 shrink-0" />;
}

type LegendProps = { era: Era; features: FeatureInfo[]; onClose: () => void };

export default function Legend({ era, features, onClose }: LegendProps) {
  const items = useMemo(() => {
    if (era.style === "modern") return [];
    const year = eraYear(era);
    const present = new Set(features.filter((f) => existsIn(f, year)).map((f) => f.type));
    return STYLE_TYPES[era.style].filter((type) => present.has(type));
  }, [era, features]);

  return (
    <section
      aria-label={`Legend for ${era.label}`}
      className="absolute inset-x-0 bottom-0 z-10 max-h-[55%] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 pb-4 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Legend · {era.label}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close legend"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-stone-500"
        >
          ×
        </button>
      </div>
      {era.style === "modern" ? (
        <p className="mt-1 text-sm text-stone-600">
          Today&apos;s map from OpenStreetMap (via OpenFreeMap). Switch to an earlier era to see
          the reconstructed landscape.
        </p>
      ) : (
        <>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {items.map((type) => (
              <li key={type} className="flex items-center gap-2">
                <Swatch style={era.style as "painted" | "built"} type={type} />
                <span>{TYPE_LABELS[type] ?? type}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">Tap anything on the map for its dates and sources.</p>
        </>
      )}
    </section>
  );
}
