/**
 * Reading items to change them, and making the change.  A read gives the same text in two forms:
 * structured, as the documents hold it, and Markdown, written from a tree of their own words.
 * `mapStructured` and `mapEdits` turn a change to either into typed edits.  Editing reads no
 * compile format: the stylesheet decides what each style means.
 */
import type { BinderItem } from './binder-item.ts';
import { type Comment, type Documents, type DocumentText, projectDocuments } from './document.ts';
import { type BuiltBlock, buildBlocks } from './built-blocks.ts';
import { insertParagraphs, removeParagraphs, setParagraphStyle } from './edit.ts';
import type { ListShape } from './edit-lists.ts';
import { type DocumentStretch, putStretch } from './edit-stretch.ts';
import { shapeTable, type TableShape } from './edit-tables.ts';
import {
  type Inline,
  type NewParagraph,
  plainNeighbour,
  type ReadParagraph,
  readParagraphs,
  type Styles,
} from './edit-pieces.ts';
import { changeLook, type LookChange, styleRange } from './edit-styles.ts';
import { replaceInlines, replaceNoteText, replaceRange } from './edit-text.ts';
import { mapEdits } from './map-markdown.ts';
import { itemComment, writeMarkdown } from './markdown-tree.ts';
import type { ScrivenerModel } from './model.ts';
import { type PlainLook, plainLook } from './plain-look.ts';
import { adaptiveTitle, flatten, openProject, type Project } from './project.ts';
import { type StyleMapping, styleMapping } from './style-mapping.ts';
import type { TextPlace } from './selector.ts';

/** Items in both forms, with the blocks the Markdown was written from. */
export interface Editable {
  structured: EditableDocument[];
  markdown: string;
  blocks: BuiltBlock[];
  mapping: StyleMapping;
}

/** A project to edit: its project and documents, and no compile format. */
export type EditingModel = Pick<ScrivenerModel, 'project' | 'documents'>;

/** Reads a project to edit. */
export function readForEditing(input: string | Project): EditingModel {
  const project = typeof input === 'string' ? openProject(input) : input;
  return { project, documents: projectDocuments(project.dir, project.files) };
}

/** The paragraphs a read holds: those in its places, and all of any table they reach into. */
function within(paragraphs: ReadParagraph[], item: string, places: TextPlace[]) {
  const held = paragraphs.filter(({ paragraph }) =>
    places.some((place) => holds(place, item, paragraph)),
  );
  const tables = new Set(held.flatMap(({ cell }) => (cell ? [cell.table] : [])));
  return paragraphs.filter(
    (read) => held.includes(read) || (read.cell && tables.has(read.cell.table)),
  );
}

/** An item's text, structured. */
export interface EditableDocument {
  item: string;
  title: string;
  paragraphs: ReadParagraph[];
}

/** A change to one document's paragraphs. */
export type DocumentEdit =
  | { kind: 'replace'; paragraph: number; start: number; end: number; text: string | Inline[] }
  | { kind: 'insert'; at: number; paragraphs: NewParagraph[] }
  | { kind: 'inlines'; paragraph: number; first: number; count: number; text: Inline[] }
  | { kind: 'note'; paragraph: number; piece: number; text: string }
  | { kind: 'remove'; first: number; count: number }
  /** A table of `count` paragraphs given this shape; with none, a new table at `first`. */
  | { kind: 'table'; first: number; count: number; rows: TableShape }
  | { kind: 'style'; paragraph: number; style?: string; list?: ListShape | null; level?: number }
  | {
      kind: 'character';
      paragraph: number;
      start: number;
      end: number;
      /** Which piece, when the stretch is in a note, by offsets into the note's text. */
      piece?: number;
      style?: string;
    }
  | ({ kind: 'look'; paragraph: number } & LookChange)
  /** Puts paragraphs, exactly as a stretch holds them, in place of `count` from `first`. */
  | { kind: 'paragraphs'; first: number; count: number; stretch: DocumentStretch }
  /** Adds or changes a linked comment, or with none given, removes it. */
  | { kind: 'comment'; id: string; comment?: Comment };

export interface ItemEdit {
  item: string;
  edit: DocumentEdit;
}

/** The edits a change comes to, and what stops it.  With any problem, nothing should be made. */
export interface MappedEdits {
  edits: ItemEdit[];
  problems: string[];
}

/** Whether a place holds a paragraph of an item. */
const holds = ({ item, first, count }: TextPlace, id: string, paragraph: number) =>
  item.id === id && first <= paragraph && paragraph < first + count;

/**
 * Reads items, with the items under them, in both forms; given `within`, only those paragraphs,
 * so that what is not read is not changed.
 */
export function readEditable(
  { project, documents }: EditingModel,
  items: BinderItem[],
  { mapping = styleMapping(project) }: { mapping?: StyleMapping } = {},
  places?: TextPlace[],
): Editable {
  const structured = flatten(items).map((item) => {
    const paragraphs = readParagraphs(project, documents.text(item.id));
    return {
      item: item.id,
      title: adaptiveTitle(item, documents),
      paragraphs: places ? within(paragraphs, item.id, places) : paragraphs,
    };
  });
  const blocks = buildBlocks(structured, mapping);
  return { structured, markdown: writeMarkdown(blocks), blocks, mapping };
}

