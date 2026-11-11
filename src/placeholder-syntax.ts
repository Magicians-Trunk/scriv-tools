/**
 * Placeholders as written in text: `<$name>`, `<$name:argument>` or `<$name#argument>`.  An
 * argument can hold placeholders of its own (`<$n:toc:<$title_no_spaces>>`), which Scrivener
 * evaluates first.
 */
export interface Placeholder {
  kind: 'placeholder';
  name: string;
  separator?: ':' | '#';
  argument: PlaceholderPart[];
  /** The backslashes written just before it: one escapes it, more do not. */
  slashes: number;
}

export type PlaceholderPart = TextPart | Placeholder;

export interface TextPart {
  kind: 'text';
  text: string;
}

/** A placeholder found in text, where it is (its backslashes aside), its argument likewise. */
export interface FoundPlaceholder extends Placeholder {
  argument: Piece[];
  start: number;
  end: number;
}

/** A piece of text: plain text, or a placeholder found in it. */
export type Piece = TextPart | FoundPlaceholder;

/**
 * A placeholder as written.  `slashes: false` leaves out the backslashes before it and those
 * inside it, as an escaped placeholder prints; `argument` writes that in place of its own.
 */
export function placeholderText(
  placeholder: Placeholder,
  written: { slashes?: boolean; argument?: string } = {},
): string {
  const slashes = written.slashes === false ? '' : '\\'.repeat(placeholder.slashes);
  const argument =
    written.argument ??
    placeholder.argument
      .map((part) => (part.kind === 'text' ? part.text : placeholderText(part, written)))
      .join('');
  const { name, separator } = placeholder;
  return `${slashes}<$${name}${separator === undefined ? '' : separator + argument}>`;
}

const NAME = /^<\$([A-Za-z][A-Za-z0-9_]*)/;

/** Whether the text starts with what starts a placeholder: `<$` and a name. */
export function startsPlaceholder(text: string): boolean {
  return NAME.test(text);
}

/** Splits text into plain text and placeholders, each where it is in the text. */
export function parsePlaceholders(source: string): Piece[] {
  return parseSequence(source, 0, false)!.pieces;
}

/** Splits text into plain text and placeholders, where they were left aside. */
export function readPlaceholders(source: string): PlaceholderPart[] {
  return parsePlaceholders(source).map(withoutPlace);
}

function withoutPlace(piece: Piece): PlaceholderPart {
  if (piece.kind === 'text') return piece;
  const { start: _start, end: _end, argument, ...placeholder } = piece;
  return { ...placeholder, argument: argument.map(withoutPlace) };
}

/**
 * Reads pieces from `start`.  Inside an argument, reading stops at the `>` that closes it, and
 * text with no closing `>` is not an argument.
 */
function parseSequence(
  source: string,
  start: number,
  inArgument: boolean,
): { pieces: Piece[]; end: number } | undefined {
  const pieces: Piece[] = [];
  let text = '';
  let index = start;
  while (index < source.length) {
    if (inArgument && source[index] === '>') {
      if (text) pieces.push({ kind: 'text', text });
      return { pieces, end: index };
    }
    const opens = source.startsWith('<$', index);
    const slashes = opens ? /\\*$/.exec(text)![0].length : 0;
    const placeholder = opens ? parseTag(source, index, slashes) : undefined;
    if (placeholder) {
      text = text.slice(0, text.length - slashes);
      if (text) pieces.push({ kind: 'text', text });
      text = '';
      pieces.push(placeholder);
      index = placeholder.end;
    } else {
      text += source[index];
      index += 1;
    }
  }
  if (inArgument) return undefined;
  if (text) pieces.push({ kind: 'text', text });
  return { pieces, end: index };
}

/** The placeholder that starts at `start`, after `slashes` backslashes, if one does. */
function parseTag(source: string, start: number, slashes: number): FoundPlaceholder | undefined {
  const name = NAME.exec(source.slice(start, start + 64))?.[1];
  if (name === undefined) return undefined;
  const after = start + 2 + name.length;
  if (source[after] === '>') {
    return { kind: 'placeholder', name, argument: [], slashes, start, end: after + 1 };
  }
  const separator = source[after];
  if (separator !== ':' && separator !== '#') return undefined;
  const argument = parseSequence(source, after + 1, true);
  if (!argument) return undefined;
  const end = argument.end + 1;
  return { kind: 'placeholder', name, separator, argument: argument.pieces, slashes, start, end };
}
