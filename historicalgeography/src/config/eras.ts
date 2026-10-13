// The single source of truth for eras. Never hard-code era lists elsewhere.
// Listed oldest to newest; the time slider runs left to right in this order.

export type Confidence = "documented" | "inferred" | "modeled";

export type Era = {
  id: string;
  label: string;
  /** Lowest confidence of anything shown in this era. */
  confidence: Confidence | "documented-inferred";
  /** Placeholder outline colour until real era layers exist. */
  color: string;
};

export const ERAS: readonly Era[] = [
  { id: "1000", label: "~1000", confidence: "modeled", color: "#7c3aed" },
  { id: "1600", label: "1600", confidence: "inferred", color: "#c2410c" },
  {
    id: "1800",
    label: "1800",
    confidence: "documented-inferred",
    color: "#b45309",
  },
  { id: "1900", label: "1900", confidence: "documented", color: "#15803d" },
  { id: "today", label: "Today", confidence: "documented", color: "#1d4ed8" },
];

export const DEFAULT_ERA_ID = "today";

export const CONFIDENCE_LABELS: Record<Era["confidence"], string> = {
  documented: "Documented",
  "documented-inferred": "Documented + inferred",
  inferred: "Inferred",
  modeled: "Modeled",
};

// Every era draws the same modern coastline for now.
export const PLACEHOLDER_COASTLINE_URL = "/data/placeholder/coastline.geojson";
