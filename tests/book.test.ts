import { describe, expect, it } from "vitest";
import type { CatalogBook, ReadingRecord } from "../src/domain/book";
import { filterBooks, getReadingStatus } from "../src/domain/book";

const books: CatalogBook[] = [
  {
    id: "new",
    title: "春の読書案内",
    series: "text",
    publicationDate: "2026-04",
  },
  {
    id: "old",
    title: "冬の物語",
    series: "books",
    publicationDate: "2025-12",
  },
  {
    id: "undated",
    title: "夏の詩集",
    series: "special",
  },
];

const records: ReadingRecord[] = [
  { bookId: "old", status: "reading", updatedAt: "2026-01-01" },
  { bookId: "undated", status: "completed", updatedAt: "2026-01-01" },
];

describe("書籍の絞り込み", () => {
  it("日本語タイトルの部分一致で検索できる", () => {
    expect(
      filterBooks(books, records, {
        series: "all",
        status: "all",
        query: " 読書 ",
      }).map((book) => book.id),
    ).toEqual(["new"]);
  });

  it("シリーズと読書状況を組み合わせ、年月の新しい順で返す", () => {
    expect(
      filterBooks(books, records, {
        series: "all",
        status: "unread",
        query: "",
      }).map((book) => book.id),
    ).toEqual(["new"]);
    expect(
      filterBooks(books, records, {
        series: "books",
        status: "reading",
        query: "",
      }).map((book) => book.id),
    ).toEqual(["old"]);
  });

  it("読書記録のない書籍は未読として扱う", () => {
    expect(getReadingStatus("new", records)).toBe("unread");
  });
});
