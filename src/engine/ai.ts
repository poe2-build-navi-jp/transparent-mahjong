import type { Action, Game, Options } from './game';
import { isClosed } from './game';
import { shanten } from './shanten';
import {
  countsOfIds, doraFromIndicator, isDragon, isHonor, isOpaque, kindOf, NUM_KINDS, type Kind, type TileId,
} from './tiles';

/**
 * CPU の思考。
 * 透明麻雀らしさとして、他家の透明牌が見えている情報を「残り枚数」と「危険度」に使う。
 */

/** seat から見える牌の枚数（自分の手牌・全員の河・副露・ドラ表示・他家の透明牌） */
function visibleCounts(g: Game, seat: number): number[] {
  const c = new Array(NUM_KINDS).fill(0);
  for (const t of g.fullHand(seat)) c[kindOf(t)]++;
  g.players.forEach((p, s) => {
    for (const d of p.discards) if (!d.called) c[kindOf(d.tile)]++;
    for (const m of p.melds) for (const t of m.tiles) c[kindOf(t)]++;
    c[30] += p.kita.length;
    if (s !== seat) {
      for (const t of p.hand) if (!isOpaque(t)) c[kindOf(t)]++;
      if (p.drawn !== null && !isOpaque(p.drawn)) c[kindOf(p.drawn)]++;
    }
  });
  for (const t of g.doraIndicators()) c[kindOf(t)]++;
  return c;
}

/** 有効牌の残り枚数 */
function ukeire(counts: number[], meldCount: number, visible: number[]): number {
  const base = shanten(counts, meldCount);
  let total = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    const remain = 4 - visible[k];
    if (remain <= 0) continue;
    counts[k]++;
    if (shanten(counts, meldCount) < base) total += remain;
    counts[k]--;
  }
  return total;
}

/**
 * 他家 opp に対して牌種 k の危険度（0 = 安全）。
 * 透明牌から相手手牌の大部分が読めるため、見えている手牌で待ちになり得るかを直接評価する。
 */
function danger(g: Game, seat: number, opp: number, k: Kind, visible: number[]): number {
  const p = g.players[opp];
  if (p.discards.some((d) => kindOf(d.tile) === k)) return 0; // 現物（フリテン）
  // 相手の見えている透明牌だけで k が当たり牌になるか
  const known = p.hand.filter((t) => !isOpaque(t));
  const hiddenCount = p.hand.length - known.length;
  const c = countsOfIds(known);
  c[k]++;
  // 見えている部分だけで和了形にどれだけ近いか（隠れ牌が多いほど不確定）
  const s = shanten(c, p.melds.length + Math.floor(hiddenCount / 3));
  let d = 10;
  if (hiddenCount <= 1 && s > 0) d = 1; // ほぼ全部見えていて当たらない
  else d = Math.max(1, 10 - s * 3);
  if (4 - visible[k] <= 0) d *= 0.3; // ワンチャンス/ノーチャンス
  if (isHonor(k)) d *= 0.6;
  void seat;
  return d;
}

function threatLevel(g: Game, opp: number): number {
  const p = g.players[opp];
  if (p.riichi) return 1;
  if (p.melds.filter((m) => m.type !== 'ankan').length >= 3) return 0.6;
  return 0;
}

function hasYakuPotential(g: Game, seat: number, extraTrip: Kind | null): boolean {
  const p = g.players[seat];
  const wind = g.seatWind(seat);
  const round = g.roundWindKind;
  const isYakuhai = (k: Kind) => isDragon(k) || k === wind || k === round;
  if (extraTrip !== null && isYakuhai(extraTrip)) return true;
  if (p.melds.some((m) => m.type !== 'chi' && isYakuhai(kindOf(m.tiles[0])))) return true;
  const c = countsOfIds(p.hand);
  for (let k = 27; k < 34; k++) if (isYakuhai(k) && c[k] >= 2) return true;
  // 断幺九を狙えるか（喰いタンなしなら鳴いた時点で不可）
  if (!g.rules.kuitan) return false;
  const all = [...p.hand, ...p.melds.flatMap((m) => m.tiles)].map(kindOf);
  const yaochu = all.filter((k) => isHonor(k) || k % 9 === 0 || k % 9 === 8).length;
  return yaochu <= 1 && p.melds.every((m) => m.tiles.every((t) => {
    const k = kindOf(t); return !isHonor(k) && k % 9 !== 0 && k % 9 !== 8;
  }));
}

