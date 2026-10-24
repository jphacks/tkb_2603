# キーなしで使うための中継と公開手順

Issue #4。Cloudflare WorkersとSQLite Durable Objectで分類を中継する。公開URLと使用モデルを設定済み。公開反映と実際の共有キーでの動作確認は公開担当者の操作後に行う。

## 公開準備の状況

2026-10-24に `https://hitoiki-proxy.gaku-fujio.workers.dev/health` が200で `{"ok":true,"enabled":false}` を返すことを確認した。Workerの公開・共有キーの登録は公開担当者が実施済み。拡張の接続先は `.env.example` に記載し、ローカルの `.env` に設定してビルドする。

2026-10-25に使用モデルを `claude-haiku-5-5` と確定した。ユーザーの指示により、金額の予算上限は当面設けず、乱用防止の回数制限は維持する。`proxy/wrangler.jsonc` はモデル指定と `CLASSIFICATION_ENABLED: "true"` に更新済みで、次のdeployから有効になる。共有キーでの分類・実サイトの動作確認を終えてからZIPを配布する。

## 公開設定と保護

- `proxy/wrangler.jsonc` の `CLASSIFICATION_ENABLED` は `true`、`ANTHROPIC_MODEL` は `claude-haiku-5-5`。deployすると、同意した利用者の分類を受け付ける。停止するときは `CLASSIFICATION_ENABLED` を `false` にしてdeployする。
- 回数上限は、1インストールにつき1分6回・UTC日100回、全体で1分30回・UTC日1000回。金額の予算上限とは独立し、費用上限の保証ではない。運用に合わせて変更する。
- 利用者の匿名IDは認証ではない。作り直されることを前提に、すべてのIDで単一のDurable Objectの全体枠を共有する。
- 枠は上流APIを呼ぶ前に原子的に予約し、上流の失敗でも消費する。UTC日・分の境界で復帰する。期限の切れたID別カウンターは削除する。
- 中継に保存するのは匿名IDのカウンターだけ。会話本文・作業名・APIキーはSQLに保存せず、ログ出力もしない。Workersのobservabilityとinvocation logsも無効にする。
- 初回は外部送信に同意するまでローカル計測のみ。設定で取り消せる。既存の個人キーは維持して直接接続に移行するが、新しい説明への同意が必要。

## 1. 公開担当者の準備

Cloudflareへの登録とメール確認を済ませる。Anthropic側の担当者から専用キーを受け取り、使用するモデルの正確なAPI IDと利用上限の方針を確認する。現在はユーザー指定で金額上限を設けない。キーをチャット・Issue・コード・WXT_/VITE_の環境変数へ貼り付けない。

## 2. Workerを停止状態で作成する

リポジトリのPowerShellで実行する。

```powershell
Set-Location C:\Users\gaku1\dev\tkb_2603\proxy
npm ci
npx wrangler login
```

ブラウザでCloudflareにログインして権限を許可する。新しい環境で停止状態から準備する場合は、`proxy/wrangler.jsonc`の `CLASSIFICATION_ENABLED` を一度 `false` に変更してから公開する。

```powershell
npm run deploy
```

表示される `https://hitoiki-proxy.<自分のサブドメイン>.workers.dev` を控える。`/health` を開くと `{"ok":true,"enabled":false}` になる。停止中は会話を送っても分類しない。

## 3. 共有キーを登録する

`proxy/`で次のコマンドを実行する。

```powershell
npx wrangler secret put ANTHROPIC_API_KEY
```

対話式の入力欄にキーを貼り付け、Enterで登録する。コマンド引数やファイルへキーの値を書かない。Cloudflareの画面からは、Worker → Settings → Variables and Secrets → Add → 種類Secret、名前 `ANTHROPIC_API_KEY` でも登録できる。Secretの登録は新しいバージョンの公開を伴い、その時点の公開設定を維持する。

## 4. モデル・上限を確定して分類を有効にする

担当者がモデルと利用上限の方針を確認した後に、`proxy/wrangler.jsonc`の公開設定を変更する。現在の確定値は上の「公開設定と保護」を参照。

| 変数 | 設定内容 |
| --- | --- |
| `ANTHROPIC_MODEL` | 確認できたモデルの正確なAPI ID。構造化出力への対応を確認する |
| `INSTALL_DAILY_LIMIT` / `INSTALL_MINUTE_LIMIT` | 1インストールのUTC日・分の上限 |
| `GLOBAL_DAILY_LIMIT` / `GLOBAL_MINUTE_LIMIT` | 全体のUTC日・分の上限 |
| `CLASSIFICATION_ENABLED` | 確認後に `true` |