/** The opening of one item's Markdown, which its reader never sees. */
const itemOpening = (item: string) => `${itemComment(item)}\n\n`;

/** One item's Markdown, without the comment that says whose it is. */
export const itemMarkdown = ({ markdown }: Editable, item: string) =>
  markdown.slice(itemOpening(item).length);

/** The edits a change to one item's Markdown comes to. */
export const mapItemMarkdown = (editable: Editable, item: string, markdown: string) =>
  mapEdits(editable, `${itemOpening(item)}${markdown}`, editable.mapping);

/** Edits with paragraphs removed one after another made one removal: a table goes all at once. */
export function joinRemovals(edits: ItemEdit[]): ItemEdit[] {
  const joined: ItemEdit[] = [];
  for (const each of edits) {
    const last = joined.at(-1);
    const { edit } = each;
    if (
      last?.item === each.item &&
      last.edit.kind === 'remove' &&
      edit.kind === 'remove' &&
      last.edit.first + last.edit.count === edit.first
    ) {
      last.edit = { ...last.edit, count: last.edit.count + edit.count };
    } else joined.push({ ...each });
  }
  return joined;
}

/** What making edits reads of the project. */
type Editing = Pick<Project, 'styles' | 'binder' | 'dir' | 'files'>;

/** Where an edit acts, so edits can be made from the end of a document, and insert after others. */
function position(edit: DocumentEdit): number {
  if (edit.kind === 'comment') return -1;
  if (edit.kind === 'insert') return edit.at * 2;
  if (edit.kind === 'table' || edit.kind === 'paragraphs') {
    return edit.first * 2 + (edit.count > 0 ? 1 : 0);
  }
  return (edit.kind === 'remove' ? edit.first : edit.paragraph) * 2 + 1;
}

/** An edit to a stretch of a paragraph's text. */
type RangeEdit = Extract<DocumentEdit, { start: number }>;

/** A stretch of a note goes by the note's text, so it moves nothing in the paragraph's. */
const isRange = (edit: DocumentEdit): edit is RangeEdit =>
  'start' in edit && !(edit.kind === 'character' && edit.piece !== undefined);

/**
 * Edits in the order that makes them, all of whose places are in the document as it stands before
 * any is made: from the end of the document back, and within a paragraph, from the end of its
 * text back, so no edit moves what a later one names.  Other edits in a paragraph keep their turn.
 */
export function inMakingOrder(edits: readonly DocumentEdit[]): DocumentEdit[] {
  const sorted = edits.toSorted((a, b) => position(b) - position(a));
  const ranges = Map.groupBy(sorted.filter(isRange), ({ paragraph }) => paragraph);
  for (const held of ranges.values()) held.sort((a, b) => b.start - a.start);
  return sorted.map((edit) => (isRange(edit) ? ranges.get(edit.paragraph)!.shift()! : edit));
}

/** Makes one edit in a document. */
export function makeEdit(
  project: Styles,
  edit: DocumentEdit,
  document: DocumentText,
  plain?: PlainLook,
): void {
  switch (edit.kind) {
    case 'replace':
      return replaceRange(project, document, edit.paragraph, edit, edit.text, plain);
    case 'inlines':
      return replaceInlines(
        project,
        document,
        edit.paragraph,
        edit.first,
        edit.count,
        edit.text,
        plain,
      );
    case 'note':
      return replaceNoteText(project, document, edit.paragraph, edit.piece, edit.text);
    case 'insert':
      return insertParagraphs(project, document, edit.at, edit.paragraphs, plain);
    case 'remove':
      return removeParagraphs(document, edit.first, edit.count);
    case 'table':
      return shapeTable(project, document, edit.first, edit.count, edit.rows, plain);
    case 'character':
      return styleRange(project, document, edit.paragraph, edit, edit.style, plain);
    case 'look':
      return changeLook(document, edit.paragraph, edit);
    case 'paragraphs':
      return putStretch(document, edit.first, edit.count, edit.stretch);
    case 'comment': {
      const others = document.comments.filter(({ id }) => id !== edit.id);
      document.comments = edit.comment ? [...others, edit.comment] : others;
      return;
    }
    default:
      return setParagraphStyle(
        project,
        document,
        edit.paragraph,
        edit.style,
        edit.list,
        edit.level,
      );
  }
}

/** Makes a document's edits, in their making order. */
export function editDocument(
  project: Editing,
  documents: Pick<Documents, 'text'>,
  item: string,
  document: DocumentText,
  edits: readonly DocumentEdit[],
): void {
  for (const edit of inMakingOrder(edits)) {
    const plain = plainNeighbour(document, 0) ? undefined : plainLook(project, documents, item);
    makeEdit(project, edit, document, plain);
  }
}

/** Makes the edits, and gives the documents changed, as `saveProject` takes them. */
export function applyEdits(
  project: Editing,
  documents: Pick<Documents, 'text'>,
  edits: ItemEdit[],
): Map<string, { content: DocumentText }> {
  const changed = new Map<string, { content: DocumentText }>();
  for (const [item, held] of Map.groupBy(edits, (each) => each.item)) {
    const content = documents.text(item);
    changed.set(item, { content });
    editDocument(
      project,
      documents,
      item,
      content,
      held.map((each) => each.edit),
    );
  }
  return changed;
}
