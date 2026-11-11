/** Comparing and merging typed values: settings, lists of things with IDs, and orders of IDs. */
import type { DocumentText } from './document.ts';
import { markupText } from './markup.ts';
import { same } from './rich-text.ts';

/** A value that changed, by the keys and indexes that lead to it. */
export interface ValueChange {
  path: (string | number)[];
  was: unknown;
  now: unknown;
}

const isRecord = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rich text held in a value: to compare by what it was read from, and to show as its words. */
const isText = (value: unknown): value is Pick<DocumentText, 'source' | 'paragraphs'> =>
  isRecord(value) && 'source' in value && 'paragraphs' in value;

function shown(value: unknown): unknown {
  if (!isText(value)) return value;
  return value.paragraphs.map(({ content }) => markupText(content)).join('\n');
}

/** Every leaf of two values that differs. */
export function valueChanges(
  was: unknown,
  now: unknown,
  path: (string | number)[] = [],
): ValueChange[] {
  if (same(was, now)) return [];
  if (isRecord(was) && isRecord(now) && !isText(was) && !isText(now)) {
    const old = new Map(Object.entries(was));
    const next = new Map(Object.entries(now));
    return [...new Set([...old.keys(), ...next.keys()])].flatMap((key) =>
      valueChanges(old.get(key), next.get(key), [...path, key]),
    );
  }
  if (Array.isArray(was) && Array.isArray(now) && was.length === now.length) {
    return was.flatMap((held, at) => valueChanges(held, now[at], [...path, at]));
  }
  return [{ path, was: shown(was), now: shown(now) }];
}

/** Both sides changed a value, each its own way. */
export interface ValueConflict {
  kind: 'value';
  path: (string | number)[];
  base: unknown;
  ours: unknown;
  theirs: unknown;
}

/** The value of three: the side that changed it.  Both, each their own way, is a conflict. */
export function pick<T>(
  base: T,
  ours: T,
  theirs: T,
  path: (string | number)[],
  conflicts: ValueConflict[],
  equal: (a: T, b: T) => boolean = same,
): T {
  if (equal(ours, theirs) || equal(base, theirs)) return ours;
  if (equal(base, ours)) return theirs;
  conflicts.push({ kind: 'value', path, base, ours, theirs });
  return ours;
}

/** A value no one reads, like a selection: the side that changed it, and ours if both did. */
export const pickQuietly = <T>(base: T, ours: T, theirs: T): T =>
  same(base, ours) ? theirs : ours;

/** The named fields of a record, each merged alone. */
export function mergeFields<T extends object>(
  base: T,
  ours: T,
  theirs: T,
  fields: readonly (keyof T)[],
  path: (string | number)[],
  conflicts: ValueConflict[],
): T {
  const merged = { ...ours };
  for (const field of fields) {
    const where = [...path, String(field)];
    merged[field] = pick(base[field], ours[field], theirs[field], where, conflicts);
  }
  return merged;
}

/**
 * Three orders of IDs as one: the order the side that moved things gave, with what only the other
 * side has after what it follows there.  `clash` says both moved the same things differently.
 */
export function mergeOrder(base: string[], ours: string[], theirs: string[]) {
  const shared = (list: string[]) =>
    list.filter((id) => base.includes(id) && ours.includes(id) && theirs.includes(id));
  const oursMoved = !same(shared(ours), shared(base));
  const theirsMoved = !same(shared(theirs), shared(base));
  const clash = oursMoved && theirsMoved && !same(shared(ours), shared(theirs));
  const [lead, other] = theirsMoved && !oursMoved ? [theirs, ours] : [ours, theirs];
  const order = [...lead];
  for (const [at, id] of other.entries()) {
    if (order.includes(id)) continue;
    let place = at === 0 ? 0 : order.indexOf(other[at - 1]!) + 1;
    while (place < order.length && !other.includes(order[place]!)) place += 1;
    order.splice(place, 0, id);
  }
  return { order, clash };
}

/** Lists of things with IDs as one: each thing merged alone, and those removed staying removed. */
export function mergeKeyed<T extends { id: string }>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  path: (string | number)[],
  conflicts: ValueConflict[],
  equal: (a: T, b: T) => boolean = same,
): T[] {
  const find = (list: readonly T[], id: string) => list.find((each) => each.id === id);
  const ids = (list: readonly T[]) => list.map(({ id }) => id);
  const { order, clash } = mergeOrder(ids(base), ids(ours), ids(theirs));
  if (clash) conflicts.push({ kind: 'value', path, base, ours, theirs });
  const alike = (a: T | undefined, b: T | undefined) =>
    a === undefined || b === undefined ? a === b : equal(a, b);
  return order.flatMap((id) => {
    const held = { base: find(base, id), ours: find(ours, id), theirs: find(theirs, id) };
    if (!held.base) return held.ours ?? held.theirs!;
    const merged = pick(held.base, held.ours, held.theirs, [...path, id], conflicts, alike);
    return merged ?? [];
  });
}