モデル・出力上限1024トークン・指示文・JSON Schemaはサーバー側で固定。リクエストは本文2つと直前の作業名のみ受け付け、追加のモデル指定などは拒否する。本文はリクエスト全体64KiB、分類に使う量はユーザー4000字・回答8000字・作業名300字を基本に切り詰める。

```powershell
npm run deploy
```

ダッシュボードだけで公開変数を変更すると、後のdeployでファイルの値に戻るため、運用設定はファイルにも反映する。止めるときは `CLASSIFICATION_ENABLED` を `false` に戻してdeployする。

## 5. 拡張へ公開URLを設定してビルドする

リポジトリのルートで、実際のWorkerのURLを設定する。下のサブドメイン部分は置き換える。

```powershell
Set-Location C:\Users\gaku1\dev\tkb_2603
$env:WXT_PROXY_URL = 'https://hitoiki-proxy.<自分のサブドメイン>.workers.dev'
npm run build
```

URLはHTTPSのルートURLのみ。パス・ユーザー名・パスワード・クエリ文字列を含めない。WXTが公開URLをコードに埋め込み、同じoriginへのhost permissionをmanifestに追加する。キーを公開する仕組みではない。`.env.example`を参考に、ローカルの`.env`へURLだけを設定する方法もある。

URL未設定なら中継へ送信せず、ローカル計測と同意済みの個人キー方式を利用できる。開発時だけ `http://localhost` / `http://127.0.0.1` を許可する。

## 6. 実機確認と配布

1. Chromeで拡張を更新し、AIチャットのタブを再読み込みする。新規プロファイルなど個人キーのない状態でも確認する。
2. 初回説明で「ローカル計測だけ使う」を選び、分類APIへ本文を送らずに読む量・作業時間などが動くことを確認する。
3. 設定で「キーなしで使う」を選び、本文の送信に同意する。「接続を確認する」が成功することを確認する。
4. ChatGPT・Claude・Geminiで各1往復し、「診断」の分類OKと運動・休憩の操作を確認する。
5. 同意を取り消して以後は送信しないことを確認する。共有サービス停止時や429でも、読む量・作業時間の計測が継続することを確認する。
6. 個人キー方式を選んだ場合だけ、保存された自分のキーで直接呼び出せることを確認する。接続方式を切り替えると再同意が必要。

公開URLを設定した同じPowerShellで次を実行する。

```powershell
npm run zip
```

`.output/`のChrome用ZIPを配布する。受け取った人はZIPを展開し、`chrome://extensions`でデベロッパーモードを有効にして、manifest.jsonのあるフォルダを「パッケージ化されていない拡張機能を読み込む」から選ぶ。

公開URLなし・HTTP・テンプレートのURLではZIP作成を止める。配布前にZIP内へ `.env` / `.dev.vars` / `proxy/` / 実際の共有キーが混ざっていないことを確認する。公開URL確定前のビルドは配布版ではない。

## この段階の確認結果

- 拡張: 10ファイル・75件のテストと型チェック、Chrome用ビルド成功。
- 中継: 12件のテスト、型チェック、Wranglerのドライラン成功。
- ローカルのWorkerとSQLite Durable ObjectをHTTP経由で呼び、端末ごと・全体の枠と同時予約を確認。
- Chromeの確認用画面（1440pxライト／390pxダーク）で、初回説明・ローカルのみ・同意・取消・接続方式の切替を確認。
- 本番の共有キーと公開URLを使った実サイト確認・最終配布ZIPの作成は、公開担当者の設定後に行う。

## 開発・検証

拡張と中継の依存・型チェック・テストを分離している。

```powershell
# ルート
npm test
npm run compile
npm run build
# proxy/
npm test
npm run check
npm run build  # dry-run。公開しない
```

実際のローカルWorkerとSQLite Durable ObjectによるHTTP検証は、`proxy/`で `npm run dev:test` を起動し、別のターミナルの同じフォルダで `node test/http-check.mjs` を実行する。Anthropicへは接続しない。このHTTP検証をやり直すときは、日次のカウンターが残るため、新しい `--persist-to` の場所で起動する。

公式資料: [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Durable Objects](https://developers.cloudflare.com/durable-objects/get-started/)、[SQLite transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[構造化出力](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)、[WXT環境変数](https://wxt.dev/guide/essentials/config/environment-variables.html)、[AnthropicのAPI保存期間](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)。

モデルIDと構造化出力の互換性は [Haiku 5.5移行ガイド](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide) と上の構造化出力の資料で確認した。
