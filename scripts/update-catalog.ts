import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";
import type { CatalogBook, SeriesType } from "../src/domain/book";
import {
  deduplicateCatalogBooks,
  validateCatalog,
} from "../src/domain/catalog";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogPath = resolve(projectRoot, "src/data/books.json");
const metadataPath = resolve(projectRoot, "src/data/catalog-metadata.json");
const ndlSearchEndpoint = "https://ndlsearch.ndl.go.jp/api/opensearch";
const openBdEndpoint = "https://api.openbd.jp/v1/get";
const ndlProviderId = "iss-ndl-opac-national";
const pageSize = 50;
const maxRecords = 10_000;
const requestIntervalMs = 1_000;
const isbnBatchSize = 50;
const maximumIsbnUrlLength = 7_000;

export interface NdlSearchSource {
  series: SeriesType;
  titleQuery: string;
}

interface NdlPage {
  books: CatalogBook[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  resultCount: number;
}

interface CatalogMetadata {
  source: "sample" | "open-bibliography";
  generatedAt: string | null;
  seriesCounts: Record<SeriesType, number>;
  dataSources?: string[];
}

interface OpenBdSummary {
  isbn?: string;
  author?: string;
  pubdate?: string;
  cover?: string;
}

const searchSources: NdlSearchSource[] = [
  { series: "text", titleQuery: "100分 de 名著 テキスト" },
  { series: "books", titleQuery: "100分 de 名著ブックス" },
  { series: "special", titleQuery: "100分 de 名著 別冊" },
];

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string): string {
  return normalizeText(value).replace(/\s/g, "").toLocaleLowerCase("ja");
}

function getText(
  element: ReturnType<ReturnType<typeof load>>,
  selector: string,
): string {
  return normalizeText(element.find(selector).first().text());
}

function getIdentifier(
  $: ReturnType<typeof load>,
  element: ReturnType<ReturnType<typeof load>>,
  type: string,
): string | undefined {
  const identifier = element
    .find("dc\\:identifier")
    .toArray()
    .find((item) =>
      ($(item).attr("xsi:type") ?? "").toLocaleLowerCase("en").includes(type),
    );
  const value = identifier ? normalizeText($(identifier).text()) : "";
  return value || undefined;
}

function parsePublicationMonth(value: string): string | undefined {
  const normalized = normalizeText(value);
  const compactMatch = normalized.match(/^(\d{4})(\d{2})$/);
  if (compactMatch) {
    const month = Number(compactMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${compactMatch[1]}-${String(month).padStart(2, "0")}`;
    }
  }
  const monthMatch = normalized.match(/(\d{4})[./年-]\s*(\d{1,2})/);
  if (monthMatch) {
    const month = Number(monthMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${monthMatch[1]}-${String(month).padStart(2, "0")}`;
    }
  }
  return undefined;
}

function hasExpectedSeries(
  source: NdlSearchSource,
  title: string,
  seriesTitle: string,
): boolean {
  const normalizedSeries = normalizeForMatch(seriesTitle);
  switch (source.series) {
    case "text":
      return (
        normalizedSeries.includes("100分de名著") &&
        (normalizedSeries.includes("テキスト") ||
          normalizedSeries.includes("テレビテキスト"))
      ) || (
        normalizedSeries.includes("nhkテレビテキスト") &&
        normalizeForMatch(title).includes("100分de名著")
      );
    case "books":
      return (
        normalizedSeries.includes("100分de名著") &&
        normalizedSeries.includes("ブックス")
      );
    case "special":
      return (
        normalizedSeries.includes("100分de名著") &&
        normalizedSeries.includes("別冊")
      );
  }
}

function parseNdlBook(
  $: ReturnType<typeof load>,
  item: ReturnType<ReturnType<typeof load>>,
  source: NdlSearchSource,
): CatalogBook | null {
  const title = getText(item, "dc\\:title") || getText(item, "title");
  const seriesTitle = getText(item, "dcndl\\:seriesTitle");
  const publisher = getText(item, "dc\\:publisher");
  if (
    !title ||
    !seriesTitle ||
    normalizeForMatch(publisher) !== normalizeForMatch("NHK出版") ||
    !hasExpectedSeries(source, title, seriesTitle)
  ) {
    return null;
  }

  const isbnValue = getIdentifier($, item, "isbn");
  const isbn = isbnValue?.replace(/[\s-]/g, "").toUpperCase();
  if (isbn && !/^\d{13}$/.test(isbn)) {
    throw new Error(`NDL書誌のISBNが13桁ではありません: ${isbnValue}`);
  }

  const bibId = getIdentifier($, item, "ndlbibid");
  const id = isbn ? `isbn-${isbn}` : bibId ? `ndl-${bibId}` : undefined;
  if (!id) {
    throw new Error(`安定した識別子のないNDL書誌を検出しました: ${title}`);
  }

  const creator = getText(item, "dc\\:creator");
  const published =
    getText(item, "dcterms\\:issued") ||
    getText(item, "dc\\:date");
  const recordUrl = getText(item, "link") || getText(item, "guid");
  if (!recordUrl) {
    throw new Error(`NDL書誌のレコードURLがありません: ${title}`);
  }
  const url = new URL(recordUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "ndlsearch.ndl.go.jp" ||
    !url.pathname.startsWith("/books/")
  ) {
    throw new Error(`NDL書誌のレコードURLが不正です: ${recordUrl}`);
  }

  const publicationDate = parsePublicationMonth(published);
  return {
    id,
    title,
    series: source.series,
    ...(creator ? { author: creator } : {}),
    ...(publicationDate ? { publicationDate } : {}),
    ...(isbn ? { isbn } : {}),
    sourceUrl: url.toString(),
  };
}

