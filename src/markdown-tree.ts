/**
 * Markdown as blocks of pieces of text, to and from a real Markdown tree (mdast).  Reading and
 * writing Markdown is the parser's and serialiser's work; this only moves between their tree and
 * ours, a paragraph to a block.
 */
import type {
  BlockContent,
  FootnoteDefinition,
  Html,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
} from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnoteFromMarkdown, gfmFootnoteToMarkdown } from 'mdast-util-gfm-footnote';
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmTable } from 'micromark-extension-gfm-table';
import type { BlockShape } from './style-mapping.ts';

/** A piece of text and what it is in Markdown.  A note is a place, with no text. */
export interface Atom {
  value: string;
  code?: true;
  bold?: true;
  italic?: true;
  link?: string;
  note?: true;
  /** A note that is a footnote, whose text is the atom's. */
  footnote?: true;
  /** A line break inside a paragraph, which is a node of its own. */
  line?: true;
  /** A new picture, whose value is its file. */
  image?: true;
  /** A new annotation or Preserve Formatting, whose value is its text. */
  added?: 'annotation' | 'preserved';
}

/** Where an item starts, or a paragraph's block. */
export type Block = { kind: 'item'; item: string } | TextBlock;

export interface TextBlock {
  kind: 'text';
  shape: BlockShape;
  atoms: Atom[];
}

/** Markdown that has no place in a project. */
export class MarkdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkdownError';
  }
}

/** What to say of Markdown a project cannot hold, in the words of what it can. */
const NO_PLACE =
  'It has no place in a project, which holds text, headings, lists, quotes and code.';

/** Makes something that may stop on Markdown, handing what stopped it to `stopped`. */
export function orStop(make: () => void, stopped: (message: string) => void): void {
  try {
    make();
  } catch (error) {
    if (!(error instanceof MarkdownError)) throw error;
    stopped(error.message);
  }
}

/** A note is an image to this address: an image is a real inline node wherever it sits in a line. */
const NOTE_ADDRESS = 'scrivener:note';
/** Images to these addresses add a note of that kind, their alternative text its text. */
const NEW_NOTES: Record<string, Atom['added']> = {
  'scrivener:annotation': 'annotation',
  'scrivener:preserved': 'preserved',
};
/** The comment that starts an item in Markdown, which says whose text follows. */
export const itemComment = (id: string) => `<!-- item ${id} -->`;
/** The comment that starts an item, as read. */
const ITEM_COMMENT = /^<!-- item (?<item>\S+) -->$/;
/** What parts a table cell's paragraphs: a cell in Markdown is one line. */
const CELL_BREAK = '<br>';

function atomNode(atom: Atom, notes: string[]): PhrasingContent[] {
  const { value, code, bold, italic, link, note, line, footnote } = atom;
  if (line) return [{ type: 'break' }];
  if (footnote) {
    notes.push(value);
    return [{ type: 'footnoteReference', identifier: String(notes.length) }];
  }
  if (note) return [{ type: 'image', url: NOTE_ADDRESS, alt: 'note' }];
  let nodes: PhrasingContent[] = [{ type: code ? 'inlineCode' : 'text', value }];
  if (italic) nodes = [{ type: 'emphasis', children: nodes }];
  if (bold) nodes = [{ type: 'strong', children: nodes }];
  if (link !== undefined) nodes = [{ type: 'link', url: link, children: nodes }];
  return nodes;
}

/**
 * Adds a list item under the last item at each level above it, or as far down as there are any:
 * Markdown cannot skip a level.
 */
function addListItem(
  children: RootContent[] | ListItem['children'],
  shape: Extract<BlockShape, { kind: 'list' }>,
  item: ListItem,
): void {
  const last = children.at(-1);
  const parent = last?.type === 'list' ? last.children.at(-1) : undefined;
  if (shape.level > 0 && parent) {
    addListItem(parent.children, { ...shape, level: shape.level - 1 }, item);
  } else if (last?.type === 'list' && last.ordered === shape.ordered) last.children.push(item);
  else children.push({ type: 'list', ordered: shape.ordered, spread: false, children: [item] });
}

