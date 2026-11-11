/**
 * Taking a change to the Markdown back to the documents.  A real parser reads the Markdown as it
 * was written and as it was edited, and the two trees are compared: block by block, then atom by
 * atom.  Only text inside one atom is compared as text, to find what in it changed.
 */
import type { BuiltBlock } from './built-blocks.ts';
import { matches } from './diff.ts';
import { type DocumentEdit, type Editable, joinRemovals, type MappedEdits } from './editable.ts';
import { addedEdits, newCell, ONLY_ADDED, pieceOf } from './map-added.ts';
import {
  type Atom,
  type Block,
  MarkdownError,
  orStop,
  readMarkdown,
  type TextBlock,
} from './markdown-tree.ts';
import { LINE_BREAK, same } from './rich-text.ts';
import { styleOfShape, type StyleMapping } from './style-mapping.ts';
import {
  type CellBlock,
  gridOf,
  isCell,
  pairCells,
  sameUnit,
  type StyledBlock,
  type Unit,
  unitsOf,
} from './map-tables.ts';
import { commonEnd, commonStart } from './text-compare.ts';

/** What to say of a change the Markdown cannot carry, which the structured form always can. */
const USE_STRUCTURED = 'Make this change in the structured form.';

const textOf = (block: Block) =>
  block.kind === 'item' ? `item ${block.item}` : block.atoms.map(({ value }) => value).join('');

/** The whole of a range in the paragraph's text, when each of its characters has its place there. */
function followBack(places: number[], start: number, end: number) {
  const inside = places.slice(start, end);
  if (inside.length === 0) return undefined;
  const followed = inside.every(
    (place, index) => place >= 0 && (index === 0 || place === inside[index - 1]! + 1),
  );
  if (!followed) throw new MarkdownError('It holds text whose place this cannot follow back.');
  return { start: inside[0]!, end: inside.at(-1)! + 1 };
}

/** Where nothing is replaced: after the last character followed back, else at the start. */
function placeAfter(places: number[]) {
  const at = places.findLast((place) => place >= 0);
  const start = at === undefined ? 0 : at + 1;
  return { start, end: start };
}

/** An atom's characters' places, for the atom as the parser read it. */
function placesOf(built: Atom, places: number[], read: Atom): number[] {
  const placed = Array.from({ length: read.value.length }, () => -1);
  for (const { a, b, length } of matches(built.value, read.value)) {
    for (let at = 0; at < length; at += 1) placed[b + at] = places[a + at]!;
  }
  return placed;
}

/** The edits that change one run of atoms into another, inside a paragraph. */
function atomEdits(
  paragraph: number,
  old: Atom[],
  places: number[][],
  edited: Atom[],
  mapping: StyleMapping,
): DocumentEdit[] {
  const edits: DocumentEdit[] = [];
  let a = 0;
  let b = 0;
  const gap = (oldEnd: number, newEnd: number) => {
    if (a === oldEnd && b === newEnd) return;
    const before = old.slice(a, oldEnd);
    const after = edited.slice(b, newEnd);
    if (before.some(({ note }) => note)) throw new MarkdownError('It moves a note.');
    const [first] = before;
    const [next] = after;
    const lone = before.length === 1 && after.length === 1;
    if (lone && first && next && same({ ...first, value: '' }, { ...next, value: '' })) {
      const start = commonStart(first.value, next.value);
      const end = commonEnd(first.value, next.value, start);
      const text = next.value.slice(start, next.value.length - end).replaceAll('\n', LINE_BREAK);
      const at = places[a]!;
      const range =
        followBack(at, start, first.value.length - end) ?? placeAfter(at.slice(0, start));
      edits.push({ kind: 'replace', paragraph, ...range, text });
      return;
    }
    const placed = places.slice(a, oldEnd).flat();
    const range = followBack(placed, 0, placed.length) ?? placeAfter(places.slice(0, a).flat());
    const text = after.map((atom) => pieceOf(atom, mapping));
    edits.push({ kind: 'replace', paragraph, ...range, text });
    // New text takes the style of what it replaces, so code that goes leaves its style first.
    if (before.some(({ code }) => code)) edits.push({ kind: 'character', paragraph, ...range });
  };
  for (const match of matches(old, edited, same)) {
    gap(match.a, match.b);
    a = match.a + match.length;
    b = match.b + match.length;
  }
  gap(old.length, edited.length);
  return edits.toReversed();
}

/** What to say of a note Markdown shows only as a place, which leaving out must not delete. */
const HIDDEN_NOTE = 'It removes a note whose content Markdown does not show.';

/** Whether a note's content is in the Markdown, as a footnote's is, so a change to it is seen. */
const hidden = ({ note, footnote }: Atom) => note === true && footnote !== true;

