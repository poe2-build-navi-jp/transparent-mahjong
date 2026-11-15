import './ui/fonts.css';
import './ui/styles.css';
import type { GameView } from './engine/game';
import { GameHost } from './net/host';
import { sanitizeName } from './net/names';
import { normalizeCode, RoomClient, RoomHost, type Member } from './net/online';
import { createRoomCode, detectServer, fetchQuota, useServer, WsRoom } from './net/wsroom';
import { DEFAULT_RULES, sanitizeRules, type Rules } from './engine/rules';
import { ads } from './app/ads';
import { billing } from './app/billing';
import { audio } from './ui/audio';
import { bindRulesPanel, rulesPanelHtml, rulesSummaryHtml } from './ui/rulesPanel';
import { haptics } from './ui/haptics';
import { TableUI, tileHtml } from './ui/table';

const app = document.getElementById('app')!;

type Length = 'tonpu' | 'hanchan';

const store = {
  get name(): string {
    try { return localStorage.getItem('tmj-name') || ''; } catch { return ''; }
  },
  set name(v: string) {
    try { localStorage.setItem('tmj-name', v); } catch { /* noop */ }
  },
  /** 前回のルール（人数・長さは以前の保存形式からも引き継ぐ） */
  get rules(): Rules {
    try {
      const saved = JSON.parse(localStorage.getItem('tmj-rules') ?? 'null');
      if (saved) return sanitizeRules(saved);
      return sanitizeRules({
        ...DEFAULT_RULES,
        count: localStorage.getItem('tmj-count') === '3' ? 3 : 4,
        length: localStorage.getItem('tmj-length') === 'hanchan' ? 'hanchan' : 'tonpu',
      });
    } catch { return { ...DEFAULT_RULES }; }
  },
  set rules(v: Rules) {
    try { localStorage.setItem('tmj-rules', JSON.stringify(sanitizeRules(v))); } catch { /* noop */ }
  },
  get length(): Length { return this.rules.length; },
  set length(v: Length) { this.rules = { ...this.rules, length: v }; },
  get count(): 3 | 4 { return this.rules.count; },
  set count(v: 3 | 4) { this.rules = { ...this.rules, count: v }; },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

let cleanup: (() => void) | null = null;
function setScreen(html: string) {
  cleanup?.();
  cleanup = null;
  app.innerHTML = html;
}

function playerName(): string {
  const input = document.getElementById('name') as HTMLInputElement | null;
  const n = sanitizeName(input?.value ?? store.name, 'あなた');
  store.name = n;
  return n;
}

function decoTiles(): string {
  const ids = [1, 41, 73, 110, 125, 133, 18, 62];
  return ids.map((id, i) => `<div class="deco d${i}">${tileHtml(id, { size: 'hand' })}</div>`).join('');
}

const CREDIT = '<div class="credit">音声素材：<a href="https://amitaro.net/" target="_blank" rel="noopener">あみたろの声素材工房（https://amitaro.net/）</a><br>BGM・効果音・牌デザイン：オリジナル<br><a class="plink" href="privacy.html">プライバシーポリシー</a></div>';

function optionsHtml(): string {
  const len = store.length;
  const cnt = store.count;
  return `
      <div class="seg" role="radiogroup">
        <button class="${cnt === 4 ? 'on' : ''}" data-count="4">四人麻雀</button>
        <button class="${cnt === 3 ? 'on' : ''}" data-count="3">三人麻雀</button>
      </div>
      <div class="seg" role="radiogroup">
        <button class="${len === 'tonpu' ? 'on' : ''}" data-len="tonpu">東風戦</button>
        <button class="${len === 'hanchan' ? 'on' : ''}" data-len="hanchan">半荘戦</button>
      </div>`;
}

function bindOptions(onChange: () => void = () => {}) {
  app.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => b.addEventListener('click', () => {
    store.length = b.dataset.len as Length;
    app.querySelectorAll('[data-len]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) => b.addEventListener('click', () => {
    store.count = b.dataset.count === '3' ? 3 : 4;
    app.querySelectorAll('[data-count]').forEach((x) => x.classList.toggle('on', x === b));
    onChange();
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-vibe]').forEach((b) => b.addEventListener('click', () => {
    b.classList.toggle('on', haptics.toggle());
    haptics.tap('medium');
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-audio]').forEach((b) => b.addEventListener('click', () => {
    b.classList.toggle('on', audio.toggle(b.dataset.audio as 'bgm' | 'voice'));
  }));
}

