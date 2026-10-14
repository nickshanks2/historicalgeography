"use client";

import { useEffect, useState } from "react";
import { OVERLAYS_URL } from "@/config/map";
import { type Era, eraYear } from "@/config/eras";

export type OverlaySheet = {
  id: string;
  year: number;
  url: string;
  bounds: [number, number, number, number];
  maxzoom: number;
  source_id: string;
};

export type OverlaySet = {
  id: string;
  title: string;
  publisher: string;
  start_year: number;
  end_year: number;
  sheets: OverlaySheet[];
};

/** The overlay shown on the map: a map set at some opacity. */
export type Overlay = { set: OverlaySet; opacity: number };

export function useOverlaySets(): OverlaySet[] {
  const [sets, setSets] = useState<OverlaySet[]>([]);
  useEffect(() => {
    fetch(OVERLAYS_URL)
      .then((r) => r.json() as Promise<{ sets: OverlaySet[] }>)
      .then((d) => setSets(d.sets))
      .catch((err) => console.error(err));
  }, []);
  return sets;
}

/** How far a map set's dates are from an era's year (0 if it spans it). */
export function yearsFrom(set: OverlaySet, era: Era) {
  const year = eraYear(era);
  if (year < set.start_year) return set.start_year - year;
  if (year > set.end_year) return year - set.end_year;
  return 0;
}

/** Map sets ordered by how close they are to the era. */
export function setsForEra(sets: OverlaySet[], era: Era) {
  return [...sets].sort((a, b) => yearsFrom(a, era) - yearsFrom(b, era));
}
