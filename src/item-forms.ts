/**
 * Items' text in the forms a file holds it: each item's paragraphs as typed data, or as Markdown
 * through the Markdown form.  Both read the documents themselves, never a compile, and both come
 * back through `paragraphEdits`, so a change touches only what differs.  Beside its own words,
 * each item shows its compiled text, which is reference only: reading a form back refuses an
 * item whose compiled text changed, and never reads it as the item's text.
 */
import type { BinderItem } from './binder-item.ts';
import type { ReadParagraph } from './edit-pieces.ts';
import { readAgain } from './document.ts';
import { applyEdits, type EditingModel, type ItemEdit } from './editable.ts';
import { addMissingStyles } from './format-manage.ts';
import {
  compiledChange,
  compiledText,
  type CompiledText,
  type ItemCompiles,
} from './item-compile.ts';
import { readItemsMarkdown, writeItemsMarkdown } from './items-markdown.ts';
import { markdownParagraphs, paragraphBlocks } from './markdown-form.ts';
import { type Block, orStop, readMarkdown } from './markdown-tree.ts';
import { paragraphEdits, shownPiece, type WrittenParagraph } from './paragraph-edits.ts';
import { readParagraphs } from './edit-pieces.ts';
import { adaptiveTitle, flatten } from './project.ts';
import type { TextPlace } from './selector.ts';
import type { StyleRoles } from './style-mapping.ts';
import { plainText } from './text-compare.ts';

/** One item's paragraphs as a form holds them, and its compiled text, which is read only. */
export interface ItemParagraphs {
  item: string;
  title: string;
  paragraphs: WrittenParagraph[];
  compiled: CompiledText;
}

/** An item read to change: all its paragraphs, and the stretch of them a form shows. */
export interface ReadItem {
  item: string;
  title: string;
  read: ReadParagraph[];
  first: number;
  count: number;
}

/** The edits a changed form comes to, and what stops it.  With any problem, none is made. */
export interface FormEdits {
  edits: ItemEdit[];
  problems: string[];
}

/** An item a form refuses to take back, and why. */
export interface Refusal {
  item: string;
  reason: string;
}

/** The edits a form exported with compiled text comes to, and the items it refuses. */
export interface ImportEdits extends FormEdits {
  /** Items whose compiled text is not as written: none of their edits is made. */
  refused: Refusal[];
}

/** Paragraphs as a form shows them: bold and italic as looks, and no place in the document. */
export const shownParagraphs = (read: ReadParagraph[], roles: StyleRoles): WrittenParagraph[] =>
  read.map(({ paragraph: _place, ...paragraph }) => ({
    ...paragraph,
    text: paragraph.text.map((piece) => shownPiece(piece, roles)),
  }));

/** The stretch of an item's paragraphs from the first that a place holds to the last. */
function stretchOf(read: ReadParagraph[], item: string, places: TextPlace[] | undefined) {
  if (!places) return { first: 0, count: read.length };
  const held = (each: ReadParagraph) =>
    places.some(
      (place) =>
        place.item.id === item &&
        place.first <= each.paragraph &&
        each.paragraph < place.first + place.count,
    );
  const tables = new Set(read.filter(held).flatMap(({ cell }) => (cell ? [cell.table] : [])));
  const shown = (each: ReadParagraph) => held(each) || (each.cell && tables.has(each.cell.table));
  const first = read.findIndex(shown);
  return first === -1
    ? { first: 0, count: 0 }
    : { first, count: read.findLastIndex(shown) + 1 - first };
}

/**
 * Reads items, with the items under them, to change; given places, only the stretch from the
 * first paragraph they hold to the last, and all of any table they reach into, so that what is
 * not read is not changed.
 */
