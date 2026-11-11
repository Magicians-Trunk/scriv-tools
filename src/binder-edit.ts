/** Typed edits on the binder.  They change the project's model; `saveProject` writes it. */
import {
  type BinderItem,
  type BinderItemType,
  type ItemMetadata,
  newBinderItem,
} from './binder-item.ts';
import type { Documents, DocumentText } from './document.ts';
import { EditError, readParagraphs } from './edit-pieces.ts';
import { editDocument } from './editable.ts';
import { paragraphEdits, retypedParagraphs } from './paragraph-edits.ts';
import type { ItemDocumentsChange } from './save.ts';
import { plainText } from './text-compare.ts';
import { flatten, type Project } from './project.ts';

/** Where an item goes: under `parent`, at `index` among its children, or last. */
export interface BinderPlace {
  parent: BinderItem;
  index?: number;
}

type Binder = Pick<Project, 'binder'>;

/** Where an item goes beside another. */
export type BinderZone = 'before' | 'after' | 'into';

/** What the binder's rules read of an item: the model's, or the structure reported of it. */
interface BinderNode<T> {
  title?: string;
  type: BinderItemType;
  children: T[];
}

const parentOf = <T extends BinderNode<T>>(binder: T[], item: T) =>
  flatten(binder).find(({ children }) => children.includes(item));

/** The item a zone of `target` puts things under: none beside what sits at the top. */
const parentAt = <T extends BinderNode<T>>(binder: T[], target: T, zone: BinderZone) =>
  zone === 'into' ? target : parentOf(binder, target);

/** The place beside or under an item, with `moving` first taken out of what is counted. */
export function placeAt(
  project: Binder,
  target: BinderItem,
  zone: BinderZone,
  moving?: BinderItem,
): BinderPlace {
  const parent = parentAt(project.binder, target, zone);
  if (!parent) throw new EditError(`Nothing goes beside "${target.title}".`);
  if (zone === 'into') return { parent };
  const siblings = parent.children.filter((child) => child !== moving);
  return { parent, index: siblings.indexOf(target) + (zone === 'after' ? 1 : 0) };
}

/** Puts an item at a place.  A place past the end of the children stops. */
function place(item: BinderItem, { parent, index }: BinderPlace): void {
  const at = index ?? parent.children.length;
  if (at < 0 || at > parent.children.length) {
    throw new EditError(`"${parent.title}" has no place ${at} among its items.`);
  }
  parent.children.splice(at, 0, item);
}

/** Adds a new text or folder at a place, and gives it back. */
export function addItem(
  type: 'Text' | 'Folder',
  title: string | undefined,
  where: BinderPlace,
  now = new Date(),
): BinderItem {
  const item = newBinderItem(type, title, now);
  place(item, where);
  return item;
}

/** Adds a new text at the top of the binder, above the Draft, and gives it back. */
export function addTopItem(project: Binder, title: string, now = new Date()): BinderItem {
  const item = newBinderItem('Text', title, now);
  project.binder.unshift(item);
  return item;
}

/** The list an item is in: its parent's, or the binder's for what sits at the top beside the Draft. */
function siblingsOf<T extends BinderNode<T>>(binder: T[], item: T): T[] | undefined {
  const parent = parentOf(binder, item);
  if (parent) return parent.children;
  return item.type === 'Text' || item.type === 'Folder' ? binder : undefined;
}

/** Why an item cannot go under a parent: never inside itself, and the binder's folders stay. */
function moveRefused<T extends BinderNode<T>>(binder: T[], item: T, parent: T): string | undefined {
  if (flatten([item]).includes(parent)) return `"${item.title}" cannot move inside itself.`;
  return siblingsOf(binder, item) ? undefined : `"${item.title}" cannot be moved.`;
}

/** Whether an item can be dropped beside or under another, in the binder or its structure. */
export function canDrop<T extends BinderNode<T>>(
  binder: T[],
  item: T,
  target: T,
  zone: BinderZone,
): boolean {
  const parent = parentAt(binder, target, zone);
  return target !== item && parent !== undefined && !moveRefused(binder, item, parent);
}

/** Moves an item, with the items under it, to a place that is not inside it. */
export function moveItem(project: Binder, item: BinderItem, where: BinderPlace): void {
  const refused = moveRefused(project.binder, item, where.parent);
  if (refused !== undefined) throw new EditError(refused);
  const siblings = siblingsOf(project.binder, item)!;
  siblings.splice(siblings.indexOf(item), 1);
  place(item, where);
}

