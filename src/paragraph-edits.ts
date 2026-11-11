/**
 * The edits that turn a document's paragraphs into paragraphs as they now stand.  Any form of a
 * document can hand back its paragraphs with no idea which is which: they are lined up by their
 * text, and within one only the characters that differ change, so all else it holds stays.
 */
import { alignParagraphs } from './align.ts';
import { matches } from './diff.ts';
import type { Inline, NewParagraph, ReadParagraph } from './edit-pieces.ts';
import type { DocumentEdit, ItemEdit } from './editable.ts';
import { same } from './rich-text.ts';
import { plainText } from './text-compare.ts';
import type { StyleRoles } from './style-mapping.ts';

/** A paragraph as a form of the document holds it: where it is in the document is its place. */
export type WrittenParagraph = Omit<ReadParagraph, 'paragraph'>;

/** The character styles that mean bold and italic in a project, when it has them. */
export type MarkStyles = Pick<StyleRoles, 'strong' | 'emphasis'>;

/**
 * A piece as bold and italic, whichever way it holds them.  A form of the document shows these
 * two as looks, so a style that only means one reads as that look.
 */
export function shownPiece({ style, ...piece }: Inline, marks: MarkStyles): Inline {
  if (style === undefined) return piece;
  if (style === marks.strong) return { ...piece, bold: true };
  if (style === marks.emphasis) return { ...piece, italic: true };
  return { ...piece, style };
}

/** A new piece in the style a look means here, in place of the look: a compile may drop a look. */
function writtenPiece(piece: Inline, { strong, emphasis }: MarkStyles): Inline {
  const { bold, italic, ...rest } = piece;
  if (piece.style !== undefined) return piece;
  if (bold && strong) return { ...rest, style: strong, ...(italic ? { italic } : {}) };
  if (italic && emphasis) return { ...rest, style: emphasis, ...(bold ? { bold } : {}) };
  return piece;
}

/** One character of a paragraph's text, a whole link's piece, or a whole note, with what it is. */
interface Cell {
  /** What must match for it to be the same one. */
  key: string;
  text: string;
  look: Omit<Inline, 'text' | 'note' | 'size' | 'placeholder'>;
  /** Its look as one value, to compare. */
  seen: string;
  /** The character style it is really in, which `look` may show as bold or italic. */
  held: string | undefined;
  /** Where it is in the paragraph's text; a note has no length there. */
  offset: number;
  /** A note, and which piece of the paragraph it is. */
  note?: { piece: number; inline: Inline };
}

function cellsOf(pieces: Inline[], marks: MarkStyles): Cell[] {
  let offset = 0;
  return pieces.flatMap((inline, piece): Cell[] => {
    const held = inline.style;
    const {
      text,
      note,
      size: _size,
      placeholder: _placeholder,
      ...look
    } = shownPiece(inline, marks);
    const seen = JSON.stringify([look.style, !!look.bold, !!look.italic, look.link]);
    if (note) {
      const key = JSON.stringify(inline);
      return [{ key, text: '', look, seen, held, offset, note: { piece, inline } }];
    }
    // Text in a link goes as one: words lined up across it would carry the link to other words.
    const parts = look.link ? [text] : Array.from(text);
    return parts.map((part) => {
      const key = look.link ? JSON.stringify([part, look.link]) : part;
      const cell = { key, text: part, look, seen, held, offset };
      offset += part.length;
      return cell;
    });
  });
}

/** Cells as pieces of text, those that look the same in one, each in the style its look means. */
function piecesOf(cells: Cell[], marks: MarkStyles): Inline[] {
  const pieces: Inline[] = [];
  for (const { text, look, note } of cells) {
    const last = pieces.at(-1);
    if (note) pieces.push(note.inline);
    else if (last && !last.note && same({ ...last, text: '' }, { ...look, text: '' })) {
      last.text += text;
    } else pieces.push({ ...look, text });
  }
  return pieces.map((piece) => writtenPiece(piece, marks));
}

/** A stretch of text that stayed, and whether it is in a style that only means a look. */
interface Stretch {
  paragraph: number;
  start: number;
  end: number;
  held: string | undefined;
}

/** The edit that turns bold or italic on or off, by the style that means it or as a look. */
function markEdit(
  { held, ...at }: Stretch,
  change: { bold: boolean } | { italic: boolean },
  style: string | undefined,
): DocumentEdit {
  const on = Object.values(change)[0];
  if (style !== undefined && !on && held === style) return { kind: 'character', ...at };
  if (style !== undefined && on && held === undefined) return { kind: 'character', ...at, style };
  return { kind: 'look', ...at, ...change };
}

