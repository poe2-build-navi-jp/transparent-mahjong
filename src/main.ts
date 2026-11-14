import './ui/styles.css';
import type { GameView } from './engine/game';
import { GameHost } from './net/host';
import { normalizeCode, RoomClient, RoomHost, type Member } from './net/online';
import { audio } from './ui/audio';
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
  get length(): Length {
    try { return (localStorage.getItem('tmj-length') as Length) || 'tonpu'; } catch { return 'tonpu'; }
  },
  set length(v: Length) {
    try { localStorage.setItem('tmj-length', v); } catch { /* noop */ }
  },
  get count(): 3 | 4 {
    try { return localStorage.getItem('tmj-count') === '3' ? 3 : 4; } catch { return 4; }
  },
  set count(v: 3 | 4) {
    try { localStorage.setItem('tmj-count', String(v)); } catch { /* noop */ }
  },
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
  const n = (input?.value ?? store.name).trim().slice(0, 12) || 'あなた';
  store.name = n;
  return n;
}

function decoTiles(): string {
  const ids = [1, 41, 73, 110, 125, 133, 18, 62];
  return ids.map((id, i) => `<div class="deco d${i}">${tileHtml(id, { size: 'hand' })}</div>`).join('');
}

const CREDIT = '<div class="credit">音声素材：<a href="https://amitaro.net/" target="_blank" rel="noopener">あみたろの声素材工房（https://amitaro.net/）</a><br>BGM・効果音・牌デザイン：オリジナル</div>';

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
      <button class="big primary" id="cpu">CPU対戦</button>
      <div class="row2">
        <button class="big" id="create">ルームを作る</button>
        <button class="big" id="join">コードで参加</button>
      </div>
      <div class="audio-row">
        <button class="toggle ${audio.settings.bgm ? 'on' : ''}" data-audio="bgm">BGM</button>
        <button class="toggle ${audio.settings.voice ? 'on' : ''}" data-audio="voice">音声</button>
      </div>
      <button class="link" id="rules">ルール説明</button>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
    </div>
    ${CREDIT}
  </div>`);
  audio.startBgm();
  bindOptions();
  document.getElementById('cpu')!.addEventListener('click', () => startCpuGame(playerName()));
  document.getElementById('create')!.addEventListener('click', () => createRoom(playerName()));
  document.getElementById('join')!.addEventListener('click', () => joinScreen(playerName()));
  document.getElementById('rules')!.addEventListener('click', rulesScreen);
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
      </ul>
      <h3>基本ルール</h3>
      <ul>
        <li>四人麻雀（25,000点持ち）／三人麻雀（35,000点持ち）、東風戦／半荘戦を選択。</li>
        <li>一般的なリーチ麻雀の役と点数計算（喰いタンあり・後付けあり・赤ドラなし）。</li>
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
        <li>通信が切れた席はCPUが代打ちし、再接続すると復帰します。</li>
      </ul>
      <h3>クレジット</h3>
      <ul>
        <li>音声素材：<a href="https://amitaro.net/" target="_blank" rel="noopener" style="color:var(--gold)">あみたろの声素材工房（https://amitaro.net/）</a></li>
        <li>BGM・効果音・牌デザイン：オリジナル</li>
      </ul>
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
    { names, cpu: names.map((_, s) => s !== seat), length: store.length },
    links, { timed: false },
  );
  table = new TableUI(app, (a) => host.action(seat, a), () => titleScreen(), count === 3 ? 'CPU対戦（三麻）' : 'CPU対戦');
  cleanup = () => { host.stop(); table.destroy(); };
  host.start();
}

// ---------------------------------------------------------------- オンライン

function lobbyHtml(code: string, members: Member[], isHost: boolean): string {
  const seats = (isHost ? Array.from({ length: store.count }, (_, i) => i) : members.map((_, i) => i)).map((i) => {
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
        ? `${optionsHtml()}
          <button class="big primary" id="start">対局開始（空席はCPU）</button>`
        : '<div class="waiting">ホストが開始するのを待っています…</div>'}
      <button class="link" id="leave">退出</button>
      <div class="err" id="err"></div>
    </div>
  </div>`;
}

function bindLobby(code: string, leave: () => void, onCount: () => void = () => {}) {
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
  bindOptions(onCount);
  document.getElementById('leave')!.addEventListener('click', leave);
}

function flash(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

async function createRoom(name: string) {
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
      room.start(store.length, store.count);
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
  setScreen('<div class="screen"><div class="card"><div class="waiting">接続中…</div></div></div>');
  const client = new RoomClient(name, code);
  let table: TableUI | null = null;
  const leave = () => { client.close(); titleScreen(); };
  client.onLobby = (members) => {
    if (table) return;
    app.innerHTML = lobbyHtml(code, members, false);
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
if (roomParam) {
  history.replaceState(null, '', location.pathname);
  joinScreen(store.name, normalizeCode(roomParam));
} else {
  titleScreen();
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
