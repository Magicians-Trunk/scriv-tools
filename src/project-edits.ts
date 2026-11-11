/**
 * The edits that turn one version of a project into another, and making them.  Binder edits go in
 * order, each on the binder as the last left it; a document's edits all name that document as it
 * was.  Settings and styles come first, so the documents' edits find the styles they name.
 */
import { type BinderItem, type ItemMetadata } from './binder-item.ts';
import { binderPlaces, itemFace, type ProjectVersion } from './binder-compare.ts';
import { type FoundFormat, formatIn } from './compile-format.ts';
import type { CompileXml } from './compile-xml.ts';
import { makeEdits, documentEdits } from './document-edits.ts';
import type { DocumentPart } from './document.ts';
import { EditError } from './edit-pieces.ts';
import type { DocumentEdit } from './editable.ts';
import {
  ownFormats,
  PROJECT_SETTINGS,
  projectSettings,
  sharedStyles,
  styleFace,
} from './project-compare.ts';
import { flatten, type Project } from './project.ts';
import type { ProjectStyle } from './project-styles.ts';
import { same } from './rich-text.ts';
import type { ItemDocumentsChange, ProjectChanges } from './save.ts';
import type { Scrivx } from './scrivx.ts';

/** The settings of the `.scrivx` file that are not its binder. */
export type ProjectSettings = Pick<Scrivx, (typeof PROJECT_SETTINGS)[number]>;

/** A change to a project.  `parent` is an item's ID, or none for the top of the binder. */
export type ProjectEdit =
  | { kind: 'add-item'; item: BinderItem; parent: string | undefined; index: number }
  | { kind: 'move-item'; item: string; parent: string | undefined; index: number }
  | { kind: 'remove-item'; item: string }
  /** An item's own fields; what is under it stays. */
  | { kind: 'set-item'; item: BinderItem }
  | { kind: 'document'; item: string; part: DocumentPart; edits: DocumentEdit[] }
  | { kind: 'synopsis'; item: string; text: string }
  | { kind: 'settings'; settings: ProjectSettings }
  | { kind: 'styles'; styles: ProjectStyle[] }
  | { kind: 'compile'; settings: CompileXml }
  | { kind: 'format'; format: FoundFormat }
  | { kind: 'remove-format'; format: FoundFormat };

const bare = (item: BinderItem): BinderItem => ({ ...item, children: [] });

/** The binder edits, in order, that make `now` of a copy of `was`, placing items from the top. */
function binderEdits(was: BinderItem[], now: BinderItem[]): ProjectEdit[] {
  const tree = structuredClone(was);
  const edits: ProjectEdit[] = [];
  const holder = (id: string) =>
    flatten(tree).find(({ children }) => children.some((c) => c.id === id));
  const arrange = (held: BinderItem[], wanted: BinderItem[], parent: string | undefined) => {
    for (const [index, child] of wanted.entries()) {
      if (held[index]?.id !== child.id) {
        const place = holder(child.id)?.children ?? tree;
        const at = place.findIndex(({ id }) => id === child.id);
        if (at >= 0) {
          held.splice(index, 0, ...place.splice(at, 1));
          edits.push({ kind: 'move-item', item: child.id, parent, index });
        } else {
          held.splice(index, 0, bare(child));
          edits.push({ kind: 'add-item', item: bare(child), parent, index });
        }
      }
      arrange(held[index]!.children, child.children, child.id);
    }
  };
  arrange(tree, now, undefined);
  const wanted = new Set(flatten(now).map(({ id }) => id));
  const prune = (items: BinderItem[]) => {
    for (const item of items) {
      if (wanted.has(item.id)) prune(item.children);
      else edits.push({ kind: 'remove-item', item: item.id });
    }
  };
  prune(tree);
  return edits;
}

function formatEdits(was: FoundFormat[], now: FoundFormat[]): ProjectEdit[] {
  const kept = new Set(now.map(({ name }) => name));
  const edits: ProjectEdit[] = was
    .filter(({ name }) => !kept.has(name))
    .map((format) => ({ kind: 'remove-format', format }));
  for (const format of now) {
    const old = was.find(({ name }) => name === format.name);
    if (!old || !same(old.model, format.model)) edits.push({ kind: 'format', format });
  }
  return edits;
}

