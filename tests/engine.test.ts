import { describe, expect, it } from 'vitest';
import { evaluateWin, payments } from '../src/engine/agari';
import { chooseAction } from '../src/engine/ai';
import { Game } from '../src/engine/game';
import { shanten, waitingKinds } from '../src/engine/shanten';
import { countsOf, parseKinds } from '../src/engine/tiles';
import type { WinContext } from '../src/engine/types';

const ctx = (hand: string, win: string, over: Partial<WinContext> = {}): WinContext => ({
  hand: parseKinds(hand), melds: [], winTile: parseKinds(win)[0], tsumo: false, riichi: false,
  doubleRiichi: false, ippatsu: false, haitei: false, houtei: false, rinshan: false, chankan: false,
  tenhou: false, chiihou: false, seatWind: 28, roundWind: 27, doraIndicators: [], uraIndicators: [], ...over,
});

describe('shanten', () => {
  it('agari is -1', () => {
    expect(shanten(countsOf(parseKinds('123m456p789s11122z')))).toBe(-1);
  });
  it('tenpai', () => {
    expect(shanten(countsOf(parseKinds('123m456p789s1112z')))).toBe(0);
    expect(waitingKinds(countsOf(parseKinds('123m456p789s1112z')))).toEqual([28]);
  });
  it('chiitoi', () => {
    expect(shanten(countsOf(parseKinds('1122m3344p5566s7z')))).toBe(0);
  });
  it('kokushi', () => {
    expect(shanten(countsOf(parseKinds('19m19p19s1234567z')))).toBe(0);
  });
});

describe('yaku & score', () => {
  it('pinfu tanyao ron', () => {
    const r = evaluateWin(ctx('234m567p345s23466s', '4s'))!;
    expect(r.yaku.map((y) => y.name)).toEqual(expect.arrayContaining(['平和', '断幺九']));
    expect(r.fu).toBe(30);
    expect(payments(r.base, false, false).total).toBe(2000);
  });
  it('no yaku returns null', () => {
    expect(evaluateWin(ctx('123m456p789s11z234m', '4m'))).toBeNull();
  });
  it('riichi tsumo pinfu 20fu', () => {
    const r = evaluateWin(ctx('123m456p789s23466s', '4s', { tsumo: true, riichi: true }))!;
    expect(r.fu).toBe(20);
    expect(r.han).toBe(3); // 立直 門前ツモ 平和
  });
  it('yakuhai', () => {
    const r = evaluateWin(ctx('123m456p78s99s777z9s', '9s'))!;
    expect(r.yaku.some((y) => y.name === '役牌 中')).toBe(true);
  });
  it('chinitsu', () => {
    const r = evaluateWin(ctx('11123455678999m', '5m'))!;
    expect(r.yakuman).toBe(2); // 純正九蓮宝燈
  });
  it('kokushi', () => {
    const r = evaluateWin(ctx('19m19p19s12345677z', '1z'))!;
    expect(r.yakuman).toBe(1);
  });
  it('suuankou tsumo', () => {
    const r = evaluateWin(ctx('111m222p333s44455z', '4z', { tsumo: true }))!;
    expect(r.yakuman).toBe(1);
  });
  it('sanankou on shanpon ron is not suuankou', () => {
    const r = evaluateWin(ctx('111m222p333s44455z', '4z'))!;
    expect(r.yakuman).toBe(0);
    expect(r.yaku.map((y) => y.name)).toEqual(expect.arrayContaining(['対々和', '三暗刻']));
  });
  it('chiitoitsu 25fu', () => {
    const r = evaluateWin(ctx('1122m3344p5566s77z', '7z'))!;
    expect(r.fu).toBe(25);
    expect(r.han).toBe(2);
  });
  it('dealer mangan tsumo', () => {
    expect(payments(2000, true, true)).toEqual({ total: 12000, fromDealer: 0, fromOthers: 4000 });
  });
});

describe('full game simulation', () => {
  it('cpu-only games finish with consistent scores', () => {
    for (let n = 0; n < 6; n++) {
      const g = new Game({ names: ['A', 'B', 'C', 'D'], cpu: [true, true, true, true], length: 'tonpu' });
      let steps = 0;
      while (g.phase !== 'gameEnd' && steps < 20000) {
        const pend = g.pendingSeats();
        if (pend.length === 0) throw new Error('stuck in ' + g.phase);
        for (const s of pend) {
          const opts = g.optionsFor(s);
          if (!opts) continue;
          const a = chooseAction(g, s, opts);
          if (!g.act(s, a)) throw new Error('illegal ' + JSON.stringify(a) + ' opts ' + JSON.stringify(opts));
          break;
        }
        steps++;
        const total = g.players.reduce((a, p) => a + p.score, 0) + g.riichiSticks * 1000;
        expect(total).toBe(100000);
        const tiles = g.players.reduce((a, p) => a + p.hand.length + (p.drawn !== null ? 1 : 0) + p.melds.reduce((x, m) => x + m.tiles.length, 0), 0);
        expect(tiles).toBeGreaterThan(0);
      }
      expect(g.phase).toBe('gameEnd');
      expect(g.final!.ranking.length).toBe(4);
    }
  }, 120000);
});
