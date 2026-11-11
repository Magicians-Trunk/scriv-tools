/**
 * Scrivener writes styles and headings as markers in the text, and they carry from one paragraph
 * to the next, so what is open at any place depends on everything before it.  Every edit keeps
 * that true by one rule: it notes what is open on each side of the change, and writes the markers
 * that lead from one to the other.
 */
import type { DocumentText } from './document.ts';
import { headingTagOf, type MarkupNode, type StyleMarker } from './markup.ts';
import { type CharacterFormat, type RichParagraph, same } from './rich-text.ts';

export type Paragraph = RichParagraph<MarkupNode[]>;

/** What is open at a place in a document: each style by its index, the heading by its level. */
export interface Open {
  paragraph?: number;
  character?: number;
  heading?: number;
}

/** What is open after these nodes, given what was open before them. */
export function openAfter(nodes: readonly MarkupNode[], before: Open): Open {
  const open = { ...before };
  for (const node of nodes) {
    const heading = headingTagOf(node);
    if (node.kind === 'link') Object.assign(open, openAfter(node.content, open));
    else if (node.kind === 'style') {
      if (node.closing) delete open[node.scope];
      else open[node.scope] = node.index;
    } else if (heading?.closing) delete open.heading;
    else if (heading) open.heading = heading.level;
  }
  return open;
}

/** What is open where a paragraph starts. */
export function openAt(document: DocumentText, paragraph: number): Open {
  return document.paragraphs
    .slice(0, paragraph)
    .reduce((open: Open, { content }) => openAfter(content, open), {});
}

/** What is open where each paragraph starts, read in one pass through the document. */
export function opensAt(document: DocumentText): Open[] {
  let open: Open = {};
  return document.paragraphs.map(({ content }) => {
    const here = open;
    open = openAfter(content, open);
    return here;
  });
}

export function styleMarker(
  scope: StyleMarker['scope'],
  index: number,
  closing: boolean,
  format: CharacterFormat,
): StyleMarker {
  const source = `<${closing ? '!' : ''}$Scr_${scope === 'paragraph' ? 'Ps' : 'Cs'}::${index}>`;
  return { kind: 'style', scope, index, closing, source, format };
}

const headingTag = (level: number, closing: boolean, format: CharacterFormat): MarkupNode => ({
  kind: 'tag',
  source: `<${closing ? '!' : ''}$Scr_H::${level}>`,
  format,
});

/** The markers that lead from what is open to what should be: endings first, as Scrivener does. */
export function transition(from: Open, to: Open, format: CharacterFormat): MarkupNode[] {
  const nodes: MarkupNode[] = [];
  const heading = from.heading !== to.heading;
  if (heading && from.heading !== undefined) nodes.push(headingTag(from.heading, true, format));
  for (const scope of ['character', 'paragraph'] as const) {
    const ended = from[scope];
    if (ended !== undefined && ended !== to[scope]) {
      nodes.push(styleMarker(scope, ended, true, format));
    }
  }
  if (heading && to.heading !== undefined) nodes.push(headingTag(to.heading, false, format));
  for (const scope of ['paragraph', 'character'] as const) {
    const started = to[scope];
    if (started !== undefined && started !== from[scope]) {
      nodes.push(styleMarker(scope, started, false, format));
    }
  }
  return nodes;
}

/** What writes no text: Scrivener puts keep-with-next tags among a paragraph's opening markers. */
const isMarker = (node: MarkupNode) => node.kind === 'style' || node.kind === 'tag';

/** Whether a marker is one of those what is open is made of. */
const opensOrCloses = (node: MarkupNode) =>
  node.kind === 'style' || headingTagOf(node) !== undefined;

/** How many markers a paragraph starts with. */
export function leadingMarkers({ content }: Paragraph): number {
  const text = content.findIndex((node) => !isMarker(node));
  return text < 0 ? content.length : text;
}

/** What is open once the markers a paragraph starts with are read, from what was open before. */
export function openBeforeText(paragraph: Paragraph, open: Open): Open {
  return openAfter(paragraph.content.slice(0, leadingMarkers(paragraph)), open);
}

/** Where a style that starts in a paragraph with no text ends, which is inside it. */
export function emptyStyleEnd({ content }: Pick<Paragraph, 'content'>): number {
  const opening = content.findIndex((node) => node.kind === 'style' && !node.closing);
  const ending = content.findIndex(
    (node, at) =>
      at > opening &&
      ((node.kind === 'style' && node.closing) || headingTagOf(node)?.closing === true),
  );
  return opening >= 0 && ending >= 0 && content.every(isMarker) ? ending : content.length;
}

/**
 * What is open where a paragraph's text starts, after the markers it starts with.  An empty
 * paragraph in a style holds where its text would go between that style's two ends.
 */
export function openAtText(
  document: DocumentText,
  index: number,
  open = openAt(document, index),
): Open {
  const paragraph = document.paragraphs[index]!;
  const end = emptyStyleEnd(paragraph);
  if (end < paragraph.content.length) return openAfter(paragraph.content.slice(0, end), open);
  return openBeforeText(paragraph, open);
}

/**
 * Ends what does not go on from `from` to `to` at the end of a paragraph, before its mark, and
 * gives what is still open.  A style normally ends at the start of the next paragraph, but a list
 * item starts with its marker, so a style ending there would take in the marker, and with it the
 * list item's paragraph: Scrivener ends it before the mark instead.
 */
export function endBeforeList(
  paragraph: Paragraph,
  from: Open,
  to: Open,
  format: CharacterFormat,
): Open {
  const going: Open = {};
  for (const kind of ['paragraph', 'character', 'heading'] as const) {
    const value = from[kind];
    if (value !== undefined && value === to[kind]) going[kind] = value;
  }
  paragraph.content.push(...transition(from, going, format));
  return going;
}

/**
 * Leads from what is open at the end of a change to what the text after it goes on with: as the
 * markers the next paragraph starts with, or, with none after, at the end of the last.  Given
 * `endAll`, what is open ends first, even what the text after it goes on with.
 */
export function join(
  document: DocumentText,
  at: number,
  from: Open,
  to: Open,
  format: CharacterFormat,
  endAll = false,
): void {
  if (same(from, to) && !endAll) return;
  const ended = endAll ? transition(from, {}, format) : [];
  const start = endAll ? {} : from;
  const next = document.paragraphs[at];
  if (!next) {
    document.paragraphs.at(-1)?.content.push(...ended, ...transition(start, to, format));
    return;
  }
  const markers = leadingMarkers(next);
  const wanted = openBeforeText(next, to);
  const others = next.content.slice(0, markers).filter((node) => !opensOrCloses(node));
  const before = document.paragraphs[at - 1];
  // What goes in the next paragraph is in its formatting, not that of what came before it.
  const [own = format] = next.content.flatMap((node) =>
    node.kind === 'text' ? [node.format] : [],
  );
  if (next.marker && before) {
    const going = endBeforeList(before, from, endAll ? {} : wanted, format);
    next.content.splice(0, markers, ...others, ...transition(going, wanted, own));
    return;
  }
  next.content.splice(0, markers, ...others, ...ended, ...transition(start, wanted, own));
}
