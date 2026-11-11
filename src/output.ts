import { BoundText } from './bound-text.ts';
import type { LinkEdgeNode } from './resolve-markup.ts';

/**
 * A document's compiled text as a tree, built paragraph by paragraph and written out once at the
 * end, so that nothing written is ever taken back out of a string.
 */
export type OutputNode =
  /** The document's own text; `written` when the compile wrote it there, as a link's address. */
  | { kind: 'text'; text: string; written?: true }
  /** What the format adds around the text: style prefixes and suffixes, list markers. */
  | { kind: 'markup'; text: string }
  /** A character style's range, written between its prefix and suffix only when it has text. */
  | { kind: 'run'; open: string; close: string; children: OutputNode[] }
  /** An inline footnote, written as its marker; a note with nothing to write is left out. */
  | { kind: 'footnote'; children: OutputNode[] }
  /** Placeholder text that describes another binder item, the target of the link it was. */
  | { kind: 'bound'; text: string; item: string }
  /** One end of a document link, which the compile writes once headings are final. */
  | LinkEdgeNode;

export const text = (value: string): OutputNode => ({ kind: 'text', text: value });
export const markup = (value: string): OutputNode => ({ kind: 'markup', text: value });

/** Whether the nodes write nothing at all. */
export function isBlank(nodes: OutputNode[]): boolean {
  return nodes.every((node) => ('children' in node ? isBlank(node.children) : node.text === ''));
}

/** Whether the nodes hold any of the document's text, a kept footnote counting as text. */
function hasText(nodes: OutputNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'text' || node.kind === 'bound' || node.kind === 'edge') {
      return node.text !== '';
    }
    if (node.kind === 'markup') return false;
    return node.kind === 'run' ? hasText(node.children) : !isBlank(node.children);
  });
}

/** Footnote markers are `[^cf1]`, numbered across the compile. */
const FOOTNOTE_LABEL = 'cf';

/**
 * Writes the nodes out, and the text of each footnote kept, in order; a note's marker numbers it
 * after the compile's `notesBefore`.  A note inside a note is numbered before it.
 */
export function serialize(
  nodes: OutputNode[],
  notesBefore: number,
): { text: BoundText; notes: BoundText[] } {
  const notes: BoundText[] = [];
  const write = (written: OutputNode[]): BoundText =>
    BoundText.join(
      written.map((node) => {
        if (node.kind === 'text') return node.written ? node.text : BoundText.own(node.text);
        if (node.kind === 'markup') return node.text;
        if (node.kind === 'bound') return BoundText.bound(node.text, node.item);
        if (node.kind === 'edge') return BoundText.linkEdge(node.text, node.link, node.edge);
        const inner = write(node.children);
        if (node.kind === 'run') {
          return hasText(node.children) ? BoundText.join([node.open, inner, node.close]) : inner;
        }
        if (isBlank(node.children)) return '';
        notes.push(inner);
        return BoundText.noteMarker(`[^${FOOTNOTE_LABEL}${notesBefore + notes.length}]`);
      }),
    );
  return { text: write(nodes), notes };
}

/** The nodes without `target`, wherever it sits in the tree. */
export function without(nodes: OutputNode[], target: OutputNode): OutputNode[] {
  return nodes
    .filter((node) => node !== target)
    .map((node) =>
      node.kind === 'run' || node.kind === 'footnote'
        ? { ...node, children: without(node.children, target) }
        : node,
    );
}

/** Puts `node` just after `target`, wherever it sits in the tree; false when it is not there. */
export function insertAfter(nodes: OutputNode[], target: OutputNode, node: OutputNode): boolean {
  const index = nodes.indexOf(target);
  if (index !== -1) {
    nodes.splice(index + 1, 0, node);
    return true;
  }
  return nodes.some(
    (each) =>
      (each.kind === 'run' || each.kind === 'footnote') && insertAfter(each.children, target, node),
  );
}

/**
 * Sets the first `count` words of the text in capitals, in text nodes and style runs only, so
 * format markup and footnotes keep their case.  Returns how many words are still to go.
 */
export function uppercaseWords(nodes: OutputNode[], count: number): number {
  let left = count;
  for (const node of nodes) {
    if (left <= 0) break;
    if (node.kind === 'text') {
      node.text = node.text.replace(/\S+/g, (word) => {
        if (left === 0) return word;
        left -= 1;
        return word.toUpperCase();
      });
    } else if (node.kind === 'run') left = uppercaseWords(node.children, left);
  }
  return left;
}
