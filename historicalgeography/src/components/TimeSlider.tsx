"use client";

import { ERAS } from "@/config/eras";

type TimeSliderProps = {
  eraId: string;
  onChange: (eraId: string) => void;
};

const THUMB_PX = 28;

export default function TimeSlider({ eraId, onChange }: TimeSliderProps) {
  const index = Math.max(
    0,
    ERAS.findIndex((era) => era.id === eraId),
  );
  const last = ERAS.length - 1;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={index}
        onChange={(e) => onChange(ERAS[Number(e.target.value)].id)}
        aria-label="Era"
        aria-valuetext={ERAS[index].label}
        className="era-slider w-full text-stone-800"
      />
      <div className="relative h-11">
        {ERAS.map((era, i) => (
          <button
            key={era.id}
            type="button"
            onClick={() => onChange(era.id)}
            aria-pressed={i === index}
            className={`absolute top-0 flex h-11 w-11 -translate-x-1/2 items-center justify-center text-[13px] tracking-tight ${
              i === index ? "font-bold text-stone-900" : "text-stone-500"
            }`}
            // Centre each label under the thumb position for its stop.
            style={{
              left: `calc(${(i / last) * 100}% + ${THUMB_PX / 2 - (i / last) * THUMB_PX}px)`,
            }}
          >
            {era.label}
          </button>
        ))}
      </div>
    </div>
  );
}
