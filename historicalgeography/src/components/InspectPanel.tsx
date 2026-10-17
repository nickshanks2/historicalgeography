import { CONFIDENCE_LABELS, type Era } from "@/config/eras";
import { STOREY_HEIGHT_M } from "@/config/map";
import { BUILDING_MATERIALS, TYPE_LABELS } from "@/map/featureTypes";
import type { FeatureInfo } from "@/map/featureInfo";
import { type SpotHistory, spotLabel } from "@/map/throughTime";
import sources from "../../data/sources.json";

type Source = { id: string; title: string; url: string | null };
const SOURCES = new Map((sources as Source[]).map((s) => [s.id, s]));

function year(value: number | null | undefined, approx?: boolean) {
  return value == null ? null : `${approx ? "~" : ""}${value}`;
}

function dateRange(f: FeatureInfo) {
  if (f.type === "landmark") return "Where it is today, shown for orientation";
  const start = year(f.start_year, f.start_approx);
  // An approximate end the year after the last record means "still there
  // when last recorded; when it went isn't known yet".
  const lastSeen =
    f.end_approx && f.observed_year != null && f.end_year === f.observed_year + 1;
  const end = lastSeen ? `after ${f.observed_year}` : year(f.end_year, f.end_approx);
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}, still exists`;
  if (end) return `Until ${end}`;
  return "Present in every era shown";
}

function storeys(n: number) {
  const whole = Math.floor(n);
  return `${whole || ""}${n % 1 ? "½" : ""}`;
}

function FeatureDetails({ feature }: { feature: FeatureInfo }) {
  const typeLabel = TYPE_LABELS[feature.type] ?? feature.type;
  const title = feature.name_tongva ?? feature.name ?? feature.name_spanish ?? typeLabel;
  const otherNames = [
    feature.name_tongva && feature.name && feature.name !== title ? feature.name : null,
    feature.name_spanish && feature.name_spanish !== title ? feature.name_spanish : null,
  ].filter(Boolean);

  return (
    <>
      <h2 className="text-lg leading-tight font-semibold">{title}</h2>
      {otherNames.length > 0 && <p className="text-sm text-stone-600">{otherNames.join(" · ")}</p>}
      {title !== typeLabel && <p className="text-sm text-stone-500">{typeLabel}</p>}
      {feature.subtype && feature.subtype !== title && !feature.material && (
        <p className="text-sm text-stone-500">{feature.subtype}</p>
      )}

      {feature.sample && (
        <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-sm text-amber-900">
          Placeholder: the shape and dates are not yet from a historical source.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Dates</dt>
        <dd>{dateRange(feature)}</dd>
        {feature.observed_year != null && (
          <>
            <dt className="text-stone-500">Recorded</dt>
            <dd>{feature.observed_year}</dd>
          </>
        )}
        {feature.type === "building" && (
          <>
            {feature.material && (
              <>
                <dt className="text-stone-500">Built of</dt>
                <dd>
                  {BUILDING_MATERIALS.find((m) => m.material === feature.material)?.label ??
                    feature.material}
                </dd>
              </>
            )}
            <dt className="text-stone-500">Storeys</dt>
            <dd>
              {feature.stories != null
                ? `${storeys(feature.stories)}, as lettered on the map`
                : "1 assumed (no other number read from the map)"}
            </dd>
          </>
        )}
        <dt className="text-stone-500">Confidence</dt>
        <dd>{CONFIDENCE_LABELS[feature.confidence] ?? feature.confidence}</dd>
      </dl>
      {feature.source_note && <p className="mt-2 text-sm text-stone-600">{feature.source_note}</p>}
      {feature.type === "building" && (
        <p className="mt-1 text-xs text-stone-500">
          Drawn in 3D at about {STOREY_HEIGHT_M} m per storey; the height is an estimate.
        </p>
      )}

      <h3 className="mt-3 text-sm text-stone-500">Sources</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {feature.source_ids.map((id) => {
          const source = SOURCES.get(id);
          if (!source) return <li key={id}>Unknown source: {id}</li>;
          return (
            <li key={id}>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noopener" className="text-blue-800 underline">
                  {source.title}
                </a>
              ) : (
                source.title
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ThroughTime({
  history,
  currentEra,
  onEra,
}: {
  history: SpotHistory;
  currentEra: Era;
  onEra: (eraId: string) => void;
}) {
  const { lng, lat } = history.lngLat;
  return (
    <>
      <h2 className="text-base leading-tight font-semibold">This spot through time</h2>
      <p className="text-xs text-stone-500">
        {lat.toFixed(5)}, {lng.toFixed(5)} · tap an era to see it
      </p>
      <ol className="mt-2 space-y-0.5 text-sm">
        {history.eras.map(({ era, features }) => {
          const current = era.id === currentEra.id;
          return (
            <li key={era.id}>
              <button
                type="button"
                onClick={() => onEra(era.id)}
                aria-current={current ? "true" : undefined}
                className={`flex w-full gap-3 rounded-md px-2 py-1.5 text-left ${
                  current ? "bg-stone-100" : "hover:bg-stone-50"
                }`}
              >
                <span className={`w-12 shrink-0 ${current ? "font-bold" : "text-stone-500"}`}>
                  {era.label}
                </span>
                <span className={features.length ? "" : "text-stone-400"}>
                  {features.length
                    ? features.map((f) => spotLabel(f) + (f.info.sample ? "*" : "")).join(" · ")
                    : era.style === "modern"
                      ? "See the modern map"
                      : "Nothing recorded here yet"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {history.eras.some((e) => e.features.some((f) => f.info.sample)) && (
        <p className="mt-1 text-xs text-stone-500">* placeholder, not yet from a source</p>
      )}
    </>
  );
}

type InspectPanelProps = {
  feature: FeatureInfo | null;
  history: SpotHistory | null;
  era: Era;
  onEra: (eraId: string) => void;
  onClose: () => void;
};

export default function InspectPanel({ feature, history, era, onEra, onClose }: InspectPanelProps) {
  return (
    <section
      aria-label="Feature details"
      className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 pb-4 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close details"
        className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-stone-500"
      >
        ×
      </button>
      <div className="pr-10">
        {feature && <FeatureDetails feature={feature} />}
        {history && (
          <div className={feature ? "mt-4 border-t border-stone-200 pt-3" : ""}>
            <ThroughTime history={history} currentEra={era} onEra={onEra} />
          </div>
        )}
      </div>
    </section>
  );
}
