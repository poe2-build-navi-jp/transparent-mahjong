/**
 * 表示言語（日本語 / English）
 *
 * 画面の文字は日本語の文をそのままキーにして t('...') で囲む。
 * 英語のときは src/i18n/en.ts の辞書を引き、辞書にない文はそのまま（日本語）表示する。
 * {name} のような部分は vars で差し込む。
 */
import { EN } from './i18n/en';
import { LONG_EN, LONG_JA } from './i18n/long';

export type Lang = 'ja' | 'en';

const KEY = 'tmj-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch { /* noop */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

let lang: Lang = detect();

export function getLang(): Lang {
  return lang;
}

/** 言語を変更して保存する */
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* noop */ }
  document.documentElement.lang = l;
}

/** 保存された設定がないときだけ言語を決める（Steam の言語設定など） */
export function suggestLang(l: Lang) {
  try { if (localStorage.getItem(KEY)) return; } catch { /* noop */ }
  lang = l;
  document.documentElement.lang = l;
}

export function hasSavedLang(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

/** 数字入りの決まった言い回し（辞書に入れられないもの） */
function pattern(ja: string): string | null {
  const m = ja.match(/^(\d+)倍役満$/);
  if (m) return `${m[1]}x yakuman`;
  return null;
}

/** 翻訳。vars は {name} を置き換える */
export function t(ja: string, vars?: Record<string, string | number>): string {
  let s = lang === 'en' ? EN[ja] ?? LONG_EN[ja] ?? pattern(ja) ?? ja : LONG_JA[ja] ?? ja;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

if (typeof document !== 'undefined') document.documentElement.lang = lang;
