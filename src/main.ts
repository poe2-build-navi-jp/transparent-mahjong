import './ui/fonts.css';
import './ui/styles.css';
import type { GameView } from './engine/game';
import { GameHost } from './net/host';
import { sanitizeName } from './net/names';
import { normalizeCode, RoomClient, RoomHost, type Member } from './net/online';
import { createRoomCode, detectServer, fetchQuota, registerSteam, useServer, WsRoom } from './net/wsroom';
import { DEFAULT_RULES, sanitizeRules, type Rules } from './engine/rules';
import { ads } from './app/ads';
import { platform } from './app/platform';
import { ACHIEVEMENTS, GameTracker, records } from './app/records';
import { billing } from './app/billing';
import { audio } from './ui/audio';
import { bindRulesPanel, rulesPanelHtml, rulesSummaryHtml } from './ui/rulesPanel';
import { haptics } from './ui/haptics';
import { KEY_HELP, PAD_HELP, TableUI, tileHtml } from './ui/table';
import { getLang, setLang, suggestLang, t } from './i18n';

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
  const n = sanitizeName(input?.value ?? store.name, t('あなた'));
  store.name = n;
  return n;
}

function decoTiles(): string {
  const ids = [1, 41, 73, 110, 125, 133, 18, 62];
  return ids.map((id, i) => `<div class="deco d${i}">${tileHtml(id, { size: 'hand' })}</div>`).join('');
}

const credit = () => `<div class="credit">${t('音声素材')}：<a href="https://amitaro.net/" target="_blank" rel="noopener">${t('あみたろの声素材工房')}（https://amitaro.net/）</a><br>${t('BGM・効果音・牌デザイン：オリジナル')}<br><a class="plink" href="${t('privacy.html')}">${t('プライバシーポリシー')}</a></div>`;

function optionsHtml(): string {
  const len = store.length;
  const cnt = store.count;
  return `
      <div class="seg" role="radiogroup">
        <button class="${cnt === 4 ? 'on' : ''}" data-count="4">${t('四人麻雀')}</button>
        <button class="${cnt === 3 ? 'on' : ''}" data-count="3">${t('三人麻雀')}</button>
      </div>
      <div class="seg" role="radiogroup">
        <button class="${len === 'tonpu' ? 'on' : ''}" data-len="tonpu">${t('東風戦')}</button>
        <button class="${len === 'hanchan' ? 'on' : ''}" data-len="hanchan">${t('半荘戦')}</button>
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
    ${getLang() === 'en' ? '<div class="logo-en">TRANSPARENT MAHJONG</div>' : ''}
    <div class="tagline">${t('４枚のうち３枚は透けて見える ― 読み合いの麻雀')}</div>
    <div class="langsw"><button class="${getLang() === 'ja' ? 'on' : ''}" data-lang="ja">日本語</button><button class="${getLang() === 'en' ? 'on' : ''}" data-lang="en">English</button></div>
    <div class="card">
      <label class="field"><span>${t('プレイヤー名')}</span><input id="name" maxlength="12" value="${esc(store.name)}" placeholder="${t('あなた')}"></label>
${optionsHtml()}
      ${useServer && activeRoom.get() ? `<button class="big primary" id="resume">${t('対局に復帰（ルーム {code}）', { code: esc(activeRoom.get()!) })}</button>` : ''}
      <button class="big primary" id="cpu">${t('CPU対戦')}</button>
      <div class="row2">
        <button class="big" id="create">${t('ルームを作る')}</button>
        <button class="big" id="join">${t('コードで参加')}</button>
      </div>
      <button class="quota-line" id="premium"><span id="quota">${t('オンライン対戦の残り回数を確認中…')}</span><span class="pm">${t('プレミアム')}</span></button>
      <div class="audio-row">
        <button class="toggle ${audio.settings.bgm ? 'on' : ''}" data-audio="bgm">BGM</button>
        <button class="toggle ${audio.settings.voice ? 'on' : ''}" data-audio="voice">${t('音声')}</button>
        <button class="toggle ${haptics.enabled ? 'on' : ''}" data-vibe="1">${t('振動')}</button>
      </div>
      <div class="title-links">
        <button class="link" id="tutorial">${t('はじめての方へ')}</button>
        <button class="link" id="stats">${t('戦績・実績')}</button>
        <button class="link" id="settings">${t('設定')}</button>
      </div>
      <div class="title-links">
        <button class="link" id="ruleset">${t('詳細ルール設定（CPU対戦）')}</button>
        <button class="link" id="rules">${t('ルール説明')}</button>
        ${platform.isDesktop ? `<button class="link" id="quit">${t('ゲームを終了')}</button>` : ''}
      </div>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
    </div>
    ${credit()}
  </div>`);
  audio.startBgm();
  bindOptions();
  document.getElementById('resume')?.addEventListener('click', () => void serverRoom(playerName(), activeRoom.get()!));
  document.getElementById('cpu')!.addEventListener('click', () => startCpuGame(playerName()));
  document.getElementById('create')!.addEventListener('click', () => createRoom(playerName()));
  document.getElementById('join')!.addEventListener('click', () => joinScreen(playerName()));
  document.getElementById('rules')!.addEventListener('click', rulesScreen);
  document.getElementById('ruleset')!.addEventListener('click', ruleSettingsScreen);
  document.getElementById('tutorial')!.addEventListener('click', () => tutorialScreen());
  document.getElementById('stats')!.addEventListener('click', statsScreen);
  document.getElementById('settings')!.addEventListener('click', settingsScreen);
  document.getElementById('quit')?.addEventListener('click', () => platform.quit());
  app.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    setLang(b.dataset.lang === 'en' ? 'en' : 'ja');
    titleScreen();
  }));
  document.getElementById('premium')!.addEventListener('click', () => premiumScreen());
  void showQuota();
}

