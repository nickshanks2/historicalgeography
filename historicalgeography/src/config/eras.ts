// The single source of truth for eras. Never hard-code era lists elsewhere.
// Listed oldest to newest; the time slider runs left to right in this order.
// An era is a filter on the time-ranged datasets (see CLAUDE.md, Data model),
// so adding one here needs no new data.

export type Confidence = "documented" | "inferred" | "modeled";

/**
 * painted: pre-1900 land-cover style; built: redrawn historical city;
 * modern: today's OpenStreetMap basemap (only ever used for "today").
 */
export type EraStyle = "painted" | "built" | "modern";

export type Era = {
  id: string;
  label: string;
  /** Year the era's features are filtered to; null means the current year. */
  year: number | null;
  /** Lowest confidence of anything shown in this era. */
  confidence: Confidence | "documented-inferred";
  style: EraStyle;
};

export const ERAS: readonly Era[] = [
  { id: "1000", label: "~1000", year: 1000, confidence: "modeled", style: "painted" },
  { id: "1600", label: "1600", year: 1600, confidence: "inferred", style: "painted" },
  {
    id: "1800",
    label: "1800",
    year: 1800,
    confidence: "documented-inferred",
    style: "painted",
  },
  {
    id: "1850",
    label: "1850",
    year: 1850,
    confidence: "documented-inferred",
    style: "painted",
  },
  { id: "1900", label: "1900", year: 1900, confidence: "documented", style: "built" },
  { id: "1925", label: "1925", year: 1925, confidence: "documented", style: "built" },
  { id: "1950", label: "1950", year: 1950, confidence: "documented", style: "built" },
  { id: "today", label: "Today", year: null, confidence: "documented", style: "modern" },
];

export const DEFAULT_ERA_ID = "today";

export function eraYear(era: Era): number {
  return era.year ?? new Date().getFullYear();
}

export function findEra(id: string): Era {
  return ERAS.find((era) => era.id === id) ?? ERAS[ERAS.length - 1];
}

export const CONFIDENCE_LABELS: Record<Era["confidence"], string> = {
  documented: "Documented",
  "documented-inferred": "Documented + inferred",
  inferred: "Inferred",
  modeled: "Modeled",
};
