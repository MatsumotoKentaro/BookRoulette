import { useEffect, useState } from "react";
import type { CatalogBook, ReadingStatus } from "../domain/book";
import { SERIES_LABELS, STATUS_LABELS } from "../domain/book";

interface BookCardProps {
  book: CatalogBook;
  status: ReadingStatus;
  disabled?: boolean;
  onStatusChange: (bookId: string, status: ReadingStatus) => void;
}

export function BookCard({
  book,
  status,
  disabled = false,
  onStatusChange,
}: BookCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [book.thumbnailUrl]);

  const showThumbnail = Boolean(book.thumbnailUrl) && !imageFailed;

  return (
    <article className="book-card">
      <div
        className="book-cover"
        aria-label={showThumbnail ? `${book.title}の書影` : "書影はありません"}
      >
        {showThumbnail ? (
          <img
            className="book-cover__image"
            src={book.thumbnailUrl}
            alt={`${book.title}の書影`}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <>
            <span className="book-cover__mark" aria-hidden="true">本</span>
            <span className="book-cover__caption">書影なし</span>
          </>
        )}
      </div>
      <div className="book-card__details">
        <div className="book-card__meta">
          <span className={`series-badge series-badge--${book.series}`}>
            {SERIES_LABELS[book.series]}
          </span>
          <span className={`status-label status-label--${status}`}>
            {STATUS_LABELS[status]}
          </span>
        </div>
        <h3>{book.title}</h3>
        {book.author && <p className="book-card__author">{book.author}</p>}
        {(book.publicationDate || book.broadcastDate) && (
          <p className="book-card__date">
            刊行・放送年月：{book.publicationDate ?? book.broadcastDate}
          </p>
        )}
        {(book.officialUrl || book.sourceUrl) && (
          <a
            className="book-card__official-link"
            href={book.officialUrl ?? book.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {book.officialUrl
              ? "NHK出版の商品ページ"
              : "国立国会図書館サーチの書誌"}
            <span aria-hidden="true"> ↗</span>
          </a>
        )}
        <label className="status-control">
          <span>読書状況</span>
          <select
            aria-label={`${book.title}の読書状況`}
            disabled={disabled}
            value={status}
            onChange={(event) =>
              onStatusChange(book.id, event.target.value as ReadingStatus)
            }
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
