/**
 * Lining up two versions of a text.  Paragraphs have no identity, so they are lined up by their
 * words: those that read the same first, then, between those, the ones most alike.  A paragraph
 * that keeps its words is the same paragraph whatever its style, so a restyle reads as a restyle.
 */
import { matches } from './diff.ts';

const WORDS = new Intl.Segmenter('en', { granularity: 'word' });

/** How alike two paragraphs must be, by the words they share, to be one paragraph changed. */
const ALIKE = 0.5;

/** Text as its words, with the spaces and punctuation between them. */
export const textTokens = (text: string) => Array.from(WORDS.segment(text), (each) => each.segment);

/** The words of a text, each once. */
function wordSet(text: string): Set<string> {
  const words = Array.from(WORDS.segment(text)).filter(({ isWordLike }) => isWordLike);
  return new Set(words.map(({ segment }) => segment));
}

/** How much of their words two sets share, from 0 to 1. */
function likeness(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return (2 * shared) / (a.size + b.size);
}

/** A paragraph of each version, or of one: one with only `was` went, one with only `now` came. */
export interface AlignedLine {
  was?: number;
  now?: number;
}

/** The best pairing, in order, of the paragraphs between two that read the same. */
function pairAlike(was: Set<string>[], now: Set<string>[]): [number, number][] {
  const scores = was.map((a) => now.map((b) => likeness(a, b)));
  // One paragraph in place of one is that paragraph rewritten, if it keeps any of its words.
  const alike = was.length === 1 && now.length === 1 ? Number.MIN_VALUE : ALIKE;
  const best = Array.from({ length: was.length + 1 }, () =>
    Array.from({ length: now.length + 1 }, () => 0),
  );
  const paired = (i: number, j: number) =>
    scores[i]![j]! >= alike ? scores[i]![j]! + best[i + 1]![j + 1]! : -1;
  for (let i = was.length - 1; i >= 0; i -= 1) {
    for (let j = now.length - 1; j >= 0; j -= 1) {
      best[i]![j] = Math.max(paired(i, j), best[i + 1]![j]!, best[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < was.length && j < now.length) {
    if (best[i]![j] === paired(i, j)) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (best[i]![j] === best[i + 1]![j]) i += 1;
    else j += 1;
  }
  return pairs;
}

/**
 * Lines up two versions' paragraphs, each given as its text, in order.  `key` says what must match
 * for two to read the same, when that is more than their text.
 */
export function alignParagraphs(
  was: readonly string[],
  now: readonly string[],
  key: { was: readonly string[]; now: readonly string[] } = { was, now },
): AlignedLine[] {
  const lines: AlignedLine[] = [];
  let a = 0;
  let b = 0;
  const gap = (wasEnd: number, nowEnd: number) => {
    const wasWords = was.slice(a, wasEnd).map(wordSet);
    const nowWords = now.slice(b, nowEnd).map(wordSet);
    for (const [i, j] of pairAlike(wasWords, nowWords)) {
      for (; a < wasEnd - wasWords.length + i; a += 1) lines.push({ was: a });
      for (; b < nowEnd - nowWords.length + j; b += 1) lines.push({ now: b });
      lines.push({ was: a, now: b });
      a += 1;
      b += 1;
    }
    for (; a < wasEnd; a += 1) lines.push({ was: a });
    for (; b < nowEnd; b += 1) lines.push({ now: b });
  };
  for (const match of matches(key.was, key.now)) {
    gap(match.a, match.b);
    for (let at = 0; at < match.length; at += 1) lines.push({ was: a + at, now: b + at });
    a += match.length;
    b += match.length;
  }
  gap(was.length, now.length);
  return lines;
}

/** Words that changed: `start` to `end` of the old text, and what stands there now. */
export interface WordHunk {
  start: number;
  end: number;
  /** Where the same words sit in the new text. */
  nowStart: number;
  nowEnd: number;
}

/** Where each token starts, and where the last ends. */
function offsets(tokens: string[]): number[] {
  let total = 0;
  return [0, ...tokens.map((token) => (total += token.length))];
}

/** The stretches of two texts that differ, word by word, in order. */
export function alignWords(was: string, now: string): WordHunk[] {
  const a = textTokens(was);
  const b = textTokens(now);
  const at = offsets(a);
  const to = offsets(b);
  const hunks: WordHunk[] = [];
  let i = 0;
  let j = 0;
  const gap = (wasEnd: number, nowEnd: number) => {
    if (i === wasEnd && j === nowEnd) return;
    hunks.push({ start: at[i]!, end: at[wasEnd]!, nowStart: to[j]!, nowEnd: to[nowEnd]! });
  };
  for (const match of matches(a, b)) {
    gap(match.a, match.b);
    i = match.a + match.length;
    j = match.b + match.length;
  }
  gap(a.length, b.length);
  return hunks;
}
