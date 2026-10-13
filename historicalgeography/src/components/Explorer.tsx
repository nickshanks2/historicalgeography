"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_ERA_ID, ERAS } from "@/config/eras";
import EraLabel from "./EraLabel";
import TimeSlider from "./TimeSlider";

// MapLibre needs the browser (WebGL), so load it client-side only.
const Map = dynamic(() => import("./Map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-stone-200" />,
});

export default function Explorer() {
  const [eraId, setEraId] = useState(DEFAULT_ERA_ID);
  const era = ERAS.find((e) => e.id === eraId) ?? ERAS[ERAS.length - 1];

  return (
    <div className="flex h-dvh w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <Map eraId={era.id} />
        <EraLabel era={era} />
      </div>
      <div className="border-t border-stone-300 bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
        <TimeSlider eraId={era.id} onChange={setEraId} />
      </div>
    </div>
  );
}
