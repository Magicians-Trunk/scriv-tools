/**
 * RTF as written, token for token: groups, control words, control symbols, hex escapes and
 * text.  `writeRtfSyntax(readRtfSyntax(source))` gives back `source` exactly, whitespace and all,
 * so nothing a document holds is lost here; meaning is read from this tree (see `rtf.ts`).
 */
export type RtfToken = RtfGroup | RtfControl | RtfSymbol | RtfHex | RtfText;

/** `{…}`. */
export interface RtfGroup {
  kind: 'group';
  /** `{\*\word …}`: a destination the reader may skip when it does not know the word. */
  ignorable: boolean;
  tokens: RtfToken[];
  /** A group the source ends without closing. */
  open?: true;
}

/** `\word`, `\word12` or `\word-3`, and the space that ends it, if one does. */
export interface RtfControl {
  kind: 'control';
  word: string;
  parameter?: number;
  /** The parameter as written (`-0`, `007`), where it differs from `String(parameter)`. */
  written?: string;
  /** The space after the word, which belongs to the word and is not text. */
  space: boolean;
}

/** `\` and one character that is not a letter: `\\`, `\{`, `\~`, a backslash and a new line. */
export interface RtfSymbol {
  kind: 'symbol';
  symbol: string;
}

/** `\'hh`: a byte in the document's code page, its hex digits as written. */
export interface RtfHex {
  kind: 'hex';
  byte: number;
  written: string;
}

/** Text as written, new lines included, which RTF readers ignore. */
export interface RtfText {
  kind: 'text';
  text: string;
}

/** Reads RTF into its tokens.  A source read as Latin-1 keeps each byte as one character. */
export function readRtfSyntax(source: string): RtfToken[] {
  const root: RtfGroup = { kind: 'group', ignorable: false, tokens: [] };
  const groups: RtfGroup[] = [root];
  const top = () => groups.at(-1)!;
  let index = 0;
  let text = '';
  const flush = () => {
    if (text) top().tokens.push({ kind: 'text', text });
    text = '';
  };
  while (index < source.length) {
    const char = source[index]!;
    if (char === '{') {
      flush();
      const ignorable = source.startsWith('{\\*', index);
      const group: RtfGroup = { kind: 'group', ignorable, tokens: [] };
      top().tokens.push(group);
      groups.push(group);
      index += ignorable ? 3 : 1;
    } else if (char === '}' && groups.length > 1) {
      flush();
      groups.pop();
      index += 1;
    } else if (char === '\\') {
      flush();
      index = readBackslash(source, index, top().tokens);
    } else {
      text += char;
      index += 1;
    }
  }
  flush();
  for (const group of groups.slice(1)) group.open = true;
  return root.tokens;
}

/** Reads the backslash at `index` into `tokens`, and returns where reading goes on. */
function readBackslash(source: string, index: number, tokens: RtfToken[]): number {
  const next = source[index + 1];
  if (next === undefined) {
    tokens.push({ kind: 'symbol', symbol: '' });
    return index + 1;
  }
  if (next === "'") {
    const written = source.slice(index + 2, index + 4);
    tokens.push({ kind: 'hex', byte: Number.parseInt(written, 16), written });
    return index + 2 + written.length;
  }
  const word = /^[a-zA-Z]+/.exec(source.slice(index + 1, index + 33))?.[0];
  if (word === undefined) {
    tokens.push({ kind: 'symbol', symbol: next });
    return index + 2;
  }
  let at = index + 1 + word.length;
  const written = /^-?\d+/.exec(source.slice(at, at + 12))?.[0];
  const control: RtfControl = { kind: 'control', word, space: false };
  if (written !== undefined) {
    control.parameter = Number(written);
    if (String(control.parameter) !== written) control.written = written;
    at += written.length;
  }
  if (source[at] === ' ') {
    control.space = true;
    at += 1;
  }
  tokens.push(control);
  return at;
}

/** Writes tokens back as RTF. */
export function writeRtfSyntax(tokens: readonly RtfToken[]): string {
  return tokens.map(writeToken).join('');
}

function writeToken(token: RtfToken): string {
  if (token.kind === 'group') {
    const opening = token.ignorable ? '{\\*' : '{';
    return `${opening}${writeRtfSyntax(token.tokens)}${token.open ? '' : '}'}`;
  }
  if (token.kind === 'control') {
    const parameter =
      token.written ?? (token.parameter === undefined ? '' : String(token.parameter));
    return `\\${token.word}${parameter}${token.space ? ' ' : ''}`;
  }
  if (token.kind === 'symbol') return `\\${token.symbol}`;
  if (token.kind === 'hex') return `\\'${token.written}`;
  return token.text;
}
