import type { ReadingRecord, ReadingStatus } from "../domain/book";
import {
  READING_RECORDS_KEY,
  type KeyValueStorage,
} from "./readingRecordRepository";

export const READING_BACKUP_SCHEMA_VERSION = 1;

interface ReadingBackup {
  schemaVersion: number;
  exportedAt: string;
  records: ReadingRecord[];
}

const validStatuses = new Set<ReadingStatus>([
  "unread",
  "reading",
  "completed",
]);

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

export function createReadingBackup(
  records: ReadingRecord[],
  exportedAt = new Date().toISOString(),
): string {
  const backup: ReadingBackup = {
    schemaVersion: READING_BACKUP_SCHEMA_VERSION,
    exportedAt,
    records,
  };
  return JSON.stringify(backup, null, 2);
}

export function parseReadingBackup(contents: string): ReadingRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("JSONを読み込めません。ファイルの内容を確認してください。");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("バックアップの形式が正しくありません。");
  }

  const backup = parsed as Record<string, unknown>;
  if (backup.schemaVersion !== READING_BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `未対応のバックアップ形式です（schemaVersion: ${String(backup.schemaVersion)}）。`,
    );
  }
  if (
    typeof backup.exportedAt !== "string" ||
    backup.exportedAt.length === 0 ||
    !Array.isArray(backup.records) ||
    !backup.records.every(isReadingRecord)
  ) {
    throw new Error("バックアップの読書記録の形式が正しくありません。");
  }

  const records = backup.records as ReadingRecord[];
  const bookIds = new Set(records.map((record) => record.bookId));
  if (bookIds.size !== records.length) {
    throw new Error("バックアップに同じ本の記録が複数あります。");
  }

  return records;
}

export function saveRestoredReadingRecords(
  storage: KeyValueStorage,
  records: ReadingRecord[],
): void {
  storage.setItem(READING_RECORDS_KEY, JSON.stringify(records));
}

export function restoreReadingBackup(
  storage: KeyValueStorage,
  contents: string,
): ReadingRecord[] {
  const records = parseReadingBackup(contents);
  saveRestoredReadingRecords(storage, records);
  return records;
}
