# 透明麻雀 対戦サーバー（Cloudflare Workers + Durable Objects）

オンライン対戦のゲーム進行をサーバー側で行います。1ルーム = 1 Durable Object です。

- ルームを作った人がアプリを閉じても対局は続きます（抜けた席は CPU が代打ち）
- 同じ端末から再接続すると元の席に戻れます
- 各プレイヤーには、その人に見えてよい情報だけを送ります
- ゲームのルール部分はクライアントと同じコード（`../src/engine`）を使います

## 無料枠・プレミアム・乱用対策

| 設定（`wrangler.toml` の `[vars]`） | 内容 |
| --- | --- |
| `FREE_GAMES_PER_DAY` | 1日あたりの無料オンライン対局数（日本時間0時に回復）。`"0"` で制限なし |
| `ROOMS_PER_MINUTE` | 1つの接続元が1分間に作れるルーム数 |
| `PREMIUM_ENTITLEMENT` | プレミアム判定に使う RevenueCat の entitlement ID |
| `ALLOWED_ORIGINS` | 接続を許可するオリジン（空なら全て許可） |

- 無料対局の回数は、対局開始時に参加している人間プレイヤー全員分を1回ずつ数えます（東風戦・半荘戦とも1回）。
- プレミアム会員かどうかは、端末の接続用IDを使って RevenueCat に問い合わせます。
  シークレットキーは `npx wrangler secret put REVENUECAT_API_KEY`（またはダッシュボードの Variables and Secrets）で登録してください。未登録の間は全員が無料枠扱いです。
- アプリ版がまだない間に無料枠を止めたい場合は、`FREE_GAMES_PER_DAY = "0"` にしてください。

## サーバー代の節約

- WebSocket Hibernation API を使い、操作がない間は Durable Object を休止させます。
- CPU の手番や時間切れは setTimeout ではなくアラームで起こし、状態はストレージに保存します。
- 人間が全員切断したルームは対局を止め、10分後に片付けます。ルームは最長6時間で破棄します。
- 対局中は数秒おきに操作があるため休止する時間は短く、節約が大きいのはロビーでの待ち時間や放置されたルームです。

## 公開方法 A: Cloudflare ダッシュボードからリポジトリをインポート（推奨・トークン不要）

リポジトリ直下の `wrangler.toml` により、**画面（dist）と対戦サーバーを同じ URL で公開**します。

1. Cloudflare → Workers & Pages → 作成 → リポジトリをインポート → このリポジトリを選ぶ
2. ルートディレクトリはリポジトリ直下のまま、ビルドコマンド `npm run build`、デプロイコマンド `npx wrangler deploy`
3. `gemunao` に push するたびに自動で公開される

画面は起動時に同じ場所の `/api/health` を確かめ、サーバーがあれば自動でサーバー経由の対戦になります（設定不要）。
GitHub Pages 版も同じサーバーにつなぎたい場合は、リポジトリの Actions 変数 `SERVER_URL` に Worker の URL を登録してください。

## 公開方法 B: GitHub Actions からサーバーだけを公開（トークン必要）

1. https://dash.cloudflare.com/sign-up で Cloudflare アカウントを作る（無料プランで動きます）
2. ダッシュボード右上のメニュー → 「My Profile」→「API Tokens」→「Create Token」→ テンプレート **Edit Cloudflare Workers** でトークンを作る
3. ダッシュボードの「Workers & Pages」画面に表示される **Account ID** を控える
4. GitHub のリポジトリ → Settings → Secrets and variables → Actions で次を登録
   - Secrets: `CLOUDFLARE_API_TOKEN`（手順2のトークン）、`CLOUDFLARE_ACCOUNT_ID`（手順3）
5. Actions タブ → 「Deploy game server (Cloudflare)」→「Run workflow」で初回デプロイ
6. 表示された URL（`https://transparent-mahjong.<アカウント名>.workers.dev`）を、同じ画面の **Variables** に `SERVER_URL` として登録
7. Actions タブ → 「Deploy to GitHub Pages」→「Run workflow」でWeb版を作り直すと、オンライン対戦がサーバー経由になります

`SERVER_URL` が未設定で、同じ場所にサーバーもない場合、オンライン対戦は従来の P2P 方式で動きます。

## 接続元の制限（任意）

`wrangler.toml` の `ALLOWED_ORIGINS` に、接続を許可するオリジンをカンマ区切りで書けます。
アプリ化したときは Capacitor のオリジン（iOS: `capacitor://localhost`、Android: `https://localhost`）も加えてください。

## ローカルで動かす

```bash
cd server
npm install
npx wrangler dev --port 8787          # サーバー
# 別ターミナルで（リポジトリ直下）
VITE_SERVER_URL=http://127.0.0.1:8787 npm run dev
```

## 料金の目安

Workers・Durable Objects とも無料枠があります（2026年時点。最新は Cloudflare の料金ページを確認してください）。
友人同士で遊ぶ規模なら無料枠に収まる見込みです。利用者が増えたら Workers の有料プラン（月額$5〜）を検討してください。
