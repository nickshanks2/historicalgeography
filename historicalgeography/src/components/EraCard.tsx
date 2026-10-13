import { CONFIDENCE_LABELS, type Era } from "@/config/eras";

type EraCardProps = { era: Era; showsSamples: boolean };

export default function EraCard({ era, showsSamples }: EraCardProps) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute top-3 left-3 z-10 max-w-[64%] rounded-lg bg-white/90 px-3 py-1.5 shadow-md backdrop-blur"
    >
      <p className="leading-tight">
        <span className="text-lg font-semibold">{era.label}</span>{" "}
        <span className="text-xs text-stone-600">
          {era.style === "modern" ? "modern map" : "reconstruction"}
        </span>
      </p>
      <p className="text-xs leading-tight text-stone-700">
        Confidence: {CONFIDENCE_LABELS[era.confidence]}
      </p>
      {showsSamples && (
        <p className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] leading-tight text-amber-900">
          Includes placeholder features, labelled when tapped
        </p>
      )}
    </div>
  );
}
