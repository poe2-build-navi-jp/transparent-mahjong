/**
 * 戦績と実績（端末内に保存。PC版では Steam の実績にも反映）
 *
 * 対局の画面（TableUI）から届く盤面を見て、局の結果・終局を記録する。
 */
import type { GameView, RoundResult } from '../engine/game';
import { isOpaque } from '../engine/tiles';
import { isAkaId } from '../engine/rules';
import { platform } from './platform';

export interface GameRecord {
  at: number;
  mode: 'cpu' | 'online';
  count: number;
  length: 'tonpu' | 'hanchan';
  rank: number;
  score: number;
  rounds: number;
  wins: number;
  dealIns: number;
  riichis: number;
  bestPoints: number;
}

export interface Records {
  games: GameRecord[];
  achievements: Record<string, number>;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
}

/** 実績の一覧（Steam の実績 API 名と同じ ID を使う） */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'FIRST_GAME', name: 'はじめの一局', desc: '対局を最後まで打つ' },
  { id: 'FIRST_WIN', name: '初和了', desc: '和了する' },
  { id: 'FIRST_TOP', name: '初トップ', desc: '1位で対局を終える' },
  { id: 'RIICHI_WIN', name: '透けても立直', desc: '立直して和了する' },
  { id: 'TSUMO_WIN', name: '自摸の手応え', desc: 'ツモで和了する' },
  { id: 'MANGAN', name: '満貫', desc: '満貫以上で和了する' },
  { id: 'HANEMAN', name: '跳満', desc: '跳満以上で和了する' },
  { id: 'YAKUMAN', name: '役満', desc: '役満で和了する' },
  { id: 'OPAQUE_WAIT', name: '見えない待ち', desc: '不透明牌で和了する（相手から見えない牌で待つ）' },
  { id: 'ALL_CLEAR', name: '丸見えの勝利', desc: '手牌がすべて透明牌の状態で和了する' },
  { id: 'AKA_3', name: '紅三点', desc: '赤ドラ3枚を使って和了する' },
  { id: 'NO_DEALIN', name: '鉄壁', desc: '一度も放銃せずに対局を終える' },
  { id: 'SANMA', name: '三人打ち', desc: '三人麻雀を最後まで打つ' },
  { id: 'HANCHAN', name: '半荘完走', desc: '半荘戦を最後まで打つ' },
  { id: 'ONLINE', name: '卓を囲む', desc: 'オンライン対戦を最後まで打つ' },
  { id: 'TOP_10', name: '常勝', desc: '1位を10回とる' },
  { id: 'GAMES_50', name: '雀荘の常連', desc: '50回対局する' },
];

const KEY = 'tmj-records';

function load(): Records {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Records | null;
    if (r && Array.isArray(r.games)) return { games: r.games, achievements: r.achievements ?? {} };
  } catch { /* 読めなければ空 */ }
  return { games: [], achievements: {} };
}

let data = load();
const listeners = new Set<(a: Achievement) => void>();

function save() {
  const json = JSON.stringify(data);
  try { localStorage.setItem(KEY, json); } catch { /* 保存できない環境 */ }
  // PC版では Steam クラウドにも保存（別のPCでも戦績・実績を引き継げる）
  platform.cloudWrite('records.json', json);
}