/** Atoms with a note taken out, and the text either side of it one atom again if it can be. */
function withoutNote(atoms: Atom[], places: number[][], at: number) {
  const before = atoms[at - 1];
  const after = atoms[at + 1];
  const rest = { atoms: atoms.toSpliced(at, 1), places: places.toSpliced(at, 1) };
  if (!before || !after || before.note || after.note) return rest;
  if (before.line || after.line || !same({ ...before, value: '' }, { ...after, value: '' })) {
    return rest;
  }
  const value = `${before.value}${after.value}`;
  return {
    atoms: rest.atoms.toSpliced(at - 1, 2, { ...before, value }),
    places: rest.places.toSpliced(at - 1, 2, [...places[at - 1]!, ...places[at + 1]!]),
  };
}

/**
 * The edits to a paragraph's notes, from the last back, and its atoms with them made.  A note's
 * piece has no place in the text, so these leave the text's places as they were.  A footnote with
 * new text is changed where it is, and one left out of the edited text goes.  Any other note stays:
 * what it holds is not in the Markdown, so leaving it out stops.
 */
function noteEdits(
  { paragraph, notes }: Extract<BuiltBlock, { kind: 'text' }>,
  read: { atoms: Atom[]; places: number[][] },
  edited: Atom[],
) {
  const noteAt = read.atoms.flatMap(({ note }, at) => (note ? [at] : []));
  const was = noteAt.map((at) => read.atoms[at]!);
  const now = edited.filter(({ note }) => note);
  const edits: DocumentEdit[] = [];
  let { atoms, places } = read;
  if (was.length === now.length) {
    atoms = atoms.slice();
    was.forEach((atom, index) => {
      const next = now[index]!;
      if (same(atom, next)) return;
      if (hidden(atom)) throw new MarkdownError(HIDDEN_NOTE);
      const first = notes[index]!;
      if (!next.footnote) throw new MarkdownError(ONLY_ADDED);
      edits.unshift({ kind: 'note', paragraph, piece: first, text: next.value });
      atoms[noteAt[index]!] = next;
    });
    return { edits, atoms, places };
  }
  const kept = new Set<number>();
  for (const { a, length } of matches(was, now, same)) {
    for (let at = 0; at < length; at += 1) kept.add(a + at);
  }
  for (let index = was.length - 1; index >= 0; index -= 1) {
    if (kept.has(index)) continue;
    if (hidden(was[index]!)) throw new MarkdownError(HIDDEN_NOTE);
    edits.push({ kind: 'inlines', paragraph, first: notes[index]!, count: 1, text: [] });
    ({ atoms, places } = withoutNote(atoms, places, noteAt[index]!));
  }
  return { edits, atoms, places };
}

/** The edits that change what a block holds: its notes, then its text. */
function heldEdits(
  built: Extract<BuiltBlock, { kind: 'text' }>,
  read: TextBlock,
  edited: TextBlock,
  mapping: StyleMapping,
): DocumentEdit[] {
  const { paragraph } = built;
  if (built.atoms.length !== read.atoms.length) throw new MarkdownError('It cannot be followed.');
  const places = read.atoms.map((atom, index) =>
    placesOf(built.atoms[index]!, built.places[index]!, atom),
  );
  const noted = noteEdits(built, { atoms: read.atoms, places }, edited.atoms);
  return [
    ...noted.edits,
    ...atomEdits(paragraph, noted.atoms, noted.places, edited.atoms, mapping),
  ];
}

/** The edits that change a block: what it holds, then its kind. */
function blockEdits(
  built: Extract<BuiltBlock, { kind: 'text' }>,
  read: StyledBlock,
  edited: StyledBlock,
  mapping: StyleMapping,
): DocumentEdit[] {
  const { paragraph } = built;
  const edits = heldEdits(built, read, edited, mapping);
  if (!same(read.shape, edited.shape)) {
    const style = styleOfShape(mapping, edited.shape);
    if (!style) throw new MarkdownError(`No style is mapped to a ${edited.shape.kind}.`);
    const { shape } = edited;
    const list = shape.kind === 'list' ? { ordered: shape.ordered, level: shape.level } : null;
    edits.push({ kind: 'style', paragraph, ...style, list });
  }
  return edits;
}

/** Where blocks added before this one go: after the block before them, in its document. */
function anchorOf(blocks: BuiltBlock[], at: number) {
  const before = blocks[at - 1];
  const next = blocks[at];
  if (before?.kind === 'text') return { item: before.item, at: before.paragraph + 1 };
  if (next?.kind === 'text') return { item: next.item, at: next.paragraph };
  return before && { item: before.item, at: 0 };
}

/** A built block that is a paragraph. */
type BuiltText = Extract<BuiltBlock, { kind: 'text' }>;

/**
 * The edits that change a table: each cell that stays by its text, as any block, then its shape,
 * when rows or columns or a cell's paragraphs came or went.
 */
