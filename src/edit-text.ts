/** Typed edits on the text of a paragraph. */
import type { DocumentText } from './document.ts';
import {
  emptyStyleEnd,
  type Open,
  openAfter,
  openAt,
  type Paragraph,
  transition,
} from './edit-markers.ts';
import {
  EditError,
  type Inline,
  inlineNodes,
  isPiece,
  namedStyle,
  NOTE_ACROSS,
  paragraphAt,
  pieceNodes,
  styledLook,
  styleAt,
  styleIndex,
  type Styles,
} from './edit-pieces.ts';
import { markupText, type MarkupNode, runsIn, runsOn } from './markup.ts';
import type { PlainLook } from './plain-look.ts';
import type { ProjectStyle } from './project-styles.ts';
import {
  formatOf,
  holdsNothing,
  inLook,
  noteAt,
  plainTextLook,
  withoutField,
} from './edit-styles.ts';
import type { CharacterFormat } from './rich-text.ts';
import { commonEnd, commonStart } from './text-compare.ts';

/** Where the one match of a text starts in a paragraph's text.  Anything else stops. */
function findOnce(paragraph: Paragraph, find: string): number {
  const whole = markupText(paragraph.content);
  const start = whole.indexOf(find);
  if (start < 0) throw new EditError(`The paragraph does not hold "${find}".`);
  if (whole.includes(find, start + 1)) {
    throw new EditError(`The paragraph holds "${find}" more than once.`);
  }
  return start;
}

/** Whether a cut here leaves a node whole: only plain text can be cut part of the way through. */
function cutsCleanly(node: MarkupNode, offset: number): boolean {
  return node.kind === 'text' || offset === 0 || offset === markupText([node]).length;
}

/** Text left of a node after a cut: nothing when it has no text left, or is not plain text. */
function kept(node: MarkupNode, value: string): MarkupNode[] {
  return node.kind === 'text' && value !== '' ? [{ ...node, text: value }] : [];
}

/** The formatting of the text beside a node, outside it: a link's, without the link. */
function besideOf(node: MarkupNode): CharacterFormat {
  return node.kind === 'link' ? withoutField(formatOf(node)) : formatOf(node);
}

/**
 * Which nodes hold a range of their text, and how far into them it starts and ends.  A range with
 * no length sits at the end of the text before it, or the start of the first text.
 */
function nodesAround(nodes: readonly MarkupNode[], start: number, end: number) {
  const texts = nodes.map((node) => markupText([node]));
  let total = 0;
  const starts = texts.map((text) => {
    total += text.length;
    return total - text.length;
  });
  const holding = (at: number, first: boolean) => {
    const node = texts.findIndex((text, index) => {
      const edge = starts[index]! + text.length;
      return text !== '' && (first && start !== end ? at < edge : at <= edge);
    });
    return { node, offset: at - starts[node]! };
  };
  return { start: holding(start, true), end: holding(end, false) };
}

/**
 * Where pieces go at a place with no length between nodes, and the formatting of the text beside
 * them there.  Such a place is a choice of side: inside the style or link that ends or starts
 * there, or outside it.  Pieces say for themselves what they are in, so they go on the side where
 * the first one's character style is open, or none is, if either side has it, and never into a
 * link.  None when the place is part of the way through a node's text, or there is no text.
 */
function placeFor({ project, document, nodes, open }: Replacing, at: number, pieces: Inline[]) {
  const [piece] = pieces;
  let total = 0;
  const places: number[] = [];
  for (const [index, node] of nodes.entries()) {
    if (total === at) places.push(index);
    total += markupText([node]).length;
  }
  if (total === at) places.push(nodes.length);
  const [left] = places;
  // With no text, the place is where the paragraph's opening markers end, as it is for a string.
  if (!piece || left === undefined || total === 0) return undefined;
  const opens = places.map((place) => openAfter(nodes.slice(0, place), open));
  // Paragraph and heading markers belong to the text, so only those around the text it is beside.
  const beside = left > 0 ? opens[0]! : opens.at(-1)!;
  const around = places.flatMap((_, index) =>
    opens[index]!.paragraph === beside.paragraph && opens[index]!.heading === beside.heading
      ? [index]
      : [],
  );
  const styled = (index: number) =>
    styleAt(project, document, opens[index]!.character)?.name === piece.style;
  const chosen = around.find(styled) ?? around[0]!;
  const place = places[chosen]!;
  const { character } = opens[chosen]!;
  const sides = [
    { node: nodes[left - 1], open: opens[0]! },
    { node: nodes[places.at(-1)!], open: opens.at(-1)! },
  ];
  const side = sides.find(({ node, open: there }) => node && there.character === character);
  return { place, format: besideOf(side?.node ?? nodes[place] ?? nodes[place - 1]!) };
}

