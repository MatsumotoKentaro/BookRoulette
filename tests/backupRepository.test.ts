import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "../src/storage/readingRecordRepository";
import {
  createReadingBackup,
  READING_BACKUP_SCHEMA_VERSION,
  restoreReadingBackup,
} from "../src/storage/backupRepository";
import { READING_RECORDS_KEY } from "../src/storage/readingRecordRepository";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } satisfies KeyValueStorage,
    values,
  };
}

describe("読書記録バックアップ", () => {
  const records = [
    {
      bookId: "book-1",
      status: "completed",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      bookId: "removed-book",
      status: "reading",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ] as const;

  it("バージョンと日時を含むJSONを作成する", () => {
    expect(
      JSON.parse(createReadingBackup([...records], "2026-01-03T00:00:00.000Z")),
    ).toEqual({
      schemaVersion: READING_BACKUP_SCHEMA_VERSION,
      exportedAt: "2026-01-03T00:00:00.000Z",
      records,
    });
  });

  it("有効なJSONを復元し、カタログ外の記録も保持する", () => {
    const { storage, values } = createStorage({
      [READING_RECORDS_KEY]: JSON.stringify([
        { bookId: "old", status: "completed", updatedAt: "2025-01-01" },
      ]),
    });
    const restored = restoreReadingBackup(
      storage,
      createReadingBackup([...records], "2026-01-03T00:00:00.000Z"),
    );

    expect(restored).toEqual(records);
    expect(JSON.parse(values.get(READING_RECORDS_KEY) ?? "null")).toEqual(records);
  });

  it.each([
    ["不正なJSON", "{"],
    ["未対応バージョン", JSON.stringify({ schemaVersion: 2, exportedAt: "now", records: [] })],
    ["不正な状態値", JSON.stringify({ schemaVersion: 1, exportedAt: "now", records: [{ bookId: "x", status: "later", updatedAt: "now" }] })],
    ["重複した本", JSON.stringify({ schemaVersion: 1, exportedAt: "now", records: [{ bookId: "x", status: "reading", updatedAt: "now" }, { bookId: "x", status: "completed", updatedAt: "later" }] })],
  ])("%sの場合はデータを書き換えない", (_case, contents) => {
    const original = JSON.stringify([
      { bookId: "existing", status: "reading", updatedAt: "2025-01-01" },
    ]);
    const { storage, values } = createStorage({
      [READING_RECORDS_KEY]: original,
    });

    expect(() => restoreReadingBackup(storage, contents)).toThrow();
    expect(values.get(READING_RECORDS_KEY)).toBe(original);
  });
});
