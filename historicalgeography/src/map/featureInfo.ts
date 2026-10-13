import type { Confidence } from "@/config/eras";

/** Properties shared by every feature in our datasets (see CLAUDE.md). */
export type FeatureInfo = {
  id: string;
  type: string;
  name?: string | null;
  name_tongva?: string | null;
  name_spanish?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  start_approx?: boolean;
  end_approx?: boolean;
  confidence: Confidence;
  source_ids: string[];
  sample?: boolean;
  /** Finer class from the source, e.g. "Valley Freshwater Marsh". */
  subtype?: string | null;
  /** Year the source map or survey recorded this feature. */
  observed_year?: number | null;
  /** How the source mapped it, e.g. "Mapped from: Tsheet Chase 1867." */
  source_note?: string | null;
};

/**
 * Normalise properties from a rendered feature: MapLibre drops nulls and
 * turns arrays into JSON strings.
 */
export function toFeatureInfo(props: Record<string, unknown>): FeatureInfo {
  const ids = props.source_ids;
  return {
    ...(props as FeatureInfo),
    source_ids: typeof ids === "string" ? JSON.parse(ids) : ((ids as string[]) ?? []),
  };
}
