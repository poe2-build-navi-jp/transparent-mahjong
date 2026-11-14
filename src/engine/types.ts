import type { Kind, TileId } from './tiles';

export type MeldType = 'chi' | 'pon' | 'minkan' | 'ankan' | 'kakan';

export interface Meld {
  type: MeldType;
  tiles: TileId[];
  /** 鳴いた牌（暗槓は undefined） */
  called?: TileId;
  /** 鳴いた相手の席（絶対席） */
  from?: number;
}

export interface YakuEntry {
  name: string;
  han: number;
  yakuman?: number;
}

export interface WinResult {
  yaku: YakuEntry[];
  han: number;
  fu: number;
  dora: number;
  yakuman: number;
  /** 基本点 */
  base: number;
  /** 点数表記（"満貫" など） */
  limitName: string;
}

export interface WinContext {
  /** 手牌（和了牌を含む、副露分は含まない）の種類 */
  hand: Kind[];
  melds: Meld[];
  winTile: Kind;
  tsumo: boolean;
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  haitei: boolean;
  houtei: boolean;
  rinshan: boolean;
  chankan: boolean;
  tenhou: boolean;
  chiihou: boolean;
  seatWind: Kind;
  roundWind: Kind;
  doraIndicators: Kind[];
  uraIndicators: Kind[];
  /** 三人麻雀（1萬表示のドラは9萬） */
  sanma?: boolean;
  /** 抜きドラの枚数 */
  nukiDora?: number;
  /** 赤ドラの枚数 */
  akaDora?: number;
  /** 喰いタン（省略時あり） */
  kuitan?: boolean;
}
