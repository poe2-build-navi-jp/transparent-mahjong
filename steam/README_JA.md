# 透明麻雀 Steam 版 公開手順

PC版（Windows / macOS / Linux）を Steam で販売するための手順と材料です。

## 中身

| パス | 内容 |
| --- | --- |
| `desktop/` | PC版アプリ（Electron）。画面は Web 版と同じコード。Steamworks（steamworks.js）で実績・クラウド保存・購入確認 |
| `steam/assets/` | ストア・ライブラリ用画像（日本語版と `_en` 英語版）、実績アイコン、スクリーンショット（1920×1080） |
| `steam/STORE_TEXT.md` | ストアページの説明文（日本語・英語）、システム要件、ストア設定のメモ |
| `steam/achievements.csv` | Steamworks に登録する実績17件（API名・名前・説明・アイコン） |
| `steam/steampipe/` | SteamPipe（steamcmd）でアップロードするための設定のひな形 |
| `steam/make-assets.cjs` | 画像を作り直すスクリプト（`npx vite --port 5199` を起動してから `node steam/make-assets.cjs`） |
| `.github/workflows/desktop.yml` | Windows / macOS / Linux 版を GitHub Actions でビルドする |

## Steam 版の仕様

- **販売方法**: 買い切り。オンライン対戦は無制限・広告なし（スマホ版の月額課金・広告は Steam 版にはない）
- **購入者の確認**: 起動時に Steam の認証チケット（Web API 用、identity = `transparent-mahjong`）を対戦サーバーへ送り、サーバーが Steam Web API（`AuthenticateUserTicket` と `CheckAppOwnership`）で購入済みか確認する。確認できた端末は30日間オンライン無制限
- **実績**: 17件。ゲーム内でも解除状況が見られ、Steam にも反映（オフライン中に解除した分は次回起動時に反映）
- **Steam クラウド**: 戦績・実績を `records.json` として保存。別のPCでも引き継げる
- **言語**: Steam の言語設定が日本語なら日本語、それ以外は英語で起動（設定・タイトル画面で変更可）
- **操作**: マウス、キーボード（← → Enter、Q/W/E/R/F/S、Tab=手牌ビュー、F11=全画面）、ゲームパッド
- **Steam オーバーレイ**: Shift+Tab

## 1. Steamworks の準備（オーナー作業）

1. https://partner.steamgames.com/ で Steamworks に登録し、アプリ登録料（Steam Direct、1タイトル $100）を支払う
2. アプリ（ゲーム）を作成し **App ID** を控える
3. デポを3つ作る（Windows / macOS / Linux）。それぞれの **Depot ID** を控える
4. 「ユーザーと権限」→ **Web API キー（パブリッシャー用）** を作成する

## 2. 対戦サーバーの設定（Cloudflare、オーナー作業）

Cloudflare の Worker `transparent-mahjong-web` に次を登録します（ダッシュボードの Settings → Variables and Secrets）。

| 名前 | 種類 | 値 |
| --- | --- | --- |
| `STEAM_APP_ID` | 変数（Text） | 手順1の App ID |
| `STEAM_WEB_API_KEY` | シークレット | 手順1のパブリッシャー Web API キー |

またはリポジトリ直下の `wrangler.toml` の `STEAM_APP_ID` に App ID を書いてマージし、キーだけ `npx wrangler secret put STEAM_WEB_API_KEY` で登録します。

## 3. PC版をビルドする

**GitHub Actions（おすすめ）**: Actions タブ →「Build desktop (Steam)」→「Run workflow」。完了すると、Windows / macOS / Linux それぞれのフォルダが成果物（Artifacts）としてダウンロードできます。

手元でビルドする場合:

```bash
npm ci
cd desktop
npm ci
npm run dist:win     # Windows（Windows上で実行）
npm run dist:mac     # macOS（Mac上で実行）
npm run dist:linux   # Linux
# 出力: desktop/release/win-unpacked, mac-universal, linux-unpacked
```