export function readItems(
  { project, documents }: EditingModel,
  items: BinderItem[],
  places?: TextPlace[],
): ReadItem[] {
  return flatten(items).map((item) => {
    const read = readParagraphs(project, documents.text(item.id), { placeholders: true });
    return {
      item: item.id,
      title: adaptiveTitle(item, documents),
      read,
      ...stretchOf(read, item.id, places),
    };
  });
}

/** The paragraphs of an item a form shows. */
const shownOf = ({ read, first, count }: ReadItem, roles: StyleRoles) =>
  shownParagraphs(read.slice(first, first + count), roles);

/** Items as the structured form holds them, each with its compiled text. */
export const structuredItems = (
  items: ReadItem[],
  roles: StyleRoles,
  compiles: ItemCompiles,
): ItemParagraphs[] =>
  items.map((each) => ({
    item: each.item,
    title: each.title,
    paragraphs: shownOf(each, roles),
    compiled: compiledText(compiles, each.item),
  }));

/**
 * Items as Markdown, each after the comment that says whose text follows, and before its
 * compiled block.
 */
export const markdownItems = (
  items: ReadItem[],
  roles: StyleRoles,
  compiles: ItemCompiles,
): string =>
  writeItemsMarkdown(
    items.map((each) => ({
      item: each.item,
      blocks: paragraphBlocks(shownOf(each, roles), roles),
      compiled: compiledText(compiles, each.item),
    })),
  );

/** The styles paragraphs name, their characters' too. */
const stylesNamed = (paragraphs: WrittenParagraph[]) =>
  paragraphs.flatMap(({ style, text }) => [
    ...(style === undefined ? [] : [style]),
    ...text.flatMap((piece) => (piece.style === undefined ? [] : [piece.style])),
  ]);

/** A paragraph's words, or none. */
const words = (paragraph: WrittenParagraph | undefined) => plainText(paragraph?.text ?? []);

/** Where two lists of paragraphs first differ in their text, and what the first one says there. */
function misread(back: ReadParagraph[], asked: WrittenParagraph[]): string {
  const length = Math.max(back.length, asked.length);
  const at = Array.from({ length }, (_, index) => index).find(
    (index) => words(back[index]) !== words(asked[index]),
  );
  if (at === undefined) return 'its words would be right, but not their styles.';
  return `paragraph ${at + 1} would read "${words(back[at])}", not what the file says.`;
}

/**
 * The items whose edits, once made and their files read again, would not hold the paragraphs
 * asked for.  Each is refused, so an import never quietly writes other text than its file says.
 */
export function unwritten(
  model: EditingModel,
  edits: ItemEdit[],
  asked: { item: string; paragraphs: WrittenParagraph[] }[],
  roles: StyleRoles,
): Refusal[] {
  const made = applyEdits(model.project, model.documents, edits);
  return asked.flatMap(({ item, paragraphs }): Refusal[] => {
    const change = made.get(item);
    if (!change) return [];
    const back = readParagraphs(model.project, readAgain(change.content), { placeholders: true });
    if (paragraphEdits(item, back, paragraphs, roles).length === 0) return [];
    return [
      {
        item,
        reason: `Writing it would not give what the file says: ${misread(back, paragraphs)}`,
      },
    ];
  });
}

/**
 * The edits that give each item the paragraphs a form now holds for it, in place of the stretch
 * it showed, adding any style a role needs.  An item the form does not name stays as it is.  An
 * item its edits would not give those paragraphs is refused, and nothing is made for it.
 */
