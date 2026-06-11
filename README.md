# A勤 業務チェックリスト Web版

DHP 訪問介護サービス（ルネッサンス・パシフィック）の「A勤 業務チェックリスト（時系列・全129項目）」を
Web化したアプリです。スタッフが当日の業務をチェックして**完了サイン（用紙の写真）をアップロードして提出**し、
**上司が内容を確認して承認 / 差し戻し**する承認フローを備えています。

**Vercel（サーバーレス）+ Postgres + Vercel Blob** で動作するよう構成しています。

## 主な機能

- **チェックリスト入力（スタッフ）**：フェーズ1〜6・全129項目を時系列表示、区分の色分け
  （オレンジ＝排泄／緑＝昼食準備／無印＝対応）、実施日・担当者・人員、各項目メモ、進捗バー、デイ送迎表
- **完了サインの提出**：サイン済み用紙を撮影してアップロード（自動で縮小してから送信）
- **承認（上司）**：承認待ち／承認済み／差し戻しで絞り込み、内容とサイン写真を確認して承認・差し戻し
- **簡易ログイン**：名前選択＋パスワード。役割（スタッフ／上司）で画面が切り替わります

## 技術構成

- Node.js + Express（Vercel サーバーレス関数として動作。`api/index.js` がエントリ）
- データベース：**Postgres**（`pg`。Vercel Postgres / Neon と互換）
- サイン写真：**Vercel Blob**（`BLOB_READ_WRITE_TOKEN` がある場合）。無い場合はローカルの `uploads/` に保存
- 認証：ステートレスな署名Cookie（`cookie-session`）＋パスワードハッシュ（`bcryptjs`）
- フロントエンド：静的HTML/CSS/JS（ビルド不要）

## Vercel へのデプロイ手順

1. **このリポジトリを Vercel にインポート**（Add New → Project）。
2. **データベース（Postgres）を追加**
   - Vercel のプロジェクト → **Storage** タブ → **Create Database** → **Postgres（Neon）** を作成し、
     プロジェクトに接続。これで `POSTGRES_URL` 等の環境変数が自動で設定されます。
3. **画像保存（Blob）を追加**
   - 同じく **Storage** タブ → **Create** → **Blob** を作成し接続。`BLOB_READ_WRITE_TOKEN` が自動設定されます。
4. **環境変数を追加**（Settings → Environment Variables）
   - `SESSION_SECRET`：ログインCookieの署名鍵（ランダムな長い文字列）。**必須**
   - `ADMIN_PASSWORD`（任意）：上司アカウントの初期パスワード（未設定なら `admin1234`）
5. **Deploy**。初回アクセス時にテーブル作成と初期ユーザー投入が自動で行われます。

> 初回アクセスでテーブル作成・初期ユーザー作成が走るため、最初の表示は数秒かかることがあります。

### 初期ユーザー

| 名前           | 役割     | 初期パスワード               |
| -------------- | -------- | ---------------------------- |
| 上司（管理者） | 上司     | `admin1234`（`ADMIN_PASSWORD` で変更可） |
| スタッフA      | スタッフ | `staff1234`                  |
| スタッフB      | スタッフ | `staff1234`                  |

> ⚠️ 初回ログイン後、ヘッダーの「パスワード変更」から必ず変更してください。
> ユーザー構成を変えたい場合は環境変数 `SEED_USERS` に JSON で指定できます（DBが空のときのみ反映）：
> `SEED_USERS=[{"name":"山田","role":"admin","password":"xxxx"},{"name":"佐藤","role":"staff","password":"yyyy"}]`

## ローカルでの実行

ローカル開発には Postgres が必要です（`BLOB_READ_WRITE_TOKEN` を設定しなければ画像は `uploads/` に保存されます）。

```bash
npm install
export POSTGRES_URL="postgresql://user:pass@localhost:5432/gyomu"
export SESSION_SECRET="任意の文字列"
npm start          # http://localhost:3000
```

## 環境変数一覧

| 変数                   | 説明                                                   | 必須 |
| ---------------------- | ------------------------------------------------------ | ---- |
| `POSTGRES_URL`         | Postgres 接続文字列（Vercel Postgres で自動設定）      | ○    |
| `BLOB_READ_WRITE_TOKEN`| Vercel Blob のトークン（Blob 連携で自動設定）          | ○(本番) |
| `SESSION_SECRET`       | ログインCookieの署名鍵                                 | ○    |
| `ADMIN_PASSWORD`       | 上司の初期パスワード（既定 `admin1234`）               | -    |
| `SEED_USERS`           | 初期ユーザーをJSONで指定（DBが空のときのみ）           | -    |

## チェックリストの改訂

業務内容が変わった場合は `data/checklist.json` を編集して再デプロイすると反映されます
（フェーズ・小見出し・項目No・区分・部屋・氏名・作業内容・注意点を保持）。
