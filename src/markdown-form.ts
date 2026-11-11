/**
 * The Markdown form: a document's paragraphs as Markdown, and Markdown back as paragraphs.  It
 * reads the document itself, so it shows what the document holds, not what a compile makes of it.
 * Markdown cannot say everything: what it does not show is carried over from the paragraphs it
 * came from, so a change here leaves the rest as it was.
 */
import { matches } from './diff.ts';
import type { Inline } from './edit-pieces.ts';
import { linkAddress, linkTarget } from './link-target.ts';
import { type Atom, type Block, type TextBlock, writeMarkdown } from './markdown-tree.ts';
import type { WrittenParagraph } from './paragraph-edits.ts';
import { LINE_BREAK, same } from './rich-text.ts';
import type { BlockShape, StyleRoles } from './style-mapping.ts';

const DEPTHS = [1, 2, 3, 4, 5, 6] as const;

/** What a paragraph is in Markdown: a heading by its own HTML header level, not its style's name. */
function shapeOf({ style, level, list, cell }: WrittenParagraph, roles: StyleRoles): BlockShape {
  if (cell) return { kind: 'cell', row: cell.row, column: cell.column, part: cell.part };
  if (list) return { kind: 'list', ...list };
  const depth = DEPTHS.find((each) => each === level);
  if (depth !== undefined) return { kind: 'heading', depth };
  if (style !== undefined && style === roles.quote) return { kind: 'quote' };
  if (style !== undefined && style === roles.code) return { kind: 'code' };
  return { kind: 'paragraph' };
}

const LINE: Atom = { value: '\n', line: true };

function atomsOf(piece: Inline, roles: StyleRoles): Atom[] {
  const { text, note, style, bold, italic, link } = piece;
  if (note === 'footnote') return [{ value: text, note: true, footnote: true }];
  if (note) return [{ value: '', note: true }];
  const look: Omit<Atom, 'value'> = {
    ...(style === roles.codeSpan ? { code: true } : {}),
    ...(bold ? { bold } : {}),
    ...(italic ? { italic } : {}),
    ...(link ? { link: linkAddress(link) } : {}),
  };
  return text
    .split(LINE_BREAK)
    .flatMap((value, line): Atom[] => [
      ...(line > 0 ? [LINE] : []),
      ...(value === '' ? [] : [{ value, ...look }]),
    ]);
}

const sameLook = (one: Atom, other: Atom) =>
  !one.note &&
  !other.note &&
  !one.line &&
  !other.line &&
  one.code === other.code &&
  one.bold === other.bold &&
  one.italic === other.italic &&
  one.link === other.link;

/** Atoms with one look as one: a style Markdown does not show must not split what it marks. */
function joined(atoms: Atom[]) {
  const joining: Atom[] = [];
  for (const atom of atoms) {
    const last = joining.at(-1);
    if (last && sameLook(last, atom)) last.value += atom.value;
    else joining.push({ ...atom });
  }
  return joining;
}

const blockOf = (paragraph: WrittenParagraph, roles: StyleRoles): TextBlock => ({
  kind: 'text',
  shape: shapeOf(paragraph, roles),
  atoms: joined(paragraph.text.flatMap((piece) => atomsOf(piece, roles))),
});

/** Each paragraph's block, by the paragraph, which never changes once made, and the roles it took. */
const keptBlocks = new WeakMap<WrittenParagraph, { roles: StyleRoles; block: TextBlock }>();

/** A paragraph's block, made once for as long as the roles stay the same. */
function keptBlock(paragraph: WrittenParagraph, roles: StyleRoles) {
  const held = keptBlocks.get(paragraph);
  if (held && same(held.roles, roles)) return held.block;
  const block = blockOf(paragraph, roles);
  keptBlocks.set(paragraph, { roles, block });
  return block;
}

/** A document's paragraphs as Markdown's blocks. */
export const paragraphBlocks = (paragraphs: WrittenParagraph[], roles: StyleRoles) =>
  paragraphs.map((paragraph) => keptBlock(paragraph, roles));

/** A document's paragraphs as Markdown. */
export const paragraphsMarkdown = (paragraphs: WrittenParagraph[], roles: StyleRoles) =>
  writeMarkdown(paragraphBlocks(paragraphs, roles));

/** Whether an atom is something a paragraph holds: words, a break, a note or a picture. */
const holdsSomething = ({ value, line, note, image }: Atom) =>
  value !== '' || line === true || note === true || image === true;

/** A block's words, by which it is lined up with the paragraph it came from. */
const wordsOf = ({ atoms }: TextBlock) => atoms.map(({ value }) => value).join('');

/** The character style of each character of a paragraph, for the words that stay. */
const characterStyles = ({ text }: WrittenParagraph, codeSpan: string) =>
  text
    .filter(({ note }) => !note)
    .flatMap(({ text: words, style }) =>
      Array.from(words, () => (style === codeSpan ? undefined : style)),
    );

