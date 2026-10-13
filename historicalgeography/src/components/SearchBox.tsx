"use client";

import { useEffect, useRef, useState } from "react";
import {
  GEOCODER_ATTRIBUTION,
  GEOCODER_URL,
  INITIAL_VIEW,
  SEARCH_BBOX,
  SEARCH_INDEX_URL,
} from "@/config/map";
import { TYPE_LABELS } from "@/map/featureTypes";

type IndexEntry = {
  names: string[];
  type: string;
  at: [number, number];
  start_year: number | null;
  end_year: number | null;
  sample: boolean;
};

export type SearchResult = {
  label: string;
  detail: string;
  at: [number, number];
  /** Present for our own historical features: when they existed. */
  years?: { start_year: number | null; end_year: number | null };
};

function years(e: IndexEntry) {
  if (e.type === "landmark") return "today";
  if (e.start_year != null && e.end_year != null) return `${e.start_year}–${e.end_year}`;
  if (e.start_year != null) return `from ${e.start_year}`;
  if (e.end_year != null) return `until ${e.end_year}`;
  return "";
}

function localMatches(index: IndexEntry[], q: string): SearchResult[] {
  const needle = q.toLowerCase();
  return index
    .map((e) => {
      const hit = e.names.findIndex((n) => n.toLowerCase().includes(needle));
      if (hit === -1) return null;
      const starts = e.names[hit].toLowerCase().startsWith(needle);
      return { e, score: (starts ? 0 : 1) + (e.type === "landmark" ? 0.5 : 0) };
    })
    .filter((m): m is { e: IndexEntry; score: number } => m !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 6)
    .map(({ e }) => ({
      label: e.names[0],
      detail: [
        TYPE_LABELS[e.type] ?? e.type,
        years(e),
        e.names.slice(1).join(" / "),
        e.sample ? "placeholder" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      at: e.at,
      years: e.type === "landmark" ? undefined : { start_year: e.start_year, end_year: e.end_year },
    }));
}

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
};

async function addressMatches(q: string, signal: AbortSignal): Promise<SearchResult[]> {
  const [lng, lat] = INITIAL_VIEW.center as [number, number];
  const url = new URL(GEOCODER_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("bbox", SEARCH_BBOX.join(","));
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const { features } = (await res.json()) as { features: PhotonFeature[] };
  return features.map(({ geometry, properties: p }) => ({
    label: p.name ?? [p.housenumber, p.street].filter(Boolean).join(" "),
    detail: [p.housenumber && p.name ? `${p.housenumber} ${p.street}` : p.street, p.city]
      .filter(Boolean)
      .join(", "),
    at: geometry.coordinates,
  }));
}

type SearchBoxProps = { onSelect: (result: SearchResult) => void; onClose: () => void };

export default function SearchBox({ onSelect, onClose }: SearchBoxProps) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [addresses, setAddresses] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetch(SEARCH_INDEX_URL)
      .then((r) => r.json())
      .then(setIndex)
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (q.trim().length < 3) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      addressMatches(q.trim(), ctrl.signal)
        .then(setAddresses)
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const query = q.trim();
  const local = query.length >= 2 ? localMatches(index, query) : [];
  const results = [...local, ...(query.length >= 3 ? addresses : [])];

  return (
    <div className="absolute inset-x-3 top-3 z-20 max-w-md rounded-xl bg-white shadow-lg">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) onSelect(results[0]);
        }}
        className="flex items-center gap-1 p-1"
      >
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder="Search a place, address or old name"
          aria-label="Search a place, address or old name"
          className="h-11 min-w-0 flex-1 rounded-lg px-3 text-base outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="flex h-11 w-11 items-center justify-center rounded-full text-2xl text-stone-500"
        >
          ×
        </button>
      </form>
      {results.length > 0 && (
        <ul className="max-h-[50vh] overflow-y-auto border-t border-stone-200 py-1">
          {results.map((r, i) => (
            <li key={`${r.label}-${i}`}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                className="block w-full px-4 py-2 text-left hover:bg-stone-100"
              >
                <span className="block text-sm font-medium">{r.label}</span>
                {r.detail && <span className="block text-xs text-stone-500">{r.detail}</span>}
              </button>
            </li>
          ))}
          {query.length >= 3 && (
            <li className="px-4 pt-1 pb-2 text-[11px] text-stone-400">{GEOCODER_ATTRIBUTION}</li>
          )}
        </ul>
      )}
    </div>
  );
}
