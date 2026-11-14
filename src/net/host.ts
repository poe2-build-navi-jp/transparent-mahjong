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
}

/** 局の結果画面で待つ時間 */
const TIME_READY = 20000;

/**
 * 権威サーバー役。ゲーム状態を持ち、各席へ見せてよい情報だけを送る。
 * ローカル（CPU対戦）でもオンライン（サーバー・ホスト端末上）でも同じものを使う。
 *
 * 時間の管理: 1手ごとに「考慮時間」があり、それを超えた分は各自の「持ち時間」から減る。
 * 両方使い切ると自動でツモ切り（鳴きはスキップ）になる。
 */
export class GameHost {
  game: Game;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private decisionKey = '';
  private decisionStart = 0;
  /** 各席の残り持ち時間（ミリ秒） */
  private bank: number[];
  private stopped = false;

  constructor(config: GameConfig, private links: SeatLink[], private opts: HostOptions) {
    this.game = new Game(config);
    this.bank = this.game.players.map(() => this.game.rules.bankSec * 1000);
  }

  private get timed(): boolean {
    return this.opts.timed && this.game.rules.thinkSec > 0;
  }

  start() {
    this.update();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
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

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
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
    this.clearTimers();
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
    for (const s of pending) {
      const dl = this.deadlineOf(s);
      if (dl === null) continue;
      this.timers.push(setTimeout(() => {
        if (g.version !== version || this.stopped) return;
        if (g.phase !== 'roundEnd') this.bank[s] = 0;
        this.timeoutAction(s);
      }, Math.max(0, dl - Date.now()) + 300));
    }
    for (let s = 0; s < g.n; s++) this.sendTo(s);

    // CPU の行動（鳴き判断は即時寄り、打牌は少し間を置く）
    const delay = this.opts.cpuDelay ?? 650;
    for (const s of pending) {
      if (!g.players[s].isCpu) continue;
      const wait = g.phase === 'turn' ? delay : 250;
      this.timers.push(setTimeout(() => {
        if (g.version !== version || this.stopped) return;
        const o = g.optionsFor(s);
        if (!o) return;
        this.action(s, chooseAction(g, s, o));
      }, wait));
      if (g.phase === 'turn') break;
    }
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
