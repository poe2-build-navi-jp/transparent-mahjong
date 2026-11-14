// 牌の表現
// 牌ID: 0..135  /  種類(kind): 0..33
//   0-8: 萬子 1-9, 9-17: 筒子 1-9, 18-26: 索子 1-9, 27-30: 東南西北, 31-33: 白發中
// 透明麻雀ルール: 各種4枚のうち1枚だけが通常牌（不透明）、残り3枚は透明牌。
//   copy (= id & 3) が 0 の牌を不透明牌とする。

export type TileId = number;
export type Kind = number;

export const NUM_KINDS = 34;
export const NUM_TILES = 136;

export const kindOf = (id: TileId): Kind => id >> 2;
export const isOpaque = (id: TileId): boolean => (id & 3) === 0;
export const isTransparent = (id: TileId): boolean => !isOpaque(id);

export const suitOf = (k: Kind): number => (k < 27 ? Math.floor(k / 9) : 3);
export const numOf = (k: Kind): number => (k < 27 ? (k % 9) + 1 : 0);
export const isHonor = (k: Kind): boolean => k >= 27;
export const isWind = (k: Kind): boolean => k >= 27 && k <= 30;
export const isDragon = (k: Kind): boolean => k >= 31;
export const isTerminal = (k: Kind): boolean => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isYaochu = (k: Kind): boolean => isHonor(k) || isTerminal(k);
export const isSimple = (k: Kind): boolean => !isYaochu(k);

export const YAOCHU_KINDS: Kind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export const EAST = 27;

/** ドラ表示牌からドラを求める */
export function doraFromIndicator(k: Kind, sanma = false): Kind {
  if (sanma && k === 0) return 8;
  if (k < 27) return Math.floor(k / 9) * 9 + ((k % 9) + 1) % 9;
  if (k <= 30) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}

const SUIT_CHARS = ['m', 'p', 's'];
const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_JP = ['萬', '筒', '索'];

export function kindName(k: Kind): string {
  if (k >= 27) return HONOR_NAMES[k - 27];
  return KANJI_NUM[k % 9] + SUIT_JP[Math.floor(k / 9)];
}

export function kindCode(k: Kind): string {
  if (k >= 27) return `${k - 26}z`;
  return `${(k % 9) + 1}${SUIT_CHARS[Math.floor(k / 9)]}`;
}

export const WIND_NAMES = ['東', '南', '西', '北'];

/** "123m456p789s11z" 形式から種類配列を作る（テスト・デバッグ用） */
export function parseKinds(s: string): Kind[] {
  const out: Kind[] = [];
  let buf: number[] = [];
  for (const ch of s.replace(/\s/g, '')) {
    if (ch >= '0' && ch <= '9') buf.push(Number(ch));
    else {
      const base = ch === 'm' ? 0 : ch === 'p' ? 9 : ch === 's' ? 18 : 27;
      for (const n of buf) out.push(base + n - 1);
      buf = [];
    }
  }
  return out;
}

export function countsOf(kinds: Iterable<Kind>): number[] {
  const c = new Array(NUM_KINDS).fill(0);
  for (const k of kinds) c[k]++;
  return c;
}

export function countsOfIds(ids: Iterable<TileId>): number[] {
  const c = new Array(NUM_KINDS).fill(0);
  for (const id of ids) c[id >> 2]++;
  return c;
}

/** 表示用ソート: 種類順、同種なら不透明牌を後ろへ */
export function sortTiles(ids: TileId[]): TileId[] {
  return [...ids].sort((a, b) => a - b);
}