export function itemEdits(
  model: EditingModel,
  items: ReadItem[],
  changed: { item: string; paragraphs: WrittenParagraph[] }[],
  roles: StyleRoles,
): ImportEdits {
  const byId = new Map(items.map((each) => [each.item, each]));
  const unknown = changed.filter(({ item }) => !byId.has(item)).map(({ item }) => item);
  if (unknown.length > 0) {
    return {
      edits: [],
      problems: [`The file names items that were not read: ${unknown.join(', ')}`],
      refused: [],
    };
  }
  const asked = changed.map(({ item, paragraphs }) => {
    const { read, first, count } = byId.get(item)!;
    const whole = [
      ...shownParagraphs(read.slice(0, first), roles),
      ...paragraphs,
      ...shownParagraphs(read.slice(first + count), roles),
    ];
    return { item, paragraphs: whole };
  });
  const edits = asked.flatMap(({ item, paragraphs }) =>
    paragraphEdits(item, byId.get(item)!.read, paragraphs, roles),
  );
  if (edits.length === 0) return { edits, problems: [], refused: [] };
  const { styles } = model.project;
  const held = [...styles];
  const named = (list: typeof changed) => stylesNamed(list.flatMap(({ paragraphs }) => paragraphs));
  addMissingStyles(model.project, named(changed), roles);
  const refused = unwritten(model, edits, asked, roles);
  if (refused.length === 0) return { edits, problems: [], refused };
  styles.splice(0, styles.length, ...held);
  addMissingStyles(model.project, named(taken(changed, refused)), roles);
  return { edits: taken(edits, refused), problems: [], refused };
}

/** An item's Markdown, read as blocks. */
export interface ItemBlocks {
  item: string;
  blocks: Block[];
}

/** The edits each item's Markdown comes to. */
export function blockEdits(
  model: EditingModel,
  items: ReadItem[],
  groups: ItemBlocks[],
  roles: StyleRoles,
): ImportEdits {
  const byId = new Map(items.map((each) => [each.item, each]));
  const changed = groups.map(({ item, blocks }) => {
    const read = byId.get(item);
    const before = read ? shownOf(read, roles) : [];
    return { item, paragraphs: markdownParagraphs(blocks, before, roles) };
  });
  return itemEdits(model, items, changed, roles);
}

/** Markdown read as blocks, with what stops it being read: none when it reads. */
export function markdownBlocks(markdown: string): { blocks: Block[]; problems: string[] } {
  const read: { blocks: Block[]; problems: string[] } = { blocks: [], problems: [] };
  orStop(
    () => {
      read.blocks = readMarkdown(markdown);
    },
    (problem) => read.problems.push(problem),
  );
  return read;
}

/** Each item's refusal, when its compiled text is not as written. */
const refusals = (read: { item: string; compiled?: CompiledText; broken?: string }[]) =>
  read.flatMap(({ item, compiled, broken }): Refusal[] => {
    const reason = broken ?? compiledChange(compiled);
    return reason === undefined ? [] : [{ item, reason }];
  });

/** What a form holds for the items it does not refuse. */
function taken<T extends { item: string }>(read: T[], refused: Refusal[]): T[] {
  const ids = new Set(refused.map(({ item }) => item));
  return read.filter(({ item }) => !ids.has(item));
}

/**
 * The edits a structured form exported with compiled text comes to, item by item, refusing any
 * item whose compiled text changed.
 */
export function structuredEdits(
  model: EditingModel,
  items: ReadItem[],
  structured: ItemParagraphs[],
  roles: StyleRoles,
): ImportEdits {
  const refused = refusals(structured);
  const made = itemEdits(model, items, taken(structured, refused), roles);
  return { ...made, refused: [...refused, ...made.refused] };
}

/**
 * The edits a Markdown form exported with compiled text comes to, item by item, refusing any
 * item whose compiled block changed.
 */
export function markdownEdits(
  model: EditingModel,
  items: ReadItem[],
  markdown: string,
  roles: StyleRoles,
): ImportEdits {
  let read: ReturnType<typeof readItemsMarkdown> = [];
  const problems: string[] = [];
  orStop(
    () => {
      read = readItemsMarkdown(markdown);
    },
    (problem) => problems.push(problem),
  );
  if (problems.length > 0) return { edits: [], problems, refused: [] };
  const refused = refusals(read);
  const made = blockEdits(model, items, taken(read, refused), roles);
  return { ...made, refused: [...refused, ...made.refused] };
}
