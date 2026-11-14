# 透明麻雀

4枚のうち3枚が **透明牌**（全員から見える）、1枚だけが通常の牌という特殊ルールの4人打ち麻雀です。
相手の手牌の大部分が透けて見えるため、待ちや危険牌の「読み合い」が勝負の鍵になります。

- **CPU対戦** … ブラウザだけで遊べます（オフライン可・PWA対応）
- **オンライン対戦** … 1人が「ルームを作る」で6文字のコードを発行し、他の人が「コードで参加」で入力すると同じ卓で対戦できます。空席はCPUが入ります。

- **四人麻雀 / 三人麻雀** を選べます（三麻は萬子2〜8なし・チーなし・北抜きドラ・ツモ損）
- BGM と発声ボイス（リーチ・ポン・チー・カン・ロン・ツモ）つき。タイトル画面・卓画面でON/OFFできます

## クレジット

- 音声素材：あみたろの声素材工房（https://amitaro.net/）
  - `public/voice/` の音声は上記サイトの素材です。[ご利用規約](https://amitaro.net/voice/voice_rule/) に従い、ゲームへの同梱目的で収録しています。音声素材そのものが必要な場合は配布元からダウンロードしてください。
- BGM・効果音：外部素材を使わず、`src/ui/audio.ts` 内で WebAudio により合成しているオリジナル曲です
- 牌デザイン：オリジナル（SVG）
- フォント：M PLUS Rounded 1c / Noto Serif JP（SIL Open Font License、`@fontsource` 経由で同梱。`node scripts/build-fonts.mjs` で `src/ui/fonts.css` を再生成）

## 遊び方（開発環境）

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 役・点数計算と CPU 自動対局のテスト
npm run build    # dist/ に静的ファイルを出力
```

## 構成

| パス | 内容 |
| --- | --- |
| `src/engine/tiles.ts` | 牌の定義（ID の下位2bitが0の牌＝不透明牌） |
| `src/engine/shanten.ts` | 向聴数・待ち計算 |
| `src/engine/agari.ts` | 和了判定・役・符・点数計算 |
| `src/engine/game.ts` | 対局の状態遷移（配牌〜鳴き〜和了/流局〜終局）と、席ごとに見せる情報の生成 |
| `src/engine/ai.ts` | CPU の思考（透明牌の情報を使った残り枚数・危険度評価） |
| `src/net/host.ts` | 権威ホスト。CPU の手番・持ち時間・切断時の代打ちを管理 |
| `src/net/online.ts` | PeerJS(WebRTC) によるルーム作成／コード参加（サーバー未設定時） |
| `src/net/wsroom.ts` | 対戦サーバーへの WebSocket 接続（自動再接続・復帰） |
| `src/net/names.ts` | プレイヤー名の不適切語フィルター |
| `server/` | 対戦サーバー（Cloudflare Workers + Durable Objects） |
| `public/privacy.html` | プライバシーポリシー |
| `src/ui/` | 卓画面・牌の SVG 描画・スタイル |
| `docs/PLAN.md` | アプリ化までのロードマップ |

オンライン対戦はルームを作った端末がホスト（ゲーム進行の権威）となり、参加者には「その人に見えてよい情報」だけを送ります（他家の不透明牌は送信しません）。

### 対戦サーバー（推奨）

`server/` に Cloudflare Workers 用の対戦サーバーがあります。サーバーがゲームを進行するので、ルームを作った人が抜けても対局が続き、アプリを閉じても「対局に復帰」で戻れます。
現在は Cloudflare Workers で画面とサーバーを同じ URL で公開しています（リポジトリ直下の `wrangler.toml`）。セットアップ手順は [server/README.md](server/README.md) を参照してください。リポジトリの Actions 変数 `SERVER_URL` を設定するとWeb版がサーバー経由になり、未設定なら下の P2P 方式で動きます。

### シグナリングサーバーの変更（P2P 方式）

既定では PeerJS の公開シグナリングサーバーを使います。自前のサーバーを使う場合はビルド時に環境変数を指定します。

```bash
VITE_PEER_HOST=peer.example.com VITE_PEER_PORT=443 VITE_PEER_PATH=/ npm run build
```

## デプロイ

既定ブランチ（`gemunao` または `main`）へ push すると GitHub Actions（`.github/workflows/deploy.yml`）でテスト・ビルドし、GitHub Pages に公開します。
リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください。
