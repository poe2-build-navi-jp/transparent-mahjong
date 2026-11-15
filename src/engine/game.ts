import { evaluateWin, payments, isAgariShape } from './agari';
import { shanten, waitingKinds } from './shanten';
import {
  EAST, NUM_TILES, countsOfIds, isOpaque, kindOf, sortTiles, type Kind, type TileId,
} from './tiles';
import type { Meld, WinResult } from './types';
import { DEFAULT_RULES, isAkaId, sanitizeRules, startScoreOf, type Rules } from './rules';

// ---------------------------------------------------------------- 型

export type Action =
  | { type: 'discard'; tile: TileId; riichi?: boolean }
  | { type: 'tsumo' }
  | { type: 'ankan'; kind: Kind }
  | { type: 'kakan'; tile: TileId }
  | { type: 'nuki'; tile: TileId }
  | { type: 'ron' }
  | { type: 'pon'; tiles: TileId[] }
  | { type: 'chi'; tiles: TileId[] }
  | { type: 'minkan' }
  | { type: 'pass' }
  | { type: 'ready' };

export interface Options {
  discard?: TileId[];
  riichi?: TileId[];
  tsumo?: boolean;
  ankan?: Kind[];
  kakan?: TileId[];
  nuki?: TileId[];
  ron?: boolean;
  pon?: TileId[][];
  chi?: TileId[][];
  minkan?: boolean;
  pass?: boolean;
  ready?: boolean;
}

export interface DiscardInfo {
  tile: TileId;
  tsumogiri: boolean;
  riichi: boolean;
  called: boolean;
}

export interface PlayerState {
  name: string;
  isCpu: boolean;
  hand: TileId[];
  drawn: TileId | null;
  melds: Meld[];
  discards: DiscardInfo[];
  score: number;
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  furitenTemp: boolean;
  furitenRiichi: boolean;
  kuikae: Kind | null;
  discardCount: number;
  /** 抜きドラ（三麻の北） */
  kita: TileId[];
}

export interface WinInfo {
  seat: number;
  from: number | null;
  hand: TileId[];
  melds: Meld[];
  kita: TileId[];
  winTile: TileId;
  result: WinResult;
  points: number;
}

export interface RoundResult {
  kind: 'win' | 'draw';
  wins: WinInfo[];
  tenpai: boolean[];
  deltas: number[];
  scores: number[];
  doraIndicators: TileId[];
  uraIndicators: TileId[];
  /** 公開された手牌（流局時のテンパイ者・和了者） */
  revealed: (TileId[] | null)[];
}

export interface FinalResult {
  ranking: { seat: number; name: string; score: number; rank: number }[];
}

export type Phase = 'turn' | 'claims' | 'chankan' | 'roundEnd' | 'gameEnd';

export interface GameEvent {
  seq: number;
  seat: number;
  kind: 'pon' | 'chi' | 'kan' | 'riichi' | 'ron' | 'tsumo' | 'draw' | 'nuki';
}

export interface GameConfig {
  names: string[];
  cpu: boolean[];
  length: 'tonpu' | 'hanchan';
  startScore?: number;
  /** 詳細ルール（省略時は標準） */
  rules?: Partial<Rules>;
}

// ---------------------------------------------------------------- ビュー

export interface PlayerView {
  seat: number;
  name: string;
  score: number;
  isCpu: boolean;
  connected: boolean;
  /** 自分: 全手牌（ツモ牌を除く）。他人: 透明牌は ID、不透明牌は null（末尾にまとめる） */
  hand: (TileId | null)[];
  /** ツモ牌。他人の不透明牌なら null、無ければ undefined */
  drawn?: TileId | null;
  melds: Meld[];
  discards: DiscardInfo[];
  riichi: boolean;
  kita: TileId[];
}