// ---------------------------------------------------------------- タイトル

function titleScreen(error = '') {
  setScreen(`
  <div class="screen title">
    <div class="decos">${decoTiles()}</div>
    <div class="logo"><span class="l1">透明</span><span class="l2">麻雀</span></div>
    <div class="tagline">４枚のうち３枚は透けて見える ― 読み合いの麻雀</div>
    <div class="card">
      <label class="field"><span>プレイヤー名</span><input id="name" maxlength="12" value="${esc(store.name)}" placeholder="あなた"></label>
${optionsHtml()}
      ${useServer && activeRoom.get() ? `<button class="big primary" id="resume">対局に復帰（ルーム ${esc(activeRoom.get()!)}）</button>` : ''}
      <button class="big primary" id="cpu">CPU対戦</button>
      <div class="row2">
        <button class="big" id="create">ルームを作る</button>
        <button class="big" id="join">コードで参加</button>
      </div>
      <button class="quota-line" id="premium"><span id="quota">オンライン対戦の残り回数を確認中…</span><span class="pm">プレミアム</span></button>
      <div class="audio-row">
        <button class="toggle ${audio.settings.bgm ? 'on' : ''}" data-audio="bgm">BGM</button>
        <button class="toggle ${audio.settings.voice ? 'on' : ''}" data-audio="voice">音声</button>
        <button class="toggle ${haptics.enabled ? 'on' : ''}" data-vibe="1">振動</button>
      </div>
      <button class="link" id="ruleset">詳細ルール設定（CPU対戦）</button>
      <button class="link" id="rules">ルール説明</button>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
    </div>
    ${CREDIT}
  </div>`);
  audio.startBgm();
  bindOptions();
  document.getElementById('resume')?.addEventListener('click', () => void serverRoom(playerName(), activeRoom.get()!));
  document.getElementById('cpu')!.addEventListener('click', () => startCpuGame(playerName()));
  document.getElementById('create')!.addEventListener('click', () => createRoom(playerName()));
  document.getElementById('join')!.addEventListener('click', () => joinScreen(playerName()));
  document.getElementById('rules')!.addEventListener('click', rulesScreen);
  document.getElementById('ruleset')!.addEventListener('click', ruleSettingsScreen);
  document.getElementById('premium')!.addEventListener('click', () => premiumScreen());
  void showQuota();
}

/** タイトル画面に本日の無料オンライン対局の残りを出す */
async function showQuota() {
  const el = document.getElementById('quota');
  if (!el) return;
  const q = await fetchQuota();
  if (!document.body.contains(el)) return;
  if (!q) { el.textContent = 'プレミアム会員について'; return; }
  if (q.premium) el.textContent = 'プレミアム会員：オンライン対戦 無制限';
  else if (q.remaining === null) el.textContent = 'オンライン対戦：アプリ公開まで無制限で遊べます';
  else el.textContent = `本日の無料オンライン対局：あと${q.remaining}回（毎日0時に回復）`;
}

// ---------------------------------------------------------------- プレミアム