/** タイトル画面に本日の無料オンライン対局の残りを出す */
async function showQuota() {
  const el = document.getElementById('quota');
  if (!el) return;
  const q = await fetchQuota();
  if (!document.body.contains(el)) return;
  if (!q) { el.textContent = t('プレミアム会員について'); return; }
  if (q.premium) el.textContent = t('プレミアム会員：オンライン対戦 無制限');
  else if (q.remaining === null) el.textContent = platform.kind === 'web'
    ? t('オンライン対戦：無制限で遊べます')
    : t('オンライン対戦：アプリ公開まで無制限で遊べます');
  else el.textContent = t('本日の無料オンライン対局：あと{n}回（毎日0時に回復）', { n: q.remaining });
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
      <h2>${t('プレミアム会員')}</h2>
      <p>${t('PREMIUM_INTRO')}</p>
      <div class="plans">
        <div class="plan">
          <div class="pname2">${t('無料')}</div>
          <ul>
            <li>${t('CPU対戦：無制限')}</li>
            <li>${platform.kind !== 'web' && limit ? t('オンライン対戦：1日{n}回まで（日本時間0時に回復）', { n: limit }) : t('オンライン対戦：無制限')}</li>
            <li>${t('対局後に広告あり（アプリ版）')}</li>
          </ul>
        </div>
        <div class="plan pro">
          <div class="pname2">${t('プレミアム')} <span id="price-premium">${t('月額800円')}</span></div>
          <ul>
            <li>${t('CPU対戦：無制限')}</li>
            <li><b>${t('オンライン対戦：無制限')}</b></li>
            <li><b>${t('広告なし')}</b></li>
          </ul>
        </div>
      </div>
      ${unlimitedNow && !premium ? `<div class="pm-on">${platform.kind === 'web' ? t('ウェブ版では、オンライン対戦も無制限で遊べます。') : t('アプリ公開までは、オンライン対戦も無制限で遊べます。')}</div>` : ''}
      ${premium ? `<div class="pm-on">${t('プレミアム会員です。いつもありがとうございます！')}</div>` : ''}
      ${import.meta.env.VITE_PLATFORM === 'steam'
        ? `<div class="pm-on">${t('Steam版をご購入の方は、オンライン対戦が無制限・広告なしで遊べます（Steamにログインした状態で起動してください）。')}</div>`
        : billing.available
        ? `${premium ? '' : `<button class="big primary" id="buy-premium">${t('プレミアムに登録する')}</button>`}
           ${ent.noAds || premium ? '' : `<button class="big" id="buy-noads">${t('広告だけ消す（買い切り）')}<span id="price-noads"></span></button>`}
           <button class="link" id="restore">${t('購入を復元する')}</button>`
        : `<div class="waiting">${t('ご購入はアプリ版から行えます（アプリ版は準備中です）。')}</div>`}
      <p class="fine">${t('SUBSCRIPTION_TERMS')}</p>
      <p class="fine"><a href="${t('terms.html')}">${t('利用規約')}</a> ・ <a href="${t('privacy.html')}">${t('プライバシーポリシー')}</a></p>
      <div class="err" id="err"></div>
      <button class="big" id="back">${t('戻る')}</button>
    </div>
  </div>`);
  document.getElementById('back')!.addEventListener('click', back);
  const err = (e: unknown) => { const el = document.getElementById('err'); if (el) el.textContent = (e as Error).message; };
  document.getElementById('buy-premium')?.addEventListener('click', async () => {
    try { await billing.buy('premium'); flash(t('プレミアムに登録しました')); void premiumScreen(back); } catch (e) { err(e); }
  });
  document.getElementById('buy-noads')?.addEventListener('click', async () => {
    try { await billing.buy('noAds'); flash(t('広告を削除しました')); void premiumScreen(back); } catch (e) { err(e); }
  });
  document.getElementById('restore')?.addEventListener('click', async () => {
    try { await billing.restore(); flash(t('購入を復元しました')); void premiumScreen(back); } catch (e) { err(e); }
  });
  if (billing.available) {
    const p = await billing.prices();
    const pp = document.getElementById('price-premium');
    if (pp && p.premium) pp.textContent = t('月額{price}', { price: p.premium });
    const pn = document.getElementById('price-noads');
    if (pn && p.noAds) pn.textContent = `（${p.noAds}）`;
  }
}

function ruleSettingsScreen() {
  const render = () => {
    setScreen(`
    <div class="screen rules">
      <div class="card wide">
        <h2>${t('詳細ルール設定')}</h2>
        ${rulesPanelHtml(store.rules, t('CPU対戦では時間制限なし（オンライン対戦のみ）'))}
        <button class="big primary" id="back">${t('決定')}</button>
      </div>
    </div>`);
    bindRulesPanel(app, () => store.rules, (r) => { store.rules = r; render(); });
    document.getElementById('back')!.addEventListener('click', () => titleScreen());
  };
  render();
}

// ---------------------------------------------------------------- 設定

function settingsScreen() {
  const vol = (key: 'bgmVol' | 'voiceVol' | 'seVol', label: string) => `
    <label class="slider"><span>${t(label)}</span>
      <input type="range" min="0" max="100" step="5" value="${Math.round(audio.settings[key] * 100)}" data-vol="${key}">
      <b>${Math.round(audio.settings[key] * 100)}</b></label>`;
  const help = (list: [string, string][]) => `<table class="keys">${list.map(([k, d]) => `<tr><th>${esc(t(k))}</th><td>${esc(t(d))}</td></tr>`).join('')}</table>`;
  setScreen(`
  <div class="screen rules">
    <div class="card wide settings">
      <h2>${t('設定')}</h2>
      <h3>${t('言語 / Language')}</h3>
      <div class="langsw"><button class="${getLang() === 'ja' ? 'on' : ''}" data-lang="ja">日本語</button><button class="${getLang() === 'en' ? 'on' : ''}" data-lang="en">English</button></div>
      <h3>${t('サウンド')}</h3>
      <div class="audio-row">
        <button class="toggle ${audio.settings.bgm ? 'on' : ''}" data-audio="bgm">BGM</button>
        <button class="toggle ${audio.settings.voice ? 'on' : ''}" data-audio="voice">${t('音声・効果音')}</button>
        <button class="toggle ${haptics.enabled ? 'on' : ''}" data-vibe="1">${t('振動')}</button>
      </div>
      ${vol('bgmVol', 'BGMの音量')}${vol('voiceVol', '発声ボイスの音量')}${vol('seVol', '効果音の音量')}
      ${platform.canFullscreen ? `<h3>${t('画面')}</h3><button class="big" id="fullscreen">${t('全画面の切り替え（F11）')}</button>` : ''}
      <h3>${t('キーボード操作')}</h3>${help(KEY_HELP)}
      <h3>${t('ゲームパッド操作')}</h3>${help(PAD_HELP)}
      <p class="fine">${t('卓画面の右上でも、自動和了・鳴きなし・ツモ切り・自動理牌・BGM・音声を切り替えられます。')}</p>
      <h3>${t('データ')}</h3>
      <button class="link" id="reset-records">${t('戦績と実績を消去する')}</button>
      <button class="big primary" id="back">${t('戻る')}</button>
    </div>
  </div>`);
  bindOptions();
  app.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((el) => {
    el.addEventListener('input', () => {
      const b = el.parentElement!.querySelector('b');
      if (b) b.textContent = el.value;
    });
    el.addEventListener('change', () => audio.setVolume(el.dataset.vol as 'bgmVol' | 'voiceVol' | 'seVol', Number(el.value) / 100));
  });
  document.getElementById('fullscreen')?.addEventListener('click', async () => {
    await platform.setFullscreen(!(await platform.isFullscreen()));
  });
  app.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    setLang(b.dataset.lang === 'en' ? 'en' : 'ja');
    settingsScreen();
  }));
  document.getElementById('reset-records')!.addEventListener('click', () => {
    if (confirm(t('戦績と実績をすべて消去しますか？（元に戻せません）'))) { records.reset(); flash(t('消去しました')); }
  });
  document.getElementById('back')!.addEventListener('click', () => titleScreen());
}

// ---------------------------------------------------------------- 戦績・実績

function statsScreen() {
  const s = records.summary();
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const got = records.data.achievements;
  const ach = ACHIEVEMENTS.map((a) => `<div class="ach ${got[a.id] ? 'on' : ''}">
      <span class="amark">${got[a.id] ? '★' : '☆'}</span><span class="aname">${esc(t(a.name))}</span><span class="adesc">${esc(t(a.desc))}</span></div>`).join('');
  const recent = records.data.games.slice(-10).reverse().map((g) => `<tr>
      <td>${new Date(g.at).toLocaleDateString()}</td><td>${g.mode === 'online' ? t('オンライン') : 'CPU'}</td>
      <td>${g.count === 3 ? t('三麻') : t('四麻')}・${g.length === 'hanchan' ? t('半荘') : t('東風')}</td><td>${t('{n}位', { n: g.rank })}</td><td>${g.score.toLocaleString()}</td></tr>`).join('');
  setScreen(`
  <div class="screen rules">
    <div class="card wide stats">
      <h2>${t('戦績・実績')}</h2>
      <div class="statgrid">
        <div><b>${s.games}</b><span>${t('対局数')}</span></div>
        <div><b>${s.games ? s.avgRank.toFixed(2) : '-'}</b><span>${t('平均順位')}</span></div>
        <div><b>${s.games ? pct(s.ranks[0] / s.games) : '-'}</b><span>${t('トップ率')}</span></div>
        <div><b>${pct(s.winRate)}</b><span>${t('和了率')}</span></div>
        <div><b>${pct(s.dealInRate)}</b><span>${t('放銃率')}</span></div>
        <div><b>${pct(s.riichiRate)}</b><span>${t('立直率')}</span></div>
        <div><b>${s.bestPoints.toLocaleString()}</b><span>${t('最高和了点')}</span></div>
        <div><b>${s.ranks.join(' / ')}</b><span>${t('1〜4位の回数')}</span></div>
      </div>
      <h3>${t('実績')}（${Object.keys(got).length} / ${ACHIEVEMENTS.length}）</h3>
      <div class="achs">${ach}</div>
      ${recent ? `<h3>${t('最近の対局')}</h3><table class="recent">${recent}</table>` : ''}
      <button class="big primary" id="back">${t('戻る')}</button>
    </div>
  </div>`);
  document.getElementById('back')!.addEventListener('click', () => titleScreen());
}

// ---------------------------------------------------------------- はじめての方へ

function tutorialScreen(page = 0) {
  const clear = (id: number) => tileHtml(id, { size: 'hand' });
  const pages: { title: string; body: string }[] = [
    {
      title: t('透明麻雀へようこそ'),
      body: `<div class="tut-tiles">${clear(33 * 4 + 1)}${clear(33 * 4)}</div>
        ${t('TUT1')}`,
    },
    {
      title: t('相手の手牌が透けて見える'),
      body: `<div class="tut-tiles">${[1, 37, 73, 0, 0].map((id, i) => i < 3 ? clear(id) : tileHtml(null, { size: 'hand' })).join('')}</div>
        ${t('TUT2')}`,
    },
    {
      title: t('自分の手も見られている'),
      body: t('TUT3'),
    },
    {
      title: t('操作のしかた'),
      body: t('TUT4'),
    },
    {
      title: t('手牌ビューで読み合う'),
      body: t('TUT5'),
    },
  ];
  const pg = pages[page];
  setScreen(`
  <div class="screen rules">
    <div class="card wide tutorial">
      <div class="tut-step">${page + 1} / ${pages.length}</div>
      <h2>${pg.title}</h2>
      ${pg.body}
      <div class="row2">
        <button class="big" id="prev" ${page === 0 ? 'disabled' : ''}>${t('前へ')}</button>
        <button class="big primary" id="next">${page === pages.length - 1 ? t('はじめる') : t('次へ')}</button>
      </div>
      <button class="link" id="skip">${t('スキップ')}</button>
    </div>
  </div>`);
  const done = () => { try { localStorage.setItem('tmj-tutorial', '1'); } catch { /* noop */ } titleScreen(); };
  document.getElementById('prev')!.addEventListener('click', () => tutorialScreen(page - 1));
  document.getElementById('next')!.addEventListener('click', () => (page === pages.length - 1 ? done() : tutorialScreen(page + 1)));
  document.getElementById('skip')!.addEventListener('click', done);
}

function rulesScreen() {
  setScreen(`
  <div class="screen rules">
    <div class="card wide">
      ${t('RULES_HTML')}
      <button class="big primary" id="back">${t('戻る')}</button>
    </div>
  </div>`);
  document.getElementById('back')!.addEventListener('click', () => titleScreen());
}

// ---------------------------------------------------------------- CPU対戦

function startCpuGame(name: string) {
  setScreen('');
  const count = store.count;
  const seat = Math.floor(Math.random() * count);
  const cpuNames = [t('CPU 白鷺'), t('CPU 烏'), t('CPU 鷹')];
  const names: string[] = [];
  let ci = 0;
  for (let s = 0; s < count; s++) names.push(s === seat ? name : cpuNames[ci++]);
  let table: TableUI;
  const links = names.map((_, s) => (s === seat ? { send: (v: GameView) => table.update(v) } : {}));
  const host = new GameHost(
    { names, cpu: names.map((_, s) => s !== seat), length: store.length, rules: store.rules },
    links, { timed: false },
  );
  table = new TableUI(app, (a) => host.action(seat, a), () => exitAfterGame(table.view?.phase === 'gameEnd'), count === 3 ? t('CPU対戦（三麻）') : t('CPU対戦'));
  table.tracker = new GameTracker('cpu');
  cleanup = () => { host.stop(); table.destroy(); };
  host.start();
}

// ---------------------------------------------------------------- オンライン

function lobbyHtml(code: string, members: Member[], isHost: boolean, rules: Rules = store.rules): string {
  const seats = Array.from({ length: Math.max(rules.count, members.length) }, (_, i) => i).map((i) => {
    const m = members[i];
    return `<div class="lseat ${m ? 'filled' : ''}">${m ? `${esc(m.name)}${m.host ? ` <span class="badge">${t('ホスト')}</span>` : ''}` : `<span class="empty">${t('空席（CPU）')}</span>`}</div>`;
  }).join('');
  const url = `${location.origin}${location.pathname}?room=${code}`;
  return `
  <div class="screen lobby">
    <div class="card">
      <h2>${isHost ? t('ルームを作成しました') : t('ルームに参加しました')}</h2>
      <div class="codebox"><span class="clabel">${t('ルームコード')}</span><span class="code">${code}</span></div>
      <div class="row2">
        <button class="big" id="copy">${t('コードをコピー')}</button>
        <button class="big" id="share">${t('招待リンクを共有')}</button>
      </div>
      <input class="urlbox" readonly value="${esc(url)}">
      <div class="seats">${seats}</div>
      ${isHost
        ? `<h3 class="lh">${t('ルール設定')}</h3>${rulesPanelHtml(rules)}
          <button class="big primary" id="start">${t('対局開始（空席はCPU）')}</button>`
        : `${rulesSummaryHtml(rules)}<div class="waiting">${t('ホストが開始するのを待っています…')}</div>`}
      <button class="link" id="leave">${t('退出')}</button>
      <div class="err" id="err"></div>
    </div>
  </div>`;
}

function bindLobby(code: string, leave: () => void, onRules: (r: Rules) => void = () => {}) {
  const url = `${location.origin}${location.pathname}?room=${code}`;
  document.getElementById('copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); flash(t('コピーしました')); } catch { flash(code); }
  });
  document.getElementById('share')?.addEventListener('click', async () => {
    const text = t('透明麻雀で対戦しよう！ ルームコード: {code}', { code });
    if (navigator.share) {
      try { await navigator.share({ title: t('透明麻雀'), text, url }); } catch { /* キャンセル */ }
    } else {
      try { await navigator.clipboard.writeText(`${text}\n${url}`); flash(t('招待リンクをコピーしました')); } catch { flash(url); }
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
  setScreen(`<div class="screen"><div class="card"><div class="waiting">${joinCode ? t('接続中…') : t('ルームを作成中…')}</div></div></div>`);
  let code: string;
  try {
    code = joinCode ?? await createRoomCode();
  } catch (e) {
    titleScreen(t('ルームを作成できませんでした（{msg}）', { msg: t((e as Error).message) }));
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
        document.getElementById('err')!.textContent = t('三人麻雀は3人までです。四人麻雀に切り替えてください');
        return;
      }
      room.start(store.rules);
    });
  };
  room.onView = (v) => {
    if (!table) {
      app.querySelector('.screen')?.remove();
      table = new TableUI(app, (a) => room.act(a), leave, t('ルーム {code}', { code }));
      table.tracker = new GameTracker('online');
    }
    table.update(v);
    activeRoom.set(v.phase === 'gameEnd' ? null : code);
  };
  room.onError = (m, fatal, errCode) => {
    if (fatal) { activeRoom.set(null); room.close(); titleScreen(t(m)); return; }
    const el = document.getElementById('err');
    if (el) {
      el.textContent = errCode === 'quota-other' ? t('本日の無料オンライン対局を使い切った参加者がいます') : t(m);
      if (errCode === 'quota') {
        el.insertAdjacentHTML('beforeend', `<br><button class="link" id="to-premium">${t('プレミアム会員について')}</button>`);
        document.getElementById('to-premium')?.addEventListener('click', () => { room.close(); activeRoom.set(null); void premiumScreen(); });
      }
    } else flash(t(m));
  };
  room.onConnection = (ok) => { if (!ok) flash(t('通信が切れました。再接続しています…')); };
  room.onClosed = () => {
    if (table?.view?.phase === 'gameEnd') return;
    room.close();
    titleScreen(t('サーバーとの接続が終了しました'));
  };
  cleanup = () => { table?.destroy(); room.close(); };
  try {
    await room.connect();
    activeRoom.set(code);
  } catch (e) {
    activeRoom.set(null);
    room.close();
    titleScreen(t((e as Error).message));
  }
}

async function createRoom(name: string) {
  if (useServer) { void serverRoom(name, null); return; }
  setScreen(`<div class="screen"><div class="card"><div class="waiting">${t('ルームを作成中…')}</div></div></div>`);
  const room = new RoomHost(name);
  let code: string;
  try {
    code = await room.open();
  } catch (e) {
    titleScreen(t('ルームを作成できませんでした（{msg}）', { msg: t((e as Error).message) }));
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
        document.getElementById('err')!.textContent = t('三人麻雀は3人までです。四人麻雀に切り替えてください');
        return;
      }
      table = new TableUI(app, (a) => room.act(a), leave, t('ルーム {code}', { code }));
      table.tracker = new GameTracker('online');
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
      <h2>${t('コードで参加')}</h2>
      <label class="field"><span>${t('プレイヤー名')}</span><input id="name" maxlength="12" value="${esc(name)}"></label>
      <label class="field"><span>${t('ルームコード')}</span><input id="code" class="codeinput" maxlength="8" autocomplete="off" value="${esc(preset)}" placeholder="ABC123"></label>
      <button class="big primary" id="go">${t('参加する')}</button>
      <button class="link" id="back">${t('戻る')}</button>
      <div class="err" id="err"></div>
    </div>
  </div>`);
  const go = () => {
    const code = normalizeCode((document.getElementById('code') as HTMLInputElement).value);
    if (code.length < 4) {
      document.getElementById('err')!.textContent = t('コードを入力してください');
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
  setScreen(`<div class="screen"><div class="card"><div class="waiting">${t('接続中…')}</div></div></div>`);
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
      table = new TableUI(app, (a) => client.act(a), leave, t('ルーム {code}', { code }));
      table.tracker = new GameTracker('online');
    }
    table.update(v);
  };
  client.onError = (m) => {
    if (!table) { client.close(); titleScreen(t(m)); } else flash(t(m));
  };
  client.onClosed = () => {
    if (table?.view?.phase === 'gameEnd') return;
    client.close();
    titleScreen(t('ホストとの接続が終了しました'));
  };
  cleanup = () => { table?.destroy(); client.close(); };
  try {
    await client.join();
  } catch (e) {
    client.close();
    titleScreen(t((e as Error).message));
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

/** PC版（Steam）: Steam の名前を初期名にし、購入者としてサーバーに登録する */
async function steamStartup() {
  if (!(await platform.steamAvailable())) return;
  await records.syncFromCloud();
  // 以前に解除した実績を Steam にも反映（オフライン中に解除した分など）
  for (const id of Object.keys(records.data.achievements)) platform.unlockAchievement(id);
  const sl = await platform.steamLanguage();
  if (sl) suggestLang(sl === 'japanese' ? 'ja' : 'en');
  if (!store.name) {
    const n = await platform.steamName();
    if (n) store.name = sanitizeName(n, '');
  }
  const ticket = await platform.steamAuthTicket();
  if (ticket) await registerSteam(ticket);
}

void detectServer().then(async () => {
  await steamStartup();
  if (roomParam) {
    history.replaceState(null, '', location.pathname);
    joinScreen(store.name, normalizeCode(roomParam));
  } else {
    let seen = false;
    try { seen = localStorage.getItem('tmj-tutorial') === '1'; } catch { /* noop */ }
    if (seen) titleScreen(); else tutorialScreen();
  }
});

records.onUnlock((a) => flash(t('実績解除：{name}', { name: t(a.name) })));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
