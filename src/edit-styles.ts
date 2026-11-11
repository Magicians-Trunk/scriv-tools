/** Typed edits on how a paragraph's text looks: its character styles, bold and italic. */
import type { DocumentText } from './document.ts';
import { type Open, openAfter, openAt, type Paragraph, transition } from './edit-markers.ts';
import {
  EditError,
  isPiece,
  lookOf,
  namedStyle,
  paragraphAt,
  styleIndex,
  type Styles,
} from './edit-pieces.ts';
import { isSpan, markupText, type MarkupNode, type SpanNode } from './markup.ts';
import type { PlainLook } from './plain-look.ts';
import type { CharacterFormat } from './rich-text.ts';

/** The formatting a node with text in it starts in. */
export function formatOf(node: MarkupNode): CharacterFormat {
  return 'format' in node ? node.format : formatOf(node.content[0]!);
}

/** These nodes with plain text cut at a place in their text, in a link too.  Others stop. */
function cutAt(nodes: MarkupNode[], at: number): MarkupNode[] {
  let total = 0;
  return nodes.flatMap((node): MarkupNode[] => {
    const offset = at - total;
    const { length } = markupText([node]);
    total += length;
    if (offset <= 0 || offset >= length) return [node];
    if (node.kind === 'link') return [{ ...node, content: cutAt(node.content, offset) }];
    if (node.kind !== 'text') {
      throw new EditError('A style cannot start or end part of the way through a placeholder.');
    }
    const parts = [node.text.slice(0, offset), node.text.slice(offset)];
    return parts.map((text) => ({ ...node, text }));
  });
}

/** A format outside a link, as a marker beside one is written. */
export function withoutField(format: CharacterFormat): CharacterFormat {
  const { field: _, ...rest } = format;
  return rest;
}

/** A format in a look: what marks the text itself stays, and the look gives the rest. */
export function inLook(format: CharacterFormat, look: CharacterFormat): CharacterFormat {
  const { font: _font, size: _size, color: _color, background: _background, ...marks } = format;
  return { ...look, ...marks };
}

/** Whether a character style opens here and closes straight after, around nothing. */
export const holdsNothing = (first: MarkupNode | undefined, next: MarkupNode | undefined) =>
  first?.kind === 'style' &&
  next?.kind === 'style' &&
  first.scope === 'character' &&
  next.closing &&
  !first.closing &&
  first.index === next.index;

/** A character style as what is open, or none. */
const openCharacter = (character: number | undefined): Open =>
  character === undefined ? {} : { character };

/**
 * These nodes with a stretch of their text in a character style, or in none.  Only style markers
 * go in and out around it: what is between them stays as it was, whatever else it holds.  A
 * stretch that starts or ends in a link has its marker there, in the link's formatting, so the
 * link stays one link.  Given a `look`, text that leaves a style takes it, or it would still look
 * like the style.  A style left with nothing in it goes.
 */
function styledNodes(
  nodes: MarkupNode[],
  { start, end }: { start: number; end: number },
  open: Open,
  style: number | undefined,
  look?: CharacterFormat,
): MarkupNode[] {
  const wanted = openCharacter(style);
  let at = 0;
  let { character } = open;
  let started: CharacterFormat | undefined;
  let ended = false;
  const cutsNode = (from: number, length: number) =>
    [start, end].some((place) => from < place && place < from + length);
  const walk = (list: MarkupNode[], inLink: boolean): MarkupNode[] => {
    const out: MarkupNode[] = [];
    const finish = (format: CharacterFormat) => {
      out.push(...transition(wanted, openCharacter(character), format));
      started = undefined;
      ended = true;
    };
    for (const node of list) {
      const { length } = markupText([node]);
      if (started && at === end) finish(inLink ? formatOf(out.at(-1)!) : started);
      if (!started && !ended && at === start && length > 0) {
        started = withoutField(formatOf(node));
        const format = inLink ? formatOf(node) : started;
        out.push(...transition(openCharacter(character), wanted, format));
      }
      if (node.kind === 'style' && node.scope === 'character') {
        ({ character } = openAfter([node], openCharacter(character)));
        if (!started) out.push(node);
      } else if (node.kind === 'link' && (started || cutsNode(at, length))) {
        out.push({ ...node, content: walk(node.content, true) });
      } else {
        ({ character } = openAfter([node], openCharacter(character)));
        const leaves = look && started && character !== undefined && node.kind === 'text';
        out.push(leaves ? { ...node, format: inLook(node.format, look) } : node);
        at += length;
      }
    }
    if (started && !inLink) finish(started);
    return out;
  };
  const styled = walk(cutAt(cutAt(nodes, start), end), false);
  return styled.filter(
    (node, place) =>
      !holdsNothing(node, styled[place + 1]) && !holdsNothing(styled[place - 1], node),
  );
}

