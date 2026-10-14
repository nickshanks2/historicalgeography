import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TraceLoader from "./TraceLoader";

export const metadata: Metadata = {
  title: "Trace · HistoricalGeography.io",
  robots: { index: false, follow: false },
};

// A local editing tool: it saves into the repository's data files, so it
// only exists in development.
export default function TracePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <TraceLoader />;
}