Steam なしで動作確認する場合は `npm start`。Steam につないで試す場合は、実行ファイルと同じフォルダに App ID を1行書いた `steam_appid.txt` を置くか、環境変数 `STEAM_APP_ID` を設定して起動します（**`steam_appid.txt` は Steam にアップロードする版には入れないこと**）。

## 4. Steamworks の各設定

- **起動オプション**
  - Windows: `TransparentMahjong.exe`
  - macOS: `TransparentMahjong.app`
  - Linux: `TransparentMahjong`
- **実績**: `steam/achievements.csv` の17件を登録（API名は大文字のまま一致させる）。アイコンは `steam/assets/achievements/`（解除・未解除の2種、256×256。Steam が縮小する）
- **Steam クラウド**: 「Steam Cloud の設定」でバイト数の上限（例 1MB）・ファイル数（例 10）を設定して有効にする（ゲーム側は `records.json` を読み書きする）
- **グラフィックアセット**: `steam/assets/` の画像をそれぞれの枠へ（ファイル名 = 枠の名前。英語版ストア用は `_en`）
  - ヘッダーカプセル 920×430、小カプセル 462×174、メインカプセル 1232×706、縦カプセル 748×896
  - ライブラリカプセル 600×900、ライブラリヒーロー 3840×1240、ライブラリロゴ 1280×720（透過）、ページ背景 1438×810
  - コミュニティアイコン 184×184、クライアントアイコン 32×32
- **スクリーンショット**: `steam/assets/screenshots/`（日本語・英語 各5枚）
- **ストアページ**: `steam/STORE_TEXT.md` の文章を貼る
- **コンテンツ調査**: ギャンブルの描写は「シミュレート（実際のお金は使わない）」
- **プライバシーポリシー URL**: https://transparent-mahjong-web.alones-aqua.workers.dev/privacy-en （日本語: /privacy）

## 5. アップロード（SteamPipe）

1. Steamworks SDK の `tools/ContentBuilder` を使う（steamcmd）
2. `steam/steampipe/*.vdf` の `YOUR_APP_ID` / `YOUR_*_DEPOT_ID` を書き換える
3. 3で作った `win-unpacked` / `mac-universal` / `linux-unpacked` を `desktop/release/` に置く（Actions の成果物を解凍）
4. `steamcmd +login <ビルド用アカウント> +run_app_build <絶対パス>/steam/steampipe/app_build.vdf +quit`
5. Steamworks の「ビルド」でブランチ `default` に設定する

## 6. 公開前チェック

- [ ] Windows / macOS / Linux それぞれで起動し、Steam オーバーレイ（Shift+Tab）が出る
- [ ] 実績が Steam 側で解除される（「はじめの一局」など）
- [ ] 2台（別アカウント）でルーム作成→参加→対局。タイトル画面に「プレミアム会員：オンライン対戦 無制限」と出る（購入確認ができている）
- [ ] Steam Deck で起動・タッチ操作・ゲームパッド操作
- [ ] Steam クラウド: 別のPCで戦績が引き継がれる
- [ ] 日本語・英語の切り替え
- [ ] macOS 版の公証（notarize）: Steam 経由の配布でも、Gatekeeper の警告を避けるには Apple Developer ID での署名と公証が必要（Apple Developer Program 年$99）。未対応のままでも起動はできるが、初回に警告が出る

## 未確認・注意

- この環境では Linux 版のビルドと起動（Steam なし）までを確認。Windows / macOS のビルドと、Steam と接続した状態（実績・クラウド・購入確認・オーバーレイ）は未確認
- Steam の購入確認（サーバー側）は Steam Web API の仕様に沿って実装したが、実際の App ID・キーでは未確認
- 音声素材（あみたろの声素材工房）は有料ゲームでもクレジット表記で利用可能。公開後に配布元へ事後報告が必要
