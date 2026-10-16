import type {
  CatalogBook,
  ReadingRecord,
  SeriesFilter,
} from "./book";
import { getReadingStatus } from "./book";

export function getRouletteCandidates(
  books: CatalogBook[],
  records: ReadingRecord[],
  selectedSeries: SeriesFilter,
): CatalogBook[] {
  return books.filter(
    (book) =>
      getReadingStatus(book.id, records) === "unread" &&
      (selectedSeries === "all" || book.series === selectedSeries),
  );
}

export function drawBook(
  books: CatalogBook[],
  records: ReadingRecord[],
  selectedSeries: SeriesFilter,
  random: () => number = Math.random,
): CatalogBook | null {
  const candidates = getRouletteCandidates(books, records, selectedSeries);
  if (candidates.length === 0) return null;

  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("乱数は0以上1未満である必要があります。");
  }

  return candidates[Math.floor(value * candidates.length)] ?? null;
}