export function chooseAction(g: Game, seat: number, opts: Options): Action {
  if (opts.ready) return { type: 'ready' };
  if (opts.tsumo) return { type: 'tsumo' };
  if (opts.ron) return { type: 'ron' };
  if (opts.nuki?.length) return { type: 'nuki', tile: opts.nuki[0] };

  const p = g.players[seat];

  // 鳴き判断
  if (opts.pass) {
    const last = g.lastDiscard;
    if (last && opts.pon) {
      const k = kindOf(last.tile);
      const before = shanten(countsOfIds(p.hand), p.melds.length);
      const after = countsOfIds(p.hand);
      after[k] -= 2;
      // 鳴いた後は1枚切る想定で最良の向聴数
      let best = 99;
      for (let x = 0; x < NUM_KINDS; x++) {
        if (!after[x]) continue;
        after[x]--;
        best = Math.min(best, shanten(after, p.melds.length + 1));
        after[x]++;
      }
      if (best < before && hasYakuPotential(g, seat, k)) return { type: 'pon', tiles: opts.pon[0] };
    }
    if (last && opts.chi && !isClosed(p.melds) && hasYakuPotential(g, seat, null)) {
      const before = shanten(countsOfIds(p.hand), p.melds.length);
      for (const tiles of opts.chi) {
        const after = countsOfIds(p.hand.filter((t) => !tiles.includes(t)));
        let best = 99;
        for (let x = 0; x < NUM_KINDS; x++) {
          if (!after[x]) continue;
          after[x]--;
          best = Math.min(best, shanten(after, p.melds.length + 1));
          after[x]++;
        }
        if (best < before) return { type: 'chi', tiles };
      }
    }
    return { type: 'pass' };
  }

  // 暗槓
  if (opts.ankan?.length) {
    const k = opts.ankan[0];
    const full = g.fullHand(seat);
    const c = countsOfIds(full);
    const before = shanten(c, p.melds.length);
    c[k] -= 4;
    // 槓後は嶺上ツモ前の13枚相当: 1枚少ない状態で比べるため、雑に4枚抜いて+1副露で比較
    const after = shanten(c, p.melds.length + 1);
    if (after <= before) return { type: 'ankan', kind: k };
  }
  if (opts.kakan?.length && !g.players.some((q, s) => s !== seat && q.riichi)) {
    return { type: 'kakan', tile: opts.kakan[0] };
  }

  const discards = opts.discard ?? [];
  if (discards.length === 1) return { type: 'discard', tile: discards[0] };

  const full = g.fullHand(seat);
  const visible = visibleCounts(g, seat);
  const counts = countsOfIds(full);
  const threats = g.seats().filter((s) => s !== seat).map((s) => ({ s, lv: threatLevel(g, s) })).filter((x) => x.lv > 0);
  const curShanten = shanten(counts, p.melds.length);
  const doraKinds = g.doraIndicators().map((t) => doraFromIndicator(kindOf(t), g.sanma));

  type Cand = { tile: TileId; sh: number; uke: number; dng: number; score: number };
  const seen = new Map<Kind, Cand>();
  for (const t of discards) {
    const k = kindOf(t);
    if (seen.has(k)) continue;
    counts[k]--;
    const sh = shanten(counts, p.melds.length);
    const uke = sh <= 3 ? ukeire(counts, p.melds.length, visible) : 0;
    counts[k]++;
    let dng = 0;
    for (const th of threats) dng += th.lv * danger(g, seat, th.s, k, visible);
    let score = -sh * 100 + uke;
    if (doraKinds.includes(k)) score -= 8;
    if (isHonor(k) && counts[k] === 1) score += 3;
    seen.set(k, { tile: t, sh, uke, dng, score });
  }
  const cands = [...seen.values()];
  // 押し引き: 脅威があり、遠い手ならベタオリ
  const defend = threats.length > 0 && curShanten >= 2;
  const semi = threats.length > 0 && curShanten === 1;
  cands.sort((a, b) => {
    if (defend) return a.dng - b.dng || b.score - a.score;
    const wa = a.score - (semi ? a.dng * 6 : 0);
    const wb = b.score - (semi ? b.dng * 6 : 0);
    return wb - wa;
  });
  const best = cands[0];
  // 同種なら透明牌から切る（不透明牌は手元に残して情報を隠す）
  const k = kindOf(best.tile);
  const sameKind = discards.filter((t) => kindOf(t) === k).sort((a, b) => Number(isOpaque(a)) - Number(isOpaque(b)));
  const tile = sameKind[0];

  if (opts.riichi?.includes(tile)) return { type: 'discard', tile, riichi: true };
  if (opts.riichi?.length && best.sh === 0) {
    const rt = opts.riichi.find((t) => kindOf(t) === k) ?? opts.riichi[0];
    return { type: 'discard', tile: rt, riichi: true };
  }
  return { type: 'discard', tile };
}
