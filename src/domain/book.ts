export type SeriesType = "text" | "books" | "special";
export type SeriesFilter = SeriesType | "all";
export type ReadingStatus = "unread" | "reading" | "completed";
export type StatusFilter = ReadingStatus | "all";

export interface CatalogBook {
  id: string;
  title: string;
  series: SeriesType;
  author?: string;
  publicationDate?: string;
  broadcastDate?: string;
  isbn?: string;
  thumbnailUrl?: string;
  officialUrl?: string;
  sourceUrl?: string;
}

export interface ReadingRecord {
  bookId: string;
  status: ReadingStatus;
  updatedAt: string;
}

export const SERIES_LABELS: Record<SeriesType, string> = {
  text: "テキスト",
  books: "ブックス",
  special: "別冊",
};

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  unread: "未読",
  reading: "読書中",
  completed: "読了",
};

export function getReadingStatus(
  bookId: string,
  records: ReadingRecord[],
): ReadingStatus {
  return records.find((record) => record.bookId === bookId)?.status ?? "unread";
}

export function filterBooks(
  books: CatalogBook[],
  records: ReadingRecord[],
  options: {
    series: SeriesFilter;
    status: StatusFilter;
    query: string;
  },
): CatalogBook[] {
  const normalizedQuery = options.query.trim().toLocaleLowerCase("ja");

  return books
    .filter((book) => {
      const status = getReadingStatus(book.id, records);
      return (
        (options.series === "all" || book.series === options.series) &&
        (options.status === "all" || status === options.status) &&
        (!normalizedQuery ||
          book.title.toLocaleLowerCase("ja").includes(normalizedQuery))
      );
    })
    .sort((a, b) => {
      const dateA = a.publicationDate ?? a.broadcastDate;
      const dateB = b.publicationDate ?? b.broadcastDate;
      if (!dateA) return dateB ? 1 : 0;
      if (!dateB) return -1;
      return dateB.localeCompare(dateA);
    });
}
