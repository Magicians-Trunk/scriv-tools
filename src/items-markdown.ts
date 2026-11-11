/**
 * Items in one Markdown file: each starts with the comment that names it, then its own words,
 * then its compiled text in a block of its own between two comments.  The compiled block is read
 * back only to see that it is as written; it never becomes the item's text.
 */
import type { RootContent } from 'mdast';
import type { CompiledText } from './item-compile.ts';
import {
  blocksOf,
  MarkdownError,
  markdownRoot,
  markdownTree,
  notesIn,
  type TextBlock,
  treeMarkdown,
} from './markdown-tree.ts';

/** One item as a Markdown file holds it. */
export interface ItemMarkdown {
  item: string;
  /** The item's own words. */
  blocks: TextBlock[];
  /** The compiled text its block holds, unless it has none. */
  compiled?: CompiledText;
  /** Why its compiled block is not as written, when it is not. */
  broken?: string;
}

/** What each kind of compiled block's comment says after the item's ID. */
const SAYS: Record<CompiledText['kind'], string> = {
  text: 'read only, as the compile writes this item; import refuses the item if it changes',
  'left out': 'the compile leaves this item out',
  stopped: 'none, as the compile stops',
};
const KINDS = new Map<string, CompiledText['kind']>([
  [SAYS.text, 'text'],
  [SAYS['left out'], 'left out'],
  [SAYS.stopped, 'stopped'],
]);

/** The comment that opens an item's compiled block, its seal in it when it has text. */
const COMPILED_COMMENT = /^<!-- compiled (?<item>\S+?)(?: (?<seal>[0-9a-f]+))?: (?<says>.*) -->$/s;
/** The comment that closes an item's compiled text. */
const endComment = (item: string) => `<!-- end of compiled ${item} -->`;

const START = 'The Markdown must start with the comment that names its item.';
const NOT_AS_WRITTEN =
  "Its compiled block is not as export writes it.  The compiled text is reference only: change the item's own words instead.";
const TEXT_AFTER =
  "Text follows its compiled block: an item's own words go before its compiled block.";

/** An item's compiled block as nodes: its comment, and with text, a fence for each piece. */
function compiledNodes(item: string, compiled: CompiledText): RootContent[] {
  if (compiled.kind !== 'text') {
    return [{ type: 'html', value: `<!-- compiled ${item}: ${SAYS[compiled.kind]} -->` }];
  }
  return [
    { type: 'html', value: `<!-- compiled ${item} ${compiled.seal}: ${SAYS.text} -->` },
    ...compiled.pieces.map((value): RootContent => ({ type: 'code', value })),
    { type: 'html', value: endComment(item) },
  ];
}

/** Items as Markdown, each its comment, its own words, and its compiled block. */
export const writeItemsMarkdown = (
  items: readonly { item: string; blocks: TextBlock[]; compiled: CompiledText }[],
): string =>
  treeMarkdown(
    markdownRoot(
      items.map(({ item, blocks, compiled }) => ({
        blocks: [{ kind: 'item', item }, ...blocks],
        after: compiledNodes(item, compiled),
      })),
    ),
  );

/**
 * Reads the compiled block whose comment is at `index` into its item, or why it is not as
 * written, and returns the index of its last node.
 */
function readCompiled(
  children: RootContent[],
  index: number,
  comment: string,
  into: ItemMarkdown,
): number {
  const broken = (why: string) => {
    into.broken ??= why;
  };
  if (into.compiled) broken('It has more than one compiled block.');
  const opened = COMPILED_COMMENT.exec(comment)?.groups;
  const kind = opened && KINDS.get(opened.says!);
  // A seal goes with compiled text, and only with it.
  const sealed = opened?.seal !== undefined;
  if (!opened || opened.item !== into.item || !kind || sealed !== (kind === 'text')) {
    broken(NOT_AS_WRITTEN);
    return index;
  }
  const done = (compiled: CompiledText) => {
    if (!into.broken) into.compiled = compiled;
  };
  if (kind !== 'text') {
    done(kind === 'stopped' ? { kind: 'stopped' } : { kind: 'left out' });
    return index;
  }
  const pieces: string[] = [];
  for (let next = index + 1; next < children.length; next += 1) {
    const node = children[next]!;
    if (node.type === 'code') {
      pieces.push(node.value);
      continue;
    }
    if (node.type === 'html' && node.value === endComment(into.item)) {
      done({ kind, pieces, seal: opened.seal! });
      return next;
    }
    broken(NOT_AS_WRITTEN);
    return next - 1;
  }
  broken(NOT_AS_WRITTEN);
  return children.length - 1;
}

/** How a compiled block's comments start, however the rest of them reads. */
const COMPILED_START = /^<!-- (?:end of )?compiled /;

/** Items read from Markdown.  Markdown with no place in a project stops. */
export function readItemsMarkdown(markdown: string): ItemMarkdown[] {
  const { children } = markdownTree(markdown);
  const notes = notesIn(children);
  const items: ItemMarkdown[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]!;
    const current = items.at(-1);
    if (node.type === 'html' && COMPILED_START.test(node.value)) {
      if (!current) throw new MarkdownError(START);
      index = readCompiled(children, index, node.value, current);
      continue;
    }
    for (const block of blocksOf(node, notes)) {
      if (block.kind === 'item') items.push({ item: block.item, blocks: [] });
      else if (!current) throw new MarkdownError(START);
      else if (current.compiled || current.broken) current.broken ??= TEXT_AFTER;
      else current.blocks.push(block);
    }
  }
  return items;
}