async function premiumScreen(back: () => void = () => titleScreen()) {
  const q = await fetchQuota();
  const ent = billing.entitlements;
  const premium = q?.premium || ent.premium;
  const limit = q?.plannedLimit ?? q?.limit ?? 1;
  const unlimitedNow = !!q && q.limit === 0;
  setScreen(`
  <div class="screen rules">
    <div class="card wide premium">
      <h2>プレミアム会員</h2>
      <p>透明麻雀のオンライン対戦は、対局を進めるサーバーを運営者が費用を負担して動かしています。
      遊ぶ人が増えるほどサーバー代がかかるため、<b>利用者の増加に合わせてサーバーを拡大していきます</b>。
      その運営費として、プレミアム会員（月額800円）をご用意しました。</p>
      <div class="plans">
        <div class="plan">
          <div class="pname2">無料</div>
          <ul>
            <li>CPU対戦：無制限</li>
            <li>オンライン対戦：1日${limit || '無制限'}${limit ? '回まで' : ''}（日本時間0時に回復）</li>
            <li>対局後に広告あり（アプリ版）</li>
          </ul>
        </div>
        <div class="plan pro">
          <div class="pname2">プレミアム <span id="price-premium">月額800円</span></div>
          <ul>
            <li>CPU対戦：無制限</li>
            <li><b>オンライン対戦：無制限</b></li>
            <li><b>広告なし</b></li>
          </ul>
        </div>
      </div>
      ${unlimitedNow && !premium ? '<div class="pm-on">アプリ公開までは、オンライン対戦も無制限で遊べます。</div>' : ''}
      ${premium ? '<div class="pm-on">プレミアム会員です。いつもありがとうございます！</div>' : ''}
      ${billing.available
        ? `${premium ? '' : '<button class="big primary" id="buy-premium">プレミアムに登録する</button>'}
           ${ent.noAds || premium ? '' : '<button class="big" id="buy-noads">広告だけ消す（買い切り）<span id="price-noads"></span></button>'}
           <button class="link" id="restore">購入を復元する</button>`
        : '<div class="waiting">ご購入はアプリ版から行えます（アプリ版は準備中です）。</div>'}
      <p class="fine">サブスクリプションは、期間終了の24時間前までに解約しない限り自動で更新されます。
      解約・更新の確認は App Store / Google Play のサブスクリプション設定から行えます。
      料金はご利用のストアのアカウントに請求されます。</p>
      <p class="fine"><a href="terms.html">利用規約</a> ・ <a href="privacy.html">プライバシーポリシー</a></p>
      <div class="err" id="err"></div>
      <button class="big" id="back">戻る</button>
    </div>
  </div>`);
  document.getElementById('back')!.addEventListener('click', back);
  const err = (e: unknown) => { const el = document.getElementById('err'); if (el) el.textContent = (e as Error).message; };
  document.getElementById('buy-premium')?.addEventListener('click', async () => {
    try { await billing.buy('premium'); flash('プレミアムに登録しました'); void premiumScreen(back); } catch (e) { err(e); }
  });
  document.getElementById('buy-noads')?.addEventListener('click', async () => {
    try { await billing.buy('noAds'); flash('広告を削除しました'); void premiumScreen(back); } catch (e) { err(e); }
  });
  document.getElementById('restore')?.addEventListener('click', async () => {
    try { await billing.restore(); flash('購入を復元しました'); void premiumScreen(back); } catch (e) { err(e); }
  });
  if (billing.available) {
    const p = await billing.prices();
    const pp = document.getElementById('price-premium');
    if (pp && p.premium) pp.textContent = `月額${p.premium}`;
    const pn = document.getElementById('price-noads');
    if (pn && p.noAds) pn.textContent = `（${p.noAds}）`;
  }
}

function ruleSettingsScreen() {
  const render = () => {
    setScreen(`
    <div class="screen rules">
      <div class="card wide">
        <h2>詳細ルール設定</h2>
        ${rulesPanelHtml(store.rules, 'CPU対戦では時間制限なし（オンライン対戦のみ）')}
        <button class="big primary" id="back">決定</button>
      </div>
    </div>`);
    bindRulesPanel(app, () => store.rules, (r) => { store.rules = r; render(); });
    document.getElementById('back')!.addEventListener('click', () => titleScreen());
  };
  render();
}

