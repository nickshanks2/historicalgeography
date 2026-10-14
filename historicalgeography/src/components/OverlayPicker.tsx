"use client";

import type { Era } from "@/config/eras";
import { type Overlay, type OverlaySet, setsForEra, yearsFrom } from "@/map/overlays";
import sources from "../../data/sources.json";

type Source = { id: string; title: string; url: string | null };
const SOURCES = new Map((sources as Source[]).map((s) => [s.id, s]));

type OverlayPickerProps = {
  era: Era;
  sets: OverlaySet[];
  overlay: Overlay | null;
  onChange: (overlay: Overlay | null) => void;
  onClose: () => void;
  defaultOpacity: number;
};

export default function OverlayPicker({
  era,
  sets,
  overlay,
  onChange,
  onClose,
  defaultOpacity,
}: OverlayPickerProps) {
  const ordered = setsForEra(sets, era);
  const opacity = overlay?.opacity ?? defaultOpacity;

  return (
    <section
      aria-label="Old maps"
      className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 pb-4 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Old maps</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close old maps"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-stone-500"
        >
          ×
        </button>
      </div>
      <p className="text-sm text-stone-600">
        Lay a historical survey map over the {era.label} view to compare it with what we draw.
      </p>

      <fieldset className="mt-2 space-y-1">
        <legend className="sr-only">Historical map</legend>
        <label className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-stone-50">
          <input
            type="radio"
            name="overlay"
            checked={!overlay}
            onChange={() => onChange(null)}
            className="h-5 w-5"
          />
          <span>None</span>
        </label>
        {ordered.map((set) => {
          const selected = overlay?.set.id === set.id;
          const closest = yearsFrom(set, era) === yearsFrom(ordered[0], era);
          return (
            <label
              key={set.id}
              className={`flex min-h-11 items-start gap-3 rounded-md px-2 py-2 ${
                selected ? "bg-stone-100" : "hover:bg-stone-50"
              }`}
            >
              <input
                type="radio"
                name="overlay"
                checked={selected}
                onChange={() => onChange({ set, opacity })}
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium">
                  {set.title}
                  {closest && era.style !== "modern" && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-normal text-emerald-900">
                      closest to {era.label}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-stone-500">
                  {set.sheets.length} sheet{set.sheets.length > 1 ? "s" : ""} · {set.publisher}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {overlay && (
        <>
          <label className="mt-3 block text-sm">
            <span className="text-stone-600">Opacity</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => onChange({ ...overlay, opacity: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>
          <h3 className="mt-3 text-sm text-stone-500">Sheets</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {overlay.set.sheets.map((sheet) => {
              const source = SOURCES.get(sheet.source_id);
              return (
                <li key={sheet.id}>
                  {source?.url ? (
                    <a href={source.url} target="_blank" rel="noopener" className="text-blue-800 underline">
                      {source.title}
                    </a>
                  ) : (
                    (source?.title ?? sheet.id)
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
