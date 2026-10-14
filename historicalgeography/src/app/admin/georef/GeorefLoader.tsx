"use client";

import dynamic from "next/dynamic";

const GeorefTool = dynamic(() => import("./GeorefTool"), { ssr: false });

export default function GeorefLoader() {
  return <GeorefTool />;
}