function tableEdits(
  built: (BuiltText & CellBlock)[],
  read: CellBlock[],
  edited: CellBlock[],
  mapping: StyleMapping,
): DocumentEdit[] {
  const edits: DocumentEdit[] = [];
  const oldGrid = gridOf(read);
  const builtGrid = gridOf(built);
  const newGrid = gridOf(edited);
  const pair = pairCells(oldGrid, newGrid);
  const kept = new Set<number>();
  const rows = newGrid.map((row, at) =>
    row.map((cell, column) =>
      cell.map((block, part) => {
        const from = pair(at, column);
        const source = from && builtGrid[from.row]![from.column]![part];
        if (!from || !source) return newCell(block, mapping);
        edits.push(...heldEdits(source, oldGrid[from.row]![from.column]![part]!, block, mapping));
        kept.add(source.paragraph);
        return source.paragraph;
      }),
    ),
  );
  const whole = builtGrid.map((row) => row.map((cell) => cell.map(({ paragraph }) => paragraph)));
  if (same(rows, whole)) return edits;
  if (read.some(({ atoms }, at) => atoms.some(hidden) && !kept.has(built[at]!.paragraph))) {
    throw new MarkdownError(HIDDEN_NOTE);
  }
  const first = built[0]!.paragraph;
  const count = built.at(-1)!.paragraph - first + 1;
  edits.push({ kind: 'table', first, count, rows });
  return edits;
}

/** What to say of a change to an item's place. */
const ITEM_STAYS = 'The comment that starts an item must stay.';

/**
 * The typed edits that turn the Markdown's tree into the edited Markdown's.  Blocks added where
 * one document ends and the next begins join the document before.  A table is compared whole.
 */
export function mapEdits(editable: Editable, edited: string, mapping: StyleMapping): MappedEdits {
  const result: MappedEdits = { edits: [], problems: [] };
  const { blocks } = editable;
  let old: Block[] = [];
  let next: Block[] = [];
  const stop = (message: string) => result.problems.push(`${message}  ${USE_STRUCTURED}`);
  orStop(() => {
    old = readMarkdown(editable.markdown);
    next = readMarkdown(edited);
  }, stop);
  if (result.problems.length > 0) return result;
  if (old.length !== blocks.length) {
    stop('The Markdown cannot be followed back.');
    return result;
  }
  const attempt = (block: Block, make: () => void) =>
    orStop(make, (message) => stop(`"${textOf(block)}": ${message}`));
  const units = unitsOf(old);
  const edits = unitsOf(next);
  const builtOf = ({ at, blocks: held }: Unit) =>
    blocks.slice(at, at + held.length).filter((block) => block.kind === 'text');
  const remove = (unit: Unit) => {
    const built = builtOf(unit);
    unit.blocks.forEach((was, at) => {
      const { item, paragraph } = built[at]!;
      if (was.atoms.some(hidden)) stop(`"${textOf(was)}": ${HIDDEN_NOTE}`);
      else result.edits.push({ item, edit: { kind: 'remove', first: paragraph, count: 1 } });
    });
  };
  const change = (unit: Unit, now: Unit, make: () => DocumentEdit[]) => {
    const { item } = builtOf(unit)[0]!;
    attempt(next[now.at]!, () => {
      result.edits.push(...make().map((edit) => ({ item, edit })));
    });
  };
  let a = 0;
  let b = 0;
  const gap = (oldEnd: number, newEnd: number) => {
    let at = a;
    let to = b;
    for (; at < oldEnd; at += 1) {
      const unit = units[at]!;
      if (unit.kind === 'item') {
        stop(ITEM_STAYS);
        continue;
      }
      const now = to < newEnd ? edits[to] : undefined;
      if (unit.kind === 'table' && now?.kind === 'table') {
        const built = builtOf(unit).filter(isCell);
        change(unit, now, () => tableEdits(built, unit.blocks, now.blocks, mapping));
      } else if (unit.kind === 'text' && now?.kind === 'text') {
        const built = builtOf(unit)[0]!;
        change(unit, now, () => blockEdits(built, unit.blocks[0], now.blocks[0], mapping));
      } else if (now?.kind === 'item') stop(ITEM_STAYS);
      else {
        // A paragraph that became a table, or the other way, goes: what it became is added.
        remove(unit);
        continue;
      }
      to += 1;
    }
    const added = edits.slice(to, newEnd);
    if (added.length === 0) return;
    const anchor = anchorOf(blocks, units[oldEnd]?.at ?? blocks.length);
    attempt(next[added[0]!.at]!, () => {
      if (!anchor) throw new MarkdownError('It has no document to go in.');
      const { item, at: place } = anchor;
      const made = addedEdits(added, place, mapping);
      result.edits.push(...made.map((edit) => ({ item, edit })));
    });
  };
  for (const match of matches(units, edits, sameUnit)) {
    gap(match.a, match.b);
    a = match.a + match.length;
    b = match.b + match.length;
  }
  gap(units.length, edits.length);
  return { ...result, edits: joinRemovals(result.edits) };
}
