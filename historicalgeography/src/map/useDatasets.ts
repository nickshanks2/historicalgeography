"use client";

import { useEffect, useState } from "react";
import { DATASET_SUMMARY_URL } from "@/config/map";

/** One row per distinct (type, years, sample) across all datasets. */
export type FeatureSummary = {
  type: string;
  start_year: number | null;
  end_year: number | null;
  sample: boolean;
};

/** What our datasets contain, for the legend and the sample notice. */
export function useDatasetSummary(): FeatureSummary[] {
  const [features, setFeatures] = useState<FeatureSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(DATASET_SUMMARY_URL)
      .then((res) => res.json() as Promise<FeatureSummary[]>)
      .then((rows) => {
        if (!cancelled) setFeatures(rows);
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, []);

  return features;
}
