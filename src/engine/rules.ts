// 対局ルール（ルームを作った人が対局前に決める）

export interface Rules {
  /** 人数 */
  count: 3 | 4;
  /** 東風戦 / 半荘戦 */
  length: 'tonpu' | 'hanchan';
  /** 持ち点（0 = 標準: 四麻25,000 / 三麻35,000） */
  startScore: number;
  /** 1手ごとの考慮時間（秒）。0 = 無制限（オンラインのみ） */
  thinkSec: number;
  /** 持ち時間（秒）。考慮時間を超えた分はここから減る */
  bankSec: number;
  /** 赤ドラ（各5の牌に1枚ずつ） */
  aka: boolean;
  /** 喰いタン（鳴いても断幺九が成立） */
  kuitan: boolean;
  /** トビ（持ち点がマイナスで終局） */
  tobi: boolean;
}

export const DEFAULT_RULES: Rules = {
  count: 4, length: 'tonpu', startScore: 0, thinkSec: 10, bankSec: 20, aka: true, kuitan: true, tobi: true,
};

export const RULE_CHOICES = {
  startScore: [0, 25000, 30000, 35000, 50000],
  thinkSec: [5, 10, 15, 20, 30, 0],
  bankSec: [0, 10, 20, 30, 60],
} as const;

/** 受け取ったルールを検証し、正しい値だけにする（サーバー・ホスト側で必ず通す） */
export function sanitizeRules(raw: unknown): Rules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Rules, unknown>>;
  const pick = <T>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
  return {
    count: r.count === 3 ? 3 : 4,
    length: r.length === 'hanchan' ? 'hanchan' : 'tonpu',
    startScore: pick(r.startScore, RULE_CHOICES.startScore, DEFAULT_RULES.startScore),
    thinkSec: pick(r.thinkSec, RULE_CHOICES.thinkSec, DEFAULT_RULES.thinkSec),
    bankSec: pick(r.bankSec, RULE_CHOICES.bankSec, DEFAULT_RULES.bankSec),
    aka: typeof r.aka === 'boolean' ? r.aka : DEFAULT_RULES.aka,
    kuitan: typeof r.kuitan === 'boolean' ? r.kuitan : DEFAULT_RULES.kuitan,
    tobi: typeof r.tobi === 'boolean' ? r.tobi : DEFAULT_RULES.tobi,
  };
}

export function startScoreOf(r: Rules): number {
  return r.startScore || (r.count === 3 ? 35000 : 25000);
}

/** 赤ドラの牌（5萬・5筒・5索の透明牌1枚ずつ）。三麻は5萬がないので2枚 */
export const AKA_IDS = [4 * 4 + 1, 13 * 4 + 1, 22 * 4 + 1];
export const isAkaId = (id: number): boolean => AKA_IDS.includes(id);

/** 一覧表示用の短い説明 */
export function rulesSummary(r: Rules, tr: (s: string, v?: Record<string, string | number>) => string = (s, v) => {
  let x = s;
  if (v) for (const [k, val] of Object.entries(v)) x = x.split(`{${k}}`).join(String(val));
  return x;
}): string[] {
  return [
    tr(r.count === 3 ? '三人麻雀' : '四人麻雀'),
    tr(r.length === 'hanchan' ? '半荘戦' : '東風戦'),
    tr('{n}点持ち', { n: startScoreOf(r).toLocaleString() }),
    r.thinkSec ? tr('考慮{a}秒＋持ち時間{b}秒', { a: r.thinkSec, b: r.bankSec }) : tr('時間無制限'),
    tr(r.aka ? '赤ドラあり' : '赤ドラなし'),
    tr(r.kuitan ? '喰いタンあり' : '喰いタンなし'),
    tr(r.tobi ? 'トビあり' : 'トビなし'),
  ];
}