export function parseNdlOpenSearchResponse(
  xml: string,
  source: NdlSearchSource,
): NdlPage {
  const $ = load(xml, { xmlMode: true });
  const root = $.root();
  const totalResults = Number(
    getText(root, "openSearch\\:totalResults"),
  );
  const startIndex = Number(getText(root, "openSearch\\:startIndex"));
  const itemsPerPage = Number(
    getText(root, "openSearch\\:itemsPerPage"),
  );
  if (
    !Number.isSafeInteger(totalResults) ||
    totalResults < 0 ||
    !Number.isSafeInteger(startIndex) ||
    startIndex < 1 ||
    !Number.isSafeInteger(itemsPerPage) ||
    itemsPerPage < 0 ||
    itemsPerPage > pageSize
  ) {
    throw new Error("NDLサーチAPIの検索結果件数・ページ情報を解析できません。");
  }

  const items = $("item").toArray();
  const books = items
    .map((item) => parseNdlBook($, $(item), source))
    .filter((book): book is CatalogBook => book !== null);
  return {
    books,
    totalResults,
    startIndex,
    itemsPerPage,
    resultCount: items.length,
  };
}

function ndlSearchUrl(
  source: NdlSearchSource,
  startIndex: number,
  resultPageSize: number,
): string {
  const url = new URL(ndlSearchEndpoint);
  url.searchParams.set("cnt", String(resultPageSize));
  url.searchParams.set("idx", String(startIndex));
  url.searchParams.set("title", source.titleQuery);
  url.searchParams.set("dpid", ndlProviderId);
  return url.toString();
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "BookRouletteCatalog/1.0 (+https://github.com/MatsumotoKentaro/BookRoulette)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}で書誌APIを取得できません: ${url}`);
  }
  return response.text();
}

