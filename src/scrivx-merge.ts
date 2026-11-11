/**
 * A three-way merge of the `.scrivx` file on its model.  Every save stamps the file, so a text merge
 * conflicts on line 2 whatever else changed; here stamps take the later side and never conflict.
 * Items merge by ID: each field alone, each item's parent alone, each parent's order alone.
 */
import type { BinderItem, ItemMetadata } from './binder-item.ts';
import { itemFace } from './binder-compare.ts';
import { stampTime } from './dates.ts';
import { same } from './rich-text.ts';
import { type Scrivx, scrivxFile, writeScrivx } from './scrivx.ts';
import {
  mergeFields,
  mergeKeyed,
  mergeOrder,
  pick,
  pickQuietly,
  type ValueConflict,
} from './value-compare.ts';
import { newUnread } from './xml-codec.ts';
import { parseXml } from './xml.ts';

/** Why an item could not be merged. */
export interface BinderConflict {
  kind: 'binder';
  item: string;
  title: string | undefined;
  /** One side removed what the other changed; both moved it; or one moved it inside the other. */
  reason: 'removed' | 'moved' | 'loop' | 'order';
}

export type ScrivxConflict = ValueConflict | BinderConflict;

/** Which of two stamps is later: ours when they are one moment. */
const later = (ours: string, theirs: string) =>
  stampTime(theirs) > stampTime(ours) ? theirs : ours;

const ITEM_FIELDS = [
  'type',
  'title',
  'groupMode',
  'binderSeparator',
  'keywords',
  'bookmarks',
  'defaultChildTemplateId',
] as const satisfies readonly (keyof BinderItem)[];

const META_FIELDS = [
  'sectionType',
  'labelId',
  'statusId',
  'includeInCompile',
  'iconFileName',
  'fileExtension',
] as const satisfies readonly (keyof ItemMetadata)[];

/** Custom fields merged one by one. */
function mergeCustom(
  base: Record<string, string>,
  ours: Record<string, string>,
  theirs: Record<string, string>,
  path: (string | number)[],
  conflicts: ValueConflict[],
) {
  const merged: Record<string, string> = {};
  for (const field of new Set(Object.keys({ ...base, ...ours, ...theirs }))) {
    const value = pick(base[field], ours[field], theirs[field], [...path, field], conflicts);
    if (value !== undefined) merged[field] = value;
  }
  return merged;
}

function mergeMetadata(
  base: ItemMetadata = { custom: {} },
  ours: ItemMetadata = { custom: {} },
  theirs: ItemMetadata = { custom: {} },
  path: (string | number)[],
  conflicts: ValueConflict[],
): ItemMetadata {
  const merged = mergeFields(base, ours, theirs, META_FIELDS, path, conflicts);
  const { notesTextSelection: was } = base;
  const selection = pickQuietly(was, ours.notesTextSelection, theirs.notesTextSelection);
  return {
    ...merged,
    custom: mergeCustom(base.custom, ours.custom, theirs.custom, [...path, 'custom'], conflicts),
    ...(selection ? { notesTextSelection: selection } : {}),
  };
}

