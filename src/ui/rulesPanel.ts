import { rulesSummary, type Rules } from '../engine/rules';

type Opt = [unknown, string];
interface Row {
  key: keyof Rules;
  label: string;
  opts: Opt[];
  note?: string;
}

const ROWS: Row[] = [
  { key: 'count', label: '人数', opts: [[4, '四人麻雀'], [3, '三人麻雀']] },
  { key: 'length', label: '対局の長さ', opts: [['tonpu', '東風戦'], ['hanchan', '半荘戦']] },
  { key: 'startScore', label: '持ち点', opts: [[0, '標準'], [25000, '25,000'], [30000, '30,000'], [35000, '35,000'], [50000, '50,000']], note: '標準: 四麻25,000 / 三麻35,000' },
  { key: 'thinkSec', label: '考慮時間（1手ごと）', opts: [[5, '5秒'], [10, '10秒'], [15, '15秒'], [20, '20秒'], [30, '30秒'], [0, '無制限']], note: '毎手リセット。超えた分は持ち時間から減る' },
  { key: 'bankSec', label: '持ち時間（1局を通して）', opts: [[0, 'なし'], [10, '10秒'], [20, '20秒'], [30, '30秒'], [60, '60秒']], note: '使い切ると自動でツモ切り・スキップ' },
  { key: 'aka', label: '赤ドラ', opts: [[true, 'あり'], [false, 'なし']], note: '5萬・5筒・5索に1枚ずつ（三麻は5筒・5索）' },
  { key: 'kuitan', label: '喰いタン', opts: [[true, 'あり'], [false, 'なし']], note: '鳴いても断幺九が成立するか' },
  { key: 'tobi', label: 'トビ', opts: [[true, 'あり'], [false, 'なし']], note: '持ち点がマイナスになったら終局' },
];

const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));

/** 編集できるルール設定パネル。timeNote: 時間の項目に付ける注記（CPU対戦用） */
export function rulesPanelHtml(r: Rules, timeNote = ''): string {
  return `<div class="rules-panel">${ROWS.map((row) => {
    const disabled = row.key === 'bankSec' && r.thinkSec === 0;
    const note = (row.key === 'thinkSec' || row.key === 'bankSec') && timeNote ? timeNote : row.note;
    return `<div class="rrow ${disabled ? 'disabled' : ''}">
      <div class="rlabel">${row.label}${note ? `<small>${note}</small>` : ''}</div>
      <div class="ropts">${row.opts.map(([v, label]) =>
        `<button class="${r[row.key] === v ? 'on' : ''}" data-rule="${row.key}" data-val="${enc(v)}" ${disabled ? 'disabled' : ''}>${label}</button>`).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}

/** 参加者向けの読み取り専用表示 */
export function rulesSummaryHtml(r: Rules): string {
  return `<div class="rules-summary"><div class="rs-title">この卓のルール</div>${rulesSummary(r).map((s) => `<span>${s}</span>`).join('')}</div>`;
}

/** パネルのボタンに反応させる。変更後のルールを onChange に渡す */
export function bindRulesPanel(root: ParentNode, get: () => Rules, onChange: (r: Rules) => void) {
  root.querySelectorAll<HTMLButtonElement>('[data-rule]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.rule as keyof Rules;
    const value = JSON.parse(decodeURIComponent(b.dataset.val!));
    onChange({ ...get(), [key]: value } as Rules);
  }));
}
