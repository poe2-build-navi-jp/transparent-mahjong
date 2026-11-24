// 長い説明文（キーで呼び出す）。日本語と英語の両方をここに置く

export const LONG_JA: Record<string, string> = {
  PREMIUM_INTRO: `透明麻雀のオンライン対戦は、対局を進めるサーバーを運営者が費用を負担して動かしています。
      遊ぶ人が増えるほどサーバー代がかかるため、<b>利用者の増加に合わせてサーバーを拡大していきます</b>。
      その運営費として、プレミアム会員（月額800円）をご用意しました。`,
  SUBSCRIPTION_TERMS: `サブスクリプションは、期間終了の24時間前までに解約しない限り自動で更新されます。
      解約・更新の確認は App Store / Google Play のサブスクリプション設定から行えます。
      料金はご利用のストアのアカウントに請求されます。`,
  TUT1: `<p>透明麻雀では、同じ牌が4枚ずつあるうち<b>3枚が透明牌</b>、<b>1枚だけが普通の牌（不透明牌）</b>です。</p>
        <p>左がガラスのような透明牌、右が不透明牌です。</p>`,
  TUT2: `<p>透明牌は、相手の手牌にあっても<b>全員から見えます</b>。見えないのは不透明牌（オレンジの裏面）だけです。</p>
        <p>相手が何を集めているか、何を待っているかを読み合うのがこのゲームの醍醐味です。</p>`,
  TUT3: `<p>あなたの透明牌も相手から丸見えです。<b>不透明牌をどこで使うか</b>が勝負の分かれ目。</p>
        <p>ポン・チー・カンでは自動で透明牌から晒すので、不透明牌は手元に残ります。</p>
        <p>待ち牌を不透明牌にしておけば、相手は読みにくくなります。</p>`,
  TUT4: `<p><b>牌をクリック</b>すると捨てます（スマホは1回目で選び、2回目で捨てる）。<b>ドラッグ</b>で手牌を並べ替えられます。</p>
        <p>キーボードは <b>← →</b> で選んで <b>Enter</b> で捨てます。<b>Q</b>=ロン/ツモ、<b>W</b>=リーチ、<b>E</b>=ポン、<b>R</b>=チー、<b>F</b>=カン、<b>S</b>=スキップ。</p>
        <p>ゲームパッドにも対応しています（設定画面に一覧があります）。</p>`,
  TUT5: `<p>右上の<b>「手牌ビュー」</b>（または <b>Tab</b> キー、相手の手牌をクリック）で、相手の見えている牌を大きく並べて確認できます。</p>
        <p>自分の手牌に付く<b>黄色い点</b>は「切るとテンパイ」の牌。待ち牌の下の数字は、見えていない残り枚数です。</p>
        <p>まずはCPU対戦で慣れてから、ルームを作って友達と対戦してみましょう。</p>`,
  RULES_HTML: `<h2>透明麻雀のルール</h2>
      <p>136枚の牌のうち、<b>各種4枚中3枚が「透明牌」</b>、残り1枚だけが通常の不透明な牌です。</p>
      <ul>
        <li>透明牌は手牌にあっても<b>全員から見えます</b>。不透明牌だけが相手から隠れます。</li>
        <li>他家の手牌の大部分が見えるので、危険牌・待ちの読み合いが勝負の鍵になります。</li>
        <li>鳴くときは自動的に透明牌から晒すので、不透明牌を手元に残して待ちを隠せます。</li>
        <li>相手から見えている牌は、残り枚数の表示にも反映されます。</li>
        <li>手牌は自動で並びません（理牌なし）。牌をドラッグして好きな順番に並べ替えられます。卓画面右上の「自動理牌」をオンにすると自動で並びます。</li>
        <li>「手牌ビュー」（Tabキー）で、相手の見えている牌を大きく表示できます。</li>
      </ul>
      <h3>基本ルール</h3>
      <ul>
        <li>四人麻雀（標準25,000点持ち）／三人麻雀（標準35,000点持ち）、東風戦／半荘戦を選択。</li>
        <li>一般的なリーチ麻雀の役と点数計算（後付けあり）。</li>
        <li>持ち点・考慮時間・持ち時間・赤ドラ・喰いタン・トビは、ルームを作った人が対局前に変更できます（CPU対戦はタイトル画面の「詳細ルール設定」）。</li>
        <li>考慮時間は1手ごとにリセットされ、超えた分は持ち時間から減ります。両方使い切ると自動でツモ切り（鳴きはスキップ）になります。</li>
        <li>ダブロンなし（頭ハネ）、途中流局なし、トビ終了あり。</li>
        <li>フリテン（捨て牌・同巡・立直後見逃し）あり。</li>
      </ul>
      <h3>三人麻雀</h3>
      <ul>
        <li>萬子の2〜8を使いません（108枚）。チーはできません。</li>
        <li>北は「北抜き」で抜きドラにできます（1枚につき1翻）。</li>
        <li>ツモ和了はツモ損（いない1人分は加算されません）。ノーテン罰符は場に2,000点。</li>
      </ul>
      <h3>オンライン対戦</h3>
      <ul>
        <li>「ルームを作る」で6文字のコードが発行されます。友達にコードを共有してください。</li>
        <li>「コードで参加」でコードを入力すると同じ卓に入れます。空いた席はCPUが入ります。</li>
        <li>ルームを作った人が抜けても対局は続きます。アプリを閉じてしまっても、タイトル画面の「対局に復帰」から戻れます。</li>
        <li>プレイヤー名は他の人に表示されます。不適切な語を含む名前は自動で置き換えられます。</li>
        <li>通信が切れた席はCPUが代打ちし、再接続すると復帰します。</li>
      </ul>
      <h3>クレジット</h3>
      <ul>
        <li>音声素材：<a href="https://amitaro.net/" target="_blank" rel="noopener" style="color:var(--gold)">あみたろの声素材工房（https://amitaro.net/）</a></li>
        <li>BGM・効果音・牌デザイン：オリジナル</li>
        <li>フォント：M PLUS Rounded 1c / Noto Serif JP（SIL Open Font License）</li>
      </ul>
      <p><a href="privacy.html" style="color:var(--gold)">プライバシーポリシー</a> ・ <a href="terms.html" style="color:var(--gold)">利用規約</a></p>`,
};

