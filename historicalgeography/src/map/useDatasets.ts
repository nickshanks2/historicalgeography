"use client";

import { useEffect, useState } from "react";
import { DATASETS } from "@/config/map";
import type { FeatureInfo } from "./featureInfo";

type Dataset = { features: { properties: FeatureInfo }[] };

/** All feature properties from our datasets (the map fetches the same URLs). */
export function useDatasetFeatures(): FeatureInfo[] {
  const [features, setFeatures] = useState<FeatureInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      Object.values(DATASETS).map((url) =>
        fetch(url).then((res) => res.json() as Promise<Dataset>),
      ),
    )
      .then((datasets) => {
        if (!cancelled) {
          setFeatures(datasets.flatMap((d) => d.features.map((f) => f.properties)));
        }
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, []);

  return features;
}
