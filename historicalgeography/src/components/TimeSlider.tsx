"use client";

import { ERAS } from "@/config/eras";

type TimeSliderProps = {
  eraId: string;
  onChange: (eraId: string) => void;
};

export default function TimeSlider({ eraId, onChange }: TimeSliderProps) {
  const index = Math.max(
    0,
    ERAS.findIndex((era) => era.id === eraId),
  );
  const last = ERAS.length - 1;

  return (
    <div className="mx-auto w-full max-w-xl px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={index}
        onChange={(e) => onChange(ERAS[Number(e.target.value)].id)}
        aria-label="Era"
        aria-valuetext={ERAS[index].label}
        className="era-slider w-full"
        style={{ color: ERAS[index].color }}
      />
      <div className="relative mt-1 h-11">
        {ERAS.map((era, i) => (
          <button
            key={era.id}
            type="button"
            onClick={() => onChange(era.id)}
            aria-pressed={i === index}
            className={`absolute top-0 flex h-11 min-w-11 -translate-x-1/2 items-center justify-center px-1 text-sm ${
              i === index ? "font-bold text-stone-900" : "text-stone-500"
            }`}
            // Thumb centre sits at an inset of half its width at each end.
            style={{
              left: `calc(${(i / last) * 100}% + ${14 - (i / last) * 28}px)`,
            }}
          >
            {era.label}
          </button>
        ))}
      </div>
    </div>
  );
}
