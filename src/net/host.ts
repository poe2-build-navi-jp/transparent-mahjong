import { chooseAction } from '../engine/ai';
import { Game, type Action, type GameConfig, type GameView } from '../engine/game';

/** 各席への接続。cpu の席は send を持たない */
export interface SeatLink {
  send?: (view: GameView) => void;
}

export interface HostOptions {
  /** 人間プレイヤーに持ち時間を設けるか（オンライン用） */
  timed: boolean;
  cpuDelay?: number;
}

const TIME_TURN = 20000;
const TIME_CLAIM = 8000;
const TIME_READY = 20000;

/**
 * 権威サーバー役。ゲーム状態を持ち、各席へ見せてよい情報だけを送る。
 * ローカル（CPU対戦）でもオンライン（ホスト端末上）でも同じものを使う。
 */
export class GameHost {
  game: Game;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private deadline: number | null = null;
  private deadlineKey = '';
  private stopped = false;

  constructor(config: GameConfig, private links: SeatLink[], private opts: HostOptions) {
    this.game = new Game(config);
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
    if (this.game.act(seat, a)) this.update();
    else this.sendTo(seat);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private sendTo(seat: number) {
    this.links[seat]?.send?.(this.game.viewFor(seat, this.deadline === null ? null : this.deadline - Date.now()));
  }

  private update() {
    if (this.stopped) return;
    this.clearTimers();
    const g = this.game;
    const pending = g.pendingSeats();
    const humans = pending.filter((s) => !g.players[s].isCpu);

    // 同じ判断場面（CPUが先に応答しただけ等）なら持ち時間を引き継ぐ
    const key = `${g.phase}|${g.current}|${g.roundWind}-${g.roundNum}-${g.honba}|` +
      g.players.map((p) => p.discards.length + p.melds.length * 100).join(',');
    if (key !== this.deadlineKey) this.deadline = null;
    this.deadlineKey = key;
    if (this.opts.timed && humans.length) {
      const dur = g.phase === 'turn' ? TIME_TURN : g.phase === 'roundEnd' ? TIME_READY : TIME_CLAIM;
      if (this.deadline === null) this.deadline = Date.now() + dur;
      const version = g.version;
      this.timers.push(setTimeout(() => {
        if (g.version !== version) return;
        for (const s of g.pendingSeats()) {
          if (g.players[s].isCpu) continue;
          this.timeoutAction(s);
        }
      }, Math.max(0, this.deadline - Date.now()) + 300));
    } else {
      this.deadline = null;
    }
    for (let s = 0; s < 4; s++) this.sendTo(s);

    // CPU の行動（鳴き判断は即時寄り、打牌は少し間を置く）
    const delay = this.opts.cpuDelay ?? 650;
    for (const s of pending) {
      if (!g.players[s].isCpu) continue;
      const version = g.version;
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