/** What differs between two looks of the same text, as an edit to a stretch of it. */
function lookEdits(
  stretch: Stretch,
  was: Cell['look'],
  now: Cell['look'],
  marks: MarkStyles,
): DocumentEdit[] {
  const { held: _held, ...at } = stretch;
  const edits: DocumentEdit[] = [];
  if (was.style !== now.style) {
    const style = now.style === undefined ? {} : { style: now.style };
    edits.push({ kind: 'character', ...at, ...style });
  }
  if (!was.bold !== !now.bold) edits.push(markEdit(stretch, { bold: !!now.bold }, marks.strong));
  if (!was.italic !== !now.italic) {
    edits.push(markEdit(stretch, { italic: !!now.italic }, marks.emphasis));
  }
  return edits;
}

/** The edits for characters that stayed, each stretch that changed its look alike in one. */
function matchedEdits(paragraph: number, old: Cell[], next: Cell[], marks: MarkStyles) {
  const edits: DocumentEdit[] = [];
  for (let at = 0; at < old.length;) {
    let end = at + 1;
    const first = old[at]!;
    const alike = (index: number) =>
      old[index]!.seen === first.seen &&
      old[index]!.held === first.held &&
      next[index]!.seen === next[at]!.seen;
    while (!first.note && end < old.length && !old[end]!.note && alike(end)) end += 1;
    const last = old[end - 1]!;
    if (!first.note && first.seen !== next[at]!.seen) {
      const stop = last.offset + last.text.length;
      const stretch = { paragraph, start: first.offset, end: stop, held: first.held };
      edits.push(...lookEdits(stretch, first.look, next[at]!.look, marks));
    }
    at = end;
  }
  return edits;
}

const keyOf = ({ key }: Cell) => key;

/** The edits that change a paragraph's text and how it looks, from the last back. */
function textEdits(
  paragraph: number,
  before: Inline[],
  after: Inline[],
  marks: MarkStyles,
): DocumentEdit[] {
  const old = cellsOf(before, marks);
  const next = cellsOf(after, marks);
  const edits: DocumentEdit[] = [];
  let a = 0;
  let b = 0;
  const gap = (oldEnd: number, newEnd: number) => {
    if (a === oldEnd && b === newEnd) return;
    const gone = old.slice(a, oldEnd);
    const text = gone.filter(({ note }) => !note);
    const added = next.slice(b, newEnd);
    const previous = old[a - 1];
    const [first] = text;
    const last = text.at(-1);
    if (first && last) {
      const end = last.offset + last.text.length;
      const range = { paragraph, start: first.offset, end };
      edits.push({ kind: 'replace', ...range, text: piecesOf(added, marks) });
    } else if (previous?.note && added.length > 0) {
      const at = previous.note.piece + 1;
      edits.push({ kind: 'inlines', paragraph, first: at, count: 0, text: piecesOf(added, marks) });
    } else if (added.length > 0) {
      const start = previous ? previous.offset + previous.text.length : 0;
      const pieces = piecesOf(added, marks);
      edits.push({ kind: 'replace', paragraph, start, end: start, text: pieces });
    }
    for (const { note } of gone) {
      if (note) edits.push({ kind: 'inlines', paragraph, first: note.piece, count: 1, text: [] });
    }
  };
  for (const match of matches(old.map(keyOf), next.map(keyOf))) {
    gap(match.a, match.b);
    a = match.a + match.length;
    b = match.b + match.length;
    const kept = old.slice(match.a, a);
    edits.push(...matchedEdits(paragraph, kept, next.slice(match.b, b), marks));
  }
  gap(old.length, next.length);
  return edits.toReversed();
}

const newParagraph = (
  { style, level, text, list }: WrittenParagraph,
  marks: MarkStyles,
): NewParagraph => ({
  ...(style === undefined ? {} : { style }),
  ...(level === undefined ? {} : { level }),
  text: text.map((piece) => writtenPiece(piece, marks)),
  ...(list ? { list } : {}),
});

/** A paragraph's words and notes, by which paragraphs are lined up. */
const wordsOf = ({ text }: WrittenParagraph) =>
  JSON.stringify(text.map(({ text: words, note }) => [words, note]).flat());

/** Whether a paragraph's text is what a form shows of it, so that none of it changed. */
const shownAs = (before: Inline[], after: Inline[], marks: MarkStyles) =>
  before.length === after.length &&
  before.every((piece, at) => same(shownPiece(piece, marks), after[at]));

/** The edits that make one paragraph into another. */
function changed(
  before: ReadParagraph,
  after: WrittenParagraph,
  marks: MarkStyles,
): DocumentEdit[] {
  const { paragraph } = before;
  const edits = shownAs(before.text, after.text, marks)
    ? []
    : textEdits(paragraph, before.text, after.text, marks);
  const level = before.level === after.level;
  if (before.style === after.style && same(before.list, after.list) && level) return edits;
  const style = after.style === undefined ? {} : { style: after.style };
  const heading = after.level === undefined ? {} : { level: after.level };
  return [...edits, { kind: 'style', paragraph, ...style, ...heading, list: after.list ?? null }];
}

/**
 * The edits that turn a document's paragraphs into `after`: none if they hold the same.  `marks`
 * says which styles bold and italic are written in, for `after` to give them as looks.  Those
 * `alignParagraphs` leaves unpaired are paired by their place, as what is typed over a paragraph
 * keeps all else it holds; only what is left of those comes and goes.
 */
