/**
 * Markdown read part by part, so that after a change only the parts the change touches are
 * parsed again.  A part is one of Markdown's top-level nodes.
 */
import type { RootContent } from 'mdast';
import { type Block, blocksOf, markdownTree, type Notes, notesIn } from './markdown-tree.ts';

/** One of Markdown's top-level nodes: where its source starts and ends, and the blocks it reads as. */
interface MarkdownPart {
  type: RootContent['type'];
  start: number;
  end: number;
  blocks: Block[];
}

/** Markdown read as blocks, kept by the top-level node each came from. */
export interface MarkdownRead {
  markdown: string;
  parts: MarkdownPart[];
}

/** What one part of Markdown says to the others: a definition anywhere reaches into every part. */
const DEFINITIONS = new Set<RootContent['type']>(['definition', 'footnoteDefinition']);

const defines = ({ type }: { type: RootContent['type'] }) => DEFINITIONS.has(type);

/** Top-level nodes as parts, their places counted from `offset`. */
function partsOf(children: RootContent[], notes: Notes, offset: number): MarkdownPart[] {
  return children.map((node) => ({
    type: node.type,
    start: node.position!.start.offset! + offset,
    end: node.position!.end.offset! + offset,
    blocks: blocksOf(node, notes),
  }));
}

/** Markdown read, part by part. */
export function readMarkdownParts(markdown: string): MarkdownRead {
  const { children } = markdownTree(markdown);
  return { markdown, parts: partsOf(children, notesIn(children), 0) };
}

/** The blocks of what was read, in order. */
export const readBlocks = ({ parts }: MarkdownRead) => parts.flatMap((part) => part.blocks);

/** How much two texts share at their start, and then at their end. */
function sharedEnds(was: string, now: string) {
  const most = Math.min(was.length, now.length);
  let start = 0;
  while (start < most && was[start] === now[start]) start += 1;
  let end = 0;
  while (end < most - start && was.at(-1 - end) === now.at(-1 - end)) end += 1;
  return { start, end };
}

/**
 * Markdown read again after a change, from what was read before: only the parts the change
 * touches, with one unchanged part on each side, are parsed again, followed by the definitions,
 * which every part reads by.  The parts on each side must read as they did, and the definitions
 * must stay apart, or the change reached beyond them, as an opened code fence does, and the
 * whole is read.  So is a change to a definition.
 */
export function rereadMarkdown(read: MarkdownRead, markdown: string): MarkdownRead {
  const { parts } = read;
  if (parts.length === 0) return readMarkdownParts(markdown);
  const shared = sharedEnds(read.markdown, markdown);
  const shift = markdown.length - read.markdown.length;
  const changedEnd = read.markdown.length - shared.end;
  const touched = parts.findIndex(({ end }) => end >= shared.start);
  const before = (touched < 0 ? parts.length : touched) - 1;
  const after = parts.findLastIndex(({ start }) => start <= changedEnd) + 1;
  if (parts.slice(Math.max(before, 0), after + 1).some(defines)) return readMarkdownParts(markdown);
  const head = parts[before];
  const tail = parts[after];
  const from = head?.start ?? 0;
  const to = (tail?.end ?? read.markdown.length) + shift;
  const source = markdown.slice(from, to);
  const defined = parts.filter(defines).map(({ start, end }) => read.markdown.slice(start, end));
  const { children: all } = markdownTree([source, ...defined].join('\n\n'));
  const ends = all.findIndex((node) => node.position!.start.offset! >= source.length);
  const children = all.slice(0, ends < 0 ? all.length : ends);
  const definitions = all.slice(children.length);
  const first = children[0];
  const last = children.at(-1);
  const kept =
    !children.some(defines) &&
    definitions.length === defined.length &&
    definitions.every(defines) &&
    (!last || last.position!.end.offset! <= source.length) &&
    (!head || (first?.type === head.type && first.position!.end.offset! + from === head.end)) &&
    (!tail ||
      (last?.type === tail.type && last.position!.start.offset! + from === tail.start + shift));
  if (!kept) return readMarkdownParts(markdown);
  const moved = parts
    .slice(tail ? after + 1 : parts.length)
    .map((part) => ({ ...part, start: part.start + shift, end: part.end + shift }));
  return {
    markdown,
    parts: [
      ...parts.slice(0, Math.max(before, 0)),
      ...partsOf(children, notesIn(definitions), from),
      ...moved,
    ],
  };
}
