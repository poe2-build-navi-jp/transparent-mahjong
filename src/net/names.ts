// プレイヤー名の検査（他のプレイヤーに表示されるため、不適切な語を含む名前は置き換える）
// クライアントとサーバーの両方で使う。

/** 比較用に正規化: 全角英数→半角、カタカナ→ひらがな、小文字化、記号・空白除去、伸ばし棒等の除去 */
export function normalizeForCheck(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\-_.・ー〜~!！?？*＊@#$%^&()（）[\]{}「」『』【】<>＜＞'"`、。,]/g, '')
    // よくある伏せ字・置き換えを戻す
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/\$/g, 's');
}

// 正規化後の文字列に含まれていたら不適切とみなす語（ひらがな・小文字）
const NG_WORDS = [
  // 日本語: 性的・差別・暴力・侮辱
  'ちんこ', 'ちんぽ', 'まんこ', 'おまんこ', 'せっくす', 'えっち', 'ふぇら', 'くんに', 'おっぱい', 'ちくび',
  'れいぷ', 'ごうかん', '強姦', 'やりまん', 'やりちん', 'ぱいぱん', 'おなにー', 'しゃせい', '射精', '勃起', 'ぼっき',
  'きちがい', '気違い', 'ききちがい', 'がいじ', '池沼', 'ちしょう', 'かたわ', 'めくら', 'つんぼ', 'おし',
  'ちょん', 'しな人', 'しなじん', '支那', 'えた', 'ひにん', 'ぶらく', '部落', 'にがー',
  'しね', '死ね', 'ころす', '殺す', 'ころしてやる', 'じさつ', '自殺', 'てろ',
  'くず', 'かす', 'ごみくず', 'ぶす', 'でぶ', 'はげ', 'ばか', '馬鹿', 'あほ', '阿呆', 'まぬけ', 'うんこ', 'うんち',
  'ちんかす', 'まんかす', 'ふぁっく', 'しっと',
  // 英語
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'sex', 'porn', 'nude',
  'rape', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'slut', 'whore', 'asshole', 'bastard', 'kill', 'nazi',
  'hitler', 'kkk', 'cum', 'anal', 'boob', 'tits',
];

// 単体では普通の言葉に含まれやすいため、名前全体が一致したときだけ弾く語
const NG_EXACT = ['おし', 'えた', 'てろ', 'かす', 'くず', 'でぶ', 'はげ', 'ちょん', 'fag', 'cum', 'anal', 'kill', 'dick'];

// 正規化で伸ばし棒が消えるため、普通の言葉が誤検出されないよう許可する語
const ALLOW = ['すいーとぴー', 'えたーなる', 'かすみ', 'かすたむ', 'かすてら', 'くずは', 'はげしい', 'でぶす',
  'skill', 'killer', 'kills', 'analysis', 'analog', 'cumulative', 'scum', 'dickens', 'sussex', 'essex', 'middlesex'];

export function isBadName(name: string): boolean {
  const n = normalizeForCheck(name);
  if (!n) return false;
  let rest = n;
  for (const a of ALLOW) rest = rest.split(a).join('');
  if (NG_EXACT.includes(n)) return true;
  return NG_WORDS.some((w) => !NG_EXACT.includes(w) && rest.includes(normalizeForCheck(w)));
}

/** 表示用に整えた名前。不適切・空なら代わりの名前を返す */
export function sanitizeName(raw: unknown, fallback = 'プレイヤー'): string {
  // 制御文字・書式文字（右から左への上書きなど）を除去
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .trim()
    .slice(0, 12);
  if (!s || isBadName(s)) return fallback;
  return s;
}