/** Adds a table cell's paragraph: to the cell before, the row before, or a new row or table. */
function addCell(
  root: Root,
  { row, column, part }: Extract<BlockShape, { kind: 'cell' }>,
  children: PhrasingContent[],
): void {
  const last = root.children.at(-1);
  if (part > 0 && last?.type === 'table') {
    const open = last.children.at(-1)?.children.at(-1);
    open?.children.push({ type: 'html', value: CELL_BREAK }, ...children);
    return;
  }
  const cell: TableCell = { type: 'tableCell', children };
  const starts = row === 0 && column === 0;
  if (last?.type !== 'table' || starts) {
    root.children.push({ type: 'table', children: [{ type: 'tableRow', children: [cell] }] });
  } else if (column === 0) last.children.push({ type: 'tableRow', children: [cell] });
  else last.children.at(-1)?.children.push(cell);
}

/** Adds a block to the tree: lists, quotes and code run on from the same just before. */
function addBlock(root: Root, block: Block, notes: string[]): void {
  const phrasing = (atoms: Atom[]) => atoms.flatMap((atom) => atomNode(atom, notes));
  const paragraphOf = (atoms: Atom[]): Paragraph => ({
    type: 'paragraph',
    children: phrasing(atoms),
  });
  const last = root.children.at(-1);
  if (block.kind === 'item') {
    const comment: Html = { type: 'html', value: itemComment(block.item) };
    root.children.push(comment);
    return;
  }
  const { shape, atoms } = block;
  const text = atoms.map(({ value }) => value).join('');
  if (shape.kind === 'heading') {
    root.children.push({ type: 'heading', depth: shape.depth, children: phrasing(atoms) });
  } else if (shape.kind === 'cell') {
    addCell(root, shape, phrasing(atoms));
  } else if (shape.kind === 'code') {
    if (last?.type === 'code') last.value += `\n${text}`;
    else root.children.push({ type: 'code', value: text });
  } else if (shape.kind === 'quote') {
    if (last?.type === 'blockquote') last.children.push(paragraphOf(atoms));
    else root.children.push({ type: 'blockquote', children: [paragraphOf(atoms)] });
  } else if (shape.kind === 'list') {
    addListItem(root.children, shape, {
      type: 'listItem',
      spread: false,
      children: [paragraphOf(atoms)],
    });
  } else root.children.push(paragraphOf(atoms));
}

/** Blocks as Markdown, written by the serialiser. */
export const writeMarkdown = (blocks: readonly Block[]): string =>
  treeMarkdown(markdownRoot([{ blocks, after: [] }]));

/** Runs of blocks, each followed by nodes of its own, as a tree, with the footnotes at its end. */
export function markdownRoot(
  runs: readonly { blocks: readonly Block[]; after: RootContent[] }[],
): Root {
  const root: Root = { type: 'root', children: [] };
  const notes: string[] = [];
  for (const { blocks, after } of runs) {
    for (const block of blocks) addBlock(root, block, notes);
    root.children.push(...after);
  }
  notes.forEach((value, index) => {
    root.children.push({
      type: 'footnoteDefinition',
      identifier: String(index + 1),
      children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
    });
  });
  return root;
}

/** A Markdown tree as text, as every Markdown here is written. */
export function treeMarkdown(root: Root): string {
  return toMarkdown(root, {
    bullet: '*',
    fences: true,
    listItemIndent: 'one',
    extensions: [gfmFootnoteToMarkdown(), gfmTableToMarkdown({ tablePipeAlign: false })],
  });
}

/** Markdown as a tree, as every Markdown here is read. */
export function markdownTree(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfmFootnote(), gfmTable()],
    mdastExtensions: [gfmFootnoteFromMarkdown(), gfmTableFromMarkdown()],
  });
}

/** The text of a Markdown's footnotes, by identifier. */
export type Notes = Map<string, string>;

/** A tree's inline nodes as atoms, each with what the nodes around it make it. */
function readAtoms(
  nodes: PhrasingContent[],
  notes: Notes,
  around: Omit<Atom, 'value'> = {},
): Atom[] {
  const atoms: Atom[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        atoms.push({ ...around, value: node.value });
        break;
      case 'break':
        atoms.push({ value: '\n', line: true });
        break;
      case 'inlineCode':
        atoms.push({ ...around, value: node.value, code: true });
        break;
      case 'emphasis':
        atoms.push(...readAtoms(node.children, notes, { ...around, italic: true }));
        break;
      case 'strong':
        atoms.push(...readAtoms(node.children, notes, { ...around, bold: true }));
        break;
      case 'link':
        atoms.push(...readAtoms(node.children, notes, { ...around, link: node.url }));
        break;
      case 'footnoteReference':
        atoms.push({ value: notes.get(node.identifier)!, note: true, footnote: true });
        break;
      case 'image': {
        const added = NEW_NOTES[node.url];
        if (node.url === NOTE_ADDRESS) atoms.push({ value: '', note: true });
        else if (added) atoms.push({ value: node.alt!, added });
        else atoms.push({ value: node.url, image: true });
        break;
      }
      default:
        throw new MarkdownError(NO_PLACE);
    }
  }
  return atoms;
}

