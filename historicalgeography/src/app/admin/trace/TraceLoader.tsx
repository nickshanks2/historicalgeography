"use client";

import dynamic from "next/dynamic";

// MapLibre and Terra Draw need the browser.
const TraceTool = dynamic(() => import("./TraceTool"), { ssr: false });

export default function TraceLoader() {
  return <TraceTool />;
}