export const LONG_EN: Record<string, string> = {
  PREMIUM_INTRO: `Online matches in Transparent Mahjong run on a game server paid for by the developer.
      The more people play, the more the servers cost, so <b>we will keep expanding the servers as the player base grows</b>.
      Premium membership (¥800 per month) helps cover those running costs.`,
  SUBSCRIPTION_TERMS: `The subscription renews automatically unless cancelled at least 24 hours before the end of the current period.
      You can manage or cancel it in the subscription settings of the App Store or Google Play.
      Payment is charged to your store account.`,
  TUT1: `<p>In Transparent Mahjong, each tile comes in four copies: <b>three are transparent</b> and <b>only one is a normal, opaque tile</b>.</p>
        <p>On the left is a glass-like transparent tile; on the right, an opaque one.</p>`,
  TUT2: `<p>Transparent tiles are <b>visible to everyone</b>, even in an opponent's hand. Only the opaque tiles (orange backs) stay hidden.</p>
        <p>Reading what your opponents are collecting and waiting on is the heart of the game.</p>`,
  TUT3: `<p>Your transparent tiles are just as visible to them. <b>Where you use your opaque tiles</b> decides the game.</p>
        <p>When you call Pon, Chi or Kan, transparent tiles are revealed first, so your opaque tiles stay in your hand.</p>
        <p>If your winning tile is an opaque one, your wait is much harder to read.</p>`,
  TUT4: `<p><b>Click a tile</b> to discard it (on touch screens, tap once to select and again to discard). <b>Drag</b> tiles to rearrange your hand.</p>
        <p>With the keyboard, use <b>← →</b> to select and <b>Enter</b> to discard. <b>Q</b> = Ron/Tsumo, <b>W</b> = Riichi, <b>E</b> = Pon, <b>R</b> = Chi, <b>F</b> = Kan, <b>S</b> = Skip.</p>
        <p>Gamepads are supported too (see Settings for the full list).</p>`,
  TUT5: `<p>Open <b>Hand View</b> (top right, the <b>Tab</b> key, or click an opponent's hand) to see your opponents' visible tiles at a large size.</p>
        <p>A <b>yellow dot</b> on one of your tiles means discarding it gets you to tenpai. The number under each winning tile shows how many copies are still unseen.</p>
        <p>Get used to the game against the CPU first, then create a room and play with friends.</p>`,
  RULES_HTML: `<h2>How to play Transparent Mahjong</h2>
      <p>Of the 136 tiles, <b>three of every four copies are "transparent"</b> and only one is a normal opaque tile.</p>
      <ul>
        <li>Transparent tiles are <b>visible to everyone</b>, even in your hand. Only opaque tiles are hidden from opponents.</li>
        <li>Since most of each opponent's hand is visible, reading dangerous tiles and waits is the key to winning.</li>
        <li>Calls reveal transparent tiles first, so you can keep opaque tiles in hand to hide your wait.</li>
        <li>Tiles you can see in other hands are counted in the "remaining tiles" display.</li>
        <li>Your hand is not sorted automatically. Drag tiles to arrange them as you like, or turn on "Auto sort" at the top right of the table.</li>
        <li>"Hand View" (Tab key) shows your opponents' visible tiles at a large size.</li>
      </ul>
      <h3>Basic rules</h3>
      <ul>
        <li>4-player (25,000 starting points by default) or 3-player (35,000 by default); East-only or East-South game.</li>
        <li>Standard Japanese riichi mahjong yaku and scoring (open yaku allowed after calling).</li>
        <li>The room creator can change starting points, thinking time, time bank, red fives, open tanyao and bankruptcy before the game (for CPU games, use "Rule settings" on the title screen).</li>
        <li>Thinking time resets every turn; going over uses your time bank. When both run out, you automatically discard the drawn tile (calls are skipped).</li>
        <li>No double ron (head bump), no abortive draws, game ends on bankruptcy.</li>
        <li>Furiten applies (own discards, same-turn, and after passing in riichi).</li>
      </ul>
      <h3>3-player mahjong</h3>
      <ul>
        <li>Characters 2–8 are removed (108 tiles). Chi is not allowed.</li>
        <li>North tiles can be set aside as Kita dora (1 han each).</li>
        <li>Tsumo wins do not collect from the missing player. Noten penalty is 2,000 points in total.</li>
      </ul>
      <h3>Online play</h3>
      <ul>
        <li>"Create room" gives you a 6-character code. Share it with your friends.</li>
        <li>Friends enter the code with "Join with code" to sit at the same table. Empty seats are filled by CPUs.</li>
        <li>The game continues even if the room creator leaves. If the app closes, use "Return to match" on the title screen.</li>
        <li>Player names are shown to others. Names with inappropriate words are replaced automatically.</li>
        <li>A disconnected player's seat is played by the CPU until they reconnect.</li>
      </ul>
      <h3>Credits</h3>
      <ul>
        <li>Voice: <a href="https://amitaro.net/" target="_blank" rel="noopener" style="color:var(--gold)">Amitaro's Voice Material Studio (https://amitaro.net/)</a></li>
        <li>Music, sound effects and tile design: original</li>
        <li>Fonts: M PLUS Rounded 1c / Noto Serif JP (SIL Open Font License)</li>
      </ul>
      <p><a href="privacy-en.html" style="color:var(--gold)">Privacy Policy</a> · <a href="terms-en.html" style="color:var(--gold)">Terms of Use</a></p>`,
};