const textBlock = (shape: BlockShape, children: PhrasingContent[], notes: Notes): Block => ({
  kind: 'text',
  shape,
  atoms: readAtoms(children, notes),
});

/** The paragraphs a container holds, each a block of this shape.  Anything else stops. */
function paragraphsOf(
  children: BlockContent[] | ListItem['children'],
  shape: BlockShape,
  notes: Notes,
): Block[] {
  return children.map((child) => {
    if (child.type !== 'paragraph') {
      throw new MarkdownError('Only paragraphs have a place inside a quote or a list.');
    }
    return textBlock(shape, child.children, notes);
  });
}

function readList({ ordered, children }: List, notes: Notes, level = 0): Block[] {
  const shape: BlockShape = { kind: 'list', ordered: ordered === true, level };
  return children.flatMap((item) =>
    item.children.flatMap((child) =>
      child.type === 'list'
        ? readList(child, notes, level + 1)
        : paragraphsOf([child], shape, notes),
    ),
  );
}

/** A table's cells as blocks: one for each of a cell's paragraphs, in reading order. */
function readTable({ children }: Table, notes: Notes): Block[] {
  return children.flatMap((tableRow, row) =>
    tableRow.children.flatMap((cell, column) => {
      const parts: PhrasingContent[][] = [[]];
      for (const node of cell.children) {
        if (node.type === 'html' && node.value === CELL_BREAK) parts.push([]);
        else parts.at(-1)!.push(node);
      }
      return parts.map((nodes, part) =>
        textBlock({ kind: 'cell', row, column, part }, nodes, notes),
      );
    }),
  );
}

/** A footnote's text, its paragraphs one after another. */
function noteText({ children }: FootnoteDefinition): string {
  return children
    .flatMap((child) => {
      if (child.type === 'paragraph') return readAtoms(child.children, new Map());
      throw new MarkdownError(`A ${child.type} in a footnote has no place in a project.`);
    })
    .map(({ value }) => value)
    .join('');
}

/** The text of each footnote a Markdown's top-level nodes define. */
export function notesIn(children: RootContent[]): Notes {
  const notes: Notes = new Map();
  for (const node of children) {
    if (node.type === 'footnoteDefinition') notes.set(node.identifier, noteText(node));
  }
  return notes;
}

/** The words of a node, without its marks. */
function wordsOf(node: Root | RootContent): string {
  if ('children' in node) return node.children.map(wordsOf).join('');
  return 'value' in node ? node.value : '';
}

/** The lines of words in Markdown, without its marks. */
export const markdownLines = (markdown: string) =>
  markdownTree(markdown).children.flatMap((node) => wordsOf(node).split('\n'));

/** The blocks one top-level node reads as. */
export function blocksOf(node: RootContent, notes: Notes): Block[] {
  switch (node.type) {
    case 'heading':
      return [textBlock({ kind: 'heading', depth: node.depth }, node.children, notes)];
    case 'paragraph':
      return [textBlock({ kind: 'paragraph' }, node.children, notes)];
    case 'blockquote':
      return paragraphsOf(node.children, { kind: 'quote' }, notes);
    case 'list':
      return readList(node, notes);
    case 'table':
      return readTable(node, notes);
    case 'footnoteDefinition':
      return [];
    case 'code':
      return node.value
        .split('\n')
        .map((value) => ({ kind: 'text', shape: { kind: 'code' }, atoms: [{ value }] }));
    case 'html': {
      const item = ITEM_COMMENT.exec(node.value)?.groups?.item;
      if (item === undefined) throw new MarkdownError(`"${node.value}" has no place.`);
      return [{ kind: 'item', item }];
    }
    default:
      throw new MarkdownError(NO_PLACE);
  }
}

/** Markdown as blocks, read by the parser. */
export function readMarkdown(markdown: string): Block[] {
  const { children } = markdownTree(markdown);
  const notes = notesIn(children);
  return children.flatMap((node) => blocksOf(node, notes));
}