/** The edits that turn one version of a project into another. */
export function projectEdits(was: ProjectVersion, now: ProjectVersion): ProjectEdit[] {
  const shared = sharedStyles(was.project, now.project);
  const edits: ProjectEdit[] = [];
  const settings = projectSettings(now.project);
  if (!same(projectSettings(was.project), settings)) {
    const { project } = now;
    edits.push({ kind: 'settings', settings: settingsOf(project) });
  }
  const faces = (project: Project) => project.styles.map((style) => styleFace(shared, style));
  if (!same(faces(was.project), faces(now.project))) {
    edits.push({ kind: 'styles', styles: now.project.styles });
  }
  const { compileSettings } = now.project;
  if (compileSettings && !same(was.project.compileSettings, compileSettings)) {
    edits.push({ kind: 'compile', settings: compileSettings });
  }
  edits.push(...formatEdits(ownFormats(was.project), ownFormats(now.project)));
  edits.push(...binderEdits(was.project.binder, now.project.binder));
  const before = binderPlaces(was);
  for (const [id, { item }] of binderPlaces(now)) {
    const old = before.get(id);
    if (old && !same(itemFace(old.item), itemFace(item))) {
      edits.push({ kind: 'set-item', item: bare(item) });
    }
    for (const part of ['content', 'notes'] as const) {
      const held = documentEdits(
        shared,
        was.documents.text(id, part),
        now.documents.text(id, part),
      );
      if (held.length > 0) edits.push({ kind: 'document', item: id, part, edits: held });
    }
    const text = now.documents.synopsis(id);
    if (was.documents.synopsis(id) !== text) edits.push({ kind: 'synopsis', item: id, text });
  }
  return edits;
}

function settingsOf(project: Project): ProjectSettings {
  const { collections, sectionTypes, labelSettings, statusSettings, customFields } = project;
  const { printSettings, keywords, projectBookmarks, templateFolderId } = project;
  const { bookmarksFolderId, autoComplete, externalSyncMap } = project;
  return {
    collections,
    sectionTypes,
    labelSettings,
    statusSettings,
    customFields,
    printSettings,
    ...(keywords ? { keywords } : {}),
    ...(projectBookmarks ? { projectBookmarks } : {}),
    ...(templateFolderId ? { templateFolderId } : {}),
    ...(bookmarksFolderId ? { bookmarksFolderId } : {}),
    ...(autoComplete ? { autoComplete } : {}),
    ...(externalSyncMap ? { externalSyncMap } : {}),
  };
}

/** The items under a parent, or at the top of the binder. */
function childrenOf(project: Project, parent: string | undefined): BinderItem[] {
  if (parent === undefined) return project.binder;
  const found = flatten(project.binder).find(({ id }) => id === parent);
  if (!found) throw new EditError(`The binder has no item ${parent}.`);
  return found.children;
}

/** Takes an item from where it is, and gives it back; none in the binder stops. */
function takeItem(project: Project, id: string): BinderItem {
  const list = [project.binder, ...flatten(project.binder).map(({ children }) => children)];
  const held = list.find((items) => items.some((each) => each.id === id));
  if (!held) throw new EditError(`The binder has no item ${id}.`);
  return held.splice(
    held.findIndex((each) => each.id === id),
    1,
  )[0]!;
}

/** Puts an item at a place, or last when the place has gone with what was left out. */
function putItem(project: Project, item: BinderItem, parent: string | undefined, index: number) {
  childrenOf(project, parent).splice(index, 0, item);
}

/** Sets an item's own fields, and stamps nothing: saving does that. */
function setItemFields(project: Project, item: BinderItem): void {
  const target = flatten(project.binder).find(({ id }) => id === item.id);
  if (!target) throw new EditError(`The binder has no item ${item.id}.`);
  const { children } = target;
  for (const key of ['title', 'groupMode', 'binderSeparator', 'defaultChildTemplateId'] as const) {
    delete target[key];
  }
  const metadata: ItemMetadata | undefined = item.metadata;
  Object.assign(target, item, { children });
  if (!metadata) delete target.metadata;
}

/** The documents as they stand with the edits made so far. */
function itemChange(changes: Map<string, ItemDocumentsChange>, item: string) {
  const held = changes.get(item) ?? {};
  changes.set(item, held);
  return held;
}

/**
 * Makes edits on a version of a project: the binder and settings change in its model, and the
 * documents and formats to save come back, as `saveProject` takes them.
 */
export function applyProjectEdits(
  { project, documents }: ProjectVersion,
  edits: readonly ProjectEdit[],
): ProjectChanges {
  const held = new Map<string, ItemDocumentsChange>();
  const formats: FoundFormat[] = [];
  const removedFormats: FoundFormat[] = [];
  for (const edit of edits) {
    switch (edit.kind) {
      case 'add-item':
        putItem(project, structuredClone(edit.item), edit.parent, edit.index);
        break;
      case 'move-item':
        putItem(project, takeItem(project, edit.item), edit.parent, edit.index);
        break;
      case 'remove-item':
        takeItem(project, edit.item);
        break;
      case 'set-item':
        setItemFields(project, edit.item);
        break;
      case 'document': {
        const change = itemChange(held, edit.item);
        const document = change[edit.part] ?? documents.text(edit.item, edit.part);
        makeEdits(project, document, edit.edits);
        change[edit.part] = document;
        break;
      }
      case 'synopsis':
        itemChange(held, edit.item).synopsis = edit.text;
        break;
      case 'settings':
        Object.assign(project, edit.settings);
        break;
      case 'styles':
        project.styles = edit.styles;
        break;
      case 'compile':
        project.compileSettings = edit.settings;
        break;
      case 'format':
        formats.push(formatIn(project, edit.format));
        break;
      default:
        removedFormats.push(formatIn(project, edit.format));
    }
  }
  return { documents: held, formats, removedFormats };
}
