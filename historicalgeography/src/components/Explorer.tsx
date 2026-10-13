"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_ERA_ID, ERAS, eraYear, findEra } from "@/config/eras";
import type { FeatureInfo } from "@/map/featureInfo";
import { STYLE_TYPES } from "@/map/styles";
import type { SpotHistory } from "@/map/throughTime";
import { existsIn } from "@/map/timeFilter";
import { useDatasetSummary } from "@/map/useDatasets";
import EraCard from "./EraCard";
import InspectPanel from "./InspectPanel";
import Legend from "./Legend";
import type { FlyTarget, Tap } from "./Map";
import SearchBox, { type SearchResult } from "./SearchBox";
import TimeSlider from "./TimeSlider";

// MapLibre needs the browser (WebGL), so load it client-side only.
const Map = dynamic(() => import("./Map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-stone-200" />,
});

type Sheet =
  | { kind: "legend" }
  | { kind: "search" }
  | { kind: "spot"; feature: FeatureInfo | null; history: SpotHistory }
  | null;

const ERA_PARAM = "era";

/** The era in the URL (?era=1850), so a place-in-time can be shared. */
function eraFromUrl() {
  const id = new URLSearchParams(window.location.search).get(ERA_PARAM);
  return id && ERAS.some((e) => e.id === id) ? id : null;
}

function writeEraToUrl(id: string) {
  const url = new URL(window.location.href);
  if (id === DEFAULT_ERA_ID) url.searchParams.delete(ERA_PARAM);
  else url.searchParams.set(ERA_PARAM, id);
  window.history.replaceState(window.history.state, "", url);
}

/** The era closest to `currentId` in which a feature with these years exists. */
function eraShowing(years: SearchResult["years"], currentId: string) {
  if (!years) return currentId;
  const current = ERAS.findIndex((e) => e.id === currentId);
  const valid = ERAS.map((era, i) => ({ era, i })).filter(({ era }) =>
    existsIn(years, eraYear(era)),
  );
  if (!valid.length || valid.some(({ i }) => i === current)) return currentId;
  return valid.sort((a, b) => Math.abs(a.i - current) - Math.abs(b.i - current))[0].era.id;
}

const noSubscription = () => () => {};

export default function Explorer() {
  // The era from a shared link; null while rendering on the server, so the
  // static page renders Today and switches after hydration.
  const urlEraId = useSyncExternalStore(noSubscription, eraFromUrl, () => null);
  const [chosenEraId, setEraId] = useState<string | null>(null);
  const eraId = chosenEraId ?? urlEraId ?? DEFAULT_ERA_ID;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const era = findEra(eraId);
  const features = useDatasetSummary();

  useEffect(() => {
    if (chosenEraId) writeEraToUrl(chosenEraId);
  }, [chosenEraId]);

  const showsSamples = useMemo(() => {
    if (era.style === "modern") return false;
    const year = eraYear(era);
    const drawn = STYLE_TYPES[era.style];
    return features.some((f) => f.sample && drawn.includes(f.type) && existsIn(f, year));
  }, [era, features]);

  const changeEra = useCallback((id: string) => {
    setEraId(id);
    // Keep "this spot through time" open; drop a feature that isn't in the new era.
    setSheet((s) => {
      if (s?.kind !== "spot") return s;
      const feature = s.feature && existsIn(s.feature, eraYear(findEra(id))) ? s.feature : null;
      return { ...s, feature };
    });
  }, []);

  // Step through eras from the keyboard: [ and ] (or , and .).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const step = { "[": -1, ",": -1, "]": 1, ".": 1 }[e.key];
      if (!step) return;
      const i = ERAS.findIndex((era) => era.id === eraId) + step;
      if (i >= 0 && i < ERAS.length) changeEra(ERAS[i].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [eraId, changeEra]);

  const onTap = useCallback(({ feature, history }: Tap) => {
    const anything = feature || history.eras.some((e) => e.features.length);
    setSheet(anything ? { kind: "spot", feature, history } : null);
  }, []);

  const onSearch = useCallback(
    (result: SearchResult) => {
      setSheet(null);
      changeEra(eraShowing(result.years, eraId));
      setFlyTo({ center: result.at, zoom: result.years ? 14.5 : 16, id: Date.now() });
    },
    [changeEra, eraId],
  );

  return (
    <div className="flex h-dvh w-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Map era={era} onTap={onTap} flyTo={flyTo} />
        <EraCard era={era} showsSamples={showsSamples} />
        {sheet === null && (
          <div className="absolute bottom-3 left-3 z-10 flex gap-2">
            <button
              type="button"
              onClick={() => setSheet({ kind: "legend" })}
              className="h-11 rounded-full bg-white/95 px-4 text-sm font-medium shadow-md"
            >
              Legend
            </button>
            <button
              type="button"
              onClick={() => setSheet({ kind: "search" })}
              aria-label="Search places"
              className="flex h-11 items-center gap-1.5 rounded-full bg-white/95 px-4 text-sm font-medium shadow-md"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="M15.5 15.5 21 21" />
              </svg>
              Search
            </button>
          </div>
        )}
        {sheet?.kind === "search" && (
          <SearchBox onSelect={onSearch} onClose={() => setSheet(null)} />
        )}
        {sheet?.kind === "legend" && (
          <Legend era={era} features={features} onClose={() => setSheet(null)} />
        )}
        {sheet?.kind === "spot" && (
          <InspectPanel
            feature={sheet.feature}
            history={sheet.history}
            era={era}
            onEra={changeEra}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
      <div className="border-t border-stone-300 bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
        <TimeSlider eraId={era.id} onChange={changeEra} />
      </div>
    </div>
  );
}
