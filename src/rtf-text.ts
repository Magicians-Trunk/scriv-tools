/** Reading and writing text in RTF: its symbols, its code page, and its escapes. */
import type { RtfControl, RtfGroup, RtfToken } from './rtf-syntax.ts';

export const SYMBOL_WORDS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  emspace: ' ',
  enspace: ' ',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
};

export const CONTROL_SYMBOLS: Record<string, string> = {
  '\\': '\\',
  '{': '{',
  '}': '}',
  '~': ' ',
  '-': '­',
  _: '‑',
  '\t': '\t',
};

/** Each Windows-1252 byte's character, decoded once. */
export const CP1252 = Array.from({ length: 256 }, (_, byte) =>
  new TextDecoder('windows-1252').decode(new Uint8Array([byte])),
);

export const decodeByte = (byte: number) => CP1252[byte & 0xff]!;

/** The code page each `\\fcharset` other than the document's names, as the RTF spec lists them. */
const CHARSET_ENCODINGS: Record<number, string> = {
  77: 'macintosh',
  128: 'shift_jis',
  129: 'euc-kr',
  134: 'gbk',
  136: 'big5',
  161: 'windows-1253',
  162: 'windows-1254',
  163: 'windows-1258',
  177: 'windows-1255',
  178: 'windows-1256',
  186: 'windows-1257',
  204: 'windows-1251',
  222: 'windows-874',
  238: 'windows-1250',
};

/**
 * Reads bytes one at a time, each in its font's code page, giving what it completes: a character
 * of two bytes comes with the second.  Returns a reader that holds any first byte between calls.
 */
export function codePageReader() {
  const readers = new Map<number, (byte: number) => string>();
  return (byte: number, charset = 0): string => {
    const encoding = CHARSET_ENCODINGS[charset];
    if (encoding === undefined) return decodeByte(byte);
    if (!readers.has(charset)) {
      const decoder = new TextDecoder(encoding);
      readers.set(charset, (next) => decoder.decode(Uint8Array.of(next), { stream: true }));
    }
    return readers.get(charset)!(byte);
  };
}

/** The text of tokens, escapes read. */
export function plainText(tokens: RtfToken[]): string {
  return tokens
    .map((token) => {
      if (token.kind === 'text') return token.text;
      if (token.kind === 'hex') return decodeByte(token.byte);
      if (token.kind === 'symbol') return CONTROL_SYMBOLS[token.symbol] ?? '';
      return token.kind === 'group' ? plainText(token.tokens) : '';
    })
    .join('');
}

/**
 * Text as RTF: braces and backslashes escaped, the rest of Windows-1252 as `\'hh`, the rest of
 * Unicode as `\uN`, for a document that has set `\uc0` (no fallback character after it).
 */
export function escapeText(text: string): string {
  let written = '';
  for (const char of text) {
    for (const unit of char.length > 1 ? [char[0]!, char[1]!] : [char]) {
      const code = unit.charCodeAt(0);
      if (unit === '\\' || unit === '{' || unit === '}') written += `\\${unit}`;
      else if (code === 9 || (code >= 32 && code < 127)) written += unit;
      else {
        const byte = CP1252.indexOf(unit);
        if (byte >= 128) written += `\\'${byte.toString(16).padStart(2, '0')}`;
        else written += `\\u${code > 32_767 ? code - 65_536 : code} `;
      }
    }
  }
  return written;
}

/** A word's number, or `fallback` when it has none. */
export const numberOf = (word: RtfControl, fallback = 0) => word.parameter ?? fallback;

/** A word as a setting: its number, or `true` when it has none. */
export const settingOf = (word: RtfControl): number | true => word.parameter ?? true;

/** The word a group starts with, if it starts with one. */
/**
 * Text after a `\u`, without the fallback characters the `\uc` before it said stand in for it:
 * what is kept, and how many fallback characters are still to skip.
 */
export function skipFallback(text: string, skipping: number): { kept: string; skipping: number } {
  const skipped = Math.min(skipping, text.length);
  return { kept: text.slice(skipped), skipping: skipping - skipped };
}

export function firstWord(group: RtfGroup): string | undefined {
  const [first] = group.tokens;
  return first?.kind === 'control' ? first.word : undefined;
}