export async function fetchNdlSource(
  source: NdlSearchSource,
  fetchPage: (url: string) => Promise<string> = fetchXml,
  resultPageSize = pageSize,
): Promise<{ books: CatalogBook[]; searchResultCount: number }> {
  if (!Number.isInteger(resultPageSize) || resultPageSize < 1 || resultPageSize > pageSize) {
    throw new RangeError(`NDLページサイズは1から${pageSize}の整数にしてください。`);
  }
  const books: CatalogBook[] = [];
  let totalResults: number | undefined;
  let startIndex = 1;
  let searchResultCount = 0;

  while (totalResults === undefined || startIndex <= totalResults) {
    if (startIndex > maxRecords) {
      throw new Error(
        `${source.series}: 検索結果が${maxRecords}件を超えるため処理を中止しました。`,
      );
    }
    if (startIndex > 1) await wait(requestIntervalMs);
    const page = parseNdlOpenSearchResponse(
      await fetchPage(ndlSearchUrl(source, startIndex, resultPageSize)),
      source,
    );
    if (totalResults === undefined) {
      totalResults = page.totalResults;
      if (totalResults > maxRecords) {
        throw new Error(
          `${source.series}: 検索結果が${totalResults}件あり、上限を超えました。`,
        );
      }
    } else if (page.totalResults !== totalResults) {
      throw new Error(`${source.series}: 取得中にNDL検索結果件数が変化しました。`);
    }

    const expectedStartIndex = startIndex;
    if (page.startIndex !== expectedStartIndex) {
      throw new Error(
        `${source.series}: NDLのページ位置が一致しません（要求 ${expectedStartIndex} / 応答 ${page.startIndex}）。`,
      );
    }
    if (page.resultCount === 0 && page.totalResults > 0) {
      throw new Error(`${source.series}: NDLサーチAPIから検索結果が返りませんでした。`);
    }

    const expectedResultCount = Math.min(
      resultPageSize,
      totalResults - startIndex + 1,
    );
    if (page.resultCount !== expectedResultCount) {
      throw new Error(
        `${source.series}: NDL検索結果のページ件数が不正です ` +
          `(期待 ${expectedResultCount} / 応答 ${page.resultCount})。`,
      );
    }

    searchResultCount += page.resultCount;
    books.push(...page.books);
    startIndex += page.resultCount;
  }

  if (searchResultCount < (totalResults ?? 0)) {
    throw new Error(`${source.series}: NDL検索結果を最後まで取得できませんでした。`);
  }
  if (books.length === 0) {
    throw new Error(
      `${source.series}: NDL検索結果に利用可能なシリーズ書誌がありません。`,
    );
  }
  return { books, searchResultCount };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOpenBdSummaries(input: unknown): Map<string, OpenBdSummary> {
  if (!Array.isArray(input)) {
    throw new Error("OpenBD APIの応答がISBN書誌の配列ではありません。");
  }
  const summaries = new Map<string, OpenBdSummary>();
  for (const record of input) {
    if (record === null) continue;
    if (!isRecord(record) || !isRecord(record.summary)) {
      throw new Error("OpenBD APIの応答に不正な書誌レコードがあります。");
    }
    const summary = record.summary;
    const isbn =
      typeof summary.isbn === "string"
        ? summary.isbn.replace(/[\s-]/g, "").toUpperCase()
        : "";
    if (!/^\d{13}$/.test(isbn)) {
      throw new Error("OpenBD APIの書誌に有効なISBNがありません。");
    }
    summaries.set(isbn, {
      isbn,
      ...(typeof summary.author === "string" && summary.author.trim()
        ? { author: normalizeText(summary.author) }
        : {}),
      ...(typeof summary.pubdate === "string" && summary.pubdate.trim()
        ? { pubdate: normalizeText(summary.pubdate) }
        : {}),
      ...(typeof summary.cover === "string" && summary.cover.trim()
        ? { cover: normalizeText(summary.cover) }
        : {}),
    });
  }
  return summaries;
}

export function enrichBooksFromOpenBd(
  books: CatalogBook[],
  response: unknown,
): CatalogBook[] {
  const summaries = parseOpenBdSummaries(response);
  return books.map((book) => {
    if (!book.isbn) return book;
    const summary = summaries.get(book.isbn.replace(/[\s-]/g, "").toUpperCase());
    if (!summary) return book;

    const bookWithMetadata = { ...book };
    if (!bookWithMetadata.author && summary.author) {
      bookWithMetadata.author = summary.author;
    }
    if (!bookWithMetadata.publicationDate && summary.pubdate) {
      const publicationDate = parsePublicationMonth(summary.pubdate);
      if (publicationDate) bookWithMetadata.publicationDate = publicationDate;
    }
    if (summary.cover) {
      const coverUrl = new URL(summary.cover);
      if (
        coverUrl.protocol === "https:" &&
        (coverUrl.hostname === "cover.openbd.jp" ||
          coverUrl.hostname.endsWith(".s3.ap-northeast-1.amazonaws.com"))
      ) {
        bookWithMetadata.thumbnailUrl = coverUrl.toString();
      } else {
        throw new Error(`OpenBD書影URLが許可されていないホストです: ${summary.cover}`);
      }
    }
    return bookWithMetadata;
  });
}

async function fetchOpenBd(isbns: string[]): Promise<unknown> {
  const uniqueIsbns = [...new Set(isbns)];
  const responseRecords: unknown[] = [];
  for (let offset = 0; offset < uniqueIsbns.length; offset += isbnBatchSize) {
    if (offset > 0) await wait(requestIntervalMs);
    const batch = uniqueIsbns.slice(offset, offset + isbnBatchSize);
    const url = new URL(openBdEndpoint);
    url.searchParams.set("isbn", batch.join(","));
    url.searchParams.set("pretty", "");
    if (url.toString().length > maximumIsbnUrlLength) {
      throw new Error("OpenBD ISBN一括リクエストが上限サイズを超えました。");
    }
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "BookRouletteCatalog/1.0 (+https://github.com/MatsumotoKentaro/BookRoulette)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`OpenBD APIがHTTP ${response.status}を返しました。`);
    }
    const page: unknown = await response.json();
    if (!Array.isArray(page) || page.length !== batch.length) {
      throw new Error("OpenBD APIの応答件数がISBNリクエストと一致しません。");
    }
    responseRecords.push(...page);
  }
  return responseRecords;
}