/** The piece of a paragraph that is a note with text.  Any other stops. */
export function noteAt(paragraph: Paragraph, at: number, piece: number): SpanNode {
  const note = paragraph.content.filter(isPiece)[piece];
  if (!note || !isSpan(note)) {
    throw new EditError(`Piece ${piece} of paragraph ${at} is not a note with text.`);
  }
  return note;
}

/** The look of text in a paragraph that is in no character style. */
export const plainTextLook = (
  project: Styles,
  document: DocumentText,
  paragraph: number,
  plain: PlainLook | undefined,
) => lookOf(project, document, paragraph) ?? plain?.character ?? {};

/**
 * Puts a stretch of a paragraph's text in a character style, or in none; given a `piece`, of the
 * note it is, by offsets into the note's text.  A style in a note starts and ends in it.  An
 * annotation holds no styles: it keeps Scrivener's markup as typed.  Text a style leaves takes the
 * paragraph's look, as a note's text keeps its own.
 */
export function styleRange(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  { piece, ...range }: { start: number; end: number; piece?: number },
  style: string | undefined,
  plain?: PlainLook,
): void {
  const target = paragraphAt(document, paragraph);
  const index = style === undefined ? undefined : styleIndex(document, namedStyle(project, style));
  if (piece === undefined) {
    const open = openAt(document, paragraph);
    const look =
      index === undefined ? plainTextLook(project, document, paragraph, plain) : undefined;
    target.content = styledNodes(target.content, range, open, index, look);
    return;
  }
  const note = noteAt(target, paragraph, piece);
  if (note.kind === 'annotation') throw new EditError('An annotation cannot hold a style.');
  note.content = styledNodes(note.content, range, {}, index);
}

/** A stretch of text made bold or italic, or not.  A look left out stays as it is. */
export interface LookChange {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
}

/** Text with a look changed, and all else it is written in kept. */
function lookChanged(node: MarkupNode, change: LookChange): MarkupNode {
  if (node.kind !== 'text') return node;
  const { bold: wasBold, italic: wasItalic, ...rest } = node.format;
  const nowBold = change.bold ?? wasBold;
  const nowItalic = change.italic ?? wasItalic;
  const format = {
    ...rest,
    ...(nowBold ? { bold: true } : {}),
    ...(nowItalic ? { italic: true } : {}),
  };
  return { ...node, format };
}

/** These nodes, whose text starts at `from`, with a look changed on what the stretch covers. */
function looksChanged(nodes: MarkupNode[], change: LookChange, from: number): MarkupNode[] {
  let at = from;
  return nodes.map((node) => {
    const start = at;
    at += markupText([node]).length;
    if (start >= change.end || at <= change.start) return node;
    if (node.kind !== 'link') return lookChanged(node, change);
    return { ...node, content: looksChanged(node.content, change, start) };
  });
}

/** Changes whether a stretch of a paragraph's text is bold or italic. */
export function changeLook(document: DocumentText, paragraph: number, change: LookChange): void {
  const target = paragraphAt(document, paragraph);
  const cut = cutAt(cutAt(target.content, change.start), change.end);
  target.content = looksChanged(cut, change, 0);
}
