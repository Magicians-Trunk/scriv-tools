/**
 * The blocks the Markdown is written from: the documents' own tree and their own words.  Each
 * character keeps its place in the paragraph, so a change can be followed back; a line break,
 * which Markdown writes its own way, is known by having none.
 */
import { matches } from './diff.ts';
import type { Inline, ReadParagraph } from './edit-pieces.ts';
import type { EditableDocument } from './editable.ts';
import { linkAddress } from './link-target.ts';
import type { Atom, Block, TextBlock } from './markdown-tree.ts';
import { LINE_BREAK, same } from './rich-text.ts';
import { type BlockShape, shapeOfStyle, type StyleMapping } from './style-mapping.ts';
import { plainText } from './text-compare.ts';

/** Each atom's characters' places in the paragraph's text, `-1` for a line break as written. */
export type BuiltBlock =
  | Extract<Block, { kind: 'item' }>
  | (TextBlock & { item: string; paragraph: number; places: number[][]; notes: number[] });

/** How a line break in a paragraph is written, a list item's with its indent. */
const LINE_BREAKS = /\n[\n\t]*/g;

/** A paragraph's words as written, each character with where it is in the paragraph. */
function placedCharacters(text: string, own: string) {
  const places = Array.from({ length: own.length }, () => -1);
  for (const { a, b, length } of matches(text, own)) {
    for (let at = 0; at < length; at += 1) places[b + at] = a + at;
  }
  return places;
}

/** What a piece is in Markdown, apart from its text. */
function atomOf({ style, bold, italic, link }: Inline, mapping: StyleMapping): Omit<Atom, 'value'> {
  const styled = (held: string | undefined) => style !== undefined && style === held;
  return {
    ...(styled(mapping.codeSpan) ? { code: true } : {}),
    ...(bold || styled(mapping.strong) ? { bold: true } : {}),
    ...(italic || styled(mapping.emphasis) ? { italic: true } : {}),
    ...(link ? { link: linkAddress(link) } : {}),
  };
}

/** A paragraph's pieces, as atoms with their characters' places. */
function atomsOf(pieces: Inline[], own: string, mapping: StyleMapping, literal: boolean) {
  const text = plainText(pieces);
  const buffers = pieces.map(() => ({ value: '', places: [] as number[] }));
  const ends: number[] = [];
  let total = 0;
  for (const piece of pieces) {
    if (!piece.note) total += piece.text.length;
    ends.push(total);
  }
  let current = Math.max(
    0,
    pieces.findIndex((piece) => !piece.note),
  );
  placedCharacters(text, own).forEach((place, at) => {
    if (place >= 0) current = ends.findIndex((end) => place < end);
    const buffer = buffers[current]!;
    buffer.value += own[at];
    buffer.places.push(place);
  });
  const atoms: Atom[] = [];
  const places: number[][] = [];
  pieces.forEach((piece, index) => {
    const { value, places: placed } = buffers[index]!;
    if (piece.note === 'footnote' && !literal) {
      atoms.push({ value: piece.text, note: true, footnote: true });
      places.push([]);
    } else if (piece.note && !literal) {
      atoms.push({ value: '', note: true });
      places.push([]);
    } else if (value !== '') {
      const atom = { value, ...(literal ? {} : atomOf(piece, mapping)) };
      const last = atoms.at(-1);
      if (last && !last.note && same({ ...last, value: '' }, { ...atom, value: '' })) {
        last.value += value;
        places.at(-1)!.push(...placed);
      } else {
        atoms.push(atom);
        places.push(placed);
      }
    }
  });
  const notes = pieces.flatMap((piece, index) => (piece.note && !literal ? [index] : []));
  return { ...splitLines(atoms, places), notes };
}

/** Atoms with each line break in their text an atom of its own, with what is on each side. */
function splitLines(atoms: Atom[], places: number[][]) {
  const split: { atoms: Atom[]; places: number[][] } = { atoms: [], places: [] };
  const add = (atom: Atom, placed: number[]) => {
    split.atoms.push(atom);
    split.places.push(placed);
  };
  atoms.forEach((atom, index) => {
    const placed = places[index]!;
    let from = 0;
    for (const { 0: spaces, index: at } of atom.code ? [] : atom.value.matchAll(LINE_BREAKS)) {
      if (at > from) add({ ...atom, value: atom.value.slice(from, at) }, placed.slice(from, at));
      add({ value: '\n', line: true }, placed.slice(at, at + 1));
      from = at + spaces.length;
    }
    if (from < atom.value.length || atom.note) {
      add({ ...atom, value: atom.value.slice(from) }, placed.slice(from));
    }
  });
  // Markdown has no line break at either end of a paragraph, so one stays out of its tree.
  while (split.atoms[0]?.line) {
    split.atoms.shift();
    split.places.shift();
  }
  while (split.atoms.at(-1)?.line) {
    split.atoms.pop();
    split.places.pop();
  }
  return split;
}

/** What kind of block a paragraph is. */
function shapeOf({ style, level, list, cell }: ReadParagraph, mapping: StyleMapping): BlockShape {
  if (cell) return { kind: 'cell', row: cell.row, column: cell.column, part: cell.part };
  return list ? { kind: 'list', ...list } : shapeOfStyle(mapping, style, level);
}

/** A paragraph's block, from its words.  An empty one has none, unless a table needs its place. */
function paragraphBlock(
  own: string,
  item: string,
  read: ReadParagraph,
  mapping: StyleMapping,
): BuiltBlock | undefined {
  const shape = shapeOf(read, mapping);
  const built = atomsOf(read.text, own, mapping, shape.kind === 'code');
  const empty = built.atoms.every(({ value, note }) => !note && value.trim() === '');
  if (empty && shape.kind !== 'cell') return undefined;
  return { kind: 'text', shape, item, paragraph: read.paragraph, ...built };
}

/** A paragraph's words as the document holds them, with its line breaks as Markdown has them. */
const documentWords = ({ text }: ReadParagraph) => plainText(text).replaceAll(LINE_BREAK, '\n');

/** Each document's start, then its paragraphs, in their own words. */
export function buildBlocks(documents: EditableDocument[], mapping: StyleMapping): BuiltBlock[] {
  return documents.flatMap(({ item, paragraphs }): BuiltBlock[] => {
    const blocks = paragraphs.flatMap((paragraph) => {
      const block = paragraphBlock(documentWords(paragraph), item, paragraph, mapping);
      return block ? [block] : [];
    });
    return [{ kind: 'item', item }, ...blocks];
  });
}
