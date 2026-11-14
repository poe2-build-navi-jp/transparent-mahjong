import {
  NUM_KINDS, countsOf, doraFromIndicator, isDragon, isHonor, isSimple, isTerminal, isYaochu,
  kindOf, YAOCHU_KINDS, type Kind,
} from './tiles';
import type { Meld, WinContext, WinResult, YakuEntry } from './types';

interface SetInfo {
  type: 'shuntsu' | 'koutsu' | 'kantsu';
  kind: Kind; // 順子は先頭
  open: boolean;
}

interface Decomp {
  pair: Kind;
  sets: { type: 'shuntsu' | 'koutsu'; kind: Kind }[];
}

/** 面子手の分解をすべて列挙する（counts は 3n+2 枚） */
export function decompose(counts: number[]): Decomp[] {
  const results: Decomp[] = [];
  const c = counts.slice();
  const sets: Decomp['sets'] = [];
  const rec = (pair: Kind) => {
    let i = 0;
    while (i < NUM_KINDS && c[i] === 0) i++;
    if (i >= NUM_KINDS) {
      results.push({ pair, sets: sets.slice() });
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      sets.push({ type: 'koutsu', kind: i });
      rec(pair);
      sets.pop();
      c[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      sets.push({ type: 'shuntsu', kind: i });
      rec(pair);
      sets.pop();
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
  };
  for (let p = 0; p < NUM_KINDS; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      rec(p);
      c[p] += 2;
    }
  }
  return results;
}

export function isChiitoi(counts: number[]): boolean {
  let pairs = 0;
  for (let i = 0; i < NUM_KINDS; i++) {
    if (counts[i] === 2) pairs++;
    else if (counts[i] !== 0) return false;
  }
  return pairs === 7;
}

export function isKokushi(counts: number[]): boolean {
  let pair = false;
  for (const k of YAOCHU_KINDS) {
    if (counts[k] === 0) return false;
    if (counts[k] === 2) pair = true;
  }
  let total = 0;
  for (let i = 0; i < NUM_KINDS; i++) total += counts[i];
  return pair && total === 14;
}

export function isAgariShape(counts: number[]): boolean {
  return decompose(counts).length > 0 || isChiitoi(counts) || isKokushi(counts);
}

function meldToSet(m: Meld): SetInfo {
  const k = kindOf(m.tiles[0]);
  if (m.type === 'chi') {
    const kinds = m.tiles.map(kindOf);
    return { type: 'shuntsu', kind: Math.min(...kinds), open: true };
  }
  if (m.type === 'pon') return { type: 'koutsu', kind: k, open: true };
  return { type: 'kantsu', kind: k, open: m.type !== 'ankan' };
}

function countDora(ctx: WinContext): { dora: number; ura: number } {
  const all: Kind[] = [...ctx.hand];
  for (const m of ctx.melds) for (const t of m.tiles) all.push(kindOf(t));
  const c = countsOf(all);
  let dora = 0;
  for (const ind of ctx.doraIndicators) dora += c[doraFromIndicator(ind, ctx.sanma)];
  let ura = 0;
  if (ctx.riichi) for (const ind of ctx.uraIndicators) ura += c[doraFromIndicator(ind, ctx.sanma)];
  return { dora, ura };
}

function limitOf(han: number, fu: number, yakuman: number): { base: number; name: string } {
  if (yakuman > 0) return { base: 8000 * yakuman, name: yakuman > 1 ? `${yakuman}倍役満` : '役満' };
  if (han >= 13) return { base: 8000, name: '数え役満' };
  if (han >= 11) return { base: 6000, name: '三倍満' };
  if (han >= 8) return { base: 4000, name: '倍満' };
  if (han >= 6) return { base: 3000, name: '跳満' };
  const base = fu * Math.pow(2, 2 + han);
  if (han >= 5 || base >= 2000) return { base: 2000, name: '満貫' };
  return { base, name: '' };
}

export const roundUp100 = (x: number) => Math.ceil(x / 100) * 100;

/** 役満判定（面子分解に依存しないもの + 依存するもの） */
function yakumanCommon(ctx: WinContext, allKinds: Kind[], closed: boolean): YakuEntry[] {
  const y: YakuEntry[] = [];
  const c = countsOf(allKinds);
  if (ctx.tenhou) y.push({ name: '天和', han: 0, yakuman: 1 });
  if (ctx.chiihou) y.push({ name: '地和', han: 0, yakuman: 1 });
  if (allKinds.every(isHonor)) y.push({ name: '字一色', han: 0, yakuman: 1 });
  if (allKinds.every(isTerminal)) y.push({ name: '清老頭', han: 0, yakuman: 1 });
  const green = new Set([19, 20, 21, 23, 25, 32]);
  if (allKinds.every((k) => green.has(k))) y.push({ name: '緑一色', han: 0, yakuman: 1 });
  if (c[31] >= 3 && c[32] >= 3 && c[33] >= 3) y.push({ name: '大三元', han: 0, yakuman: 1 });
  const windTrip = [27, 28, 29, 30].filter((k) => c[k] >= 3).length;
  const windPair = [27, 28, 29, 30].filter((k) => c[k] === 2).length;
  if (windTrip === 4) y.push({ name: '大四喜', han: 0, yakuman: 2 });
  else if (windTrip === 3 && windPair === 1) y.push({ name: '小四喜', han: 0, yakuman: 1 });
  const kans = ctx.melds.filter((m) => m.type.endsWith('kan')).length;
  if (kans === 4) y.push({ name: '四槓子', han: 0, yakuman: 1 });
  if (closed && ctx.melds.length === 0) {
    const hc = countsOf(ctx.hand);
    for (const s of [0, 9, 18]) {
      if (ctx.hand.every((k) => k >= s && k < s + 9)) {
        const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
        let ok = true;
        for (let i = 0; i < 9; i++) if (hc[s + i] < base[i]) ok = false;
        if (ok) {
          hc[ctx.winTile]--;
          let pure = true;
          for (let i = 0; i < 9; i++) if (hc[s + i] !== base[i]) pure = false;
          y.push({ name: pure ? '純正九蓮宝燈' : '九蓮宝燈', han: 0, yakuman: pure ? 2 : 1 });
        }
      }
    }
  }
  return y;
}

interface Candidate {
  yaku: YakuEntry[];
  han: number;
  fu: number;
  yakuman: number;
}

/** 和了の評価。役がなければ null */
export function evaluateWin(ctx: WinContext): WinResult | null {
  const handCounts = countsOf(ctx.hand);
  const closed = ctx.melds.every((m) => m.type === 'ankan');
  const allKinds: Kind[] = [...ctx.hand];
  for (const m of ctx.melds) {
    const ks = m.tiles.map(kindOf);
    // 槓子は3枚として扱う（役判定用）
    allKinds.push(...(m.type.endsWith('kan') ? ks.slice(0, 3) : ks));
  }

  const candidates: Candidate[] = [];
  const situational: YakuEntry[] = [];
  if (ctx.doubleRiichi) situational.push({ name: 'ダブル立直', han: 2 });
  else if (ctx.riichi) situational.push({ name: '立直', han: 1 });
  if (ctx.ippatsu) situational.push({ name: '一発', han: 1 });
  if (ctx.tsumo && closed) situational.push({ name: '門前清自摸和', han: 1 });
  if (ctx.haitei) situational.push({ name: '海底摸月', han: 1 });
  if (ctx.houtei) situational.push({ name: '河底撈魚', han: 1 });
  if (ctx.rinshan) situational.push({ name: '嶺上開花', han: 1 });
  if (ctx.chankan) situational.push({ name: '槍槓', han: 1 });

  // 国士無双
  if (ctx.melds.length === 0 && isKokushi(handCounts)) {
    const y: YakuEntry[] = [];
    const thirteen = handCounts[ctx.winTile] === 2;
    y.push({ name: thirteen ? '国士無双十三面待ち' : '国士無双', han: 0, yakuman: thirteen ? 2 : 1 });
    if (ctx.tenhou) y.push({ name: '天和', han: 0, yakuman: 1 });
    if (ctx.chiihou) y.push({ name: '地和', han: 0, yakuman: 1 });
    candidates.push({ yaku: y, han: 0, fu: 0, yakuman: y.reduce((a, b) => a + (b.yakuman ?? 0), 0) });
  }

  const common = yakumanCommon(ctx, allKinds, closed);

  // 七対子
  if (ctx.melds.length === 0 && isChiitoi(handCounts)) {
    const yakuman = common.filter((y) => y.name !== '大三元' && y.name !== '小四喜' && y.name !== '大四喜');
    if (yakuman.length) {
      candidates.push({ yaku: yakuman, han: 0, fu: 0, yakuman: yakuman.reduce((a, b) => a + (b.yakuman ?? 0), 0) });
    } else {
      const y: YakuEntry[] = [...situational, { name: '七対子', han: 2 }];
      if (allKinds.every(isSimple)) y.push({ name: '断幺九', han: 1 });
      if (allKinds.every(isYaochu)) y.push({ name: '混老頭', han: 2 });
      const flush = flushYaku(allKinds, true);
      if (flush) y.push(flush);
      candidates.push({ yaku: y, han: y.reduce((a, b) => a + b.han, 0), fu: 25, yakuman: 0 });
    }
  }

  // 面子手
  const meldSets = ctx.melds.map(meldToSet);
  for (const d of decompose(handCounts)) {
    // 和了牌の位置候補ごとに評価
    const positions: { idx: number; wait: 'tanki' | 'shanpon' | 'ryanmen' | 'kanchan' | 'penchan' }[] = [];
    if (d.pair === ctx.winTile) positions.push({ idx: -1, wait: 'tanki' });
    d.sets.forEach((s, idx) => {
      if (s.type === 'koutsu' && s.kind === ctx.winTile) positions.push({ idx, wait: 'shanpon' });
      if (s.type === 'shuntsu' && ctx.winTile >= s.kind && ctx.winTile <= s.kind + 2) {
        const pos = ctx.winTile - s.kind;
        const n = s.kind % 9; // 0..6
        let wait: 'ryanmen' | 'kanchan' | 'penchan';
        if (pos === 1) wait = 'kanchan';
        else if (pos === 0) wait = n === 6 ? 'penchan' : 'ryanmen';
        else wait = n === 0 ? 'penchan' : 'ryanmen';
        positions.push({ idx, wait });
      }
    });
    for (const pos of positions) {
      const sets: SetInfo[] = [
        ...d.sets.map((s, i) => ({
          type: s.type,
          kind: s.kind,
          // ロンで完成した刻子は明刻扱い
          open: s.type === 'koutsu' && i === pos.idx && !ctx.tsumo,
        })),
        ...meldSets,
      ];
      candidates.push(evalRegular(ctx, d.pair, sets, pos.wait, closed, situational, common, allKinds));
    }
  }

  if (candidates.length === 0) return null;

  // 最高点の候補を選ぶ
  let best: WinResult | null = null;
  const { dora, ura } = countDora(ctx);
  for (const cand of candidates) {
    if (cand.yakuman === 0 && cand.han === 0) continue;
    let yaku = cand.yaku;
    let han = cand.han;
    let doraTotal = 0;
    if (cand.yakuman === 0) {
      doraTotal = dora + ura;
      yaku = [...yaku];
      if (dora) yaku.push({ name: 'ドラ', han: dora });
      if (ura) yaku.push({ name: '裏ドラ', han: ura });
      const nuki = ctx.nukiDora ?? 0;
      if (nuki) yaku.push({ name: '抜きドラ', han: nuki });
      const aka = ctx.akaDora ?? 0;
      if (aka) yaku.push({ name: '赤ドラ', han: aka });
      doraTotal += nuki + aka;
      han += doraTotal;
    }
    const lim = limitOf(han, cand.fu, cand.yakuman);
    const res: WinResult = {
      yaku, han, fu: cand.fu, dora: doraTotal, yakuman: cand.yakuman, base: lim.base, limitName: lim.name,
    };
    if (!best || res.base > best.base || (res.base === best.base && res.han > best.han)) best = res;
  }
  return best;
}

function flushYaku(allKinds: Kind[], closed: boolean): YakuEntry | null {
  const suits = new Set(allKinds.filter((k) => k < 27).map((k) => Math.floor(k / 9)));
  if (suits.size !== 1) return null;
  const hasHonor = allKinds.some(isHonor);
  if (hasHonor) return { name: '混一色', han: closed ? 3 : 2 };
  return { name: '清一色', han: closed ? 6 : 5 };
}

function evalRegular(
  ctx: WinContext, pair: Kind, sets: SetInfo[], wait: string, closed: boolean,
  situational: YakuEntry[], common: YakuEntry[], allKinds: Kind[],
): Candidate {
  // 役満
  const ym = [...common];
  const concealedTrip = sets.filter((s) => s.type !== 'shuntsu' && !s.open).length;
  if (concealedTrip === 4) {
    ym.push(wait === 'tanki' ? { name: '四暗刻単騎', han: 0, yakuman: 2 } : { name: '四暗刻', han: 0, yakuman: 1 });
  }
  if (ym.length) {
    return { yaku: ym, han: 0, fu: 0, yakuman: ym.reduce((a, b) => a + (b.yakuman ?? 0), 0) };
  }

  const y: YakuEntry[] = [...situational];
  const valuePair = (k: Kind) => (isDragon(k) ? 1 : 0) + (k === ctx.seatWind ? 1 : 0) + (k === ctx.roundWind ? 1 : 0);
  const shuntsu = sets.filter((s) => s.type === 'shuntsu');
  const trips = sets.filter((s) => s.type !== 'shuntsu');

  // 平和
  const pinfu = closed && ctx.melds.length === 0 && shuntsu.length === 4 && valuePair(pair) === 0 && wait === 'ryanmen';
  if (pinfu) y.push({ name: '平和', han: 1 });
  if (allKinds.every(isSimple) && (closed || ctx.kuitan !== false)) y.push({ name: '断幺九', han: 1 });

  // 一盃口・二盃口
  if (closed) {
    const seqCount = new Map<number, number>();
    for (const s of shuntsu) seqCount.set(s.kind, (seqCount.get(s.kind) ?? 0) + 1);
    let peiko = 0;
    for (const v of seqCount.values()) peiko += Math.floor(v / 2);
    if (peiko === 2) y.push({ name: '二盃口', han: 3 });
    else if (peiko === 1) y.push({ name: '一盃口', han: 1 });
  }

  // 役牌
  for (const t of trips) {
    if (t.kind === 31) y.push({ name: '役牌 白', han: 1 });
    if (t.kind === 32) y.push({ name: '役牌 發', han: 1 });
    if (t.kind === 33) y.push({ name: '役牌 中', han: 1 });
    if (t.kind === ctx.seatWind) y.push({ name: '自風牌', han: 1 });
    if (t.kind === ctx.roundWind) y.push({ name: '場風牌', han: 1 });
  }

  // 三色同順
  for (let n = 0; n < 7; n++) {
    if ([0, 9, 18].every((b) => shuntsu.some((s) => s.kind === b + n))) {
      y.push({ name: '三色同順', han: closed ? 2 : 1 });
      break;
    }
  }
  // 一気通貫
  for (const b of [0, 9, 18]) {
    if ([0, 3, 6].every((o) => shuntsu.some((s) => s.kind === b + o))) {
      y.push({ name: '一気通貫', han: closed ? 2 : 1 });
      break;
    }
  }
  // 三色同刻
  for (let n = 0; n < 9; n++) {
    if ([0, 9, 18].every((b) => trips.some((s) => s.kind === b + n))) {
      y.push({ name: '三色同刻', han: 2 });
      break;
    }
  }
  // チャンタ系
  const setHasYaochu = (s: SetInfo) =>
    s.type === 'shuntsu' ? isTerminal(s.kind) || isTerminal(s.kind + 2) : isYaochu(s.kind);
  if (isYaochu(pair) && sets.every(setHasYaochu) && shuntsu.length > 0) {
    if (allKinds.some(isHonor)) y.push({ name: '混全帯幺九', han: closed ? 2 : 1 });
    else y.push({ name: '純全帯幺九', han: closed ? 3 : 2 });
  }
  if (allKinds.every(isYaochu)) y.push({ name: '混老頭', han: 2 });
  if (trips.length === 4) y.push({ name: '対々和', han: 2 });
  if (concealedTrip === 3) y.push({ name: '三暗刻', han: 2 });
  if (sets.filter((s) => s.type === 'kantsu').length === 3) y.push({ name: '三槓子', han: 2 });
  const dragonTrips = trips.filter((s) => isDragon(s.kind)).length;
  if (dragonTrips === 2 && isDragon(pair)) y.push({ name: '小三元', han: 2 });
  const flush = flushYaku(allKinds, closed);
  if (flush) y.push(flush);

  // 符計算
  let fu: number;
  if (pinfu) {
    fu = ctx.tsumo ? 20 : 30;
  } else {
    fu = 20;
    if (closed && !ctx.tsumo) fu += 10;
    if (ctx.tsumo) fu += 2;
    for (const s of trips) {
      let f = 2;
      if (isYaochu(s.kind)) f *= 2;
      if (!s.open) f *= 2;
      if (s.type === 'kantsu') f *= 4;
      fu += f;
    }
    fu += valuePair(pair) * 2;
    if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
    if (fu === 20) fu = 30; // 喰い平和形
    fu = Math.ceil(fu / 10) * 10;
  }
  return { yaku: y, han: y.reduce((a, b) => a + b.han, 0), fu, yakuman: 0 };
}

/** 点数支払い計算 */
export function payments(base: number, dealer: boolean, tsumo: boolean) {
  if (tsumo) {
    if (dealer) {
      const each = roundUp100(base * 2);
      return { total: each * 3, fromDealer: 0, fromOthers: each };
    }
    const fromDealer = roundUp100(base * 2);
    const fromOthers = roundUp100(base);
    return { total: fromDealer + fromOthers * 2, fromDealer, fromOthers };
  }
  const total = roundUp100(base * (dealer ? 6 : 4));
  return { total, fromDealer: 0, fromOthers: 0 };
}