export const records = {
  get data(): Records { return data; },

  /** 実績解除の通知を受け取る */
  onUnlock(fn: (a: Achievement) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  unlock(id: string) {
    if (data.achievements[id]) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    data.achievements[id] = Date.now();
    save();
    platform.unlockAchievement(id);
    for (const l of listeners) l(a);
  },

  /** PC版: Steam クラウドの方が新しければ取り込む（起動時に呼ぶ） */
  async syncFromCloud() {
    const raw = await platform.cloudRead('records.json');
    if (!raw) return;
    try {
      const c = JSON.parse(raw) as Records;
      if (!Array.isArray(c.games)) return;
      // 対局数の多い方を正とし、実績は両方を合わせる
      const games = c.games.length > data.games.length ? c.games : data.games;
      data = { games, achievements: { ...c.achievements, ...data.achievements } };
      save();
    } catch { /* 壊れたデータは無視 */ }
  },

  reset() {
    data = { games: [], achievements: {} };
    save();
  },

  summary() {
    const g = data.games;
    const n = g.length;
    const rounds = g.reduce((a, x) => a + x.rounds, 0);
    const rate = (k: (x: GameRecord) => number) => (rounds ? g.reduce((a, x) => a + k(x), 0) / rounds : 0);
    const ranks = [1, 2, 3, 4].map((r) => g.filter((x) => x.rank === r).length);
    return {
      games: n,
      avgRank: n ? g.reduce((a, x) => a + x.rank, 0) / n : 0,
      ranks,
      winRate: rate((x) => x.wins),
      dealInRate: rate((x) => x.dealIns),
      riichiRate: rate((x) => x.riichis),
      bestPoints: g.reduce((a, x) => Math.max(a, x.bestPoints), 0),
      bestScore: n ? Math.max(...g.map((x) => x.score)) : 0,
    };
  },
};

/** 1つの対局を見守って記録する */
export class GameTracker {
  private lastResultKey = '';
  private done = false;
  private rounds = 0;
  private wins = 0;
  private dealIns = 0;
  private riichis = 0;
  private bestPoints = 0;
  private riichiSeenRound = '';

  constructor(private mode: 'cpu' | 'online') {}

  observe(v: GameView) {
    const me = v.players[v.you];
    const roundKey = `${v.roundWind}-${v.roundNum}-${v.honba}`;
    if (me?.riichi && this.riichiSeenRound !== roundKey) {
      this.riichiSeenRound = roundKey;
      this.riichis++;
    }
    if (v.result && (v.phase === 'roundEnd' || v.phase === 'gameEnd')) {
      const key = `${roundKey}|${JSON.stringify(v.result.deltas)}`;
      if (key !== this.lastResultKey) {
        this.lastResultKey = key;
        this.round(v, v.result);
      }
    }
    if (v.phase === 'gameEnd' && v.final && !this.done) {
      this.done = true;
      this.finish(v);
    }
  }

  private round(v: GameView, r: RoundResult) {
    this.rounds++;
    for (const w of r.wins) {
      if (w.seat === v.you) {
        this.wins++;
        this.bestPoints = Math.max(this.bestPoints, w.points);
        records.unlock('FIRST_WIN');
        if (w.result.yaku.some((y) => y.name.includes('立直'))) records.unlock('RIICHI_WIN');
        if (w.from === null) records.unlock('TSUMO_WIN');
        if (w.result.base >= 2000) records.unlock('MANGAN');
        if (w.result.base >= 3000) records.unlock('HANEMAN');
        if (w.result.yakuman > 0) records.unlock('YAKUMAN');
        if (isOpaque(w.winTile)) records.unlock('OPAQUE_WAIT');
        if (w.hand.every((t) => !isOpaque(t))) records.unlock('ALL_CLEAR');
        const allTiles = [...w.hand, ...w.melds.flatMap((m) => m.tiles)];
        if (v.aka && allTiles.filter(isAkaId).length >= 3) records.unlock('AKA_3');
      }
      if (w.from === v.you) this.dealIns++;
    }
  }

  private finish(v: GameView) {
    const me = v.final!.ranking.find((x) => x.seat === v.you)!;
    data.games.push({
      at: Date.now(), mode: this.mode, count: v.players.length, length: v.length,
      rank: me.rank, score: me.score, rounds: this.rounds, wins: this.wins,
      dealIns: this.dealIns, riichis: this.riichis, bestPoints: this.bestPoints,
    });
    if (data.games.length > 500) data.games = data.games.slice(-500);
    save();
    records.unlock('FIRST_GAME');
    if (me.rank === 1) records.unlock('FIRST_TOP');
    if (this.dealIns === 0) records.unlock('NO_DEALIN');
    if (v.players.length === 3) records.unlock('SANMA');
    if (v.length === 'hanchan') records.unlock('HANCHAN');
    if (this.mode === 'online') records.unlock('ONLINE');
    if (data.games.filter((g) => g.rank === 1).length >= 10) records.unlock('TOP_10');
    if (data.games.length >= 50) records.unlock('GAMES_50');
  }
}