function rulesScreen() {
  setScreen(`
  <div class="screen rules">
    <div class="card wide">
      <h2>透明麻雀のルール</h2>
      <p>136枚の牌のうち、<b>各種4枚中3枚が「透明牌」</b>、残り1枚だけが通常の不透明な牌です。</p>
      <ul>
        <li>透明牌は手牌にあっても<b>全員から見えます</b>。不透明牌だけが相手から隠れます。</li>
        <li>他家の手牌の大部分が見えるので、危険牌・待ちの読み合いが勝負の鍵になります。</li>
        <li>鳴くときは自動的に透明牌から晒すので、不透明牌を手元に残して待ちを隠せます。</li>
        <li>相手から見えている牌は、残り枚数の表示にも反映されます。</li>
        <li>手牌は自動で並びません（理牌なし）。牌をドラッグして好きな順番に並べ替えられます。卓画面右上の「自動理牌」をオンにすると自動で並びます。</li>
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
      <p><a href="privacy.html" style="color:var(--gold)">プライバシーポリシー</a></p>
      <button class="big primary" id="back">戻る</button>
    </div>
  </div>`);
  document.getElementById('back')!.addEventListener('click', () => titleScreen());
}

// ---------------------------------------------------------------- CPU対戦

function startCpuGame(name: string) {
  setScreen('');
  const count = store.count;
  const seat = Math.floor(Math.random() * count);
  const cpuNames = ['CPU 白鷺', 'CPU 烏', 'CPU 鷹'];
  const names: string[] = [];
  let ci = 0;
  for (let s = 0; s < count; s++) names.push(s === seat ? name : cpuNames[ci++]);
  let table: TableUI;
  const links = names.map((_, s) => (s === seat ? { send: (v: GameView) => table.update(v) } : {}));
  const host = new GameHost(
    { names, cpu: names.map((_, s) => s !== seat), length: store.length, rules: store.rules },
    links, { timed: false },
  );
  table = new TableUI(app, (a) => host.action(seat, a), () => exitAfterGame(table.view?.phase === 'gameEnd'), count === 3 ? 'CPU対戦（三麻）' : 'CPU対戦');
  cleanup = () => { host.stop(); table.destroy(); };
  host.start();
}

// ---------------------------------------------------------------- オンライン

function lobbyHtml(code: string, members: Member[], isHost: boolean, rules: Rules = store.rules): string {
  const seats = Array.from({ length: Math.max(rules.count, members.length) }, (_, i) => i).map((i) => {
    const m = members[i];
    return `<div class="lseat ${m ? 'filled' : ''}">${m ? `${esc(m.name)}${m.host ? ' <span class="badge">ホスト</span>' : ''}` : '<span class="empty">空席（CPU）</span>'}</div>`;
  }).join('');
  const url = `${location.origin}${location.pathname}?room=${code}`;
  return `
  <div class="screen lobby">
    <div class="card">
      <h2>${isHost ? 'ルームを作成しました' : 'ルームに参加しました'}</h2>
      <div class="codebox"><span class="clabel">ルームコード</span><span class="code">${code}</span></div>
      <div class="row2">
        <button class="big" id="copy">コードをコピー</button>
        <button class="big" id="share">招待リンクを共有</button>
      </div>
      <input class="urlbox" readonly value="${esc(url)}">
      <div class="seats">${seats}</div>
      ${isHost
        ? `<h3 class="lh">ルール設定</h3>${rulesPanelHtml(rules)}
          <button class="big primary" id="start">対局開始（空席はCPU）</button>`
        : `${rulesSummaryHtml(rules)}<div class="waiting">ホストが開始するのを待っています…</div>`}
      <button class="link" id="leave">退出</button>
      <div class="err" id="err"></div>
    </div>
  </div>`;
}

