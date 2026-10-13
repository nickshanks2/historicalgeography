import { CONFIDENCE_LABELS } from "@/config/eras";
import { TYPE_LABELS } from "@/map/featureTypes";
import type { FeatureInfo } from "@/map/featureInfo";
import sources from "../../data/sources.json";

type Source = { id: string; title: string; url: string | null };
const SOURCES = new Map((sources as Source[]).map((s) => [s.id, s]));

function year(value: number | null | undefined, approx?: boolean) {
  return value == null ? null : `${approx ? "~" : ""}${value}`;
}

function dateRange(f: FeatureInfo) {
  if (f.type === "landmark") return "Where it is today, shown for orientation";
  const start = year(f.start_year, f.start_approx);
  const end = year(f.end_year, f.end_approx);
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}, still exists`;
  if (end) return `Until ${end}`;
  return "Present in every era shown";
}

type InspectPanelProps = { feature: FeatureInfo; onClose: () => void };

export default function InspectPanel({ feature, onClose }: InspectPanelProps) {
  const typeLabel = TYPE_LABELS[feature.type] ?? feature.type;
  const title = feature.name_tongva ?? feature.name ?? feature.name_spanish ?? typeLabel;
  const otherNames = [
    feature.name_tongva && feature.name && feature.name !== title ? feature.name : null,
    feature.name_spanish && feature.name_spanish !== title ? feature.name_spanish : null,
  ].filter(Boolean);

  return (
    <section
      aria-label="Feature details"
      className="absolute inset-x-0 bottom-0 z-10 max-h-[55%] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 pb-4 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg leading-tight font-semibold">{title}</h2>
          {otherNames.length > 0 && (
            <p className="text-sm text-stone-600">{otherNames.join(" · ")}</p>
          )}
          {title !== typeLabel && <p className="text-sm text-stone-500">{typeLabel}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl text-stone-500"
        >
          ×
        </button>
      </div>

      {feature.sample && (
        <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-sm text-amber-900">
          Sample for style review: the shape and dates are placeholders, not historical data.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Dates</dt>
        <dd>{dateRange(feature)}</dd>
        <dt className="text-stone-500">Confidence</dt>
        <dd>{CONFIDENCE_LABELS[feature.confidence] ?? feature.confidence}</dd>
      </dl>

      <h3 className="mt-3 text-sm text-stone-500">Sources</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {feature.source_ids.map((id) => {
          const source = SOURCES.get(id);
          if (!source) return <li key={id}>Unknown source: {id}</li>;
          return (
            <li key={id}>
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener"
                  className="text-blue-800 underline"
                >
                  {source.title}
                </a>
              ) : (
                source.title
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
