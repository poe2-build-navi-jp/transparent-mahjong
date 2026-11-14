import type { Action, GameView, Options, PlayerView, RoundResult } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import {
  countsOfIds, isOpaque, kindOf, WIND_NAMES, type Kind, type TileId,
} from '../engine/tiles';
import type { Meld } from '../engine/types';
import { audio, type VoiceKind } from './audio';
import { haptics } from './haptics';
import { tileFaceSvg } from './tileSvg';

type Size = 'hand' | 'pond' | 'opp' | 'meld' | 'small' | 'dora';

interface TileOpts {
  size: Size;
  side?: boolean;
  cls?: string;
  attrs?: string;
}

export function tileHtml(id: TileId | null, o: TileOpts): string {
  const cls = ['tile', `t-${o.size}`];
  if (id === null || id < 0) cls.push('back');
  else cls.push(isOpaque(id) ? 'opaque' : 'clear');
  if (o.side) cls.push('side');
  if (o.cls) cls.push(o.cls);
  const face = id === null || id < 0 ? '' : `<div class="face">${tileFaceSvg(kindOf(id))}</div>`;
  return `<div class="${cls.join(' ')}" ${o.attrs ?? ''}>${face}</div>`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const CALL_TEXT: Record<string, string> = {
  pon: 'ポン', chi: 'チー', kan: 'カン', riichi: 'リーチ', ron: 'ロン', tsumo: 'ツモ', draw: '流局', nuki: '北',
};

interface Settings {
  autoWin: boolean;
  noCalls: boolean;
  autoDiscard: boolean;
  /** 自動理牌（オフなら手牌は自分で並べ替える） */
  autoSort: boolean;
}

function loadSettings(): Settings {
  try {
    return { autoWin: false, noCalls: false, autoDiscard: false, autoSort: false, ...JSON.parse(localStorage.getItem('tmj-settings') ?? '{}') };
  } catch {
    return { autoWin: false, noCalls: false, autoDiscard: false, autoSort: false };
  }
}

export class TableUI {
  private stage: HTMLElement;
  private wrap: HTMLElement;
  view: GameView | null = null;
  private mode: 'normal' | 'riichi' | 'chi' | 'kan' = 'normal';
  private selected: TileId | null = null;
  private pointerType = 'mouse';
  private settings = loadSettings();
  private lastEventSeq = 0;
  private localDeadline: number | null = null;
  private timerHandle: ReturnType<typeof setInterval>;
  private autoHandle: ReturnType<typeof setTimeout> | null = null;
  private hoverTile: TileId | null = null;
  private sentForVersion = '';
  /** 自分で並べた手牌の順番（ツモ牌を手牌に入れた場合はそれも含む） */
  private handOrder: TileId[] = [];
  private drag: {
    id: TileId; el: HTMLElement; startX: number; startY: number; moved: boolean;
    ux: number; uy: number; scale: number; slots: { id: TileId; cx: number; cy: number }[];
  } | null = null;
  private suppressClick = false;
  private renderPending = false;

  constructor(
    root: HTMLElement,
    private send: (a: Action) => void,
    private onExit: () => void,
    private label: string,
  ) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'stage-wrap';
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.wrap.appendChild(this.stage);
    root.appendChild(this.wrap);
    this.fit();
    window.addEventListener('resize', this.fit);
    this.stage.addEventListener('pointerdown', (e) => { this.pointerType = e.pointerType || 'mouse'; });
    this.stage.addEventListener('click', this.onClick);
    this.stage.addEventListener('pointerdown', this.onDragStart);
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragEnd);
    this.stage.addEventListener('mouseover', this.onHover);
    this.timerHandle = setInterval(() => this.tickTimer(), 250);
    this.stage.innerHTML = '<div class="loading">配牌中…</div>';
    audio.startBgm();
  }

  destroy() {
    window.removeEventListener('resize', this.fit);
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragEnd);
    clearInterval(this.timerHandle);
    if (this.autoHandle) clearTimeout(this.autoHandle);
    this.wrap.remove();
  }

  private fit = () => {
    // ノッチ・ホームバーを除いた領域に収める
    const w = this.wrap.clientWidth || window.innerWidth;
    const h = this.wrap.clientHeight || window.innerHeight;
    const portrait = h > w * 1.05;
    const scale = portrait ? Math.min(h / 1280, w / 720) : Math.min(w / 1280, h / 720);
    this.stage.style.transform = portrait
      ? `translate(-50%, -50%) rotate(90deg) scale(${scale})`
      : `translate(-50%, -50%) scale(${scale})`;
  };

  update(v: GameView) {
    const prev = this.view;
    this.view = v;
    this.localDeadline = v.deadline === null ? null : Date.now() + v.deadline;
    // 選択状態のリセット
    const myTurnChanged = !prev || prev.phase !== v.phase || prev.current !== v.current || !sameOpts(prev.options, v.options);
    if (myTurnChanged) {
      this.mode = 'normal';
      this.selected = null;
    }
    // ドラッグ中は描き直すと掴んでいる牌が消えるので、離すまで待つ
    if (this.drag) this.renderPending = true;
    else this.render(prev);
    if (prev && v.players.some((p, i) => p.discards.length > (prev.players[i]?.discards.length ?? 0))) audio.click();
    if (v.event && v.event.seq !== this.lastEventSeq) {
      if (this.lastEventSeq !== 0 || prev) this.showCall(v);
      this.lastEventSeq = v.event.seq;
    }
    this.scheduleAuto();
  }

  // ------------------------------------------------------------ 自動操作

  private scheduleAuto() {
    if (this.autoHandle) clearTimeout(this.autoHandle);
    this.autoHandle = null;
    const v = this.view;
    const o = v?.options;
    if (!v || !o) return;
    const key = `${v.phase}|${v.current}|${v.wallCount}|${JSON.stringify(o)}`;
    let act: Action | null = null;
    let delay = 350;
    const me = v.players[v.you];
    if (this.settings.autoWin && (o.ron || o.tsumo)) act = { type: o.ron ? 'ron' : 'tsumo' };
    else if (o.pass && !o.ron && this.settings.noCalls) act = { type: 'pass' };
    else if (o.discard && !o.tsumo && !o.ankan && !o.kakan && !o.nuki && me.drawn !== undefined && me.drawn !== null) {
      if (me.riichi || (this.settings.autoDiscard && !o.riichi)) {
        act = { type: 'discard', tile: me.drawn };
        delay = me.riichi ? 600 : 400;
      }
    }
    if (act && this.sentForVersion !== key) {
      const a = act;
      this.autoHandle = setTimeout(() => {
        this.sentForVersion = key;
        this.send(a);
      }, delay);
    }
  }

  // ------------------------------------------------------------ 描画

  private rel(seat: number): number {
    const n = this.view!.players.length;
    const r = (seat - this.view!.you + n) % n;
    // 三麻は対面がいない: 下家=右、上家=左
    return n === 3 && r === 2 ? 3 : r;
  }

  private wind(v: GameView, seat: number): string {
    const n = v.players.length;
    return WIND_NAMES[(seat - v.roundNum + n) % n];
  }

  private render(prev: GameView | null) {
    const v = this.view!;
    const parts: string[] = [];
    parts.push('<div class="felt"></div>');
    parts.push(this.centerHtml(v));
    for (const p of v.players) parts.push(this.layerHtml(v, p, prev));
    parts.push(this.plates(v));
    parts.push(this.doraHtml(v));
    parts.push(this.menuHtml());
    parts.push(this.selfHandHtml(v));
    parts.push(this.actionsHtml(v));
    parts.push(this.infoHtml(v));
    let overlay = '';
    if (v.phase === 'gameEnd' && v.final) overlay = this.finalHtml(v);
    else if (v.phase === 'roundEnd' && v.result) overlay = this.resultHtml(v, v.result);
    if (overlay && prev && prev.phase === v.phase) overlay = overlay.replace('class="overlay"', 'class="overlay instant"');
    parts.push(overlay);
    const callout = this.stage.querySelector('.callout');
    this.stage.innerHTML = parts.join('');
    if (callout) this.stage.appendChild(callout);
    this.tickTimer();
  }

  private centerHtml(v: GameView): string {
    const round = `${WIND_NAMES[v.roundWind]}${v.roundNum + 1}局`;
    const seats = v.players.map((p) => {
      const r = this.rel(p.seat);
      const wind = this.wind(v, p.seat);
      const active = (v.phase === 'turn' || v.phase === 'claims') && v.current === p.seat;
      return `<div class="cseat r${r} ${active ? 'active' : ''} ${wind === '東' ? 'dealer' : ''}">
        <span class="cwind">${wind}</span><span class="cscore">${p.score}</span></div>`;
    }).join('');
    return `<div class="center">
      <div class="cround">${round}</div>
      <div class="csub"><span>${v.honba}本場</span><span>供託 ${v.riichiSticks}</span></div>
      <div class="cwall">残り <b>${v.wallCount}</b></div>
      ${seats}
    </div>`;
  }

  private layerHtml(v: GameView, p: PlayerView, prev: GameView | null): string {
    const r = this.rel(p.seat);
    const prevCount = prev?.players[p.seat].discards.length ?? 0;
    // 河: 6枚×2段 + 3段目以降は横に伸ばす
    const rows: string[][] = [[], [], []];
    p.discards.forEach((d, i) => {
      const row = Math.min(2, Math.floor(i / 6));
      const isLast = v.lastDiscard?.seat === p.seat && i === p.discards.length - 1;
      const cls = [d.called ? 'called' : '', d.tsumogiri ? 'tsumogiri' : '', isLast ? 'last' : '', i >= prevCount && prev ? 'new' : ''].join(' ');
      rows[row].push(tileHtml(d.tile, { size: 'pond', side: d.riichi, cls }));
    });
    const pond = `<div class="pond">${rows.map((x) => `<div class="prow">${x.join('')}</div>`).join('')}</div>`;
    const stick = p.riichi ? '<div class="rstick"><i></i></div>' : '';
    let hand = '';
    if (r !== 0) {
      const tiles = p.hand.map((t) => tileHtml(t, { size: 'opp' })).join('');
      const drawn = p.drawn !== undefined ? `<span class="gap"></span>${tileHtml(p.drawn, { size: 'opp', cls: 'drawn' })}` : '';
      hand = `<div class="ohand ${p.melds.length >= 2 ? 'many' : ''}">${tiles}${drawn}${this.meldsHtml(p.melds, p.seat, 'opp', p.kita)}</div>`;
    }
    return `<div class="layer r${r}">${pond}${stick}${hand}</div>`;
  }

  private meldsHtml(melds: Meld[], seat: number, size: Size, kita: TileId[] = []): string {
    if (!melds.length && !kita.length) return '';
    const n = this.view!.players.length;
    const out = melds.map((m) => {
      let fromRel = m.from === undefined ? 0 : (m.from - seat + n) % n; // 1=下家 2=対面 3=上家
      if (n === 3 && fromRel === 2) fromRel = 3;
      let tiles = m.tiles.filter((t) => t !== m.called);
      const html: string[] = [];
      if (m.type === 'ankan') {
        return `<div class="meld">${m.tiles.map((t, i) => tileHtml(i === 0 || i === 3 ? null : t, { size })).join('')}</div>`;
      }
      if (m.type === 'kakan') {
        const added = m.tiles[m.tiles.length - 1];
        tiles = m.tiles.filter((t) => t !== m.called && t !== added);
        const calledIdx = fromRel === 3 ? 0 : fromRel === 2 ? 1 : 2;
        const seq: string[] = tiles.map((t) => tileHtml(t, { size }));
        seq.splice(calledIdx, 0, `<div class="kakan-stack">${tileHtml(m.called!, { size, side: true })}${tileHtml(added, { size, side: true })}</div>`);
        return `<div class="meld">${seq.join('')}</div>`;
      }
      if (m.type === 'chi') {
        tiles.sort((a, b) => a - b);
        html.push(tileHtml(m.called!, { size, side: true }), ...tiles.map((t) => tileHtml(t, { size })));
        return `<div class="meld">${html.join('')}</div>`;
      }
      const calledIdx = fromRel === 3 ? 0 : fromRel === 2 ? 1 : tiles.length;
      const seq = tiles.map((t) => tileHtml(t, { size }));
      seq.splice(calledIdx, 0, tileHtml(m.called!, { size, side: true }));
      return `<div class="meld">${seq.join('')}</div>`;
    });
    if (kita.length) out.push(`<div class="meld kita">${kita.map((t) => tileHtml(t, { size })).join('')}<span class="klabel">抜きドラ</span></div>`);
    return `<div class="melds">${out.join('')}</div>`;
  }

  private plates(v: GameView): string {
    return v.players.map((p) => {
      const r = this.rel(p.seat);
      const wind = this.wind(v, p.seat);
      const badge = !p.connected ? '<span class="badge off">切断・代打ち</span>' : p.isCpu ? '<span class="badge">CPU</span>' : '';
      const active = (v.phase === 'turn' || v.phase === 'claims') && v.current === p.seat;
      return `<div class="plate p${r} ${active ? 'active' : ''}">
        <div class="avatar w${wind}">${wind}</div>
        <div class="pinfo"><div class="pname">${esc(p.name)} ${badge}</div>
        <div class="pscore">${p.score.toLocaleString()}${p.riichi ? ' <span class="rbadge">立直</span>' : ''}</div></div>
      </div>`;
    }).join('');
  }

  private doraHtml(v: GameView): string {
    const tiles: string[] = [];
    for (let i = 0; i < 5; i++) tiles.push(tileHtml(v.doraIndicators[i] ?? null, { size: 'dora' }));
    return `<div class="dora"><div class="dlabel">ドラ表示</div><div class="dtiles">${tiles.join('')}</div></div>`;
  }

  private menuHtml(): string {
    const s = this.settings;
    const t = (key: keyof Settings, label: string) =>
      `<button class="toggle ${s[key] ? 'on' : ''}" data-toggle="${key}">${label}</button>`;
    return `<div class="menu">
      <button class="exit" data-exit="1">退出</button>
      <div class="mlabel">${esc(this.label)}</div>
      <div class="toggles">${t('autoWin', '自動和了')}${t('noCalls', '鳴きなし')}${t('autoDiscard', 'ツモ切り')}${t('autoSort', '自動理牌')}
        <button class="toggle ${audio.settings.bgm ? 'on' : ''}" data-audio="bgm">BGM</button>
        <button class="toggle ${audio.settings.voice ? 'on' : ''}" data-audio="voice">音声</button>
        <button class="toggle ${haptics.enabled ? 'on' : ''}" data-vibe="1">振動</button></div>
    </div>`;
  }

  /** 自分の手牌情報（何を切ればテンパイか） */
  private discardAnalysis(v: GameView): Map<Kind, { waits: Kind[]; shanten: number }> {
    const me = v.players[v.you];
    const full = [...me.hand, ...(me.drawn !== undefined && me.drawn !== null ? [me.drawn] : [])] as TileId[];
    const res = new Map<Kind, { waits: Kind[]; shanten: number }>();
    if (full.length % 3 !== 2) return res;
    const c = countsOfIds(full);
    const melds = me.melds.length;
    for (const t of full) {
      const k = kindOf(t);
      if (res.has(k)) continue;
      c[k]--;
      const sh = shanten(c, melds);
      res.set(k, { shanten: sh, waits: sh === 0 ? waitingKinds(c, melds) : [] });
      c[k]++;
    }
    return res;
  }

  private remaining(v: GameView, k: Kind): number {
    let seen = 0;
    for (const p of v.players) {
      for (const t of p.hand) if (t !== null && kindOf(t) === k) seen++;
      if (p.drawn !== undefined && p.drawn !== null && kindOf(p.drawn) === k) seen++;
      for (const d of p.discards) if (!d.called && kindOf(d.tile) === k) seen++;
      for (const m of p.melds) for (const t of m.tiles) if (kindOf(t) === k) seen++;
      if (k === 30) seen += p.kita.length;
    }
    for (const t of v.doraIndicators) if (kindOf(t) === k) seen++;
    return Math.max(0, 4 - seen);
  }

  private selfHandHtml(v: GameView): string {
    const me = v.players[v.you];
    const o = v.options;
    const canDiscard = !!o?.discard && v.phase === 'turn';
    const allowed = new Set<TileId>(this.mode === 'riichi' ? o?.riichi ?? [] : o?.discard ?? []);
    const analysis = canDiscard ? this.discardAnalysis(v) : null;
    const tile = (t: TileId, extra = '') => {
      const cls = [extra];
      if (canDiscard) {
        if (!allowed.has(t)) cls.push('disabled');
        else cls.push('playable');
        const a = analysis?.get(kindOf(t));
        if (a && a.shanten === 0 && a.waits.length) cls.push('keeps-tenpai');
      }
      if (this.selected === t) cls.push('selected');
      return tileHtml(t, { size: 'hand', cls: cls.join(' '), attrs: `data-tile="${t}"` });
    };
    const { hand: order, drawn: drawnId } = this.displayHand(v);
    const hand = order.map((t) => tile(t)).join('');
    const drawn = drawnId !== null ? `<span class="gap"></span>${tile(drawnId, 'drawn')}` : '';
    return `<div class="myhand ${this.settings.autoSort ? '' : 'free'}">${hand}${drawn}</div><div class="mymelds">${this.meldsHtml(me.melds, me.seat, 'meld', me.kita)}</div>`;
  }

  /** 表示する手牌の並びと、別置きにするツモ牌 */
  private displayHand(v: GameView): { hand: TileId[]; drawn: TileId | null } {
    const me = v.players[v.you];
    const hand = me.hand as TileId[];
    const drawn = me.drawn !== undefined && me.drawn !== null ? me.drawn : null;
    if (this.settings.autoSort) {
      this.handOrder = [];
      return { hand: [...hand].sort((a, b) => a - b), drawn };
    }
    // 自分の並びを保ったまま、なくなった牌を除き、新しく入った牌は右端に足す
    const present = new Set<TileId>(hand);
    if (drawn !== null && this.handOrder.includes(drawn)) present.add(drawn);
    const order = this.handOrder.filter((t) => present.has(t));
    for (const t of hand) if (!order.includes(t)) order.push(t);
    this.handOrder = order;
    return { hand: order, drawn: drawn !== null && !order.includes(drawn) ? drawn : null };
  }

  private actionsHtml(v: GameView): string {
    const o = v.options;
    if (!o || v.phase === 'roundEnd' || v.phase === 'gameEnd') return '<div class="actions"></div>';
    const btn = (act: string, label: string, cls = '') => `<button class="abtn ${cls}" data-act="${act}">${label}</button>`;
    const b: string[] = [];
    if (this.mode === 'riichi') {
      b.push(`<div class="hint">立直宣言する牌を選んでください</div>`, btn('cancel', 'キャンセル', 'gray'));
    } else if (this.mode === 'chi') {
      for (const [i, tiles] of (o.chi ?? []).entries()) {
        const called = v.lastDiscard!.tile;
        const all = [...tiles, called].sort((a, b) => a - b);
        b.push(`<button class="abtn choice" data-chi="${i}">${all.map((t) => tileHtml(t, { size: 'small', cls: t === called ? 'hl' : '' })).join('')}</button>`);
      }
      b.push(btn('cancel', '戻る', 'gray'));
    } else if (this.mode === 'kan') {
      for (const k of o.ankan ?? []) b.push(`<button class="abtn choice" data-ankan="${k}">${tileHtml(k * 4 + 1, { size: 'small' })} 暗槓</button>`);
      for (const t of o.kakan ?? []) b.push(`<button class="abtn choice" data-kakan="${t}">${tileHtml(t, { size: 'small' })} 加槓</button>`);
      b.push(btn('cancel', '戻る', 'gray'));
    } else {
      if (o.ron) b.push(btn('ron', 'ロン', 'red'));
      if (o.tsumo) b.push(btn('tsumo', 'ツモ', 'red'));
      if (o.riichi) b.push(btn('riichi', 'リーチ', 'orange'));
      if (o.pon) b.push(btn('pon', 'ポン', 'blue'));
      if (o.chi) b.push(btn('chi', 'チー', 'green'));
      if (o.minkan || o.ankan || o.kakan) b.push(btn('kan', 'カン', 'purple'));
      if (o.nuki) b.push(btn('nuki', '北抜き', 'green'));
      if (o.pass) b.push(btn('pass', 'スキップ', 'gray'));
    }
    return `<div class="actions">${b.join('')}</div>`;
  }

  private infoHtml(v: GameView): string {
    const me = v.players[v.you];
    let waitsHtml = '';
    let waits = v.waits;
    let title = '待ち';
    // ホバー中の牌を切った場合の待ち
    if (this.hoverTile !== null && v.options?.discard) {
      const a = this.discardAnalysis(v).get(kindOf(this.hoverTile));
      if (a) {
        waits = a.waits;
        title = a.shanten === 0 ? '打牌後の待ち' : `${a.shanten}向聴`;
        if (a.shanten > 0) waits = [];
        if (a.shanten > 0) waitsHtml = `<div class="waits"><span class="wtitle">${title}</span></div>`;
      }
    }
    if (waits.length) {
      waitsHtml = `<div class="waits"><span class="wtitle">${title}</span>${waits.map((k) =>
        `<span class="w">${tileHtml(k * 4 + 1, { size: 'small' })}<em>${this.remaining(v, k)}</em></span>`).join('')}
        ${v.furiten && title === '待ち' ? '<span class="furiten">フリテン</span>' : ''}</div>`;
    }
    void me;
    return `<div class="info">${waitsHtml}</div><div class="timer"></div>`;
  }

  private resultHtml(v: GameView, r: RoundResult): string {
    const name = (s: number) => esc(v.players[s].name);
    let body = '';
    if (r.kind === 'win') {
      body = r.wins.map((w) => {
        const hand = w.hand.filter((t) => t !== w.winTile);
        const res = w.result;
        const yaku = res.yaku.map((y) => `<li><span>${esc(y.name)}</span><b>${y.yakuman ? (y.yakuman > 1 ? 'ダブル役満' : '役満') : y.han + '翻'}</b></li>`).join('');
        const summary = res.yakuman ? res.limitName : `${res.fu}符 ${res.han}翻${res.limitName ? ' ' + res.limitName : ''}`;
        return `<div class="win">
          <div class="wtitle2">${name(w.seat)} <span class="how">${w.from === null ? 'ツモ' : `ロン ← ${name(w.from)}`}</span></div>
          <div class="whand">${hand.map((t) => tileHtml(t, { size: 'meld' })).join('')}<span class="gap"></span>${tileHtml(w.winTile, { size: 'meld', cls: 'hl' })}${this.meldsHtml(w.melds, w.seat, 'small', w.kita)}</div>
          <div class="wdora"><span>ドラ</span>${r.doraIndicators.map((t) => tileHtml(t, { size: 'small' })).join('')}
            ${r.uraIndicators.length ? `<span>裏ドラ</span>${r.uraIndicators.map((t) => tileHtml(t, { size: 'small' })).join('')}` : ''}</div>
          <ul class="yaku">${yaku}</ul>
          <div class="wpoints">${summary}<b>${w.points.toLocaleString()}点</b></div>
        </div>`;
      }).join('');
    } else {
      body = `<div class="draw"><div class="wtitle2">流局</div>${v.players.map((p) => {
        const hand = r.revealed[p.seat];
        return `<div class="drow"><span class="dname">${esc(p.name)}</span><span class="${r.tenpai[p.seat] ? 'tp' : 'nt'}">${r.tenpai[p.seat] ? '聴牌' : '不聴'}</span>
          <span class="dhand">${hand ? hand.map((t) => tileHtml(t, { size: 'small' })).join('') : ''}</span></div>`;
      }).join('')}</div>`;
    }
    const scores = v.players.map((p) => {
      const d = r.deltas[p.seat];
      return `<div class="srow"><span>${this.wind(v, p.seat)}</span><span class="sname">${esc(p.name)}</span><span class="sval">${r.scores[p.seat].toLocaleString()}</span><span class="delta ${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${d ? d.toLocaleString() : ''}</span></div>`;
    }).join('');
    const ready = v.options?.ready ? '<button class="abtn ok" data-act="ready">OK</button>' : '<div class="waiting">他のプレイヤーを待っています…</div>';
    return `<div class="overlay"><div class="panel result">${body}<div class="scores">${scores}</div>${ready}</div></div>`;
  }

  private finalHtml(v: GameView): string {
    const rows = v.final!.ranking.map((x) => `<div class="frow rank${x.rank} ${x.seat === v.you ? 'me' : ''}"><span class="rk">${x.rank}位</span><span class="fname">${esc(x.name)}</span><span class="fscore">${x.score.toLocaleString()}</span></div>`).join('');
    const me = v.final!.ranking.find((x) => x.seat === v.you)!;
    const msg = me.rank === 1 ? '勝利！' : `${me.rank}位`;
    return `<div class="overlay"><div class="panel final"><div class="ftitle">対局終了</div><div class="fmsg">${msg}</div>${rows}
      <div class="fbtns"><button class="abtn blue" data-exit="1">タイトルへ</button></div></div></div>`;
  }

  // ------------------------------------------------------------ 演出

  private showCall(v: GameView) {
    const e = v.event!;
    const text = CALL_TEXT[e.kind];
    if (!text) return;
    if (e.kind !== 'draw' && e.kind !== 'nuki') audio.voice(e.kind as VoiceKind);
    haptics.tap(e.kind === 'ron' || e.kind === 'tsumo' ? 'heavy' : 'medium');
    const old = this.stage.querySelector('.callout');
    old?.remove();
    const el = document.createElement('div');
    el.className = `callout c${this.rel(e.seat)} k-${e.kind}`;
    el.textContent = text;
    this.stage.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  private tickTimer() {
    const el = this.stage.querySelector('.timer') as HTMLElement | null;
    if (!el) return;
    const v = this.view;
    if (!v || this.localDeadline === null || !v.options) {
      el.textContent = '';
      el.classList.remove('show');
      return;
    }
    const sec = Math.max(0, Math.ceil((this.localDeadline - Date.now()) / 1000));
    el.textContent = String(sec);
    el.classList.add('show');
    el.classList.toggle('urgent', sec <= 5);
  }

  // ------------------------------------------------------------ 入力

  private onHover = (e: MouseEvent) => {
    if (this.pointerType !== 'mouse') return;
    const t = (e.target as HTMLElement).closest('[data-tile]') as HTMLElement | null;
    const id = t ? Number(t.dataset.tile) : null;
    if (id === this.hoverTile) return;
    this.hoverTile = id;
    const v = this.view;
    if (!v) return;
    const info = this.stage.querySelector('.info');
    if (info) info.outerHTML = this.infoHtml(v).replace('<div class="timer"></div>', '');
  };

  // ------------------------------------------------------------ 手牌の並べ替え（ドラッグ）

  private onDragStart = (e: PointerEvent) => {
    if (this.settings.autoSort || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = (e.target as HTMLElement).closest('.myhand [data-tile]') as HTMLElement | null;
    if (!el) return;
    const tiles = [...this.stage.querySelectorAll<HTMLElement>('.myhand [data-tile]')];
    if (tiles.length < 2) return;
    // 画面の拡大縮小・縦持ち回転に関係なく扱えるよう、手牌の並ぶ向きと縮尺を実測する
    const c = (t: HTMLElement) => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const a = c(tiles[0]);
    const b = c(tiles[1]);
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const local = tiles[1].offsetLeft - tiles[0].offsetLeft || 1;
    this.drag = {
      id: Number(el.dataset.tile), el, startX: e.clientX, startY: e.clientY, moved: false,
      ux: (b.x - a.x) / dist, uy: (b.y - a.y) / dist, scale: dist / local,
      slots: tiles.map((t) => ({ id: Number(t.dataset.tile), cx: c(t).x, cy: c(t).y })),
    };
  };

  private onDragMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 10) return;
      d.moved = true;
      d.el.classList.add('dragging');
    }
    e.preventDefault();
    // 手牌の並ぶ向きに沿った移動量（ステージ座標）
    const along = (dx * d.ux + dy * d.uy) / d.scale;
    const across = (-dx * d.uy + dy * d.ux) / d.scale;
    d.el.style.transform = `translate(${along}px, ${Math.min(0, across)}px)`;
  };

  private onDragEnd = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!d.moved) {
      if (this.renderPending && this.view) { this.renderPending = false; this.render(this.view); }
      return;
    }
    this.suppressClick = true;
    setTimeout(() => { this.suppressClick = false; }, 0);
    // 指を離した位置に最も近い隙間へ入れる
    const along = (p: { cx: number; cy: number }) => p.cx * d.ux + p.cy * d.uy;
    const pos = e.clientX * d.ux + e.clientY * d.uy;
    const others = d.slots.filter((s) => s.id !== d.id);
    let idx = others.findIndex((s) => pos < along(s));
    if (idx < 0) idx = others.length;
    const order = others.map((s) => s.id);
    order.splice(idx, 0, d.id);
    this.handOrder = order;
    this.renderPending = false;
    if (this.view) this.render(this.view);
  };

  private onClick = (e: MouseEvent) => {
    if (this.suppressClick) { this.suppressClick = false; return; }
    const target = e.target as HTMLElement;
    const v = this.view;
    if (target.closest('[data-exit]')) {
      if (v?.phase === 'gameEnd' || confirm('対局を退出しますか？')) this.onExit();
      return;
    }
    const vb = target.closest('[data-vibe]') as HTMLElement | null;
    if (vb) { vb.classList.toggle('on', haptics.toggle()); return; }
    const au = target.closest('[data-audio]') as HTMLElement | null;
    if (au) {
      au.classList.toggle('on', audio.toggle(au.dataset.audio as 'bgm' | 'voice'));
      return;
    }
    const tg = target.closest('[data-toggle]') as HTMLElement | null;
    if (tg) {
      const key = tg.dataset.toggle as keyof Settings;
      this.settings[key] = !this.settings[key];
      try { localStorage.setItem('tmj-settings', JSON.stringify(this.settings)); } catch { /* 保存不可 */ }
      tg.classList.toggle('on', this.settings[key]);
      if (key === 'autoSort') this.render(v);
      this.scheduleAuto();
      return;
    }
    if (!v) return;
    const o = v.options;
    const btn = target.closest('[data-act],[data-chi],[data-ankan],[data-kakan]') as HTMLElement | null;
    if (btn && o) {
      this.handleButton(btn, o, v);
      return;
    }
    const tileEl = target.closest('[data-tile]') as HTMLElement | null;
    if (tileEl && o?.discard && v.phase === 'turn') {
      const id = Number(tileEl.dataset.tile);
      const allowed = this.mode === 'riichi' ? o.riichi ?? [] : o.discard;
      if (!allowed.includes(id)) return;
      if (this.pointerType !== 'mouse' && this.selected !== id) {
        this.selected = id;
        this.hoverTile = id;
        this.render(v);
        return;
      }
      haptics.tap('light');
      this.send({ type: 'discard', tile: id, riichi: this.mode === 'riichi' });
      this.mode = 'normal';
      this.selected = null;
      this.hoverTile = null;
    }
  };

  private handleButton(btn: HTMLElement, o: Options, v: GameView) {
    const act = btn.dataset.act;
    if (btn.dataset.chi !== undefined) {
      this.send({ type: 'chi', tiles: o.chi![Number(btn.dataset.chi)] });
      return;
    }
    if (btn.dataset.ankan !== undefined) { this.send({ type: 'ankan', kind: Number(btn.dataset.ankan) }); return; }
    if (btn.dataset.kakan !== undefined) { this.send({ type: 'kakan', tile: Number(btn.dataset.kakan) }); return; }
    switch (act) {
      case 'ron': case 'tsumo': case 'pass': case 'ready': case 'minkan':
        this.send({ type: act } as Action);
        return;
      case 'pon':
        this.send({ type: 'pon', tiles: o.pon![0] });
        return;
      case 'nuki':
        this.send({ type: 'nuki', tile: o.nuki![0] });
        return;
      case 'chi':
        if (o.chi!.length === 1) this.send({ type: 'chi', tiles: o.chi![0] });
        else { this.mode = 'chi'; this.render(v); }
        return;
      case 'kan': {
        const n = (o.ankan?.length ?? 0) + (o.kakan?.length ?? 0) + (o.minkan ? 1 : 0);
        if (o.minkan) this.send({ type: 'minkan' });
        else if (n === 1 && o.ankan?.length) this.send({ type: 'ankan', kind: o.ankan[0] });
        else if (n === 1 && o.kakan?.length) this.send({ type: 'kakan', tile: o.kakan[0] });
        else { this.mode = 'kan'; this.render(v); }
        return;
      }
      case 'riichi':
        this.mode = 'riichi';
        this.selected = null;
        this.render(v);
        return;
      case 'cancel':
        this.mode = 'normal';
        this.render(v);
        return;
    }
  }
}

function sameOpts(a: Options | null, b: Options | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

