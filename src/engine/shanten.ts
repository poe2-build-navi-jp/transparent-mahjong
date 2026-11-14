import { NUM_KINDS, YAOCHU_KINDS, type Kind } from './tiles';

// 色ごとに (面子数, 塔子数, 雀頭有無) の到達可能状態を列挙してキャッシュする
const suitCache = new Map<number, number[]>();

function suitStates(c: number[], off: number): number[] {
  let key = 0;
  for (let i = 8; i >= 0; i--) key = key * 5 + c[off + i];
  const hit = suitCache.get(key);
  if (hit) return hit;
  const a = c.slice(off, off + 9);
  const found = new Set<number>();
  const rec = (i: number, m: number, t: number, p: number) => {
    while (i < 9 && a[i] === 0) i++;
    if (i >= 9) {
      found.add(m * 100 + t * 10 + p);
      return;
    }
    if (a[i] >= 3) { a[i] -= 3; rec(i, m + 1, t, p); a[i] += 3; }
    if (i <= 6 && a[i + 1] && a[i + 2]) {
      a[i]--; a[i + 1]--; a[i + 2]--; rec(i, m + 1, t, p); a[i]++; a[i + 1]++; a[i + 2]++;
    }
    if (a[i] >= 2) {
      a[i] -= 2;
      if (!p) rec(i, m, t, 1);
      rec(i, m, t + 1, p);
      a[i] += 2;
    }
    if (i <= 7 && a[i + 1]) { a[i]--; a[i + 1]--; rec(i, m, t + 1, p); a[i]++; a[i + 1]++; }
    if (i <= 6 && a[i + 2]) { a[i]--; a[i + 2]--; rec(i, m, t + 1, p); a[i]++; a[i + 2]++; }
    const save = a[i];
    a[i] = 0;
    rec(i + 1, m, t, p);
    a[i] = save;
  };
  rec(0, 0, 0, 0);
  // 支配される状態を除去
  const list = [...found].map((v) => [Math.floor(v / 100), Math.floor(v / 10) % 10, v % 10]);
  const out = list
    .filter((x) => !list.some((y) => y !== x && y[0] >= x[0] && y[1] >= x[1] && y[2] >= x[2] && (y[0] > x[0] || y[1] > x[1] || y[2] > x[2])))
    .map((x) => x[0] * 100 + x[1] * 10 + x[2]);
  suitCache.set(key, out);
  return out;
}

function honorStates(c: number[]): number[] {
  let m = 0;
  let pairs = 0;
  for (let k = 27; k < 34; k++) {
    if (c[k] >= 3) m++;
    else if (c[k] === 2) pairs++;
  }
  const out = [m * 100 + pairs * 10];
  if (pairs > 0) out.push(m * 100 + (pairs - 1) * 10 + 1);
  return out;
}

/** 一般形の向聴数（-1 = 和了形）。meldCount は副露数（暗槓含む） */
export function shantenNormal(counts: number[], meldCount = 0): number {
  const groups = [suitStates(counts, 0), suitStates(counts, 9), suitStates(counts, 18), honorStates(counts)];
  let best = 8 - 2 * meldCount;
  const maxBlocks = 4 - meldCount;
  for (const a of groups[0]) for (const b of groups[1]) for (const c of groups[2]) for (const d of groups[3]) {
    const p = (a % 10) + (b % 10) + (c % 10) + (d % 10);
    if (p > 1) continue;
    const m = Math.floor(a / 100) + Math.floor(b / 100) + Math.floor(c / 100) + Math.floor(d / 100);
    const t = (Math.floor(a / 10) % 10) + (Math.floor(b / 10) % 10) + (Math.floor(c / 10) % 10) + (Math.floor(d / 10) % 10);
    const mm = Math.min(m, maxBlocks);
    const tt = Math.min(t, maxBlocks - mm);
    const s = 8 - 2 * (mm + meldCount) - tt - p;
    if (s < best) best = s;
  }
  return best;
}

export function shantenChiitoi(counts: number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < NUM_KINDS; i++) {
    if (counts[i] >= 1) kinds++;
    if (counts[i] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function shantenKokushi(counts: number[]): number {
  let kinds = 0;
  let pair = 0;
  for (const k of YAOCHU_KINDS) {
    if (counts[k] >= 1) kinds++;
    if (counts[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

export function shanten(counts: number[], meldCount = 0): number {
  let s = shantenNormal(counts, meldCount);
  if (meldCount === 0) {
    s = Math.min(s, shantenChiitoi(counts), shantenKokushi(counts));
  }
  return s;
}

/** 13枚(3n+1)の手牌の待ち牌の種類一覧（自分の手で4枚使い切っている牌は除く） */
export function waitingKinds(counts: number[], meldCount = 0): Kind[] {
  const out: Kind[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (shanten(counts, meldCount) === -1) out.push(k);
    counts[k]--;
  }
  return out;
}
