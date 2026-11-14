import { chooseAction } from '../engine/ai';
import { Game, type Action, type GameConfig, type GameView } from '../engine/game';

/** 各席への接続。cpu の席は send を持たない */
export interface SeatLink {
  send?: (view: GameView) => void;
}

export interface HostOptions {
  /** 人間プレイヤーにルールの考慮時間・持ち時間を適用するか（オンライン用） */
  timed: boolean;
  cpuDelay?: number;
  /**
   * 時間で起きる処理（CPUの手番・時間切れ）の予約方法。
   * 省略時は setTimeout。サーバーでは Durable Object のアラームに置き換えて、待ち時間中はサーバーを休止させる。
   * at = null は「予約なし」。
   */
  schedule?: (at: number | null) => void;
}

/** 局の結果画面で待つ時間 */
const TIME_READY = 20000;

/** 時間で起きる処理 */
interface Due {
  at: number;
  seat: number;
  kind: 'cpu' | 'timeout';
  /** 予約時のゲームの版。版が変わっていたら（誰かが先に動いたら）無効 */
  version: number;
}

/** 保存・復元用 */
export interface HostSnapshot {
  game: Record<string, unknown>;
  bank: number[];
  decisionKey: string;
  decisionStart: number;
  due: Due[];
  timed: boolean;
}

/**
 * 権威サーバー役。ゲーム状態を持ち、各席へ見せてよい情報だけを送る。
 * ローカル（CPU対戦）でもオンライン（サーバー上）でも同じものを使う。
 *
 * 時間の管理: 1手ごとに「考慮時間」があり、それを超えた分は各自の「持ち時間」から減る。
 * 両方使い切ると自動でツモ切り（鳴きはスキップ）になる。
 */
export class GameHost {
  game: Game;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private decisionKey = '';
  private decisionStart = 0;
  /** 各席の残り持ち時間（ミリ秒） */
  private bank: number[];
  private due: Due[] = [];
  private stopped = false;
  /** false の間は時間で起きる処理を止める（全員が切断している間など） */
  private running = true;

  constructor(config: GameConfig | null, private links: SeatLink[], private opts: HostOptions, snap?: HostSnapshot) {
    if (snap) {
      this.game = Game.fromJSON(snap.game);
      this.bank = snap.bank;
      this.decisionKey = snap.decisionKey;
      this.decisionStart = snap.decisionStart;
      this.due = snap.due;
    } else {
      this.game = new Game(config!);
      this.bank = this.game.players.map(() => this.game.rules.bankSec * 1000);
    }
  }

  /** 保存した状態から作り直す（サーバーの休止から復帰したとき） */
  static restore(snap: HostSnapshot, links: SeatLink[], opts: HostOptions): GameHost {
    return new GameHost(null, links, { ...opts, timed: snap.timed }, snap);
  }

  snapshot(): HostSnapshot {
    return {
      game: this.game.toJSON(), bank: this.bank, decisionKey: this.decisionKey,
      decisionStart: this.decisionStart, due: this.due, timed: this.opts.timed,
    };
  }

  private get timed(): boolean {
    return this.opts.timed && this.game.rules.thinkSec > 0;
  }

  start() {
    this.update();
  }

  stop() {
    this.stopped = true;
    this.disarm();
    this.opts.schedule?.(null);
  }

  /** 時間で起きる処理の一時停止・再開 */
  setRunning(on: boolean) {
    if (this.running === on) return;
    this.running = on;
    if (on) {
      // 止めていた間の分、考慮時間を数え直す
      this.decisionKey = '';
      this.update();
    } else {
      this.arm();
    }
  }

  setLink(seat: number, link: SeatLink) {
    this.links[seat] = link;
    this.game.connected[seat] = true;
    this.game.setCpu(seat, false);
    this.update();
  }

  /** 切断された席はCPUが代打ちする */
  disconnect(seat: number) {
    this.links[seat] = {};
    this.game.connected[seat] = false;
    this.game.setCpu(seat, true);
    this.update();
  }

  /** 席の送り先だけ差し替える（状態は変えない） */
  relink(seat: number, link: SeatLink) {
    this.links[seat] = link;
  }

  /** 全員に今の盤面を送り直す */
  broadcast() {
    for (let s = 0; s < this.game.n; s++) this.sendTo(s);
  }