/** Atoms as pieces, each note the paragraph held in its turn and all else from the Markdown. */
function piecesOf(atoms: Atom[], was: WrittenParagraph | undefined, roles: StyleRoles): Inline[] {
  const notes = was?.text.filter(({ note }) => note) ?? [];
  const styles = was ? characterStyles(was, roles.codeSpan) : [];
  const words = was
    ? was.text
        .filter(({ note }) => !note)
        .map(({ text }) => text)
        .join('')
    : '';
  const value = atoms
    .filter(({ note }) => !note)
    .map((atom) => atom.value)
    .join('');
  const kept = new Map<number, string | undefined>();
  for (const { a, b, length } of matches(words, value)) {
    for (let at = 0; at < length; at += 1) kept.set(b + at, styles[a + at]);
  }
  let offset = 0;
  return atoms.flatMap((atom): Inline[] => {
    if (atom.image) return [{ text: atom.value, note: 'picture' }];
    if (atom.note) {
      const held = notes.shift();
      if (atom.footnote) return [{ ...held, text: atom.value, note: 'footnote' }];
      return held ? [held] : [];
    }
    const look = {
      ...(atom.bold ? { bold: atom.bold } : {}),
      ...(atom.italic ? { italic: atom.italic } : {}),
      ...(atom.link === undefined ? {} : { link: linkTarget(atom.link) }),
    };
    const pieces: Inline[] = [];
    for (const character of atom.line ? LINE_BREAK : atom.value) {
      const style = atom.code ? roles.codeSpan : kept.get(offset);
      offset += character.length;
      const last = pieces.at(-1);
      if (last && last.style === style) last.text += character;
      else pieces.push({ ...look, ...(style === undefined ? {} : { style }), text: character });
    }
    return pieces;
  });
}

/** The style a block's shape means, or the one it had if that meant nothing Markdown shows. */
function styleOf(shape: BlockShape, was: WrittenParagraph | undefined, roles: StyleRoles) {
  if (shape.kind === 'heading') return roles.headings[shape.depth];
  if (shape.kind === 'quote') return roles.quote;
  if (shape.kind === 'code') return roles.code;
  const old = was && shapeOf(was, roles).kind;
  return old === 'heading' || old === 'quote' || old === 'code' ? undefined : was?.style;
}

/** A block as a paragraph: what Markdown cannot say comes from the paragraph it was. */
function paragraphOf(
  block: TextBlock,
  was: WrittenParagraph | undefined,
  roles: StyleRoles,
): WrittenParagraph {
  const { shape, atoms } = block;
  const named = styleOf(shape, was, roles);
  return {
    ...(named === undefined ? {} : { style: named }),
    ...(shape.kind === 'heading' ? { level: shape.depth } : {}),
    text: piecesOf(atoms, was, roles),
    ...(shape.kind === 'list' ? { list: { ordered: shape.ordered, level: shape.level } } : {}),
    ...(was?.cell ? { cell: was.cell } : {}),
  };
}

/** Whether a block says what a paragraph's block says, so the paragraph stands as it was. */
const unchanged = (block: TextBlock, was: TextBlock) =>
  same(block.shape, was.shape) && same(joined(block.atoms), was.atoms);

/**
 * Markdown's blocks as paragraphs, lined up with those it was written from.  A paragraph whose
 * block says what it said stays the same paragraph.  Markdown shows no empty paragraph, so each
 * stays where it was, and a block with nothing in it, such as an empty line in code, is none.
 */
export function markdownParagraphs(
  read: Block[],
  before: WrittenParagraph[],
  roles: StyleRoles,
): WrittenParagraph[] {
  const blocks = read.flatMap((block) =>
    block.kind === 'text' && block.atoms.some(holdsSomething) ? [block] : [],
  );
  const shown = before.filter(({ text }) => text.length > 0);
  const words = (paragraph: WrittenParagraph) => wordsOf(keptBlock(paragraph, roles));
  const pairs = new Map<number, WrittenParagraph>();
  let a = 0;
  let b = 0;
  const pairUp = (oldEnd: number, newEnd: number) => {
    for (; a < oldEnd && b < newEnd; a += 1, b += 1) pairs.set(b, shown[a]!);
    a = oldEnd;
    b = newEnd;
  };
  for (const match of matches(shown.map(words), blocks.map(wordsOf))) {
    pairUp(match.a, match.b);
    pairUp(match.a + match.length, match.b + match.length);
  }
  pairUp(shown.length, blocks.length);
  const written = blocks.map((block, at) => {
    const was = pairs.get(at);
    return was && unchanged(block, keptBlock(was, roles)) ? was : paragraphOf(block, was, roles);
  });
  const result: WrittenParagraph[] = [];
  const placed = new Set(pairs.values());
  let next = 0;
  for (const paragraph of before) {
    if (paragraph.text.length === 0) result.push(paragraph);
    else if (placed.has(paragraph)) {
      while (pairs.get(next) !== paragraph) {
        result.push(written[next]!);
        next += 1;
      }
      result.push(written[next]!);
      next += 1;
    }
  }
  return [...result, ...written.slice(next)];
}