/** Replaces a range of these nodes' text. */
function replaceIn(
  replacing: Replacing,
  range: { start: number; end: number },
  text: string | Inline[],
  plain?: PlainLook,
): void {
  const { project, document, nodes, open } = replacing;
  if (typeof text !== 'string' && range.start === range.end) {
    const between = placeFor(replacing, range.start, text);
    if (between) {
      spliceNodes(replacing, between.place, between.place, between.format, text);
      return;
    }
  }
  const { start, end } = nodesAround(nodes, range.start, range.end);
  const first = nodes[start.node];
  const last = nodes[end.node];
  if (!first || !last) {
    if (nodes.some(runsOn)) throw new EditError(NOTE_ACROSS);
    const at = emptyStyleEnd({ content: nodes });
    const named = styleAt(project, document, openAfter(nodes.slice(0, at), open).paragraph);
    const look = named ? styledLook(named, plain?.character ?? {}) : (plain?.character ?? {});
    nodes.splice(at, 0, ...inlineNodes(project, document, text, look));
    return;
  }
  // Pieces say what their links are, so those for all of a link take its place.
  const whole = start.offset === 0 && end.offset === markupText([last]).length;
  if (first === last && first.kind === 'link' && (typeof text === 'string' || !whole)) {
    const inside = { ...replacing, nodes: first.content };
    const opened = openAfter(nodes.slice(0, start.node), open);
    replaceIn({ ...inside, open: opened }, { start: start.offset, end: end.offset }, text);
    return;
  }
  if (!cutsCleanly(first, start.offset) || !cutsCleanly(last, end.offset)) {
    throw new EditError('The change ends part of the way through a link or note.');
  }
  const head = first.kind === 'text' ? first.text.slice(0, start.offset) : '';
  const tail = last.kind === 'text' ? last.text.slice(end.offset) : '';
  spliceNodes(replacing, start.node, end.node + 1, besideOf(first), text, {
    head: kept(first, head),
    tail: kept(last, tail),
  });
}

/** Where nodes are being replaced. */
interface Replacing {
  project: Styles;
  document: DocumentText;
  nodes: MarkupNode[];
  /** What is open before the nodes. */
  open: Open;
  /** The look of text there in no character style. */
  look: () => CharacterFormat;
}

/**
 * The look pieces start from, which say for themselves if they are bold or italic or a link: what
 * they replace keeps its font, and takes the rest from its paragraph's style.
 */
function stated(project: Styles, document: DocumentText, open: Open, format: CharacterFormat) {
  const { bold: _bold, italic: _italic, field: _field, ...rest } = format;
  const named = styleAt(project, document, open.paragraph);
  const { bold, italic } = named ? styledLook(named, {}) : ({} satisfies CharacterFormat);
  return { ...rest, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) };
}

/**
 * Pieces as nodes where `from` is open and the text there is in `format`.  Each is in the
 * character style it names, or in none, whatever is open there: one in the style open there takes
 * the formatting of the text it goes in, one in another style takes that style's, and one in no
 * style takes the look of text in none.  Gives what is open after them, and the formatting
 * markers there are written in.
 */
function piecesAt(
  { project, document, look }: Replacing,
  pieces: Inline[],
  from: Open,
  format: CharacterFormat,
) {
  const { character: _, ...outside } = from;
  const marker = from.character === undefined ? format : inLook(format, look());
  const baseOf = (named: ProjectStyle | undefined, character: number | undefined) => {
    if (character === from.character) return stated(project, document, from, format);
    if (named) return styledLook(named, stated(project, document, from, marker));
    return stated(project, document, from, marker);
  };
  let open: Open = from;
  const nodes: MarkupNode[] = [];
  for (const piece of pieces) {
    const named = piece.style === undefined ? undefined : namedStyle(project, piece.style);
    const wanted: Open = named ? { ...outside, character: styleIndex(document, named) } : outside;
    nodes.push(
      ...transition(open, wanted, marker),
      ...pieceNodes(piece, baseOf(named, wanted.character), project.files),
    );
    open = wanted;
  }
  return { nodes, open, marker };
}