/** An item's own fields; what is under it is merged apart. */
function mergeItem(
  base: BinderItem,
  ours: BinderItem,
  theirs: BinderItem,
  conflicts: ValueConflict[],
): BinderItem {
  const path = ['binder', ours.id];
  const merged = mergeFields(base, ours, theirs, ITEM_FIELDS, path, conflicts);
  const { textSettings, corkboardAndOutliner } = base;
  const text = pickQuietly(textSettings, ours.textSettings, theirs.textSettings);
  const board = pickQuietly(
    corkboardAndOutliner,
    ours.corkboardAndOutliner,
    theirs.corkboardAndOutliner,
  );
  const { textSettings: _text, corkboardAndOutliner: _board, ...rest } = merged;
  const held = [base.metadata, ours.metadata, theirs.metadata] as const;
  const metadata = held.some(Boolean) && mergeMetadata(...held, [...path, 'metadata'], conflicts);
  return {
    ...rest,
    modified: later(ours.modified, theirs.modified),
    ...(text ? { textSettings: text } : {}),
    ...(board ? { corkboardAndOutliner: board } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/** Each item of a binder by ID, with its parent's. */
function parents(binder: BinderItem[]) {
  const found = new Map<string, { item: BinderItem; parent: string | undefined }>();
  const walk = (items: BinderItem[], parent: string | undefined) => {
    for (const item of items) {
      found.set(item.id, { item, parent });
      walk(item.children, item.id);
    }
  };
  walk(binder, undefined);
  return found;
}

/** Whether an item is as it was, there and in its parent. */
function untouched(
  base: { item: BinderItem; parent: string | undefined },
  side: { item: BinderItem; parent: string | undefined },
) {
  return base.parent === side.parent && same(itemFace(base.item), itemFace(side.item));
}

/** What the merge keeps of an item, each side's. */
function keepsItem(
  id: string,
  base: ReturnType<typeof parents>,
  ours: ReturnType<typeof parents>,
  theirs: ReturnType<typeof parents>,
  conflicts: ScrivxConflict[],
): boolean {
  const [was, mine, other] = [base.get(id), ours.get(id), theirs.get(id)];
  if (!was || (mine && other)) return true;
  const left = mine ?? other;
  if (!left) return false;
  if (untouched(was, left)) return false;
  conflicts.push({ kind: 'binder', item: id, title: left.item.title, reason: 'removed' });
  return true;
}

/** A place in the merged binder where a loop would start: following parents comes back to `id`. */
function loops(id: string, chosen: Map<string, string | undefined>): boolean {
  const seen = new Set<string>();
  let at = chosen.get(id);
  while (at !== undefined && !seen.has(at)) {
    if (at === id) return true;
    seen.add(at);
    at = chosen.get(at);
  }
  return false;
}

/** The merged binder, each item in the place and order its sides agree on. */
function mergeBinder(
  base: BinderItem[],
  ours: BinderItem[],
  theirs: BinderItem[],
  conflicts: ScrivxConflict[],
  values: ValueConflict[],
): BinderItem[] {
  const [was, mine, other] = [parents(base), parents(ours), parents(theirs)];
  const ids = new Set([...mine.keys(), ...other.keys(), ...was.keys()]);
  const kept = new Set([...ids].filter((id) => keepsItem(id, was, mine, other, conflicts)));
  const chosen = new Map<string, string | undefined>();
  for (const id of kept) {
    const a = mine.get(id);
    const b = other.get(id);
    const held = was.get(id);
    if (
      a &&
      b &&
      held &&
      a.parent !== b.parent &&
      held.parent !== a.parent &&
      held.parent !== b.parent
    ) {
      conflicts.push({ kind: 'binder', item: id, title: a.item.title, reason: 'moved' });
    }
    const side = a ?? b!;
    const moved = a && b && held && held.parent === a.parent ? b.parent : side.parent;
    chosen.set(id, moved);
  }
  for (const id of kept) {
    if (loops(id, chosen)) {
      const { item, parent } = mine.get(id)!;
      conflicts.push({ kind: 'binder', item: id, title: item.title, reason: 'loop' });
      chosen.set(id, parent);
    }
  }
  // An item kept under a folder the other side removed brings the folder back.
  for (const id of kept) {
    for (let at = chosen.get(id); at !== undefined && !kept.has(at); at = chosen.get(at)) {
      const { item, parent } = (mine.get(at) ?? other.get(at))!;
      kept.add(at);
      chosen.set(at, parent);
      conflicts.push({ kind: 'binder', item: at, title: item.title, reason: 'removed' });
    }
  }
  const under = (list: ReturnType<typeof parents>, parent: string | undefined) =>
    [...list]
      .filter(([id, held]) => held.parent === parent && chosen.get(id) === parent && kept.has(id))
      .map(([id]) => id);
  const build = (parent: string | undefined): BinderItem[] => {
    const { order, clash } = mergeOrder(
      under(was, parent),
      under(mine, parent),
      under(other, parent),
    );
    if (clash) {
      const title = parent === undefined ? undefined : mine.get(parent)?.item.title;
      conflicts.push({ kind: 'binder', item: parent ?? '', title, reason: 'order' });
    }
    return order.map((id) => {
      const [a, b, held] = [mine.get(id)?.item, other.get(id)?.item, was.get(id)?.item];
      const item = a && b && held ? mergeItem(held, a, b, values) : (a ?? b)!;
      return { ...item, children: build(id) };
    });
  };
  return build(undefined);
}

export interface MergedScrivx {
  merged: Scrivx;
  conflicts: ScrivxConflict[];
}

/** Merges three versions of a project file.  What conflicts stays as ours has it. */
export function mergeScrivx(base: Scrivx, ours: Scrivx, theirs: Scrivx): MergedScrivx {
  const values: ValueConflict[] = [];
  const conflicts: ScrivxConflict[] = [];
  const keyed = <T extends { id: string }>(
    a: readonly T[] = [],
    b: readonly T[] = [],
    c: readonly T[] = [],
    ...path: string[]
  ) => mergeKeyed(a, b, c, path, values);
  const field = <K extends keyof Scrivx>(key: K) =>
    pick(base[key], ours[key], theirs[key], [key], values);
  const newest = stampTime(theirs.modified) > stampTime(ours.modified) ? theirs : ours;
  const merged: Scrivx = {
    ...ours,
    modified: newest.modified,
    modId: newest.modId,
    creator: newest.creator,
    device: newest.device,
    binder: mergeBinder(base.binder, ours.binder, theirs.binder, conflicts, values),
    collections: keyed(base.collections, ours.collections, theirs.collections, 'collections'),
    sectionTypes: {
      definitions: keyed(
        base.sectionTypes.definitions,
        ours.sectionTypes.definitions,
        theirs.sectionTypes.definitions,
        'sectionTypes',
      ),
      levels: pick(
        base.sectionTypes.levels,
        ours.sectionTypes.levels,
        theirs.sectionTypes.levels,
        ['sectionTypes', 'levels'],
        values,
      ),
    },
    labelSettings: {
      ...mergeFields(
        base.labelSettings,
        ours.labelSettings,
        theirs.labelSettings,
        ['title', 'defaultId'],
        ['labelSettings'],
        values,
      ),
      labels: keyed(
        base.labelSettings.labels,
        ours.labelSettings.labels,
        theirs.labelSettings.labels,
        'labelSettings',
      ),
    },
    statusSettings: {
      ...mergeFields(
        base.statusSettings,
        ours.statusSettings,
        theirs.statusSettings,
        ['title', 'defaultId'],
        ['statusSettings'],
        values,
      ),
      statuses: keyed(
        base.statusSettings.statuses,
        ours.statusSettings.statuses,
        theirs.statusSettings.statuses,
        'statusSettings',
      ),
    },
    customFields: keyed(base.customFields, ours.customFields, theirs.customFields, 'customFields'),
    printSettings: field('printSettings'),
    ...optional('projectBookmarks', field('projectBookmarks')),
    ...optional('templateFolderId', field('templateFolderId')),
    ...optional('bookmarksFolderId', field('bookmarksFolderId')),
    ...optional('autoComplete', field('autoComplete')),
    ...optional('externalSyncMap', field('externalSyncMap')),
  };
  const keywords = keyed(base.keywords, ours.keywords, theirs.keywords, 'keywords');
  if (ours.keywords || theirs.keywords) merged.keywords = keywords;
  return { merged, conflicts: [...conflicts, ...values] };
}

/** A setting a project may not have: an object holding it, or nothing when merged away. */
const optional = <T>(key: string, value: T | undefined) =>
  value === undefined ? {} : { [key]: value };

/** Reads a `.scrivx` file's text. */
function readScrivx(text: string): Scrivx {
  const root = parseXml(text, 'ScrivenerProject');
  if (!root) throw new Error('This file holds no project.');
  return scrivxFile.read(root, newUnread());
}

/** Merges three `.scrivx` files' text, as a merge driver gets them, into the file to write. */
export function mergeScrivxText(base: string, ours: string, theirs: string) {
  const { merged, conflicts } = mergeScrivx(readScrivx(base), readScrivx(ours), readScrivx(theirs));
  return { text: writeScrivx(merged), conflicts };
}
