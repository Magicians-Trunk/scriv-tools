/** Comparing two versions of a binder, by item ID, as data. */
import type { BinderItem } from './binder-item.ts';
import { matches } from './diff.ts';
import { adaptiveTitle, flatten, labelName, sectionTypeName, statusName } from './project.ts';
import type { Documents } from './document.ts';
import type { Project } from './project.ts';
import { same } from './rich-text.ts';
import { valueChanges } from './value-compare.ts';

/** One version of a project, as read: from its folder, or from a revision in git. */
export interface ProjectVersion {
  project: Project;
  documents: Documents;
}

/** Where an item is in a binder: its parent, none at the top, its place there, and its path. */
export interface ItemPlace {
  item: BinderItem;
  parent: string | undefined;
  index: number;
  /** The titles that lead to it, its own last. */
  path: string[];
}

/** Every item of a binder by ID, with where it is. */
export function binderPlaces({ project, documents }: ProjectVersion): Map<string, ItemPlace> {
  const places = new Map<string, ItemPlace>();
  const walk = (items: BinderItem[], parent: string | undefined, above: string[]) => {
    for (const [index, item] of items.entries()) {
      const path = [...above, adaptiveTitle(item, documents)];
      places.set(item.id, { item, parent, index, path });
      walk(item.children, item.id, path);
    }
  };
  walk(project.binder, undefined, []);
  return places;
}

/** What of an item a reader can see: no stamps, no selections, and nothing of how it was shown. */
export function itemFace(item: BinderItem) {
  const { metadata = { custom: {} }, keywords, bookmarks, type } = item;
  const { notesTextSelection: _selection, ...held } = metadata;
  return {
    type,
    title: item.title,
    groupMode: item.groupMode,
    binderSeparator: item.binderSeparator,
    metadata: held,
    keywords,
    bookmarks,
    defaultChildTemplateId: item.defaultChildTemplateId,
  };
}

/** A field of an item that changed, by what the project calls it and its values. */
export interface FieldChange {
  field: string;
  was: unknown;
  now: unknown;
}

/** What an item's fields read as: IDs as the project names them. */
function namedFields(project: Project, item: BinderItem) {
  const { title: _title, metadata, ...face } = itemFace(item);
  const { labelId: _label, statusId: _status, sectionType, custom, ...rest } = metadata;
  const titles = new Map(project.customFields.map(({ id, title }) => [id, title]));
  const keywords = flatten(project.keywords ?? []);
  return {
    ...face,
    ...rest,
    label: labelName(project, item),
    status: statusName(project, item),
    sectionType: sectionTypeName(project, sectionType?.id),
    keywords: item.keywords.map((id) => keywords.find((each) => each.id === id)?.title ?? id),
    ...Object.fromEntries(
      Object.entries(custom).map(([id, value]) => [titles.get(id) ?? id, value]),
    ),
  };
}

function fieldChanges(was: Project, a: BinderItem, now: Project, b: BinderItem): FieldChange[] {
  const { title: _a, ...before } = itemFace(a);
  const { title: _b, ...after } = itemFace(b);
  if (same(before, after)) return [];
  const changes = valueChanges(namedFields(was, a), namedFields(now, b));
  return changes.map(({ path, was: old, now: next }) => ({
    field: path.join('.'),
    was: old,
    now: next,
  }));
}

/** What became of a binder item. */
export type BinderChange = { id: string; title: string; path: string[] } & (
  | { kind: 'added' | 'removed' }
  /** `from` and `to` are paths to its parent; it went to the Trash when `trashed` says so. */
  | { kind: 'moved'; from: string[]; to: string[]; trashed: boolean }
  | { kind: 'renamed'; was: string }
  /** It changed its place among the same parent's items. */
  | { kind: 'reordered'; was: number; now: number }
  | { kind: 'changed'; fields: FieldChange[] }
);

/** The items that are in the same parent both times and changed their order among those. */
function reordered(was: Map<string, ItemPlace>, now: Map<string, ItemPlace>): Set<string> {
  const stayed = [...now].filter(([id, { parent }]) => {
    const before = was.get(id);
    return before && before.parent === parent;
  });
  const moved = new Set<string>();
  for (const [, group] of Map.groupBy(stayed, ([, { parent }]) => parent)) {
    const ids = group.map(([id]) => id);
    const after = ids.toSorted((a, b) => now.get(a)!.index - now.get(b)!.index);
    const before = ids.toSorted((a, b) => was.get(a)!.index - was.get(b)!.index);
    const kept = new Set<string>();
    for (const { a, length } of matches(before, after)) {
      before.slice(a, a + length).forEach((id) => kept.add(id));
    }
    for (const id of ids) if (!kept.has(id)) moved.add(id);
  }
  return moved;
}

/** Compares two versions' binders. */
export function compareBinders(was: ProjectVersion, now: ProjectVersion): BinderChange[] {
  const before = binderPlaces(was);
  const after = binderPlaces(now);
  const out = reordered(before, after);
  const trash = now.project.binder.find(({ type }) => type === 'TrashFolder');
  const inTrash = new Set(flatten(trash ? [trash] : []).map(({ id }) => id));
  const changes: BinderChange[] = [];
  for (const [id, { item, parent, index, path }] of after) {
    const title = path.at(-1)!;
    const named = { id, title, path };
    const old = before.get(id);
    if (!old) {
      changes.push({ ...named, kind: 'added' });
      continue;
    }
    if (old.parent !== parent) {
      const from = old.path.slice(0, -1);
      const to = path.slice(0, -1);
      changes.push({ ...named, kind: 'moved', from, to, trashed: inTrash.has(id) });
    }
    if (old.item.title !== item.title) {
      changes.push({ ...named, kind: 'renamed', was: old.path.at(-1)! });
    }
    if (out.has(id)) changes.push({ ...named, kind: 'reordered', was: old.index, now: index });
    const fields = fieldChanges(was.project, old.item, now.project, item);
    if (fields.length > 0) changes.push({ ...named, kind: 'changed', fields });
  }
  for (const [id, { path }] of before) {
    if (!after.has(id)) changes.push({ id, title: path.at(-1)!, path, kind: 'removed' });
  }
  return changes;
}