export function paragraphEdits(
  item: string,
  before: ReadParagraph[],
  after: WrittenParagraph[],
  marks: MarkStyles = {},
): ItemEdit[] {
  const edits: DocumentEdit[] = [];
  let a = 0;
  let b = 0;
  const pair = (oldEnd: number, newEnd: number) => {
    for (; a < oldEnd && b < newEnd; a += 1, b += 1) {
      edits.push(...changed(before[a]!, after[b]!, marks));
    }
    if (a < oldEnd) edits.push({ kind: 'remove', first: before[a]!.paragraph, count: oldEnd - a });
    if (b < newEnd) {
      const at = before[oldEnd]?.paragraph ?? before.length;
      const paragraphs = after.slice(b, newEnd).map((each) => newParagraph(each, marks));
      edits.push({ kind: 'insert', at, paragraphs });
    }
    a = oldEnd;
    b = newEnd;
  };
  const plain = (list: WrittenParagraph[]) => list.map(({ text }) => plainText(text));
  const key = { was: before.map(wordsOf), now: after.map(wordsOf) };
  for (const { was, now } of alignParagraphs(plain(before), plain(after), key)) {
    if (was === undefined || now === undefined) continue;
    pair(was, now);
    pair(was + 1, now + 1);
  }
  pair(before.length, after.length);
  return edits.map((edit) => ({ item, edit }));
}

/** A paragraph's characters, each with the piece it is in, and its notes by the character after. */
function charactersOf(text: Inline[]) {
  const characters: { value: string; piece: number }[] = [];
  const notes = new Map<number, number[]>();
  text.forEach((piece, at) => {
    if (piece.note) notes.set(characters.length, [...(notes.get(characters.length) ?? []), at]);
    else for (const value of piece.text) characters.push({ value, piece: at });
  });
  return { characters, notes };
}

/**
 * A paragraph retyped as a line of plain text: each character that stayed keeps its piece's look,
 * one typed takes the look of the character before it, but not its link, and every note stays
 * where it was.
 */
function retyped(paragraph: WrittenParagraph, line: string): WrittenParagraph {
  if (plainText(paragraph.text) === line) return paragraph;
  const { characters, notes } = charactersOf(paragraph.text);
  const typed = Array.from(line);
  const placed: { value: string; piece: number; typed?: true }[] = [];
  let noted = 0;
  const notesTo = (position: number) => {
    for (; noted <= position; noted += 1) {
      for (const piece of notes.get(noted) ?? []) placed.push({ value: '', piece });
    }
  };
  let b = 0;
  const gap = (oldEnd: number, newEnd: number) => {
    notesTo(oldEnd - 1);
    const look = placed.findLast(({ value }) => value !== '')?.piece ?? characters[oldEnd]?.piece;
    for (const value of typed.slice(b, newEnd)) {
      placed.push({ value, piece: look ?? -1, typed: true });
    }
  };
  for (const match of matches(
    characters.map(({ value }) => value),
    typed,
  )) {
    gap(match.a, match.b);
    for (let at = match.a; at < match.a + match.length; at += 1) {
      notesTo(at);
      placed.push(characters[at]!);
    }
    b = match.b + match.length;
  }
  gap(characters.length, typed.length);
  notesTo(characters.length);
  const text: Inline[] = [];
  let last: string | undefined;
  for (const { value, piece, typed: added } of placed) {
    const { link: _link, ...held } = paragraph.text[piece] ?? { text: '' };
    const kept = paragraph.text[piece];
    const key = `${piece}${added ? '+' : ''}`;
    if (kept?.note) text.push(kept);
    else if (key === last) text.at(-1)!.text += value;
    else text.push({ ...(added ? held : kept), text: value });
    last = kept?.note ? undefined : key;
  }
  return { ...paragraph, text };
}

/**
 * Paragraphs as lines of plain text change them: each line paired with a paragraph, as
 * `paragraphEdits` pairs them, keeps that paragraph's style and the looks of what stayed.  A new
 * line is its text alone, which goes in as the document has text there.
 */
export function retypedParagraphs(before: WrittenParagraph[], lines: string[]): WrittenParagraph[] {
  const after: WrittenParagraph[] = [];
  let a = 0;
  let b = 0;
  const pair = (oldEnd: number, newEnd: number) => {
    for (; b < newEnd; a += 1, b += 1) {
      const line = lines[b]!;
      after.push(
        a < oldEnd ? retyped(before[a]!, line) : { text: line === '' ? [] : [{ text: line }] },
      );
    }
    a = oldEnd;
  };
  for (const { was, now } of alignParagraphs(
    before.map(({ text }) => plainText(text)),
    lines,
  )) {
    if (was === undefined || now === undefined) continue;
    pair(was, now);
    pair(was + 1, now + 1);
  }
  pair(before.length, lines.length);
  return after;
}
