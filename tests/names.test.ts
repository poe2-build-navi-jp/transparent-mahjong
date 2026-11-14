import { describe, expect, it } from 'vitest';
import { isBadName, sanitizeName } from '../src/net/names';

describe('player name filter', () => {
  it('blocks inappropriate names (including obfuscated)', () => {
    for (const n of ['fuck', 'FUCK you', 'ｆｕｃｋ', 'f.u.c.k', 'シネ', 'しね', '死ね', 'チンコ', 'ちんこ太郎', 'sh1t', 'ばか', 'キチガイ', 'nigger']) {
      expect(isBadName(n), n).toBe(true);
    }
  });
  it('allows ordinary names', () => {
    for (const n of ['たろう', 'ゆうき', 'Mahjong太郎', 'かすみ', 'Kasumi', 'skill', 'はなこ', 'えたーなる', 'Essex', 'さくら', '雀士', 'ホスト', 'ゲスト', 'Player1']) {
      expect(isBadName(n), n).toBe(false);
    }
  });
  it('sanitizes', () => {
    expect(sanitizeName('  fuck  ')).toBe('プレイヤー');
    expect(sanitizeName('')).toBe('プレイヤー');
    expect(sanitizeName('a‮b')).toBe('ab');
    expect(sanitizeName('1234567890abcdef')).toBe('1234567890ab');
  });
});
