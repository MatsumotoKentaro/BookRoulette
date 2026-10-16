import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "../src/storage/readingRecordRepository";
import {
  loadReadingRecords,
  READING_RECORDS_KEY,
  saveReadingRecord,
} from "../src/storage/readingRecordRepository";

function createStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("読書記録リポジトリ", () => {
  it("保存した状態を読み戻せる", () => {
    const storage = createStorage();
    const records = saveReadingRecord(
      storage,
      [],
      "book-1",
      "completed",
      "2026-01-01T00:00:00.000Z",
    );
    expect(loadReadingRecords(storage)).toEqual(records);
    expect(READING_RECORDS_KEY).toBe("100min-meicho-reading-records-v1");
  });

  it("新しい状態を保存しても他の本の記録を維持する", () => {
    const storage = createStorage();
    const first = saveReadingRecord(
      storage,
      [],
      "old-book",
      "reading",
      "2026-01-01T00:00:00.000Z",
    );
    const next = saveReadingRecord(
      storage,
      first,
      "new-book",
      "completed",
      "2026-01-02T00:00:00.000Z",
    );
    expect(next.map((record) => record.bookId)).toEqual(["old-book", "new-book"]);
    expect(loadReadingRecords(storage)).toEqual(next);
  });

  it("読了から未読へ戻せる", () => {
    const storage = createStorage();
    const records = saveReadingRecord(
      storage,
      [],
      "book-1",
      "completed",
      "2026-01-01T00:00:00.000Z",
    );
    saveReadingRecord(
      storage,
      records,
      "book-1",
      "unread",
      "2026-01-02T00:00:00.000Z",
    );
    expect(loadReadingRecords(storage)[0].status).toBe("unread");
  });

  it("不正なJSONや形式を明示的にエラーにする", () => {
    expect(() =>
      loadReadingRecords(createStorage({ [READING_RECORDS_KEY]: "{" })),
    ).toThrow("読み込めません");
    expect(() =>
      loadReadingRecords(
        createStorage({ [READING_RECORDS_KEY]: JSON.stringify([{ bookId: "x" }]) }),
      ),
    ).toThrow("形式が正しくありません");
  });

  it("カタログから消えた本の記録も保持する", () => {
    const orphaned = [
      { bookId: "removed-book", status: "reading", updatedAt: "2026-01-01" },
    ];
    const storage = createStorage({
      [READING_RECORDS_KEY]: JSON.stringify(orphaned),
    });
    expect(loadReadingRecords(storage)).toEqual(orphaned);
  });
});
