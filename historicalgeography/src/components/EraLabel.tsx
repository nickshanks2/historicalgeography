import { CONFIDENCE_LABELS, type Era } from "@/config/eras";

export default function EraLabel({ era }: { era: Era }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute top-3 left-3 max-w-[60%] rounded-lg bg-white/90 px-3 py-2 shadow-md backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: era.color }}
        />
        <span className="text-lg leading-tight font-semibold">{era.label}</span>
      </div>
      <p className="text-sm leading-tight text-stone-700">
        Confidence: {CONFIDENCE_LABELS[era.confidence]}
      </p>
      <p className="mt-1 text-xs leading-tight text-stone-500">
        Placeholder: modern coastline
      </p>
    </div>
  );
}