async function readPreviousMetadata(): Promise<CatalogMetadata | null> {
  try {
    const raw = await readFile(metadataPath, "utf8");
    const metadata: unknown = JSON.parse(raw);
    if (
      !isRecord(metadata) ||
      !("source" in metadata) ||
      !("seriesCounts" in metadata)
    ) {
      throw new Error("既存のカタログメタデータの形式が不正です。");
    }
    return metadata as unknown as CatalogMetadata;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function getSeriesCounts(books: CatalogBook[]): Record<SeriesType, number> {
  return {
    text: books.filter((book) => book.series === "text").length,
    books: books.filter((book) => book.series === "books").length,
    special: books.filter((book) => book.series === "special").length,
  };
}

async function writeCatalog(
  books: CatalogBook[],
  metadata: CatalogMetadata,
): Promise<void> {
  const token = randomUUID();
  const catalogTempPath = `${catalogPath}.${token}.tmp`;
  const metadataTempPath = `${metadataPath}.${token}.tmp`;
  try {
    await writeFile(catalogTempPath, `${JSON.stringify(books, null, 2)}\n`, {
      flag: "wx",
    });
    await writeFile(
      metadataTempPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      { flag: "wx" },
    );
    await rename(catalogTempPath, catalogPath);
    await rename(metadataTempPath, metadataPath);
  } finally {
    await Promise.all([
      unlink(catalogTempPath).catch(() => undefined),
      unlink(metadataTempPath).catch(() => undefined),
    ]);
  }
}

export async function updateCatalog(dryRun = false): Promise<void> {
  const previousMetadata = await readPreviousMetadata();
  const results = [];
  for (const source of searchSources) {
    console.log(`NDL検索: ${source.series} (${source.titleQuery})`);
    const result = await fetchNdlSource(source);
    results.push(result);
    console.log(
      `${source.series}: 検索結果${result.searchResultCount}件から ` +
        `${result.books.length}件のシリーズ書誌を取得`,
    );
  }

  const ndlBooks = results.flatMap((result) => result.books);
  let openBdEnrichedCount = 0;
  let enrichedBooks = ndlBooks;
  const isbns = ndlBooks.flatMap((book) => (book.isbn ? [book.isbn] : []));
  if (isbns.length > 0) {
    try {
      const openBdResponse = await fetchOpenBd(isbns);
      enrichedBooks = enrichBooksFromOpenBd(ndlBooks, openBdResponse);
      openBdEnrichedCount = enrichedBooks.filter(
        (book, index) =>
          book.author !== ndlBooks[index]?.author ||
          book.publicationDate !== ndlBooks[index]?.publicationDate ||
          book.thumbnailUrl !== ndlBooks[index]?.thumbnailUrl,
      ).length;
      const foundCount = parseOpenBdSummaries(openBdResponse).size;
      console.log(
        `OpenBD: ISBN ${isbns.length}件中 ${foundCount}件に書誌情報、` +
          `${enrichedBooks.filter((book) => book.thumbnailUrl).length}件に書影あり`,
      );
    } catch (error) {
      console.warn(
        `警告: OpenBDの補完に失敗しました。NDL書誌で続行します: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const deduplicated = deduplicateCatalogBooks(enrichedBooks);
  const books = validateCatalog(deduplicated.books);
  const seriesCounts = getSeriesCounts(books);
  console.log(
    `カタログ: 合計${books.length}件 ` +
      `(テキスト ${seriesCounts.text}, ブックス ${seriesCounts.books}, 別冊 ${seriesCounts.special})`,
  );
  console.log(`重複除去: ${deduplicated.duplicates}件`);
  console.log(`OpenBDでの補完: ${openBdEnrichedCount}件`);

  if (seriesCounts.text < 12) {
    console.warn(
      `警告: テキストの取得件数が${seriesCounts.text}件です。` +
        "NDL全国書誌情報で提供されるテキスト書誌が不完全な可能性があります。",
    );
  }
  if (previousMetadata && previousMetadata.source !== "sample") {
    for (const series of ["text", "books", "special"] as const) {
      const previousCount = previousMetadata.seriesCounts[series];
      const nextCount = seriesCounts[series];
      if (previousCount > 0 && nextCount < previousCount * 0.8) {
        console.warn(
          `警告: ${series}が${previousCount}件から${nextCount}件に減少しました（20%以上）。`,
        );
      }
    }
  }

  if (dryRun) {
    console.log("dry-run: カタログファイルは変更していません。");
    return;
  }

  await writeCatalog(books, {
    source: "open-bibliography",
    generatedAt: new Date().toISOString(),
    seriesCounts,
    dataSources: [
      "National Diet Library Search API (National Bibliography)",
      "OpenBD API",
    ],
  });
  console.log(`カタログを更新しました: ${catalogPath}`);
}

async function main(): Promise<void> {
  await updateCatalog(process.argv.includes("--dry-run"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(
      `カタログ更新に失敗しました: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