/** Moves an item to the project's Trash, as Scrivener does: it stays there until emptied. */
export function trashItem(project: Binder, item: BinderItem): void {
  const trash = project.binder.find(({ type }) => type === 'TrashFolder');
  if (!trash) throw new EditError('The project has no Trash folder.');
  moveItem(project, item, { parent: trash });
}

/** What can change of an item.  Left out stays; a label, status or section of `''` clears it. */
export interface ItemChange {
  title?: string;
  label?: string;
  status?: string;
  section?: string;
  include?: boolean;
}

/** The ID a name has among a project's labels, statuses or section types.  None stops. */
function idOf(kind: string, entries: { id: string; name: string }[], name: string): string {
  const found = entries.find((entry) => entry.name === name);
  if (!found) throw new EditError(`The project has no ${kind} "${name}".`);
  return found.id;
}

/** An item's metadata with one ID set from its name, or cleared given `''`. */
function withId(
  metadata: ItemMetadata,
  key: 'labelId' | 'statusId',
  id: () => string,
  name: string | undefined,
): ItemMetadata {
  if (name === undefined) return metadata;
  const { [key]: _, ...rest } = metadata;
  return name === '' ? rest : { ...rest, [key]: id() };
}

/** Changes an item's title and metadata by name, as the project's own lists hold them. */
export function setItem(
  project: Pick<Project, 'labelSettings' | 'statusSettings' | 'sectionTypes'>,
  item: BinderItem,
  { title, label, status, section, include }: ItemChange,
): void {
  const { labels } = project.labelSettings;
  const { statuses } = project.statusSettings;
  const { definitions } = project.sectionTypes;
  // With no title of its own, an item goes by its synopsis or its text.
  if (title === '') delete item.title;
  else if (title !== undefined) item.title = title;
  let metadata: ItemMetadata = { custom: {}, ...item.metadata };
  metadata = withId(metadata, 'labelId', () => idOf('label', labels, label!), label);
  metadata = withId(metadata, 'statusId', () => idOf('status', statuses, status!), status);
  if (section !== undefined) {
    const id = section === '' ? '' : idOf('section type', definitions, section);
    metadata = { ...metadata, sectionType: { ...metadata.sectionType, id } };
  }
  if (include !== undefined) metadata = { ...metadata, includeInCompile: include };
  item.metadata = metadata;
}

/** What can change of an item, its documents and custom fields as well. */
export interface ItemDetailsChange extends ItemChange {
  synopsis?: string;
  notes?: string;
  /** Custom fields by ID; `''` clears one. */
  custom?: Record<string, string>;
}

/** Changes an item, and gives back what to save of its documents. */
export function changeItem(
  project: Project,
  documents: Documents,
  item: BinderItem,
  { synopsis, notes, custom, ...change }: ItemDetailsChange,
): ItemDocumentsChange {
  setItem(project, item, change);
  for (const [field, value] of Object.entries(custom ?? {})) {
    setCustomField(project, item, field, value === '' ? undefined : value);
  }
  return {
    ...(synopsis === undefined ? {} : { synopsis }),
    ...(notes === undefined ? {} : { notes: replaceNotes(project, documents, item, notes) }),
  };
}

/** An item's notes as plain text, a paragraph to a line. */
export function readNotes(project: Project, documents: Pick<Documents, 'text'>, id: string) {
  const notes = readParagraphs(project, documents.text(id, 'notes'));
  return notes.map(({ text }) => plainText(text)).join('\n');
}

/**
 * An item's notes changed to new text, a paragraph to a line, to save as its `notes`.  They are
 * rich text: only what the lines change is edited, so the rest keeps its formatting.
 */
export function replaceNotes(
  project: Pick<Project, 'binder' | 'dir' | 'styles' | 'files'>,
  documents: Pick<Documents, 'text'>,
  item: BinderItem,
  text: string,
): DocumentText {
  const notes = documents.text(item.id, 'notes');
  const before = readParagraphs(project, notes);
  const after = retypedParagraphs(before, text === '' ? [] : text.split('\n'));
  const edits = paragraphEdits(item.id, before, after).map(({ edit }) => edit);
  editDocument(project, documents, item.id, notes, edits);
  return notes;
}

/** Sets a custom metadata field the project has, or clears it given nothing. */
export function setCustomField(
  { customFields }: Pick<Project, 'customFields'>,
  item: BinderItem,
  field: string,
  value: string | undefined,
): void {
  if (!customFields.some(({ id }) => id === field)) {
    throw new EditError(`The project has no custom field "${field}".`);
  }
  const custom = { ...item.metadata?.custom };
  if (value === undefined) delete custom[field];
  else custom[field] = value;
  item.metadata = { ...item.metadata, custom };
}
