import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CatalogBook } from "../src/domain/book";
import {
  deduplicateCatalogBooks,
  validateCatalog,
} from "../src/domain/catalog";
import {
  enrichBooksFromOpenBd,
  fetchNdlSource,
  parseNdlOpenSearchResponse,
} from "../scripts/update-catalog";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/ndl-opensearch.xml", import.meta.url)),
  "utf8",
);
const openBdFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/openbd.json", import.meta.url)),
    "utf8",
  ),
) as unknown;
const booksSource = {
  series: "books" as const,
  titleQuery: "100分 de 名著ブックス",
};
const fullCatalog: CatalogBook[] = [
  { id: "t1", title: "テキスト", series: "text" },
  { id: "b1", title: "ブックス", series: "books" },
  { id: "s1", title: "別冊", series: "special" },
];

describe("公開書誌APIの取得・検証", () => {
  it("NDL OpenSearchからシリーズ一致書誌のみを正規化する", () => {
    const parsed = parseNdlOpenSearchResponse(fixture, booksSource);
    expect(parsed).toEqual({
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      resultCount: 2,
      books: [
        {
          id: "isbn-9784140000001",
          title: "サンプル書籍",
          series: "books",
          author: "サンプル 著者",
          publicationDate: "2024-03",
          isbn: "9784140000001",
          sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I012345678",
        },
      ],
    });
  });

  it.each([
    [
      { series: "text", titleQuery: "100分 de 名著 テキスト" },
      "100分de名著",
      "NHKテキスト. 100分de名著",
    ],
    [
      { series: "books", titleQuery: "100分 de 名著ブックス" },
      "ブックス書籍",
      "NHK「100分de名著」ブックス",
    ],
    [
      { series: "special", titleQuery: "100分 de 名著 別冊" },
      "別冊書籍",
      "[教養・文化シリーズ]. 別冊NHK100分de名著",
    ],
  ] as const)("書誌シリーズ名から%sを正確に分類する", (source, title, seriesTitle) => {
    const xml = fixture
      .replace(/サンプル書籍/g, title)
      .replace("NHK「100分de名著」ブックス", seriesTitle);
    const parsed = parseNdlOpenSearchResponse(xml, source);
    expect(parsed.books[0]?.series).toBe(source.series);
  });

  it("ページ情報が壊れたNDL応答を拒否する", () => {
    expect(() =>
      parseNdlOpenSearchResponse(
        fixture.replace("<openSearch:startIndex>1</openSearch:startIndex>", ""),
        booksSource,
      ),
    ).toThrow("ページ情報");
  });

  it("NDL APIの全ページを順次取得し、ページ欠落を検出する", async () => {
    const firstPage = fixture.replace(
      "<openSearch:totalResults>2</openSearch:totalResults>",
      "<openSearch:totalResults>4</openSearch:totalResults>",
    );
    const secondPage = firstPage.replace(
      "<openSearch:startIndex>1</openSearch:startIndex>",
      "<openSearch:startIndex>3</openSearch:startIndex>",
    );
    const calls: string[] = [];
    const result = await fetchNdlSource(
      booksSource,
      async (url) => {
        calls.push(url);
        return calls.length === 1 ? firstPage : secondPage;
      },
      2,
    );
    expect(result.searchResultCount).toBe(4);
    expect(result.books).toHaveLength(2);
    expect(calls).toHaveLength(2);

    await expect(
      fetchNdlSource(booksSource, async () => fixture.replace(
        "<openSearch:totalResults>2</openSearch:totalResults>",
        "<openSearch:totalResults>4</openSearch:totalResults>",
      ).replace(
        "<openSearch:startIndex>1</openSearch:startIndex>",
        "<openSearch:startIndex>2</openSearch:startIndex>",
      )),
    ).rejects.toThrow("ページ位置が一致しません");
  });

  it("ISBN一致でOpenBD書誌・書影を補完し、ISBN不一致と不正画像を拒否する", () => {
    const book: CatalogBook = {
      id: "isbn-9784140000001",
      title: "サンプル書籍",
      series: "books",
      isbn: "9784140000001",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I012345678",
    };
    expect(enrichBooksFromOpenBd([book], openBdFixture)[0]).toEqual({
      ...book,
      author: "OpenBD著者",
      publicationDate: "2024-03",
      thumbnailUrl: "https://cover.openbd.jp/9784140000001.jpg",
    });
    expect(
      enrichBooksFromOpenBd(
        [{ ...book, isbn: "9784140000002" }],
        openBdFixture,
      )[0].thumbnailUrl,
    ).toBeUndefined();
    expect(() =>
      enrichBooksFromOpenBd(
        [book],
        [{ summary: { isbn: "9784140000001", cover: "https://example.com/book.jpg" } }],
      ),
    ).toThrow("許可されていないホスト");
    expect(() => enrichBooksFromOpenBd([book], {})).toThrow("配列ではありません");
  });

  it("全3シリーズ・ISBN重複と既存の書誌要件を検証する", () => {
    expect(validateCatalog(fullCatalog)).toEqual(fullCatalog);
    expect(() =>
      validateCatalog([{ id: "t1", title: "本", series: "text" }]),
    ).toThrow("シリーズがありません");
    expect(() =>
      validateCatalog([
        ...fullCatalog,
        {
          id: "bad",
          title: "不正URL",
          series: "text",
          sourceUrl: "file:///invalid",
        },
      ]),
    ).toThrow("sourceUrlがURLではありません");

    const { books, duplicates } = deduplicateCatalogBooks([
      { id: "book-a", title: "本A", series: "books", isbn: "978-1-23456-789-0" },
      { id: "book-b", title: "本Aの重複", series: "books", isbn: "9781234567890" },
      { id: "book-c", title: "本C", series: "text" },
    ]);
    expect(books.map((book) => book.id)).toEqual(["book-a", "book-c"]);
    expect(duplicates).toBe(1);
  });
});
