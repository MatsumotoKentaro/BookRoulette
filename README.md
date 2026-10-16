# 100分 de 名著 読書ルーレット

Vite + React + TypeScript の静的Webアプリです。読書記録はブラウザの
localStorage に保存し、カタログは `src/data/books.json` から読み込みます。

## 開発

```sh
npm install
npm run dev
npm test
npm run lint
npm run build
```

## バックアップと復元

本棚の下にある「読書記録のバックアップ」から、読書記録をJSON形式でダウンロードできます。
復元時は形式バージョンと全レコードを検証し、確認ダイアログの後に現在の読書記録を置き換えます。
不正なファイルは保存領域を書き換えません。カタログから削除された本の記録もバックアップに含まれます。

## GitHub Pagesへの公開

`.github/workflows/deploy.yml` は `main` ブランチへのpushと手動実行でLint・テスト・本番ビルドを実行し、
成功後にGitHub Pagesへデプロイします。Pull Requestでは検証のみを行います。
GitHubリポジトリの **Settings > Pages > Build and deployment** で **GitHub Actions** を公開元に設定してください。

GitHub Actions上のVite `base` はこのリポジトリ名に合わせた `/BookRoulette/` です。
ローカル開発・ビルドでは `/` を使用します。別のリポジトリ名に移す場合は `vite.config.ts` の設定と
この説明を更新してください。画面内リンクはハッシュ遷移のため、個別ルートへの直接アクセスによる404は発生しません。

## 公開書誌APIによるカタログ取得

`npm run update:catalog` は、ブラウザではなくNode.jsから公開書誌APIを順次利用し、
検証済みデータを `src/data/books.json` に生成します。

1. [国立国会図書館サーチ OpenSearch API](https://ndlsearch.ndl.go.jp/help/api)
   から「国立国会図書館全国書誌情報（`iss-ndl-opac-national`）」を検索します。
   タイトル・シリーズ名・出版社・ISBN・刊行年月・NDL書誌URLを取得し、
   書誌中のシリーズ名と出版社が一致する本だけをテキスト／ブックス／別冊に分類します。
2. [OpenBD API](https://openbd.jp/) をISBN一括検索で呼び出し、著者・刊行年月の欠損を補い、
   利用可能な場合は書影URLを取得します。OpenBDに書誌がないISBNはNDLの情報を維持します。
3. 安定ID、ISBN重複、シリーズ3種、URL、日付を検証してからファイルを更新します。
   NDLの結果ページは1秒間隔で順次取得し、APIエラー、ページ欠落、0件の分類、
   不正なレコードがあれば更新に失敗します。OpenBD補完だけが失敗した場合は、
   警告を表示してNDLの書誌を使用します。

実行:

```sh
npm run update:catalog -- --dry-run
npm run update:catalog
```

`--dry-run` は取得・件数確認を行いますが、カタログを上書きしません。
データ取得後は3系列の件数を出力します。前回の生成済みカタログより20%以上
減った系列は警告し、テキストが12件未満の場合もNDL側の収録不足の可能性を警告します。
初期の `books.json` はテスト用サンプルであり、カタログ更新を実行するまでは
実書誌に切り替わりません。

### API利用条件と収録範囲

- NDLサーチのAPI利用案内では、NDL作成の書誌データは利用目的を問わず無償利用可能と
  されています。API利用時は出典としてNDLサーチAPIを明記し、連続利用に際しては
  利用実態の連絡を推奨しています。このアプリはNDLサーチAPIのクレジットを画面に表示します。
- NDLサーチは提供機関ごとに条件が異なると明記しています。このため利用元を
  `iss-ndl-opac-national`（NDL全国書誌情報）に限定し、他機関の提供データは取得しません。
- OpenBDは書誌情報・書影を自由に利用できるAPIとして提供されています。
  書影はOpenBD応答に含まれるURLだけを採用し、未収録・取得失敗時はプレースホルダーを
  表示します。Amazon画像やNHK出版サイトの画像は取得しません。
- 2026-10-16に実APIを調査した結果、全国書誌情報の検索ではブックスと別冊は複数件
  見つかる一方、テキストのシリーズ書誌はごく少数でした。同日に生成した現在の
  `books.json` はテキスト2件・ブックス62件・別冊39件の計103件で、OpenBDはISBN
  102件中89件を書誌補完し、書影は0件でした。NDLで提供されていない月刊号を
  推測・合成して増やしません。テキストの少なさを更新ログで警告するため、カタログが
  不完全な場合は追加の適切なオープンデータ提供元が確認されるまで現状のデータを
  維持してください。

参考:

- [NDLサーチAPI仕様](https://ndlsearch.ndl.go.jp/help/api/specifications)
- [NDLサーチAPI提供対象データプロバイダ](https://ndlsearch.ndl.go.jp/help/api/provider)
- [NDLサーチ 著作権・書誌データ利用について](https://ndlsearch.ndl.go.jp/help/sitepolicy)
- [OpenBD API](https://openbd.jp/)
