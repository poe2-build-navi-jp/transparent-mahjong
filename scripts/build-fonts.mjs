// フォントをアプリに同梱するための CSS（src/ui/fonts.css）を生成する。
// - M PLUS Rounded 1c（本文）: 400 / 700 の woff2 を全文字分（ブラウザは必要な分割ファイルだけ読む）
// - Noto Serif JP（ロゴ・牌の文字・発声）: 使う文字を含む分割ファイルだけ
// 実行: node scripts/build-fonts.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SERIF_TEXT = '透明麻雀一二三四五六七八九萬東南西北白發中ポンチーカンリーチロンツモ流局勝利！位1234';

function faces(pkg, weight) {
  const css = readFileSync(`node_modules/@fontsource/${pkg}/${weight}.css`, 'utf8');
  return css.match(/@font-face\s*{[^}]*}/g) ?? [];
}

function covers(face, text) {
  const m = face.match(/unicode-range:\s*([^;]+);/);
  if (!m) return true;
  const ranges = m[1].split(',').map((r) => r.trim().replace(/^U\+/i, '')).map((r) => {
    const [a, b] = r.split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
  return [...text].some((ch) => {
    const c = ch.codePointAt(0);
    return ranges.some(([a, b]) => c >= a && c <= b);
  });
}

function fix(face, pkg, weightRange) {
  return face
    // woff の予備ファイルは不要（対応ブラウザはすべて woff2 を読める）
    .replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/, '')
    .replace(/url\(\.\/files\//g, `url(../../node_modules/@fontsource/${pkg}/files/`)
    .replace(/font-weight:\s*\d+;/, `font-weight: ${weightRange};`);
}

const out = ['/* 自動生成: node scripts/build-fonts.mjs （フォント: SIL Open Font License） */'];
for (const [w, range] of [['400', '100 500'], ['700', '600 900']]) {
  for (const f of faces('m-plus-rounded-1c', w)) out.push(fix(f, 'm-plus-rounded-1c', range));
}
for (const [w, range] of [['700', '600 800'], ['900', '900']]) {
  for (const f of faces('noto-serif-jp', w)) if (covers(f, SERIF_TEXT)) out.push(fix(f, 'noto-serif-jp', range));
}
writeFileSync('src/ui/fonts.css', out.join('\n') + '\n');
console.log(`faces: ${out.length - 1}`);
