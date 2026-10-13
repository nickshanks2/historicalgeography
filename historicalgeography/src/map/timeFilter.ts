import type { ExpressionSpecification } from "maplibre-gl";

type Props = { start_year?: number | null; end_year?: number | null };

/** Whether a feature exists in `year` (see CLAUDE.md, Data model). */
export function existsIn(props: Props, year: number): boolean {
  return (
    (props.start_year ?? -Infinity) <= year && year < (props.end_year ?? Infinity)
  );
}

/** The same test as a MapLibre filter expression. */
export function existsInFilter(year: number): ExpressionSpecification {
  return [
    "all",
    ["<=", ["coalesce", ["get", "start_year"], -1e6], year],
    [">", ["coalesce", ["get", "end_year"], 1e6], year],
  ];
}
