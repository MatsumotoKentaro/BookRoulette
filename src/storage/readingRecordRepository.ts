import type { ReadingRecord, ReadingStatus } from "../domain/book";

export const READING_RECORDS_KEY = "100min-meicho-reading-records-v1";

const validStatuses = new Set<ReadingStatus>([
  "unread",
  "reading",
  "completed",
]);

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isReadingRecord(value: unknown): value is ReadingRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bookId === "string" &&
    record.bookId.length > 0 &&
    typeof record.status === "string" &&
    validStatuses.has(record.status as ReadingStatus) &&
    typeof record.updatedAt === "string" &&
    record.updatedAt.length > 0
  );
}

export function loadReadingRecords(storage: KeyValueStorage): ReadingRecord[] {
  const raw = storage.getItem(READING_RECORDS_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("保存された読書記録を読み込めません。データ形式を確認してください。");
  }

  if (!Array.isArray(parsed) || !parsed.every(isReadingRecord)) {
    throw new Error("保存された読書記録の形式が正しくありません。");
  }

  return parsed;
}

export function saveReadingRecord(
  storage: KeyValueStorage,
  records: ReadingRecord[],
  bookId: string,
  status: ReadingStatus,
  updatedAt: string,
): ReadingRecord[] {
  const nextRecords = records.filter((record) => record.bookId !== bookId);
  nextRecords.push({ bookId, status, updatedAt });
  storage.setItem(READING_RECORDS_KEY, JSON.stringify(nextRecords));
  return nextRecords;
}
