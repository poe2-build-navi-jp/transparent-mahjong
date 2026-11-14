# 透明麻雀 対戦サーバー（Cloudflare Workers + Durable Objects）

オンライン対戦のゲーム進行をサーバー側で行います。1ルーム = 1 Durable Object です。

- ルームを作った人がアプリを閉じても対局は続きます（抜けた席は CPU が代打ち）
- 同じ端末から再接続すると元の席に戻れます
- 各プレイヤーには、その人に見えてよい情報だけを送ります
- ゲームのルール部分はクライアントと同じコード（`../src/engine`）を使います

## 初回セットアップ（1回だけ）

1. https://dash.cloudflare.com/sign-up で Cloudflare アカウントを作る（無料プランで動きます）
2. ダッシュボード右上のメニュー → 「My Profile」→「API Tokens」→「Create Token」→ テンプレート **Edit Cloudflare Workers** でトークンを作る
3. ダッシュボードの「Workers & Pages」画面に表示される **Account ID** を控える
4. GitHub のリポジトリ → Settings → Secrets and variables → Actions で次を登録
   - Secrets: `CLOUDFLARE_API_TOKEN`（手順2のトークン）、`CLOUDFLARE_ACCOUNT_ID`（手順3）
5. Actions タブ → 「Deploy game server (Cloudflare)」→「Run workflow」で初回デプロイ
6. 表示された URL（`https://transparent-mahjong.<アカウント名>.workers.dev`）を、同じ画面の **Variables** に `SERVER_URL` として登録
7. Actions タブ → 「Deploy to GitHub Pages」→「Run workflow」でWeb版を作り直すと、オンライン対戦がサーバー経由になります

`SERVER_URL` が未設定の間は、オンライン対戦は従来の P2P 方式で動きます。

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