export interface GameView {
  you: number;
  players: PlayerView[];
  roundWind: number;
  roundNum: number;
  honba: number;
  riichiSticks: number;
  wallCount: number;
  doraIndicators: TileId[];
  current: number;
  phase: Phase;
  lastDiscard: { seat: number; tile: TileId } | null;
  options: Options | null;
  result: RoundResult | null;
  final: FinalResult | null;
  event: GameEvent | null;
  /** 持ち時間の残り（ミリ秒、送信時点） */
  deadline: number | null;
  /** 残りの持ち時間（ミリ秒）。deadline のうちこの分が持ち時間 */
  bank: number | null;
  /** 赤ドラありか（描画用） */
  aka: boolean;
  length: 'tonpu' | 'hanchan';
  /** 自分の待ち（テンパイ時） */
  waits: Kind[];
  furiten: boolean;
}

// ---------------------------------------------------------------- ユーティリティ

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  const rnd = new Uint32Array(a.length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd);
  else for (let i = 0; i < rnd.length; i++) rnd[i] = Math.floor(Math.random() * 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 同種の牌を手牌から n 枚選ぶ（透明牌を優先して晒す＝不透明牌を手元に残す） */
export function pickTiles(hand: TileId[], kind: Kind, n: number): TileId[] | null {
  const cands = hand.filter((t) => kindOf(t) === kind).sort((a, b) => Number(isOpaque(a)) - Number(isOpaque(b)));
  return cands.length >= n ? cands.slice(0, n) : null;
}

export const isClosed = (melds: Meld[]) => melds.every((m) => m.type === 'ankan');

// ---------------------------------------------------------------- ゲーム本体

export class Game {
  players: PlayerState[];
  config: GameConfig;
  roundWind = 0;
  roundNum = 0;
  honba = 0;
  riichiSticks = 0;
  wall: TileId[] = [];
  deadWall: TileId[] = [];
  doraCount = 1;
  kanCount = 0;
  current = 0;
  phase: Phase = 'turn';
  lastDiscard: { seat: number; tile: TileId } | null = null;
  claimOptions = new Map<number, Options>();
  claimResponses = new Map<number, Action>();
  pendingRiichi = false;
  rinshanDraw = false;
  firstGoAround = true;
  chankanTile: TileId | null = null;
  result: RoundResult | null = null;
  final: FinalResult | null = null;
  readySeats = new Set<number>();
  event: GameEvent | null = null;
  eventSeq = 0;
  connected: boolean[] = [true, true, true, true];
  version = 0;
  rules: Rules;

  constructor(config: GameConfig) {
    this.config = config;
    this.rules = sanitizeRules({ ...DEFAULT_RULES, ...config.rules, count: config.names.length === 3 ? 3 : 4, length: config.length });
    const start = config.startScore ?? startScoreOf(this.rules);
    this.players = config.names.map((name, i) => ({
      name, isCpu: config.cpu[i], hand: [], drawn: null, melds: [], discards: [], score: start,
      riichi: false, doubleRiichi: false, ippatsu: false, furitenTemp: false, furitenRiichi: false,
      kuikae: null, discardCount: 0, kita: [],
    }));
    this.startRound();
  }

  get dealer() { return this.roundNum; }
  get n() { return this.players.length; }
  get sanma() { return this.players.length === 3; }
  seats(): number[] { return this.players.map((_, i) => i); }
  seatWind(seat: number): Kind { return EAST + ((seat - this.dealer + this.n) % this.n); }
  get roundWindKind(): Kind { return EAST + this.roundWind; }
  doraIndicators(): TileId[] { return this.deadWall.slice(4, 4 + this.doraCount); }
  uraIndicators(): TileId[] { return this.deadWall.slice(9, 9 + this.doraCount); }

  private emit(seat: number, kind: GameEvent['kind']) {
    this.event = { seq: ++this.eventSeq, seat, kind };
  }

  startRound() {
    // 三麻は萬子の2〜8を使わない（108枚）
    const tiles = shuffle(Array.from({ length: NUM_TILES }, (_, i) => i)
      .filter((t) => !this.sanma || kindOf(t) === 0 || kindOf(t) >= 8));
    this.deadWall = tiles.slice(0, 14);
    this.wall = tiles.slice(14);
    for (const p of this.players) {
      p.hand = this.wall.splice(0, 13);
      p.drawn = null;
      p.melds = [];
      p.discards = [];
      p.riichi = p.doubleRiichi = p.ippatsu = p.furitenTemp = p.furitenRiichi = false;
      p.kuikae = null;
      p.discardCount = 0;
      p.kita = [];
    }
    this.doraCount = 1;
    this.kanCount = 0;
    this.lastDiscard = null;
    this.pendingRiichi = false;
    this.rinshanDraw = false;
    this.firstGoAround = true;
    this.chankanTile = null;
    this.result = null;
    this.readySeats.clear();
    this.claimOptions.clear();
    this.claimResponses.clear();
    this.current = this.dealer;
    this.draw(this.dealer);
    this.version++;
  }

  private draw(seat: number, rinshan = false) {
    const p = this.players[seat];
    let t: TileId;
    if (rinshan) {
      // 王牌 0-3 が嶺上牌。海底は1枚繰り上がる
      t = this.deadWall[this.kanCount - 1];
      this.wall.pop();
    } else {
      t = this.wall.shift()!;
    }
    p.drawn = t;
    p.kuikae = null;
    this.current = seat;
    this.rinshanDraw = rinshan;
    this.phase = 'turn';
  }

  // ------------------------------------------------ 判定

  fullHand(seat: number): TileId[] {
    const p = this.players[seat];
    return p.drawn !== null ? [...p.hand, p.drawn] : [...p.hand];
  }

  waitsOf(seat: number): Kind[] {
    const p = this.players[seat];
    if (p.hand.length % 3 !== 1) return [];
    const c = countsOfIds(p.hand);
    return waitingKinds(c, p.melds.length);
  }

  isFuriten(seat: number): boolean {
    const p = this.players[seat];
    if (p.furitenTemp || p.furitenRiichi) return true;
    const waits = this.waitsOf(seat);
    return p.discards.some((d) => waits.includes(kindOf(d.tile)));
  }

  private winContext(seat: number, hand: TileId[], winTile: TileId, tsumo: boolean, extra: { chankan?: boolean } = {}) {
    const p = this.players[seat];
    const noCalls = this.players.every((q) => q.melds.length === 0);
    const isDealer = seat === this.dealer;
    return evaluateWin({
      hand: hand.map(kindOf),
      melds: p.melds,
      winTile: kindOf(winTile),
      tsumo,
      riichi: p.riichi,
      doubleRiichi: p.doubleRiichi,
      ippatsu: p.ippatsu,
      haitei: tsumo && this.wall.length === 0 && !this.rinshanDraw,
      houtei: !tsumo && this.wall.length === 0 && !extra.chankan,
      rinshan: tsumo && this.rinshanDraw,
      chankan: !!extra.chankan,
      tenhou: tsumo && isDealer && this.firstGoAround && p.discardCount === 0 && noCalls,
      chiihou: tsumo && !isDealer && this.firstGoAround && p.discardCount === 0 && noCalls,
      seatWind: this.seatWind(seat),
      roundWind: this.roundWindKind,
      doraIndicators: this.doraIndicators().map(kindOf),
      uraIndicators: this.uraIndicators().map(kindOf),
      sanma: this.sanma,
      nukiDora: p.kita.length,
      akaDora: this.rules.aka ? [...hand, ...p.melds.flatMap((m) => m.tiles)].filter(isAkaId).length : 0,
      kuitan: this.rules.kuitan,
    });
  }

  optionsFor(seat: number): Options | null {
    const p = this.players[seat];
    if (this.phase === 'roundEnd' || this.phase === 'gameEnd') {
      if (this.phase === 'roundEnd' && !this.readySeats.has(seat)) return { ready: true };
      return null;
    }
    if (this.phase === 'claims' || this.phase === 'chankan') {
      if (this.claimResponses.has(seat)) return null;
      return this.claimOptions.get(seat) ?? null;
    }
    if (this.phase !== 'turn' || seat !== this.current) return null;

    const opts: Options = {};
    const full = this.fullHand(seat);
    const closed = isClosed(p.melds);
    if (p.drawn !== null) {
      // ツモ和了
      const c = countsOfIds(full);
      if (isAgariShape(c) && this.winContext(seat, full, p.drawn, true)) opts.tsumo = true;
      // 槓
      if (!p.riichi && this.kanCount < 4 && this.wall.length > 0) {
        const ankan: Kind[] = [];
        for (let k = 0; k < 34; k++) if (c[k] === 4) ankan.push(k);
        if (ankan.length) opts.ankan = ankan;
        const kakan = p.melds
          .filter((m) => m.type === 'pon')
          .map((m) => full.find((t) => kindOf(t) === kindOf(m.tiles[0])))
          .filter((t): t is TileId => t !== undefined);
        if (kakan.length) opts.kakan = kakan;
      }
      // 北抜き（三麻）
      if (this.sanma && this.wall.length > 0) {
        const norths = (p.riichi ? [p.drawn] : full).filter((t) => kindOf(t) === 30);
        if (norths.length) opts.nuki = norths;
      }
    }
    // 打牌
    if (p.riichi && p.drawn !== null) {
      opts.discard = [p.drawn];
    } else {
      let allowed = full.filter((t) => p.kuikae === null || kindOf(t) !== p.kuikae);
      if (allowed.length === 0) allowed = full;
      opts.discard = allowed;
      // 立直
      if (closed && !p.riichi && p.score >= 1000 && this.wall.length >= this.n && p.drawn !== null) {
        const riichi: TileId[] = [];
        const c = countsOfIds(full);
        const ok = new Map<Kind, boolean>();
        for (const t of full) {
          const k = kindOf(t);
          if (!ok.has(k)) {
            c[k]--;
            ok.set(k, shanten(c, p.melds.length) === 0 && waitingKinds(c, p.melds.length).length > 0);
            c[k]++;
          }
          if (ok.get(k)) riichi.push(t);
        }
        if (riichi.length) opts.riichi = riichi;
      }
    }
    return opts;
  }

  pendingSeats(): number[] {
    if (this.phase === 'turn') return [this.current];
    if (this.phase === 'claims' || this.phase === 'chankan') {
      return [...this.claimOptions.keys()].filter((s) => !this.claimResponses.has(s));
    }
    if (this.phase === 'roundEnd') return this.seats().filter((s) => !this.readySeats.has(s));
    return [];
  }

  // ------------------------------------------------ アクション

  act(seat: number, action: Action): boolean {
    const ok = this.actInner(seat, action);
    if (ok) this.version++;
    return ok;
  }

  private actInner(seat: number, a: Action): boolean {
    if (this.phase === 'roundEnd') {
      if (a.type !== 'ready') return false;
      this.readySeats.add(seat);
      if (this.readySeats.size >= this.n) this.nextRound();
      return true;
    }
    const opts = this.optionsFor(seat);
    if (!opts) return false;

    if (this.phase === 'claims' || this.phase === 'chankan') {
      if (a.type === 'ron' && !opts.ron) return false;
      if (a.type === 'pon' && !opts.pon?.some((x) => sameSet(x, a.tiles))) return false;
      if (a.type === 'chi' && !opts.chi?.some((x) => sameSet(x, a.tiles))) return false;
      if (a.type === 'minkan' && !opts.minkan) return false;
      if (!['ron', 'pon', 'chi', 'minkan', 'pass'].includes(a.type)) return false;
      this.claimResponses.set(seat, a);
      if (this.pendingSeats().length === 0) this.resolveClaims();
      return true;
    }

    // 手番
    const p = this.players[seat];
    switch (a.type) {
      case 'tsumo': {
        if (!opts.tsumo) return false;
        const full = this.fullHand(seat);
        const res = this.winContext(seat, full, p.drawn!, true)!;
        this.emit(seat, 'tsumo');
        this.finishWins([{ seat, from: null, hand: full, winTile: p.drawn!, result: res }]);
        return true;
      }
      case 'discard': {
        if (!opts.discard?.includes(a.tile)) return false;
        if (a.riichi && !opts.riichi?.includes(a.tile)) return false;
        this.doDiscard(seat, a.tile, !!a.riichi);
        return true;
      }
      case 'ankan': {
        if (!opts.ankan?.includes(a.kind)) return false;
        const full = this.fullHand(seat);
        const tiles = full.filter((t) => kindOf(t) === a.kind);
        p.hand = full.filter((t) => kindOf(t) !== a.kind);
        p.drawn = null;
        p.melds.push({ type: 'ankan', tiles });
        this.afterKan(seat);
        return true;
      }
      case 'kakan': {
        if (!opts.kakan?.includes(a.tile)) return false;
        const full = this.fullHand(seat);
        p.hand = full.filter((t) => t !== a.tile);
        p.drawn = null;
        const m = p.melds.find((m) => m.type === 'pon' && kindOf(m.tiles[0]) === kindOf(a.tile))!;
        m.type = 'kakan';
        m.tiles.push(a.tile);
        // 槍槓チェック
        this.chankanTile = a.tile;
        this.claimOptions.clear();
        this.claimResponses.clear();
        for (let s = 0; s < this.n; s++) {
          if (s === seat) continue;
          if (this.canRon(s, a.tile, true)) this.claimOptions.set(s, { ron: true, pass: true });
        }
        this.lastDiscard = null;
        if (this.claimOptions.size) {
          this.phase = 'chankan';
          this.current = seat;
        } else {
          this.afterKan(seat);
        }
        return true;
      }
      case 'nuki': {
        if (!opts.nuki?.includes(a.tile)) return false;
        const full = this.fullHand(seat);
        p.hand = full.filter((t) => t !== a.tile);
        p.kita.push(a.tile);
        // 補充牌は牌山の末尾から引く
        p.drawn = this.wall.pop()!;
        this.rinshanDraw = true;
        this.emit(seat, 'nuki');
        return true;
      }
      default:
        return false;
    }
  }

  private afterKan(seat: number) {
    this.kanCount++;
    this.doraCount = Math.min(5, this.doraCount + 1);
    for (const q of this.players) q.ippatsu = false;
    this.firstGoAround = false;
    this.emit(seat, 'kan');
    this.draw(seat, true);
  }

  private canRon(seat: number, tile: TileId, chankan = false): boolean {
    const p = this.players[seat];
    const hand = [...p.hand, tile];
    if (!isAgariShape(countsOfIds(hand))) return false;
    if (this.isFuriten(seat)) return false;
    return !!this.winContext(seat, hand, tile, false, { chankan });
  }

  private doDiscard(seat: number, tile: TileId, riichi: boolean) {
    const p = this.players[seat];
    const full = this.fullHand(seat);
    const tsumogiri = tile === p.drawn;
    p.hand = full.filter((t) => t !== tile);
    p.drawn = null;
    p.kuikae = null;
    if (p.ippatsu && !riichi) p.ippatsu = false;
    p.furitenTemp = false;
    if (riichi) {
      p.riichi = true;
      p.doubleRiichi = this.firstGoAround && p.discardCount === 0 && this.players.every((q) => q.melds.length === 0);
      this.pendingRiichi = true;
      this.emit(seat, 'riichi');
    }
    p.discardCount++;
    p.discards.push({ tile, tsumogiri, riichi, called: false });
    this.lastDiscard = { seat, tile };
    if (this.firstGoAround && seat === (this.dealer + this.n - 1) % this.n) this.firstGoAround = false;

    // 他家の鳴き・ロン候補
    this.claimOptions.clear();
    this.claimResponses.clear();
    const k = kindOf(tile);
    for (let s = 0; s < this.n; s++) {
      if (s === seat) continue;
      const q = this.players[s];
      const o: Options = {};
      if (this.canRon(s, tile)) o.ron = true;
      if (!q.riichi && this.wall.length > 0) {
        const same = q.hand.filter((t) => kindOf(t) === k);
        if (same.length >= 2) o.pon = [pickTiles(q.hand, k, 2)!];
        if (same.length >= 3 && this.kanCount < 4) o.minkan = true;
        if (!this.sanma && s === (seat + 1) % this.n && k < 27) {
          const n = k % 9;
          const chi: TileId[][] = [];
          for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
            if (n + a < 0 || n + b > 8) continue;
            const ta = pickTiles(q.hand, k + a, 1);
            const tb = pickTiles(q.hand, k + b, 1);
            if (ta && tb) chi.push([ta[0], tb[0]]);
          }
          if (chi.length) o.chi = chi;
        }
      }
      if (o.ron || o.pon || o.chi || o.minkan) {
        o.pass = true;
        this.claimOptions.set(s, o);
      }
    }
    if (this.claimOptions.size) {
      this.phase = 'claims';
    } else {
      this.afterDiscardNoClaim();
    }
  }

  private markPassedRon(tile: TileId, skipSeat: number | null) {
    // 見逃し: 待ち牌が出たのにロンしなかった場合のフリテン
    const k = kindOf(tile);
    for (let s = 0; s < this.n; s++) {
      if (s === skipSeat || (this.lastDiscard && s === this.lastDiscard.seat)) continue;
      if (this.waitsOf(s).includes(k)) {
        const p = this.players[s];
        if (p.riichi) p.furitenRiichi = true;
        else p.furitenTemp = true;
      }
    }
  }

  private resolveClaims() {
    const order = (from: number) => this.seats().slice(1).map((i) => (from + i) % this.n);
    if (this.phase === 'chankan') {
      const from = this.current;
      const tile = this.chankanTile!;
      for (const s of order(from)) {
        if (this.claimResponses.get(s)?.type === 'ron') {
          const hand = [...this.players[s].hand, tile];
          const res = this.winContext(s, hand, tile, false, { chankan: true })!;
          this.emit(s, 'ron');
          this.finishWins([{ seat: s, from, hand, winTile: tile, result: res }]);
          return;
        }
      }
      for (const s of this.claimOptions.keys()) {
        const p = this.players[s];
        if (p.riichi) p.furitenRiichi = true; else p.furitenTemp = true;
      }
      this.chankanTile = null;
      this.afterKan(from);
      return;
    }

    const { seat: from, tile } = this.lastDiscard!;
    // ロン（頭ハネ）
    for (const s of order(from)) {
      if (this.claimResponses.get(s)?.type === 'ron') {
        const hand = [...this.players[s].hand, tile];
        const res = this.winContext(s, hand, tile, false)!;
        this.emit(s, 'ron');
        this.finishWins([{ seat: s, from, hand, winTile: tile, result: res }]);
        return;
      }
    }
    this.markPassedRon(tile, null);
    this.finalizeRiichi(from);

    for (const s of order(from)) {
      const r = this.claimResponses.get(s);
      if (r?.type === 'pon' || r?.type === 'minkan') {
        this.doCall(s, from, tile, r);
        return;
      }
    }
    for (const s of order(from)) {
      const r = this.claimResponses.get(s);
      if (r?.type === 'chi') {
        this.doCall(s, from, tile, r);
        return;
      }
    }
    this.afterDiscardNoClaim(true);
  }

  private finalizeRiichi(seat: number) {
    if (!this.pendingRiichi) return;
    this.pendingRiichi = false;
    const p = this.players[seat];
    p.score -= 1000;
    this.riichiSticks++;
    p.ippatsu = true;
  }

  private doCall(seat: number, from: number, tile: TileId, a: Action) {
    const p = this.players[seat];
    const fromP = this.players[from];
    fromP.discards[fromP.discards.length - 1].called = true;
    for (const q of this.players) q.ippatsu = false;
    this.firstGoAround = false;
    let used: TileId[];
    if (a.type === 'minkan') used = pickTiles(p.hand, kindOf(tile), 3)!;
    else used = (a as { tiles: TileId[] }).tiles;
    p.hand = p.hand.filter((t) => !used.includes(t));
    const type = a.type === 'minkan' ? 'minkan' : a.type === 'pon' ? 'pon' : 'chi';
    p.melds.push({ type, tiles: [...used, tile], called: tile, from });
    this.lastDiscard = null;
    this.current = seat;
    if (type === 'minkan') {
      this.afterKan(seat);
    } else {
      p.kuikae = kindOf(tile);
      p.drawn = null;
      this.phase = 'turn';
      this.rinshanDraw = false;
      this.emit(seat, type);
    }
  }

  private afterDiscardNoClaim(alreadyMarked = false) {
    const from = this.lastDiscard!.seat;
    if (!alreadyMarked) {
      this.markPassedRon(this.lastDiscard!.tile, null);
      this.finalizeRiichi(from);
    }
    if (this.wall.length === 0) {
      this.exhaustiveDraw();
      return;
    }
    this.draw((from + 1) % this.n);
  }

  // ------------------------------------------------ 局の終了

  private finishWins(wins: { seat: number; from: number | null; hand: TileId[]; winTile: TileId; result: WinResult }[]) {
    const deltas: number[] = this.players.map(() => 0);
    const infos: WinInfo[] = [];
    let dealerWon = false;
    for (const w of wins) {
      const dealer = w.seat === this.dealer;
      if (dealer) dealerWon = true;
      const pay = payments(w.result.base, dealer, w.from === null);
      // 三麻のツモは「ツモ損」（いない1人分は誰も払わない）
      let points = pay.total;
      if (w.from === null) {
        points = 0;
        for (let s = 0; s < this.n; s++) if (s !== w.seat) points += s === this.dealer ? pay.fromDealer : pay.fromOthers;
        for (let s = 0; s < this.n; s++) {
          if (s === w.seat) continue;
          const amt = (s === this.dealer ? pay.fromDealer : pay.fromOthers) + this.honba * 100;
          deltas[s] -= amt;
          deltas[w.seat] += amt;
        }
      } else {
        const amt = pay.total + this.honba * 100 * (this.n - 1);
        deltas[w.from] -= amt;
        deltas[w.seat] += amt;
      }
      deltas[w.seat] += this.riichiSticks * 1000;
      infos.push({
        seat: w.seat, from: w.from, hand: sortTiles(w.hand), melds: this.players[w.seat].melds, kita: this.players[w.seat].kita,
        winTile: w.winTile, result: w.result, points,
      });
    }
    this.riichiSticks = 0;
    for (let s = 0; s < this.n; s++) this.players[s].score += deltas[s];
    const revealed: (TileId[] | null)[] = this.players.map(() => null);
    for (const w of infos) revealed[w.seat] = w.hand;
    this.result = {
      kind: 'win', wins: infos, tenpai: this.players.map(() => false), deltas,
      scores: this.players.map((p) => p.score), doraIndicators: this.doraIndicators(),
      uraIndicators: this.players.some((p, i) => p.riichi && wins.some((w) => w.seat === i)) ? this.uraIndicators() : [],
      revealed,
    };
    this.endRound(dealerWon, false);
  }

  private exhaustiveDraw() {
    const tenpai = this.players.map((_, s) => this.waitsOf(s).length > 0);
    const n = tenpai.filter(Boolean).length;
    const deltas: number[] = this.players.map(() => 0);
    if (n > 0 && n < this.n) {
      // 四麻: 場に3000点 / 三麻: 場に2000点
      const pot = this.sanma ? 2000 : 3000;
      for (let s = 0; s < this.n; s++) deltas[s] = tenpai[s] ? pot / n : -pot / (this.n - n);
    }
    for (let s = 0; s < this.n; s++) this.players[s].score += deltas[s];
    this.emit(this.current, 'draw');
    this.result = {
      kind: 'draw', wins: [], tenpai, deltas, scores: this.players.map((p) => p.score),
      doraIndicators: this.doraIndicators(), uraIndicators: [],
      revealed: this.players.map((p, s) => (tenpai[s] ? sortTiles(p.hand) : null)),
    };
    this.endRound(tenpai[this.dealer], true);
  }

  private renchan = false;
  private drawRound = false;

  private endRound(renchan: boolean, draw: boolean) {
    this.renchan = renchan;
    this.drawRound = draw;
    this.phase = 'roundEnd';
    this.readySeats.clear();
    for (let s = 0; s < this.n; s++) if (this.players[s].isCpu) this.readySeats.add(s);
    if (this.readySeats.size >= this.n) this.nextRound();
  }

  private isGameOver(): boolean {
    if (this.rules.tobi && this.players.some((p) => p.score < 0)) return true;
    const lastWind = this.config.length === 'tonpu' ? 0 : 1;
    const isAllLast = this.roundWind === lastWind && this.roundNum === this.n - 1;
    const beyond = this.roundWind > lastWind;
    if (beyond) return true;
    if (isAllLast) {
      if (!this.renchan) return true;
      // あがりやめ: 親がトップなら終了
      const top = Math.max(...this.players.map((p) => p.score));
      if (this.players[this.dealer].score === top && this.players[this.dealer].score >= (this.sanma ? 40000 : 30000)) return true;
    }
    return false;
  }

  private nextRound() {
    if (this.isGameOver()) {
      this.finishGame();
      return;
    }
    if (this.renchan) {
      this.honba++;
    } else {
      this.honba = this.drawRound ? this.honba + 1 : 0;
      this.roundNum++;
      if (this.roundNum === this.n) {
        this.roundNum = 0;
        this.roundWind++;
      }
    }
    const lastWind = this.config.length === 'tonpu' ? 0 : 1;
    if (this.roundWind > lastWind) {
      this.finishGame();
      return;
    }
    this.startRound();
  }

  private finishGame() {
    // 供託はトップ取り
    const order = this.seats().sort((a, b) => this.players[b].score - this.players[a].score || a - b);
    this.players[order[0]].score += this.riichiSticks * 1000;
    this.riichiSticks = 0;
    this.final = {
      ranking: order.map((s, i) => ({ seat: s, name: this.players[s].name, score: this.players[s].score, rank: i + 1 })),
    };
    this.phase = 'gameEnd';
  }

  /** 保存用に状態を書き出す（サーバーが休止しても対局を再開できるように） */
  toJSON(): Record<string, unknown> {
    const o = { ...this } as unknown as Record<string, unknown>;
    o.claimOptions = [...this.claimOptions];
    o.claimResponses = [...this.claimResponses];
    o.readySeats = [...this.readySeats];
    return o;
  }

  /** toJSON で書き出した状態から復元する */
  static fromJSON(o: Record<string, unknown>): Game {
    const g = Object.create(Game.prototype) as Game;
    Object.assign(g, o);
    g.claimOptions = new Map(o.claimOptions as [number, Options][]);
    g.claimResponses = new Map(o.claimResponses as [number, Action][]);
    g.readySeats = new Set(o.readySeats as number[]);
    return g;
  }

  /** 切断などで席をCPUに切り替える */
  setCpu(seat: number, cpu: boolean) {
    this.players[seat].isCpu = cpu;
    if (cpu && this.phase === 'roundEnd') this.act(seat, { type: 'ready' });
    this.version++;
  }

  // ------------------------------------------------ ビュー

  viewFor(you: number, deadline: number | null = null, bank: number | null = null): GameView {
    const players: PlayerView[] = this.players.map((p, s) => {
      const self = s === you;
      const showAll = self || this.phase === 'gameEnd';
      let hand: (TileId | null)[];
      let drawn: TileId | null | undefined;
      if (self) {
        // 自分の手牌は配牌・ツモ順のまま送る（並べ替えは各自の画面で行う）
        hand = [...p.hand];
        drawn = p.drawn ?? undefined;
      } else if (showAll) {
        hand = sortTiles(p.hand);
        drawn = p.drawn ?? undefined;
      } else {
        // 透明牌だけ見せる。不透明牌は位置情報を漏らさないよう末尾に寄せる
        const visible = sortTiles(p.hand.filter((t) => !isOpaque(t)));
        const hidden = p.hand.filter(isOpaque).map(() => null);
        hand = [...visible, ...hidden];
        drawn = p.drawn === null ? undefined : isOpaque(p.drawn) ? null : p.drawn;
      }
      return {
        seat: s, name: p.name, score: p.score, isCpu: p.isCpu, connected: this.connected[s],
        hand, drawn, melds: p.melds, discards: p.discards, riichi: p.riichi, kita: p.kita,
      };
    });
    const waits = this.phase === 'gameEnd' ? [] : this.waitsOf(you);
    return {
      you, players, roundWind: this.roundWind, roundNum: this.roundNum, honba: this.honba,
      riichiSticks: this.riichiSticks, wallCount: this.wall.length,
      doraIndicators: this.doraIndicators(), current: this.current, phase: this.phase,
      lastDiscard: this.lastDiscard, options: this.optionsFor(you), result: this.result,
      final: this.final, event: this.event, deadline, bank, length: this.config.length, aka: this.rules.aka,
      waits, furiten: waits.length > 0 && this.isFuriten(you),
    };
  }
}

function sameSet(a: TileId[], b: TileId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