function bindLobby(code: string, leave: () => void, onRules: (r: Rules) => void = () => {}) {
  const url = `${location.origin}${location.pathname}?room=${code}`;
  document.getElementById('copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); flash('コピーしました'); } catch { flash(code); }
  });
  document.getElementById('share')?.addEventListener('click', async () => {
    const text = `透明麻雀で対戦しよう！ ルームコード: ${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: '透明麻雀', text, url }); } catch { /* キャンセル */ }
    } else {
      try { await navigator.clipboard.writeText(`${text}\n${url}`); flash('招待リンクをコピーしました'); } catch { flash(url); }
    }
  });
  bindOptions();
  bindRulesPanel(app, () => store.rules, (r) => { store.rules = r; onRules(store.rules); });
  document.getElementById('leave')!.addEventListener('click', leave);
}

function flash(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ---------------------------------------------------------------- オンライン（サーバー型）

/** 参加中のルーム（アプリが終了されても戻れるよう保存） */
const activeRoom = {
  get(): string | null {
    try {
      const v = JSON.parse(localStorage.getItem('tmj-active-room') ?? 'null') as { code: string; at: number } | null;
      return v && Date.now() - v.at < 3 * 60 * 60 * 1000 ? v.code : null;
    } catch { return null; }
  },
  set(code: string | null) {
    try {
      if (code) localStorage.setItem('tmj-active-room', JSON.stringify({ code, at: Date.now() }));
      else localStorage.removeItem('tmj-active-room');
    } catch { /* noop */ }
  },
};

async function serverRoom(name: string, joinCode: string | null) {
  setScreen(`<div class="screen"><div class="card"><div class="waiting">${joinCode ? '接続中…' : 'ルームを作成中…'}</div></div></div>`);
  let code: string;
  try {
    code = joinCode ?? await createRoomCode();
  } catch (e) {
    titleScreen(`ルームを作成できませんでした（${(e as Error).message}）`);
    return;
  }
  const room = new WsRoom(name, code);
  let table: TableUI | null = null;
  const leave = () => { const fin = table?.view?.phase === 'gameEnd'; activeRoom.set(null); room.close(); exitAfterGame(!!fin); };
  let sentRules = false;
  room.onLobby = (members, youAreHost, rules) => {
    if (table) return;
    // ホストは自分の設定をサーバーへ送る（最初の1回）
    if (youAreHost && !sentRules) { sentRules = true; room.setRules(store.rules); }
    const shown = youAreHost ? store.rules : rules;
    app.innerHTML = lobbyHtml(code, members, youAreHost, shown);
    bindLobby(code, leave, (r) => { room.setRules(r); room.onLobby(members, youAreHost, r); });
    document.getElementById('start')?.addEventListener('click', () => {
      if (members.length > store.count) {
        document.getElementById('err')!.textContent = '三人麻雀は3人までです。四人麻雀に切り替えてください';
        return;
      }
      room.start(store.rules);
    });
  };
  room.onView = (v) => {
    if (!table) {
      app.querySelector('.screen')?.remove();
      table = new TableUI(app, (a) => room.act(a), leave, `ルーム ${code}`);
    }
    table.update(v);
    activeRoom.set(v.phase === 'gameEnd' ? null : code);
  };
  room.onError = (m, fatal, errCode) => {
    if (fatal) { activeRoom.set(null); room.close(); titleScreen(m); return; }
    const el = document.getElementById('err');
    if (el) {
      el.textContent = m;
      if (errCode === 'quota') {
        el.insertAdjacentHTML('beforeend', '<br><button class="link" id="to-premium">プレミアム会員について</button>');
        document.getElementById('to-premium')?.addEventListener('click', () => { room.close(); activeRoom.set(null); void premiumScreen(); });
      }
    } else flash(m);
  };
  room.onConnection = (ok) => { if (!ok) flash('通信が切れました。再接続しています…'); };
  room.onClosed = () => {
    if (table?.view?.phase === 'gameEnd') return;
    room.close();
    titleScreen('サーバーとの接続が終了しました');
  };
  cleanup = () => { table?.destroy(); room.close(); };
  try {
    await room.connect();
    activeRoom.set(code);
  } catch (e) {
    activeRoom.set(null);
    room.close();
    titleScreen((e as Error).message);
  }
}

async function createRoom(name: string) {
  if (useServer) { void serverRoom(name, null); return; }
  setScreen('<div class="screen"><div class="card"><div class="waiting">ルームを作成中…</div></div></div>');
  const room = new RoomHost(name);
  let code: string;
  try {
    code = await room.open();
  } catch (e) {
    titleScreen(`ルームを作成できませんでした（${(e as Error).message}）`);
    return;
  }
  let table: TableUI | null = null;
  const leave = () => { room.close(); titleScreen(); };
  const renderLobby = (members: Member[]) => {
    if (table) return;
    room.setRules(store.rules);
    app.innerHTML = lobbyHtml(code, members, true);
    bindLobby(code, leave, () => renderLobby(room.members()));
    document.getElementById('start')!.addEventListener('click', () => {
      if (room.guests.length > store.count - 1) {
        document.getElementById('err')!.textContent = '三人麻雀は3人までです。四人麻雀に切り替えてください';
        return;
      }
      table = new TableUI(app, (a) => room.act(a), leave, `ルーム ${code}`);
      app.querySelector('.screen')?.remove();
      room.onView = (v) => table!.update(v);
      room.start(store.rules);
    });
  };
  room.onLobby = renderLobby;
  room.onError = (m) => { const el = document.getElementById('err'); if (el) el.textContent = m; };
  cleanup = () => { table?.destroy(); room.close(); };
  renderLobby(room.members());
}

function joinScreen(name: string, preset = '') {
  setScreen(`
  <div class="screen join">
    <div class="card">
      <h2>コードで参加</h2>
      <label class="field"><span>プレイヤー名</span><input id="name" maxlength="12" value="${esc(name)}"></label>
      <label class="field"><span>ルームコード</span><input id="code" class="codeinput" maxlength="8" autocomplete="off" value="${esc(preset)}" placeholder="ABC123"></label>
      <button class="big primary" id="go">参加する</button>
      <button class="link" id="back">戻る</button>
      <div class="err" id="err"></div>
    </div>
  </div>`);
  const go = () => {
    const code = normalizeCode((document.getElementById('code') as HTMLInputElement).value);
    if (code.length < 4) {
      document.getElementById('err')!.textContent = 'コードを入力してください';
      return;
    }
    joinRoom(playerName(), code);
  };
  document.getElementById('go')!.addEventListener('click', go);
  document.getElementById('code')!.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  document.getElementById('back')!.addEventListener('click', () => titleScreen());
}

async function joinRoom(name: string, code: string) {
  if (useServer) { void serverRoom(name, code); return; }
  setScreen('<div class="screen"><div class="card"><div class="waiting">接続中…</div></div></div>');
  const client = new RoomClient(name, code);
  let table: TableUI | null = null;
  const leave = () => { client.close(); titleScreen(); };
  client.onLobby = (members, rules) => {
    if (table) return;
    app.innerHTML = lobbyHtml(code, members, false, rules);
    bindLobby(code, leave);
  };
  client.onView = (v) => {
    if (!table) {
      app.querySelector('.screen')?.remove();
      table = new TableUI(app, (a) => client.act(a), leave, `ルーム ${code}`);
    }
    table.update(v);
  };
  client.onError = (m) => {
    if (!table) { client.close(); titleScreen(m); } else flash(m);
  };
  client.onClosed = () => {
    if (table?.view?.phase === 'gameEnd') return;
    client.close();
    titleScreen('ホストとの接続が終了しました');
  };
  cleanup = () => { table?.destroy(); client.close(); };
  try {
    await client.join();
  } catch (e) {
    client.close();
    titleScreen((e as Error).message);
  }
}

// ---------------------------------------------------------------- 起動

const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
/** 対局を終えてタイトルへ戻る。終局後なら広告（アプリ版・無料会員のみ） */
function exitAfterGame(finished: boolean) {
  titleScreen();
  if (finished) void ads.afterGame();
}

void billing.init();
void ads.init();

void detectServer().then(() => {
  if (roomParam) {
    history.replaceState(null, '', location.pathname);
    joinScreen(store.name, normalizeCode(roomParam));
  } else {
    titleScreen();
  }
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
