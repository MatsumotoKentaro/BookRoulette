import { describe, expect, it } from "vitest";
import type { CatalogBook, ReadingRecord, SeriesType } from "../src/domain/book";
import { drawBook, getRouletteCandidates } from "../src/domain/roulette";

const books: CatalogBook[] = (["text", "books", "special"] as SeriesType[]).map(
  (series, index) => ({
    id: `book-${index}`,
    title: `本${index}`,
    series,
  }),
);

const records: ReadingRecord[] = [
  { bookId: "book-1", status: "reading", updatedAt: "2026-01-01T00:00:00Z" },
  { bookId: "book-2", status: "completed", updatedAt: "2026-01-01T00:00:00Z" },
];

describe("ルーレット", () => {
  it("カタログまたは候補が空ならnullを返す", () => {
    expect(drawBook([], [], "all")).toBeNull();
    expect(drawBook(books, records, "books")).toBeNull();
  });

  it("未読だけを対象にし、選択したシリーズで絞る", () => {
    expect(getRouletteCandidates(books, records, "all").map((book) => book.id))
      .toEqual(["book-0"]);
    expect(getRouletteCandidates(books, [], "special").map((book) => book.id))
      .toEqual(["book-2"]);
  });

  it("乱数0なら先頭候補、1未満の最大値なら最後の候補を選ぶ", () => {
    expect(drawBook(books, [], "all", () => 0)?.id).toBe("book-0");
    expect(drawBook(books, [], "all", () => 0.999999)?.id).toBe("book-2");
  });

  it("抽選しても読書記録を変更しない", () => {
    const original = structuredClone(records);
    drawBook(books, records, "all", () => 0);
    expect(records).toEqual(original);
  });

  it("範囲外の乱数を拒否する", () => {
    expect(() => drawBook(books, [], "all", () => 1)).toThrow(RangeError);
  });
});
