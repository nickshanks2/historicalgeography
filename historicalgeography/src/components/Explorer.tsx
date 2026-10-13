"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_ERA_ID, eraYear, findEra } from "@/config/eras";
import type { FeatureInfo } from "@/map/featureInfo";
import { STYLE_TYPES } from "@/map/styles";
import { existsIn } from "@/map/timeFilter";
import { useDatasetFeatures } from "@/map/useDatasets";
import EraCard from "./EraCard";
import InspectPanel from "./InspectPanel";
import Legend from "./Legend";
import TimeSlider from "./TimeSlider";

// MapLibre needs the browser (WebGL), so load it client-side only.
const Map = dynamic(() => import("./Map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-stone-200" />,
});

type Sheet = { kind: "legend" } | { kind: "inspect"; feature: FeatureInfo } | null;

export default function Explorer() {
  const [eraId, setEraId] = useState(DEFAULT_ERA_ID);
  const [sheet, setSheet] = useState<Sheet>(null);
  const era = findEra(eraId);
  const features = useDatasetFeatures();

  const showsSamples = useMemo(() => {
    if (era.style === "modern") return false;
    const year = eraYear(era);
    const drawn = STYLE_TYPES[era.style];
    return features.some((f) => f.sample && drawn.includes(f.type) && existsIn(f, year));
  }, [era, features]);

  const changeEra = useCallback((id: string) => {
    setEraId(id);
    setSheet((s) => (s?.kind === "inspect" ? null : s));
  }, []);

  const inspect = useCallback(
    (feature: FeatureInfo | null) =>
      setSheet(feature ? { kind: "inspect", feature } : null),
    [],
  );

  return (
    <div className="flex h-dvh w-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Map era={era} onInspect={inspect} />
        <EraCard era={era} showsSamples={showsSamples} />
        {sheet === null && (
          <button
            type="button"
            onClick={() => setSheet({ kind: "legend" })}
            className="absolute bottom-3 left-3 z-10 h-11 rounded-full bg-white/95 px-4 text-sm font-medium shadow-md"
          >
            Legend
          </button>
        )}
        {sheet?.kind === "legend" && (
          <Legend era={era} features={features} onClose={() => setSheet(null)} />
        )}
        {sheet?.kind === "inspect" && (
          <InspectPanel feature={sheet.feature} onClose={() => setSheet(null)} />
        )}
      </div>
      <div className="border-t border-stone-300 bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
        <TimeSlider eraId={era.id} onChange={changeEra} />
      </div>
    </div>
  );
}
