import type { SeriesFilter } from "../domain/book";
import { SERIES_LABELS } from "../domain/book";

interface SeriesSelectProps {
  id: string;
  value: SeriesFilter;
  onChange: (series: SeriesFilter) => void;
}

export function SeriesSelect({ id, value, onChange }: SeriesSelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as SeriesFilter)}
    >
      <option value="all">すべて</option>
      {Object.entries(SERIES_LABELS).map(([series, label]) => (
        <option key={series} value={series}>
          {label}
        </option>
      ))}
    </select>
  );
}
