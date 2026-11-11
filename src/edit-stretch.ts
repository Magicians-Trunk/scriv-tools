/**
 * A stretch of a document's paragraphs, held exactly as they are, to put in another version of it.
 * What a typed edit cannot say goes this way: a table, a picture, a font.  Styles are held by ID
 * and lists by their definition, as each document numbers them for itself.
 */
import type { DocumentText } from './document.ts';
import { renumberLists } from './edit-lists.ts';
import { join, type Open, openAt, type Paragraph, styleMarker } from './edit-markers.ts';
import { cutsNote, cutsTable, EditError, NOTE_ACROSS } from './edit-pieces.ts';
import type { MarkupNode } from './markup.ts';
import { type ListDefinition, type ListOverride, same } from './rich-text.ts';

/** What is open at a place, each style by its ID. */
type OpenIds = { paragraph?: string; character?: string; heading?: number };

export interface DocumentStretch {
  paragraphs: Paragraph[];
  /** The document's own style IDs and lists, which the paragraphs number. */
  styleIds: string[];
  lists: ListDefinition[];
  listOverrides: ListOverride[];
  /** What is open before the paragraphs, and after them. */
  open: OpenIds;
  after: OpenIds;
  settings: DocumentText['settings'];
}

function openIds({ paragraph, character, heading }: Open, styleIds: string[]): OpenIds {
  return {
    ...(paragraph === undefined ? {} : { paragraph: styleIds[paragraph]! }),
    ...(character === undefined ? {} : { character: styleIds[character]! }),
    ...(heading === undefined ? {} : { heading }),
  };
}

/** A copy of `count` paragraphs of a document from `first`. */
export function stretchOf(document: DocumentText, first: number, count: number): DocumentStretch {
  const { styleIds, lists, listOverrides, settings } = document;
  return structuredClone({
    paragraphs: document.paragraphs.slice(first, first + count),
    styleIds,
    lists,
    listOverrides,
    open: openIds(openAt(document, first), styleIds),
    after: openIds(openAt(document, first + count), styleIds),
    settings,
  });
}

/** A style's index in a document, listing it there if the document has not used it yet. */
function indexOfId(document: DocumentText, id: string): number {
  const index = document.styleIds.indexOf(id);
  return index >= 0 ? index : document.styleIds.push(id) - 1;
}

/** Markup with its styles numbered as the document numbers them. */
function renumbered(document: DocumentText, styleIds: string[], nodes: MarkupNode[]): MarkupNode[] {
  return nodes.map((node) => {
    if (node.kind === 'style') {
      const index = indexOfId(document, styleIds[node.index]!);
      return { ...node, ...styleMarker(node.scope, index, node.closing, node.format) };
    }
    return 'content' in node
      ? { ...node, content: renumbered(document, styleIds, node.content) }
      : node;
  });
}

/** A list with what only says where it is in its document left out. */
const listShapeOf = ({ id: _id, templateId: _templateId, levels, ...rest }: ListDefinition) => ({
  ...rest,
  levels: levels.map(({ text: { templateId: _level, ...text }, ...level }) => ({ ...level, text })),
});

/** The override in a document for a list of a stretch: of the same list, or of it added there. */
function adoptList(document: DocumentText, stretch: DocumentStretch, override: number): number {
  const held = stretch.listOverrides.find((each) => each.override === override);
  const list = stretch.lists.find(({ id }) => id === held?.listId);
  // A paragraph can name a list its document does not define, which reads as no list at all.
  if (!list) return override;
  const found = document.listOverrides.find(({ listId }) => {
    const own = document.lists.find(({ id }) => id === listId)!;
    return same(listShapeOf(own), listShapeOf(list));
  });
  if (found) return found.override;
  const id = Math.max(0, ...document.lists.map((each) => each.id)) + 1;
  const added = Math.max(0, ...document.listOverrides.map((entry) => entry.override)) + 1;
  document.lists.push({ ...structuredClone(list), id, templateId: id });
  document.listOverrides.push({ listId: id, count: 0, override: added });
  return added;
}

function adopted(document: DocumentText, stretch: DocumentStretch, paragraph: Paragraph) {
  const { list } = paragraph.format;
  const copy = structuredClone(paragraph);
  copy.content = renumbered(document, stretch.styleIds, copy.content);
  if (list) {
    copy.format.list = { ...list, override: adoptList(document, stretch, list.override) };
  }
  return copy;
}

function openIn(document: DocumentText, { paragraph, character, heading }: OpenIds): Open {
  return {
    ...(paragraph === undefined ? {} : { paragraph: indexOfId(document, paragraph) }),
    ...(character === undefined ? {} : { character: indexOfId(document, character) }),
    ...(heading === undefined ? {} : { heading }),
  };
}

/** Puts a stretch in place of `count` paragraphs from `first`, leading into and out of it. */
export function putStretch(
  document: DocumentText,
  first: number,
  count: number,
  stretch: DocumentStretch,
): void {
  if (cutsTable(document, first) || cutsTable(document, first + count)) {
    throw new EditError('Part of a table cannot change, only all of it.');
  }
  if (cutsNote(document, first) || cutsNote(document, first + count)) {
    throw new EditError(NOTE_ACROSS);
  }
  if (document.source === '') document.settings = structuredClone(stretch.settings);
  const before = openAt(document, first);
  const after = openAt(document, first + count);
  const copied = stretch.paragraphs.map((paragraph) => adopted(document, stretch, paragraph));
  const last = copied.at(-1)!;
  const ended = first + count === document.paragraphs.length;
  document.paragraphs.splice(first, count, ...copied);
  const previous = document.paragraphs[first - 1];
  if (previous?.end.kind === 'document') previous.end = { ...previous.end, kind: 'paragraph' };
  const closing = ended ? 'document' : 'paragraph';
  if (ended || last.end.kind === 'document') last.end = { ...last.end, kind: closing };
  join(document, first, before, openIn(document, stretch.open), last.end.format);
  const at = first + copied.length;
  join(document, at, openIn(document, stretch.after), after, last.end.format);
  renumberLists(document, copied);
}
