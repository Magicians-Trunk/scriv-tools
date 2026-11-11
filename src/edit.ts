/** Typed edits on a document's paragraphs: adding them, removing them, and restyling them. */
import type { DocumentText } from './document.ts';
import { type ListShape, listShape, makeListItem, renumberLists } from './edit-lists.ts';
import {
  endBeforeList,
  join,
  type Open,
  openAfter,
  openAt,
  openAtText,
  openBeforeText,
  type Paragraph,
  transition,
} from './edit-markers.ts';
import {
  cutsNote,
  cutsTable,
  EditError,
  firstText,
  inlineNodes,
  lookOf,
  namedStyle,
  type NewParagraph,
  NOTE_ACROSS,
  paragraphAt,
  plainNeighbour,
  sampleOf,
  styledLook,
  styleAt,
  styleIndex,
  type Styles,
} from './edit-pieces.ts';
import { headingTagOf, type MarkupNode } from './markup.ts';
import type { PlainLook } from './plain-look.ts';
import { headingLevel } from './style-mapping.ts';
import { type CharacterFormat, same } from './rich-text.ts';

/** What adding a paragraph reads: what is open before it, and the paragraphs on either side. */
interface Place {
  at: number;
  open: Open;
  /** What is open after the paragraphs being added, which the text there goes on with. */
  after: Open;
  previous: Paragraph | undefined;
  next: Paragraph | undefined;
  /** The look of plain text when the document has none to copy. */
  plain?: PlainLook;
}

/** A paragraph to add, which can keep the nodes of one that is being remade, in its new look. */
interface Adding extends NewParagraph {
  keep?: (character: CharacterFormat) => MarkupNode[];
}

/** A new paragraph, and what is open after it. */
function build(
  project: Styles,
  document: DocumentText,
  { style, text, keep, list, level: given }: Adding,
  { at, open, after, previous, next, plain }: Place,
): { paragraph: Paragraph; open: Open } {
  const named = style === undefined ? undefined : namedStyle(project, style);
  const sample = named && sampleOf(named);
  const neighbour = plainNeighbour(document, at);
  const copied = firstText(neighbour?.content ?? [])?.format ?? plain?.character ?? {};
  const character = named ? styledLook(named, copied) : copied;
  const index = named && styleIndex(document, named);
  const level = given ?? (named && headingLevel(named));
  const heading = level !== undefined;
  const wanted: Open = index === undefined ? {} : { paragraph: index };
  if (heading) wanted.heading = level;
  // A style's prefix goes around the whole of a run of it, so a heading is always a run of its
  // own.  As Scrivener writes it: keep-with-next, then what ends and starts, and it runs through
  // its paragraph mark, to end in the next paragraph.
  const marker = named?.lists?.[0] ?? (list && (list.ordered ? '{decimal}.' : '{disc}'));
  const from =
    marker !== undefined && previous ? endBeforeList(previous, open, wanted, character) : open;
  const content = [
    ...(sample?.before.filter((node) => !headingTagOf(node)) ?? []),
    ...(heading ? transition(open, {}, character) : []),
    ...transition(heading ? {} : from, wanted, character),
    ...(keep ? keep(character) : inlineNodes(project, document, text, character)),
    ...(heading ? [] : (sample?.after ?? [])),
  ];
  const paragraph: Paragraph = {
    format: sample?.format ?? neighbour?.format ?? plain?.format ?? {},
    content: structuredClone(content),
    end: { kind: 'paragraph', format: character },
  };
  if (marker !== undefined) {
    const fits = (item: Paragraph | undefined): item is Paragraph => {
      const shape = item?.marker && listShape(document, item);
      return !!item?.marker && (!list || list.level > 0 || shape?.ordered === list.ordered);
    };
    const continues = open.paragraph === index && fits(previous) ? previous : undefined;
    const goesOn = fits(next) && openBeforeText(next, after).paragraph === index;
    const beside = continues ?? (goesOn ? next : undefined);
    makeListItem(document, paragraph, marker, beside, character, list?.level);
  }
  return { paragraph, open: wanted };
}

/** A paragraph's last node, when it ends the paragraph style `index`. */
function endsStyle({ content }: Paragraph, index: number): boolean {
  const last = content.at(-1);
  return (
    last?.kind === 'style' && last.scope === 'paragraph' && last.closing && last.index === index
  );
}

/** A new document opens as the project's own do: the styles' samples are Scrivener's writing. */
export function startDocument(project: Styles, document: DocumentText): void {
  const written = project.styles.find(({ format }) => Object.keys(format.settings).length > 0);
  if (written && document.source === '') document.settings = written.format.settings;
}

/** Adds paragraphs before the paragraph at `at`, or after the last when `at` is the length. */
export function insertParagraphs(
  project: Styles,
  document: DocumentText,
  at: number,
  paragraphs: NewParagraph[],
  plain?: PlainLook,
): void {
  addParagraphs(project, document, at, paragraphs, plain);
}

