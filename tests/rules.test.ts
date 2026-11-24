import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateWin } from '../src/engine/agari';
import { Game } from '../src/engine/game';
import { DEFAULT_RULES, sanitizeRules } from '../src/engine/rules';
import { parseKinds } from '../src/engine/tiles';
import type { WinContext } from '../src/engine/types';
import { GameHost } from '../src/net/host';

const base = (over: Partial<WinContext>): WinContext => ({
  hand: [], melds: [], winTile: 0, tsumo: false, riichi: false, doubleRiichi: false, ippatsu: false,
  haitei: false, houtei: false, rinshan: false, chankan: false, tenhou: false, chiihou: false,
  seatWind: 28, roundWind: 27, doraIndicators: [], uraIndicators: [], ...over,
});

describe('rules', () => {
  it('sanitizes bad input', () => {
    expect(sanitizeRules({ count: 5, thinkSec: 999, aka: 'yes', startScore: 1 })).toEqual(DEFAULT_RULES);
    expect(sanitizeRules({ count: 3, length: 'hanchan', thinkSec: 0, kuitan: false }).kuitan).toBe(false);
  });

  it('kuitan off: open tanyao has no yaku', () => {
    // 234m 567p 345s 66s + ポン 888s（鳴き）
    const melds = [{ type: 'pon' as const, tiles: [25 * 4 + 1, 25 * 4 + 2, 25 * 4 + 3], called: 25 * 4 + 3, from: 0 }];
    const hand = parseKinds('234m567p66s23s');
    const on = evaluateWin(base({ hand: [...hand, parseKinds('4s')[0]], melds, winTile: parseKinds('4s')[0] }));
    const off = evaluateWin(base({ hand: [...hand, parseKinds('4s')[0]], melds, winTile: parseKinds('4s')[0], kuitan: false }));
    expect(on?.yaku.some((y) => y.name === '断幺九')).toBe(true);
    expect(off).toBeNull();
  });

  it('aka dora adds han', () => {
    const r = evaluateWin(base({ hand: parseKinds('234m567p345s23466s'), winTile: parseKinds('4s')[0], riichi: true, akaDora: 2 }))!;
    expect(r.yaku.find((y) => y.name === '赤ドラ')?.han).toBe(2);
  });

  it('start score and tobi follow rules', () => {
    const g = new Game({ names: ['a', 'b', 'c', 'd'], cpu: [true, true, true, true], length: 'tonpu', rules: { startScore: 30000, tobi: false } });
    expect(g.players[0].score).toBe(30000);
    expect(g.rules.tobi).toBe(false);
  });
});

describe('think time and bank', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses bank time after think time and auto-discards when both run out', () => {
    let last: { deadline: number | null; bank: number | null } = { deadline: null, bank: null };
    const links = [0, 1, 2, 3].map((s) => (s === 0 ? { send: (v: { deadline: number | null; bank: number | null }) => { last = v; } } : {}));
    const host = new GameHost(
      { names: ['me', 'a', 'b', 'c'], cpu: [false, true, true, true], length: 'tonpu', rules: { thinkSec: 5, bankSec: 10 } },
      links as never, { timed: true, cpuDelay: 10 },
    );
    // 自分が親になるまで進める（席0が親でなければ CPU が進める）
    host.start();
    for (let i = 0; i < 200 && !(host.game.phase === 'turn' && host.game.current === 0); i++) {
      if (host.game.optionsFor(0)?.pass) host.action(0, { type: 'pass' });
      vi.advanceTimersByTime(300);
    }
    expect(host.game.current).toBe(0);
    expect(last.bank).toBe(10000);
    expect(Math.round((last.deadline ?? 0) / 1000)).toBe(15);
    const discards = host.game.players[0].discards.length;
    // 8秒考えてから打牌 → 持ち時間が3秒減る
    vi.advanceTimersByTime(8000);
    const o = host.game.optionsFor(0)!;
    host.action(0, { type: 'discard', tile: o.discard![0] });
    expect(host.game.players[0].discards.length).toBe(discards + 1);
    for (let i = 0; i < 400 && !(host.game.phase === 'turn' && host.game.current === 0); i++) {
      // 待っている間に回ってきた鳴き・ロンの判断はすぐスキップする（放置すると時間切れで持ち時間を使う）
      if (host.game.optionsFor(0)?.pass) host.action(0, { type: 'pass' });
      vi.advanceTimersByTime(300);
    }
    if (host.game.phase === 'turn' && host.game.current === 0) {
      expect(last.bank).toBe(7000);
      // 何もしないと 5秒 + 7秒 で自動打牌
      const before = host.game.players[0].discards.length;
      vi.advanceTimersByTime(12500);
      expect(host.game.players[0].discards.length).toBe(before + 1);
    }
    host.stop();
  });
});