/** Takes out each character style opened and closed around nothing from `from` to `to`. */
function dropEmptyStyles(nodes: MarkupNode[], from: number, to: number): void {
  for (let at = Math.min(to, nodes.length - 2); at >= Math.max(from, 0); at -= 1) {
    if (holdsNothing(nodes[at], nodes[at + 1])) nodes.splice(at, 2);
  }
}

/**
 * Puts new text in place of nodes from `start` to `end`, with what is kept of them either side.
 * Text given as a string takes the formatting and style of what it replaces.  Pieces say their own
 * style, so a style open where they go ends for one in another, and a style they leave with
 * nothing in it goes.
 */
function spliceNodes(
  replacing: Replacing,
  start: number,
  end: number,
  format: CharacterFormat,
  text: string | Inline[],
  { head = [], tail = [] }: { head?: MarkupNode[]; tail?: MarkupNode[] } = {},
): void {
  const { project, document, nodes, open } = replacing;
  const inNote = nodes.slice(0, start).some(runsOn) || nodes.slice(end).some(runsIn);
  if (inNote || nodes.slice(start, end).some((node) => runsOn(node) || runsIn(node))) {
    throw new EditError(NOTE_ACROSS);
  }
  const before = openAfter(nodes.slice(0, start), open);
  const after = openAfter(nodes.slice(0, end), open);
  if (typeof text === 'string') {
    const written = inlineNodes(project, document, text, format);
    nodes.splice(
      start,
      end - start,
      ...head,
      ...written,
      ...transition(before, after, format),
      ...tail,
    );
    return;
  }
  const written = piecesAt(replacing, text, before, format);
  const ending = transition(written.open, after, written.marker);
  const placed = [...head, ...written.nodes, ...ending, ...tail];
  nodes.splice(start, end - start, ...placed);
  dropEmptyStyles(nodes, start - 1, start + placed.length);
}

/** Nodes of a paragraph, or of a note in it, to replace text in. */
const replacingIn = (
  project: Styles,
  document: DocumentText,
  paragraph: number,
  nodes: MarkupNode[],
  plain?: PlainLook,
): Replacing => ({
  project,
  document,
  nodes,
  open: openAt(document, paragraph),
  look: () => plainTextLook(project, document, paragraph, plain),
});

/**
 * Replaces a range of a paragraph's text, by offsets into the text `markupText` reads, across its
 * runs, styles and links.  The text around it keeps its formatting; the new text takes the
 * formatting of the text it replaces.
 */
export function replaceRange(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  range: { start: number; end: number },
  text: string | Inline[],
  plain?: PlainLook,
): void {
  const { content } = paragraphAt(document, paragraph);
  replaceIn(replacingIn(project, document, paragraph, content, plain), range, text, plain);
}

/** Replaces the one place a paragraph holds `find`. */
export function replaceText(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  find: string,
  text: string | Inline[],
): void {
  const start = findOnce(paragraphAt(document, paragraph), find);
  const range = { start, end: start + find.length };
  replaceRange(project, document, paragraph, range, text);
}

/**
 * Changes the text inside a footnote, annotation or Preserve Formatting, the piece `piece` as
 * `readParagraphs` lists it.  Only the words that differ change, so what else the note holds, like
 * bold text, a link or an annotation's colour, stays.
 */
export function replaceNoteText(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  piece: number,
  text: string,
): void {
  const note = noteAt(paragraphAt(document, paragraph), paragraph, piece);
  const was = markupText(note.content);
  const start = commonStart(was, text);
  const end = commonEnd(was, text, start);
  const range = { start, end: was.length - end };
  const words = text.slice(start, text.length - end);
  replaceIn(replacingIn(project, document, paragraph, note.content), range, words);
}

/**
 * Replaces `count` of a paragraph's pieces, as `readParagraphs` lists them, from `first`.  With
 * none to replace, the new ones go before that piece, or after the last.
 */
export function replaceInlines(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  first: number,
  count: number,
  text: Inline[],
  plain?: PlainLook,
): void {
  const { content } = paragraphAt(document, paragraph);
  const pieces = content.flatMap((node, index) => (isPiece(node) ? [index] : []));
  const start = pieces[first] ?? (pieces.at(-1) ?? -1) + 1;
  const end = count > 0 ? pieces[first + count - 1]! + 1 : start;
  const format = plainTextLook(project, document, paragraph, plain);
  const open = openAt(document, paragraph);
  spliceNodes(
    { project, document, nodes: content, open, look: () => format },
    start,
    end,
    format,
    text,
  );
}