function addParagraphs(
  project: Styles,
  document: DocumentText,
  at: number,
  paragraphs: Adding[],
  plain?: PlainLook,
): void {
  const [first] = paragraphs;
  if (!first) return;
  if (cutsTable(document, at)) throw new EditError('A paragraph cannot go inside a table.');
  if (cutsNote(document, at)) throw new EditError(NOTE_ACROSS);
  startDocument(project, document);
  const after = openAt(document, at);
  const before = document.paragraphs[at - 1];
  const next = document.paragraphs[at];
  const style = first.style === undefined ? undefined : namedStyle(project, first.style);
  const index = style ? document.styleIds.indexOf(style.id) : -1;
  const continues =
    style &&
    first.level === undefined &&
    !sampleOf(style).before.some((node) => headingTagOf(node));
  let open = after;
  // Text that goes on from a style ending just before it joins that style, instead of starting
  // it anew: a style's prefix and suffix go around the whole of it.
  if (before && continues && index >= 0 && endsStyle(before, index)) {
    before.content.pop();
    open = { ...after, paragraph: index };
  }
  const added: Paragraph[] = [];
  for (const paragraph of paragraphs) {
    const previous = added.at(-1) ?? before;
    const place = { at, open, after, previous, next, ...(plain ? { plain } : {}) };
    const built = build(project, document, paragraph, place);
    open = built.open;
    added.push(built.paragraph);
  }
  const last = added.at(-1)!;
  document.paragraphs.splice(at, 0, ...added);
  // The last paragraph of a document has no mark, so what is added takes that from it.
  if (before?.end.kind === 'document') before.end = { ...before.end, kind: 'paragraph' };
  if (at + added.length === document.paragraphs.length) {
    last.end = { ...last.end, kind: 'document' };
  }
  join(document, at + added.length, open, after, last.end.format, open.heading !== undefined);
  renumberLists(document, added);
}

/** Removes `count` paragraphs from `first`, leaving what is open after them as it was. */
export function removeParagraphs(document: DocumentText, first: number, count: number): void {
  if (cutsTable(document, first) || cutsTable(document, first + count)) {
    throw new EditError('Part of a table cannot be removed, only all of it.');
  }
  if (cutsNote(document, first) || cutsNote(document, first + count)) {
    throw new EditError(NOTE_ACROSS);
  }
  const before = openAt(document, first);
  const after = openAt(document, first + count);
  const removed = document.paragraphs.splice(first, count);
  const last = removed.at(-1);
  if (!last) return;
  const previous = document.paragraphs[first - 1];
  if (previous && last.end.kind === 'document') {
    previous.end = { ...previous.end, kind: 'document' };
  }
  join(document, first, before, after, last.end.format);
  renumberLists(document, removed);
}

/** Whether a node belongs to a paragraph's style, not to what the paragraph holds. */
function ofParagraphStyle(node: MarkupNode): boolean {
  if (node.kind === 'style') return node.scope === 'paragraph';
  return node.kind === 'tag';
}

/**
 * Puts a paragraph in a paragraph style, or in none.  All it holds stays, and its text takes the
 * new style's look as Scrivener applies one: a Paragraph style changes no character attribute, and
 * a Paragraph+Character style makes all text alike but what is in a character style, each with
 * the font family and size only as `FontChange` says.  With no style, text in the old style's
 * look takes plain text's.  A link keeps its own look.  Given a `level`, the paragraph has that
 * HTML header level; otherwise it has its style's.
 */
export function setParagraphStyle(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  style: string | undefined,
  list?: ListShape | null,
  level?: number,
): void {
  const target = paragraphAt(document, paragraph);
  const { content, end } = target;
  const at = openAtText(document, paragraph);
  const now = styleAt(project, document, at.paragraph);
  const shape = list === undefined ? listShape(document, target) : (list ?? undefined);
  const named = style === undefined ? undefined : namedStyle(project, style);
  const heading = level ?? (named && headingLevel(named));
  const kept = now?.name === style && same(listShape(document, target), shape);
  if (kept && at.heading === heading) return;
  const look = lookOf(project, document, paragraph);
  const nodes = content.filter((node) => !ofParagraphStyle(node));
  const keep = (character: CharacterFormat) => {
    let open = at;
    return nodes.map((node) => {
      const styled = open.character !== undefined;
      open = openAfter([node], open);
      if (node.kind !== 'text' || styled) return node;
      if (named) return { ...node, format: styledLook(named, node.format) };
      return same(node.format, look) ? { ...node, format: character } : node;
    });
  };
  removeParagraphs(document, paragraph, 1);
  addParagraphs(project, document, paragraph, [
    {
      ...(style === undefined ? {} : { style }),
      ...(shape ? { list: shape } : {}),
      ...(level === undefined ? {} : { level }),
      text: '',
      keep,
    },
  ]);
  document.paragraphs[paragraph]!.end = end;
}
