# 透明麻雀

4枚のうち3枚が **透明牌**（全員から見える）、1枚だけが通常の牌という特殊ルールの4人打ち麻雀です。
相手の手牌の大部分が透けて見えるため、待ちや危険牌の「読み合い」が勝負の鍵になります。

- **CPU対戦** … ブラウザだけで遊べます（オフライン可・PWA対応）
- **オンライン対戦** … 1人が「ルームを作る」で6文字のコードを発行し、他の人が「コードで参加」で入力すると同じ卓で対戦できます。空席はCPUが入ります。

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
| `src/net/online.ts` | PeerJS(WebRTC) によるルーム作成／コード参加 |
| `src/ui/` | 卓画面・牌の SVG 描画・スタイル |
| `docs/PLAN.md` | アプリ化までのロードマップ |

オンライン対戦はルームを作った端末がホスト（ゲーム進行の権威）となり、参加者には「その人に見えてよい情報」だけを送ります（他家の不透明牌は送信しません）。

### シグナリングサーバーの変更

既定では PeerJS の公開シグナリングサーバーを使います。自前のサーバーを使う場合はビルド時に環境変数を指定します。

```bash
VITE_PEER_HOST=peer.example.com VITE_PEER_PORT=443 VITE_PEER_PATH=/ npm run build
```

## デプロイ

既定ブランチ（`gemunao` または `main`）へ push すると GitHub Actions（`.github/workflows/deploy.yml`）でテスト・ビルドし、GitHub Pages に公開します。
リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください。
