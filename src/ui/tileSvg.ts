import type { Kind } from '../engine/tiles';

// 牌の絵柄を SVG で生成する（オリジナル素材）。viewBox 0 0 60 80
const RED = '#d0312d';
const BLUE = '#1f4e9c';
const GREEN = '#1d7a46';
const INK = '#1b1b1f';

const cache = new Map<Kind, string>();

function circle(x: number, y: number, r: number, color: string): string {
  return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${r * 0.28}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="${color}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.68}" fill="none" stroke="${color}" stroke-width="${r * 0.1}" stroke-dasharray="${r * 0.3} ${r * 0.18}"/></g>`;
}

function stick(x: number, y: number, color: string, h = 20): string {
  const w = 6;
  return `<g><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" fill="${color}"/>` +
    `<rect x="${x - w / 2}" y="${y - 1}" width="${w}" height="2" fill="#fff" opacity=".7"/>` +
    `<rect x="${x - 1}" y="${y - h / 2 + 2}" width="2" height="${h - 4}" fill="#fff" opacity=".35"/></g>`;
}

const PIN_LAYOUT: Record<number, [number, number, string][]> = {
  2: [[30, 22, GREEN], [30, 58, BLUE]],
  3: [[16, 18, BLUE], [30, 40, RED], [44, 62, GREEN]],
  4: [[18, 22, BLUE], [42, 22, GREEN], [18, 58, GREEN], [42, 58, BLUE]],
  5: [[17, 19, BLUE], [43, 19, GREEN], [30, 40, RED], [17, 61, GREEN], [43, 61, BLUE]],
  6: [[19, 15, GREEN], [41, 15, GREEN], [19, 42, RED], [41, 42, RED], [19, 64, RED], [41, 64, RED]],
  7: [[14, 12, GREEN], [30, 21, GREEN], [46, 30, GREEN], [19, 48, RED], [41, 48, RED], [19, 67, RED], [41, 67, RED]],
  8: [[19, 12, BLUE], [41, 12, BLUE], [19, 30, BLUE], [41, 30, BLUE], [19, 49, BLUE], [41, 49, BLUE], [19, 67, BLUE], [41, 67, BLUE]],
  9: [[14, 15, BLUE], [30, 15, BLUE], [46, 15, BLUE], [14, 40, RED], [30, 40, RED], [46, 40, RED], [14, 65, GREEN], [30, 65, GREEN], [46, 65, GREEN]],
};

const SOU_LAYOUT: Record<number, [number, number, string][]> = {
  2: [[30, 22, GREEN], [30, 58, GREEN]],
  3: [[30, 22, GREEN], [19, 58, GREEN], [41, 58, GREEN]],
  4: [[19, 22, GREEN], [41, 22, GREEN], [19, 58, GREEN], [41, 58, GREEN]],
  5: [[17, 22, GREEN], [43, 22, GREEN], [30, 40, RED], [17, 58, GREEN], [43, 58, GREEN]],
  6: [[14, 22, GREEN], [30, 22, GREEN], [46, 22, GREEN], [14, 58, GREEN], [30, 58, GREEN], [46, 58, GREEN]],
  7: [[30, 13, RED], [14, 40, GREEN], [30, 40, GREEN], [46, 40, GREEN], [14, 66, GREEN], [30, 66, GREEN], [46, 66, GREEN]],
  8: [[12, 22, GREEN], [24, 18, GREEN], [36, 18, GREEN], [48, 22, GREEN], [12, 58, GREEN], [24, 62, GREEN], [36, 62, GREEN], [48, 58, GREEN]],
  9: [[14, 14, GREEN], [30, 14, RED], [46, 14, GREEN], [14, 40, GREEN], [30, 40, RED], [46, 40, GREEN], [14, 66, GREEN], [30, 66, RED], [46, 66, GREEN]],
};

const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const FONT = `font-family="'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif" font-weight="700"`;

function face(k: Kind): string {
  if (k < 9) {
    return `<text x="30" y="34" text-anchor="middle" font-size="30" fill="${INK}" ${FONT}>${KANJI[k]}</text>` +
      `<text x="30" y="70" text-anchor="middle" font-size="30" fill="${RED}" ${FONT}>萬</text>`;
  }
  if (k < 18) {
    const n = k - 9 + 1;
    if (n === 1) {
      return circle(30, 40, 20, RED) + `<circle cx="30" cy="40" r="25" fill="none" stroke="${GREEN}" stroke-width="2.5"/>`;
    }
    const r = n <= 3 ? 11 : n <= 5 ? 10 : n === 6 ? 8.5 : 7.5;
    return PIN_LAYOUT[n].map(([x, y, c]) => circle(x, y, r, c)).join('');
  }
  if (k < 27) {
    const n = k - 18 + 1;
    if (n === 1) {
      // 一索: 鳥をイメージした意匠
      return `<g><ellipse cx="30" cy="44" rx="13" ry="17" fill="${GREEN}"/>` +
        `<path d="M30 14 C38 18 40 26 34 32 L30 28 L26 32 C20 26 22 18 30 14Z" fill="${RED}"/>` +
        `<circle cx="30" cy="22" r="3" fill="#fff"/><path d="M22 58 L30 72 L38 58Z" fill="${BLUE}"/>` +
        `<path d="M24 40 Q30 50 36 40" stroke="#fff" stroke-width="2" fill="none"/></g>`;
    }
    const h = n >= 7 ? 18 : 22;
    return SOU_LAYOUT[n].map(([x, y, c]) => stick(x, y, c, h)).join('');
  }
  switch (k) {
    case 27: case 28: case 29: case 30:
      return `<text x="30" y="56" text-anchor="middle" font-size="42" fill="${INK}" ${FONT}>${'東南西北'[k - 27]}</text>`;
    case 31:
      return `<rect x="12" y="14" width="36" height="52" rx="3" fill="none" stroke="${BLUE}" stroke-width="3"/>` +
        `<rect x="17" y="19" width="26" height="42" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.2"/>`;
    case 32:
      return `<text x="30" y="56" text-anchor="middle" font-size="42" fill="${GREEN}" ${FONT}>發</text>`;
    default:
      return `<text x="30" y="56" text-anchor="middle" font-size="42" fill="${RED}" ${FONT}>中</text>`;
  }
}

/** red: 赤ドラ（絵柄をすべて赤で描く） */
export function tileFaceSvg(k: Kind, red = false): string {
  const key = red ? k + 100 : k;
  let s = cache.get(key);
  if (!s) {
    let f = face(k);
    if (red) f = f.split(INK).join(RED).split(BLUE).join(RED).split(GREEN).join(RED);
    s = `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${f}</svg>`;
    cache.set(key, s);
  }
  return s;
}
