/** Above this many pairs of differing elements, the elements between are not matched up. */
const MATCH_LIMIT = 4_000_000;

/** A run of elements that match: from `a` in the first list and `b` in the second, `length` long. */
export interface Match {
  a: number;
  b: number;
  length: number;
}

/**
 * The longest run of elements the two lists have in common, in order, as runs that match: what
 * they start and end with, then the longest common run of what is between them.
 */
export function matches<T>(
  a: ArrayLike<T>,
  b: ArrayLike<T>,
  equal: (first: T, second: T) => boolean = Object.is,
): Match[] {
  let before = 0;
  while (before < a.length && before < b.length && equal(a[before]!, b[before]!)) before += 1;
  let after = 0;
  while (
    after < a.length - before &&
    after < b.length - before &&
    equal(a[a.length - 1 - after]!, b[b.length - 1 - after]!)
  ) {
    after += 1;
  }
  const rows = a.length - before - after;
  const columns = b.length - before - after;
  const found: Match[] = before > 0 ? [{ a: 0, b: 0, length: before }] : [];
  const add = (first: number, second: number) => {
    const last = found.at(-1);
    if (last && last.a + last.length === first && last.b + last.length === second) last.length += 1;
    else found.push({ a: first, b: second, length: 1 });
  };
  if (rows > 0 && columns > 0 && rows * columns <= MATCH_LIMIT) {
    // The longest common run, by the usual table of lengths from the end.
    const lengths = Array.from({ length: rows + 1 }, () =>
      Array.from({ length: columns + 1 }, () => 0),
    );
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = columns - 1; j >= 0; j -= 1) {
        lengths[i]![j] = equal(a[before + i]!, b[before + j]!)
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < columns) {
      if (equal(a[before + i]!, b[before + j]!)) {
        add(before + i, before + j);
        i += 1;
        j += 1;
      } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i += 1;
      else j += 1;
    }
  }
  if (after > 0) found.push({ a: a.length - after, b: b.length - after, length: after });
  return found;
}
