import type { CatalogBook, SeriesType } from "./book";

export const SERIES_TYPES: SeriesType[] = ["text", "books", "special"];

const optionalStringFields = [
  "author",
  "publicationDate",
  "broadcastDate",
  "isbn",
  "thumbnailUrl",
  "officialUrl",
  "sourceUrl",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIsbn(isbn: string): string {
  return isbn.replace(/[\s-]/g, "").toUpperCase();
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateCatalog(input: unknown): CatalogBook[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("カタログは1冊以上の書籍を含む配列である必要があります。");
  }

  const ids = new Set<string>();
  const isbns = new Set<string>();
  const seriesFound = new Set<SeriesType>();
  const books = input.map((value, index): CatalogBook => {
    if (!isRecord(value)) {
      throw new Error(`カタログの${index + 1}件目が書籍オブジェクトではありません。`);
    }
    const { id, title, series } = value;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error(`カタログの${index + 1}件目に有効なidがありません。`);
    }
    if (typeof title !== "string" || !title.trim()) {
      throw new Error(`カタログの${index + 1}件目に有効なtitleがありません。`);
    }
    if (
      typeof series !== "string" ||
      !SERIES_TYPES.includes(series as SeriesType)
    ) {
      throw new Error(`カタログの${index + 1}件目のseriesが不正です。`);
    }
    if (ids.has(id)) {
      throw new Error(`カタログ内に重複したidがあります: ${id}`);
    }
    ids.add(id);
    seriesFound.add(series as SeriesType);

    const book: CatalogBook = {
      id: id.trim(),
      title: title.trim(),
      series: series as SeriesType,
    };
    for (const field of optionalStringFields) {
      const fieldValue = value[field];
      if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
        continue;
      }
      if (typeof fieldValue !== "string") {
        throw new Error(`カタログの${index + 1}件目の${field}が文字列ではありません。`);
      }
      if (
        (field === "thumbnailUrl" ||
          field === "officialUrl" ||
          field === "sourceUrl") &&
        !isValidHttpUrl(fieldValue)
      ) {
        throw new Error(`カタログの${index + 1}件目の${field}がURLではありません。`);
      }
      if (
        (field === "publicationDate" || field === "broadcastDate") &&
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(fieldValue)
      ) {
        throw new Error(`カタログの${index + 1}件目の${field}がYYYY-MM形式ではありません。`);
      }
      book[field] = fieldValue;
    }

    if (book.isbn) {
      const normalizedIsbn = normalizeIsbn(book.isbn);
      if (isbns.has(normalizedIsbn)) {
        throw new Error(`カタログ内に重複したISBNがあります: ${book.isbn}`);
      }
      isbns.add(normalizedIsbn);
    }
    return book;
  });

  const missingSeries = SERIES_TYPES.filter((series) => !seriesFound.has(series));
  if (missingSeries.length > 0) {
    throw new Error(`カタログにシリーズがありません: ${missingSeries.join(", ")}`);
  }

  return books;
}

export function deduplicateCatalogBooks(
  input: CatalogBook[],
): { books: CatalogBook[]; duplicates: number } {
  const ids = new Set<string>();
  const isbns = new Map<string, CatalogBook>();
  const books: CatalogBook[] = [];
  let duplicates = 0;

  for (const book of input) {
    const normalizedIsbn = book.isbn ? normalizeIsbn(book.isbn) : undefined;
    if (ids.has(book.id)) {
      duplicates += 1;
      continue;
    }
    if (normalizedIsbn && isbns.has(normalizedIsbn)) {
      const existing = isbns.get(normalizedIsbn);
      if (existing?.series !== book.series) {
        throw new Error(
          `同一ISBNが異なるシリーズに分類されています: ${book.isbn}`,
        );
      }
      duplicates += 1;
      continue;
    }
    ids.add(book.id);
    if (normalizedIsbn) isbns.set(normalizedIsbn, book);
    books.push(book);
  }

  return { books, duplicates };
}