  action(seat: number, a: Action) {
    if (this.stopped) return;
    const g = this.game;
    const wasPending = this.timed && g.phase !== 'roundEnd' && !g.players[seat].isCpu && g.pendingSeats().includes(seat);
    if (g.act(seat, a)) {
      // 考慮時間を超えた分を持ち時間から引く
      if (wasPending) {
        const over = Date.now() - this.decisionStart - g.rules.thinkSec * 1000;
        if (over > 0) this.bank[seat] = Math.max(0, this.bank[seat] - over);
      }
      this.update();
    } else {
      this.sendTo(seat);
    }
  }

  /** 期限が来た処理を実行する（タイマー・アラームから呼ばれる） */
  runDue(now = Date.now()) {
    if (this.stopped || !this.running) return;
    for (let guard = 0; guard < 100; guard++) {
      const g = this.game;
      const d = this.due.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!d) break;
      this.due = this.due.filter((x) => x !== d);
      if (d.version !== g.version) continue;
      if (d.kind === 'cpu') {
        const o = g.optionsFor(d.seat);
        if (o && g.players[d.seat].isCpu) this.action(d.seat, chooseAction(g, d.seat, o));
      } else {
        if (g.phase !== 'roundEnd') this.bank[d.seat] = 0;
        this.timeoutAction(d.seat);
      }
    }
    this.arm();
  }

  private disarm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 次に起きる時刻を予約する */
  private arm() {
    this.disarm();
    if (this.stopped) return;
    const next = this.running && this.due.length ? Math.min(...this.due.map((d) => d.at)) : null;
    if (this.opts.schedule) {
      this.opts.schedule(next);
      return;
    }
    if (next !== null) this.timer = setTimeout(() => this.runDue(), Math.max(0, next - Date.now()));
  }

  /** その席の締め切り時刻（なければ null） */
  private deadlineOf(seat: number): number | null {
    const g = this.game;
    if (!this.timed || g.players[seat].isCpu || !g.pendingSeats().includes(seat)) return null;
    if (g.phase === 'roundEnd') return this.decisionStart + TIME_READY;
    if (g.phase === 'gameEnd') return null;
    return this.decisionStart + g.rules.thinkSec * 1000 + this.bank[seat];
  }

  private sendTo(seat: number) {
    const dl = this.deadlineOf(seat);
    const bank = dl === null || this.game.phase === 'roundEnd' ? null : this.bank[seat];
    this.links[seat]?.send?.(this.game.viewFor(seat, dl === null ? null : dl - Date.now(), bank));
  }

  private update() {
    if (this.stopped) return;
    const g = this.game;
    const pending = g.pendingSeats();

    // 新しい判断場面になったら時計を回し直す（CPUが先に応答しただけなら引き継ぐ）
    const key = `${g.phase}|${g.current}|${g.roundWind}-${g.roundNum}-${g.honba}|` +
      g.players.map((p) => p.discards.length + p.melds.length * 100 + p.kita.length * 10000).join(',');
    if (key !== this.decisionKey) {
      this.decisionKey = key;
      this.decisionStart = Date.now();
    }
    const version = g.version;
    const now = Date.now();
    this.due = [];
    for (const s of pending) {
      const dl = this.deadlineOf(s);
      if (dl !== null) this.due.push({ at: dl + 300, seat: s, kind: 'timeout', version });
    }
    // CPU の行動（鳴き判断は即時寄り、打牌は少し間を置く）
    const delay = this.opts.cpuDelay ?? 650;
    for (const s of pending) {
      if (!g.players[s].isCpu) continue;
      this.due.push({ at: now + (g.phase === 'turn' ? delay : 250), seat: s, kind: 'cpu', version });
      if (g.phase === 'turn') break;
    }
    for (let s = 0; s < g.n; s++) this.sendTo(s);
    this.arm();
  }

  private timeoutAction(seat: number) {
    const g = this.game;
    const o = g.optionsFor(seat);
    if (!o) return;
    let a: Action;
    if (o.ready) a = { type: 'ready' };
    else if (o.pass) a = { type: 'pass' };
    else {
      const p = g.players[seat];
      const tile = p.drawn ?? o.discard![o.discard!.length - 1];
      a = { type: 'discard', tile: o.discard!.includes(tile) ? tile : o.discard![0] };
    }
    this.action(seat, a);
  }
}
