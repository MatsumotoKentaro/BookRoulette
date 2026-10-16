import { useEffect, useMemo, useState } from "react";
import { BookCard } from "./components/BookCard";
import { SeriesSelect } from "./components/SeriesSelect";
import catalogMetadata from "./data/catalog-metadata.json";
import catalogJson from "./data/books.json";
import {
  filterBooks,
  getReadingStatus,
  SERIES_LABELS,
  STATUS_LABELS,
} from "./domain/book";
import type {
  ReadingRecord,
  ReadingStatus,
  SeriesFilter,
  StatusFilter,
} from "./domain/book";
import { validateCatalog } from "./domain/catalog";
import { drawBook, getRouletteCandidates } from "./domain/roulette";
import {
  loadReadingRecords,
  saveReadingRecord,
} from "./storage/readingRecordRepository";
import {
  createReadingBackup,
  parseReadingBackup,
  saveRestoredReadingRecords,
} from "./storage/backupRepository";

const statuses: ReadingStatus[] = ["unread", "reading", "completed"];
const catalogBooks = validateCatalog(catalogJson);

export default function App() {
  const [records, setRecords] = useState<ReadingRecord[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [rouletteSeries, setRouletteSeries] = useState<SeriesFilter>("all");
  const [resultId, setResultId] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState<SeriesFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      setRecords(loadReadingRecords(window.localStorage));
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? error.message
          : "読書記録を読み込めませんでした。",
      );
    } finally {
      setStorageReady(true);
    }
  }, []);

  const candidates = useMemo(
    () => getRouletteCandidates(catalogBooks, records, rouletteSeries),
    [records, rouletteSeries],
  );
  const selectedBook = resultId
    ? catalogBooks.find((book) => book.id === resultId) ?? null
    : null;
  const visibleBooks = useMemo(
    () =>
      filterBooks(catalogBooks, records, {
        series: seriesFilter,
        status: statusFilter,
        query,
      }),
    [records, seriesFilter, statusFilter, query],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        statuses.map((status) => [
          status,
          catalogBooks.filter(
            (book) => getReadingStatus(book.id, records) === status,
          ).length,
        ]),
      ) as Record<ReadingStatus, number>,
    [records],
  );
  const seriesCounts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SERIES_LABELS).map(([series]) => [
          series,
          catalogBooks.filter(
            (book) =>
              book.series === series &&
              getReadingStatus(book.id, records) === "unread",
          ).length,
        ]),
      ) as Record<Exclude<SeriesFilter, "all">, number>,
    [records],
  );

  function handleStatusChange(bookId: string, status: ReadingStatus) {
    if (!storageReady || storageError) return;

    try {
      setRecords(
        saveReadingRecord(
          window.localStorage,
          records,
          bookId,
          status,
          new Date().toISOString(),
        ),
      );
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? `読書記録を保存できませんでした：${error.message}`
          : "読書記録を保存できませんでした。",
      );
    }
  }

  function handleDraw() {
    const book = drawBook(catalogBooks, records, rouletteSeries);
    setResultId(book?.id ?? null);
  }

  function handleExport() {
    try {
      const contents = createReadingBackup(records);
      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `100min-meicho-reading-records-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackupError(null);
      setBackupMessage("読書記録をJSONファイルに保存しました。");
    } catch (error) {
      setBackupMessage(null);
      setBackupError(
        error instanceof Error
          ? `バックアップを作成できませんでした：${error.message}`
          : "バックアップを作成できませんでした。",
      );
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setBackupError(null);
    setBackupMessage(null);
    let contents: string;
    try {
      contents = await file.text();
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? `ファイルを読み込めませんでした：${error.message}`
          : "ファイルを読み込めませんでした。",
      );
      return;
    }

    let restored: ReadingRecord[];
    try {
      restored = parseReadingBackup(contents);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "バックアップの形式が正しくありません。",
      );
      return;
    }

    if (
      !window.confirm(
        "現在の読書記録をこのバックアップの内容で置き換えます。この操作は取り消せません。続けますか？",
      )
    ) {
      return;
    }

    try {
      saveRestoredReadingRecords(window.localStorage, restored);
      setRecords(restored);
      setStorageError(null);
      setBackupMessage(`${restored.length}件の読書記録を復元しました。`);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "バックアップを復元できませんでした。",
      );
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="トップへ">
          <span className="brand__symbol" aria-hidden="true">本</span>
          <span>100分 de 名著<br />読書ルーレット</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#roulette">ルーレット</a>
          <a href="#library">本棚</a>
          <a href="#backup">バックアップ</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">今日の一冊と出会う</p>
        <h1>まだ知らない名著を、<br />ルーレットで。</h1>
        <p className="hero__description">
          気になる本に出会ったら、読書状況を記録してみましょう。
        </p>
        <a className="text-link" href="#roulette">一冊選んでみる <span aria-hidden="true">↓</span></a>
      </section>

      {storageError && (
        <div className="storage-alert" role="alert">
          <strong>読書記録に問題があります</strong>
          <span>{storageError}</span>
          <span>記録の読み書きができないため、状態変更は停止しています。</span>
        </div>
      )}

      <section className="summary" aria-label="読書状況">
        {statuses.map((status) => (
          <div className="summary__item" key={status}>
            <span>{STATUS_LABELS[status]}</span>
            <strong>{counts[status]}</strong>
            <small>冊</small>
          </div>
        ))}
      </section>

      <section className="roulette-section section-wrap" id="roulette">
        <div className="section-heading">
          <p className="eyebrow">PICK YOUR NEXT BOOK</p>
          <h2>次に読む一冊を選ぶ</h2>
          <p>未読の本の中から、気になる一冊を引いてみましょう。</p>
        </div>
        <div className="roulette-panel">
          <label className="field">
            <span>シリーズ</span>
            <SeriesSelect
              id="roulette-series"
              value={rouletteSeries}
              onChange={(series) => {
                setRouletteSeries(series);
                setResultId(null);
              }}
            />
          </label>
          <p className="candidate-count">
            抽選対象 <strong>{candidates.length}</strong> 冊
          </p>
          <button
            className="draw-button"
            type="button"
            disabled={!storageReady || Boolean(storageError) || candidates.length === 0}
            onClick={handleDraw}
          >
            <span aria-hidden="true">⟳</span> ルーレットを回す
          </button>
          {candidates.length === 0 && (
            <p className="empty-message" role="status">
              抽選対象の未読書籍がありません
            </p>
          )}
          {selectedBook && (
            <div className="draw-result" aria-live="polite">
              <p className="eyebrow">YOUR NEXT BOOK</p>
              <BookCard
                book={selectedBook}
                status={getReadingStatus(selectedBook.id, records)}
                disabled={!storageReady || Boolean(storageError)}
                onStatusChange={handleStatusChange}
              />
            </div>
          )}
        </div>
        <div className="series-counts" aria-label="シリーズ別の未読数">
          {Object.entries(SERIES_LABELS).map(([series, label]) => (
            <div className="series-count" key={series}>
              <span>{label}</span>
              <strong>{seriesCounts[series as keyof typeof seriesCounts]}</strong>
              <small>冊が未読</small>
            </div>
          ))}
        </div>
      </section>

      <section className="library-section section-wrap" id="library">
        <div className="section-heading section-heading--library">
          <p className="eyebrow">YOUR BOOKSHELF</p>
          <h2>本棚</h2>
          <p>読んだ本も、これから読む本も、ここで管理できます。</p>
        </div>
        <div className="filters" aria-label="書籍を絞り込む">
          <label className="field">
            <span>タイトルで検索</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="タイトルを入力"
            />
          </label>
          <label className="field">
            <span>シリーズ</span>
            <SeriesSelect
              id="library-series"
              value={seriesFilter}
              onChange={setSeriesFilter}
            />
          </label>
          <label className="field">
            <span>読書状況</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
            >
              <option value="all">すべて</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="results-count" aria-live="polite">
          {visibleBooks.length} 冊の本
        </p>
        {visibleBooks.length > 0 ? (
          <div className="book-grid">
            {visibleBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                status={getReadingStatus(book.id, records)}
                disabled={!storageReady || Boolean(storageError)}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        ) : (
          <p className="empty-library">条件に一致する本はありません。</p>
        )}
      </section>

      <section className="backup-section section-wrap" id="backup">
        <div className="section-heading">
          <p className="eyebrow">KEEP YOUR READING RECORDS SAFE</p>
          <h2>読書記録のバックアップ</h2>
          <p>
            記録はこのブラウザに保存されます。定期的にJSONファイルへ保存してください。
          </p>
        </div>
        <div className="backup-panel">
          <button
            className="backup-button"
            type="button"
            disabled={!storageReady || Boolean(storageError)}
            onClick={handleExport}
          >
            JSONをダウンロード
          </button>
          <label className="backup-import">
            <span>バックアップファイルから復元</span>
            <input
              type="file"
              accept="application/json,.json"
              disabled={!storageReady}
              onChange={handleImport}
            />
          </label>
          <p className="backup-note">
            復元すると現在の記録はすべて置き換わります。カタログにない本の記録も保存されます。
          </p>
          {backupError && <p className="backup-feedback backup-feedback--error" role="alert">{backupError}</p>}
          {backupMessage && <p className="backup-feedback" role="status">{backupMessage}</p>}
        </div>
      </section>

      <footer className="site-footer">
        <p>読書の記録は、このブラウザに保存されます。</p>
        {catalogMetadata.source === "sample" ? (
          <p>掲載内容は動作確認用のサンプルデータです。</p>
        ) : (
          <p>
            書誌情報：国立国会図書館サーチAPI（全国書誌情報）／
            OpenBD API（ISBN書誌情報・書影）
          </p>
        )}
      </footer>
    </main>
  );
}
