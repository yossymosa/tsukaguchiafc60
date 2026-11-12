# GAS の更新とデプロイ

このPCでは2026年11月2日に Google 認証を設定済みです。
GitHub / Vercel と GAS は公開処理が別ですが、GAS もコマンドで更新できます。
認証が有効な間はブラウザーでの貼り付けや再ログインは不要です。

- 更新ツール: `scripts/gas-release.mjs`（追加パッケージ不要、Node.js 22以降）
- 既存の認証: ユーザーホームの `.clasprc.json`、キー名 `afc-gas-deploy`
- プロジェクト: `1JgEmvknlGLd2SxSSo01zg9AskoA2jqLpAmjqu5VnUF39A9NQkfcwHMKD`
- 公開先: `index.html` の `GAS_URL` と同じ既存デプロイ。ツール内に固定しています。

このPCの Node.js は次の場所にあります。ランタイム更新で変わった場合は実在する Node.js に読み替えます。

```powershell
$gasNode = 'C:\Users\yossy\AppData\Local\OpenAI\Codex\runtimes\cua_node\5c41f77a7900391c\bin\node.exe'
& $gasNode scripts/gas-release.mjs inspect
```

`inspect` は現在のコード・公開版・デプロイ設定を一時フォルダーへバックアップし、保存先を表示します。
未公開の変更があれば停止するので、保存した両方のコードを確認してください。

そのフォルダーの `before-content.json` を元に、変更したいファイルだけを編集した
`prepared-content.json`（`{"files":[{"name":"…","type":"SERVER_JS","source":"…"},…]}`）を作ります。
既存の全ファイルと `appsscript` の内容を保持します。バックアップにはソースが含まれるため、リポジトリ内には置きません。

オンラインのコードは `コード`・`youtube`・`coach-voice-notes`・`timetree-readonly` とマニフェストに分かれています。
ローカルの `gas-readwrite (5).js` はまとめて検証するためのソースです。
それでオンラインの全ファイルを置き換えると重複や既存処理の欠落が起きるため、差分だけを反映します。

公開する全 `SERVER_JS` を結合して構文と対象機能のテストを確認し、差分をレビューしてから実行します。

```powershell
& $gasNode scripts/gas-release.mjs deploy 'inspectで表示された保存先' '変更内容の説明'
```

ツールは公開直前の変更競合とマニフェストの一致を確認し、コード保存→新バージョン作成→既存デプロイの更新を実行します。
公開コードの一致、稼働応答、管理者用APIへの未認証アクセス拒否も確認します。
失敗時は自分が反映した版だけを元に戻す処理を行い、別の更新を上書きしません。
公開URL・実行ユーザー・アクセス設定の変更や `setup()` の再実行は行いません。

Google 認証はメモリー内で更新し、トークンを出力・GitHubへ保存しません。
認証が失効した場合だけ、既存と同じ `afc-gas-deploy` の Google 認証を再設定します。
以前の clasp インストールは一時フォルダーにあり消える場合がありますが、このツールは clasp の再インストールを必要としません。

2026年11月12日、管理者専用 TimeTree 閲覧を v78 → **v79** として既存URLへ公開しました。
公開コードで全58件のテストを通過し、公開応答と管理者用APIの未認証アクセス拒否も確認済みです。
実際の TimeTree アカウントへの接続は管理者がアプリ内で行います。

API仕様: [Apps Script のデプロイ更新](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/update)、
[Google OAuth のトークン更新](https://developers.google.com/identity/protocols/oauth2/web-server#offline)。
