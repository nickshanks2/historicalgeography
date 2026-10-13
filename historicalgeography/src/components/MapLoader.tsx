"use client";

import dynamic from "next/dynamic";

// MapLibre needs the browser (WebGL), so load it client-side only.
const Map = dynamic(() => import("./Map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-stone-200" />,
});

export default function MapLoader() {
  return <Map />;
}
