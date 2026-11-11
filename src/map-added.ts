/**
 * What Markdown adds to a document: its atoms as pieces, and new paragraphs and tables.  A block
 * is a paragraph of its own, so the empty lines between blocks add none, as in the editor's forms.
 */
import type { Inline, NewParagraph } from './edit-pieces.ts';
import type { TableParagraph } from './edit-tables.ts';
import type { DocumentEdit } from './editable.ts';
import { linkTarget } from './link-target.ts';
import { gridOf, type StyledBlock, type Unit } from './map-tables.ts';
import { type Atom, MarkdownError, type TextBlock } from './markdown-tree.ts';
import { LINE_BREAK } from './rich-text.ts';
import { styleOfShape, type StyleMapping } from './style-mapping.ts';

/** What to say of a note Markdown cannot make. */
export const ONLY_ADDED =
  'Only a footnote, picture, ![text](scrivener:annotation) or ![text](scrivener:preserved) can be added in Markdown.';

/** An atom as a piece of a paragraph.  One that is a note, or has no style mapped, stops. */
export function pieceOf(atom: Atom, mapping: StyleMapping): Inline {
  const { value, code, bold, italic, link, note, footnote, image, added } = atom;
  if (footnote) return { text: value, note: 'footnote' };
  if (image) return { text: value, note: 'picture' };
  if (added) return { text: value, note: added };
  if (note) throw new MarkdownError(ONLY_ADDED);
  if (code && mapping.codeSpan === undefined)
    throw new MarkdownError('No style is mapped to code.');
  const strong = bold ? mapping.strong : undefined;
  const emphasis = italic ? mapping.emphasis : undefined;
  const style = code ? mapping.codeSpan : (strong ?? emphasis);
  return {
    text: value.replaceAll('\n', LINE_BREAK),
    ...(style === undefined ? {} : { style }),
    ...(bold && (strong === undefined || style !== strong) ? { bold } : {}),
    ...(italic && (emphasis === undefined || style !== emphasis) ? { italic } : {}),
    ...(link === undefined ? {} : { link: linkTarget(link) }),
  };
}

/** A block as a new paragraph.  One with no style mapped stops. */
export function newParagraph(block: StyledBlock, mapping: StyleMapping): NewParagraph {
  const style = styleOfShape(mapping, block.shape);
  if (!style) throw new MarkdownError(`No style is mapped to a ${block.shape.kind}.`);
  const { shape } = block;
  const list =
    shape.kind === 'list' ? { list: { ordered: shape.ordered, level: shape.level } } : {};
  return { ...style, ...list, text: block.atoms.map((atom) => pieceOf(atom, mapping)) };
}

/** A new cell's paragraph. */
export const newCell = ({ atoms }: TextBlock, mapping: StyleMapping): TableParagraph => ({
  text: atoms.map((atom) => pieceOf(atom, mapping)),
});

/** What goes in at one place: paragraphs and tables, from the last back, as each goes in first. */
export function addedEdits(added: Unit[], at: number, mapping: StyleMapping): DocumentEdit[] {
  const edits: DocumentEdit[] = [];
  let paragraphs: NewParagraph[] = [];
  const hold = () => {
    if (paragraphs.length > 0) edits.unshift({ kind: 'insert', at, paragraphs });
    paragraphs = [];
  };
  for (const unit of added) {
    if (unit.kind === 'item') throw new MarkdownError('An item cannot be added here.');
    if (unit.kind === 'text') paragraphs.push(newParagraph(unit.blocks[0], mapping));
    else {
      hold();
      const rows = gridOf(unit.blocks).map((row) =>
        row.map((cell) => cell.map((block) => newCell(block, mapping))),
      );
      edits.unshift({ kind: 'table', first: at, count: 0, rows });
    }
  }
  hold();
  return edits;
}
