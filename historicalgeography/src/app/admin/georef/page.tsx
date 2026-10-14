import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GeorefLoader from "./GeorefLoader";

export const metadata: Metadata = {
  title: "Georeference · HistoricalGeography.io",
  robots: { index: false, follow: false },
};

// A local editing tool: it saves into the repository's data files, so it
// only exists in development.
export default function GeorefPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <GeorefLoader />;
}
