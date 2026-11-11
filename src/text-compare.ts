/** Comparing text and pieces of text. */
import type { Inline } from './edit-pieces.ts';

/** How many characters two texts start with in common. */
export function commonStart(a: string, b: string): number {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  return at;
}

/** How many characters two texts end with in common, leaving out the first `after` of each. */
export function commonEnd(a: string, b: string, after: number): number {
  let at = 0;
  while (
    at < a.length - after &&
    at < b.length - after &&
    a[a.length - 1 - at] === b[b.length - 1 - at]
  ) {
    at += 1;
  }
  return at;
}

/** The text pieces read as, which notes are no part of. */
export const plainText = (text: Inline[]) =>
  text
    .filter(({ note }) => note === undefined)
    .map((inline) => inline.text)
    .join('');

/** The words an edit's text says, as text alone or as pieces. */
export const wordsOf = (text: string | Inline[]) =>
  typeof text === 'string' ? text : plainText(text);
