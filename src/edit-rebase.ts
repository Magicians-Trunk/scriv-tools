/**
 * Rebasing edits over each other.  Edits made together all name places in the document as it stood
 * before any of them, so two changes to one document can each be read against it.  Rebasing one
 * over the other moves its places to the document as the other left it: a paragraph on by what
 * came and went before it, an offset on by what changed before it in its paragraph.  Where both
 * touch the same thing, and do not do the same to it, neither can be moved, and that is a conflict.
 */
import type { Inline } from './edit-pieces.ts';
import type { DocumentEdit } from './editable.ts';
import { same } from './rich-text.ts';
import { wordsOf } from './text-compare.ts';

/** Why two edits cannot both be made. */
export type ConflictReason = 'words' | 'style' | 'note' | 'removed' | 'paragraphs' | 'comment';

/** An edit that cannot go over another: each as it was made, against the same document. */
export interface EditConflict {
  reason: ConflictReason;
  edit: DocumentEdit;
  over: DocumentEdit;
}

/** Which goes first when two changes add paragraphs at one place. */
export type Ties = 'after' | 'before';

export interface Rebased {
  edits: DocumentEdit[];
  conflicts: EditConflict[];
}

/** Paragraphs an edit takes away and adds: `count` from `first`, and `adds` in their place. */
interface Span {
  first: number;
  count: number;
  adds: number;
  edit: DocumentEdit;
}

function spanOf(edit: DocumentEdit): Span | undefined {
  if (edit.kind === 'insert') {
    return { first: edit.at, count: 0, adds: edit.paragraphs.length, edit };
  }
  if (edit.kind === 'remove') return { first: edit.first, count: edit.count, adds: 0, edit };
  if (edit.kind === 'table') {
    const adds = edit.rows.flat(2).length;
    return { first: edit.first, count: edit.count, adds, edit };
  }
  if (edit.kind !== 'paragraphs') return undefined;
  return { first: edit.first, count: edit.count, adds: edit.stretch.paragraphs.length, edit };
}

/** Where a place in the document moves to, with those spans made. */
function movedPlace(spans: Span[], place: number, ties: Ties): number {
  let moved = place;
  for (const { first, count, adds } of spans) {
    if (count === 0) {
      if (first < place || (first === place && ties === 'after')) moved += adds;
    } else if (first + count <= place) moved += adds - count;
    else if (first < place) moved += first - place + (ties === 'after' ? adds : 0);
  }
  return moved;
}

const holds = ({ first, count }: Pick<Span, 'first' | 'count'>, paragraph: number) =>
  first <= paragraph && paragraph < first + count;

/** The length of the text an edit puts in, less what it takes out. */
function growth({ start, end, text }: { start: number; end: number; text: string | Inline[] }) {
  return wordsOf(text).length - (end - start);
}

type Range = Extract<DocumentEdit, { start: number }>;

/** A stretch of a note goes by the note's text, and is taken with the note. */
const inNote = (edit: DocumentEdit) => edit.kind === 'character' && edit.piece !== undefined;

const isRange = (edit: DocumentEdit): edit is Range => 'start' in edit && !inNote(edit);

/** Whether two edits reach the same text, or put text in at the same place. */
const overlap = (a: Range, b: Range) =>
  (a.start < b.end && b.start < a.end) || (a.start === b.start && a.end === b.end);

/** What one edit comes to over others: the edits it becomes, or what stops it. */
type Outcome = DocumentEdit[] | { reason: ConflictReason; over: DocumentEdit };

/** The text an edit to a stretch of a paragraph reaches, over the edits to that paragraph. */
function overRange(edit: Range, mates: DocumentEdit[]): Outcome {
  let shift = 0;
  for (const mate of mates) {
    if (mate.kind === 'inlines') return { reason: 'words', over: mate };
    if (!isRange(mate)) continue;
    if (same(edit, mate)) return [];
    if (overlap(edit, mate)) return { reason: 'words', over: mate };
    if (mate.kind === 'replace' && mate.end <= edit.start) shift += growth(mate);
  }
  return [{ ...edit, start: edit.start + shift, end: edit.end + shift }];
}

/** A note, over the edits to its paragraph: only those that can move pieces stop it. */
function overNote(edit: Extract<DocumentEdit, { piece?: number }>, mates: DocumentEdit[]): Outcome {
  for (const mate of mates) {
    if (same(edit, mate)) return [];
    const moves = mate.kind === 'inlines' || (mate.kind === 'replace' && Array.isArray(mate.text));
    const clashes = 'piece' in mate && mate.piece === edit.piece;
    if (moves || clashes) return { reason: 'note', over: mate };
  }
  return [edit];
}

/** An edit inside one paragraph, over the edits to that paragraph. */
function overParagraph(edit: DocumentEdit, mates: DocumentEdit[]): Outcome {
  if (edit.kind === 'note' || (edit.kind === 'character' && inNote(edit))) {
    return overNote(edit, mates);
  }
  if (isRange(edit)) return overRange(edit, mates);
  if (edit.kind === 'style') {
    const other = mates.find(({ kind }) => kind === 'style');
    if (!other) return [edit];
    return same(edit, other) ? [] : { reason: 'style', over: other };
  }
  const other = mates.find(({ kind }) => kind !== 'style');
  if (!other) return [edit];
  return same(edit, other) ? [] : { reason: 'words', over: other };
}

/** The parts of a removal left to make, with what is gone already not in it. */
function survivors(
  { first, count }: Extract<DocumentEdit, { kind: 'remove' }>,
  spans: Span[],
): DocumentEdit[] {
  const left: DocumentEdit[] = [];
  for (let paragraph = first; paragraph < first + count; paragraph += 1) {
    if (spans.some((span) => holds(span, paragraph))) continue;
    const place = movedPlace(spans, paragraph, 'after');
    const last = left.at(-1);
    if (last?.kind === 'remove' && last.first + last.count === place) last.count += 1;
    else left.push({ kind: 'remove', first: place, count: 1 });
  }
  return left;
}

/** An edit that takes paragraphs away, over the edits made at them. */
function overSpan(
  edit: Extract<DocumentEdit, { kind: 'remove' | 'paragraphs' | 'table' }>,
  over: DocumentEdit[],
  spans: Span[],
): Outcome {
  const { first, count } = edit;
  const span = { first, count };
  if (over.some((other) => same(other, edit))) return [];
  for (const other of over) {
    if ('paragraph' in other && holds(span, other.paragraph)) {
      return { reason: 'removed', over: other };
    }
  }
  const met = spans.filter((other) => {
    if (other.count === 0) return first < other.first && other.first < first + count;
    return other.first < first + count && first < other.first + other.count;
  });
  const changing = met.find((other) => other.adds > 0 && other.count > 0);
  if (changing) return { reason: 'paragraphs', over: changing.edit };
  if (edit.kind === 'remove') return survivors(edit, spans);
  if (met[0]) return { reason: 'paragraphs', over: met[0].edit };
  return [{ ...edit, first: movedPlace(spans, first, 'after') }];
}

/** A place paragraphs go, over the edits made: the same paragraphs there are already there. */
function overPlace(
  edit: Extract<DocumentEdit, { kind: 'insert' | 'paragraphs' | 'table' }>,
  over: DocumentEdit[],
  spans: Span[],
  ties: Ties,
): Outcome {
  if (over.some((other) => same(other, edit))) return [];
  if (edit.kind === 'insert') return [{ ...edit, at: movedPlace(spans, edit.at, ties) }];
  return [{ ...edit, first: movedPlace(spans, edit.first, ties) }];
}

/** A comment, over the comments changed. */
function overComment(edit: Extract<DocumentEdit, { kind: 'comment' }>, over: DocumentEdit[]) {
  const other = over.find((each) => each.kind === 'comment' && each.id === edit.id);
  if (!other) return [edit];
  return same(edit, other) ? [] : { reason: 'comment' as const, over: other };
}

function overAll(edit: DocumentEdit, over: DocumentEdit[], spans: Span[], ties: Ties): Outcome {
  if (edit.kind === 'comment') return overComment(edit, over);
  if (edit.kind === 'insert') return overPlace(edit, over, spans, ties);
  if (edit.kind === 'remove') return overSpan(edit, over, spans);
  if (edit.kind === 'paragraphs' || edit.kind === 'table') {
    if (edit.count === 0) return overPlace(edit, over, spans, ties);
    return overSpan(edit, over, spans);
  }
  const { paragraph } = edit;
  const gone = spans.find((span) => holds(span, paragraph));
  if (gone) return { reason: 'removed', over: gone.edit };
  const mates = over.filter((other) => 'paragraph' in other && other.paragraph === paragraph);
  const outcome = overParagraph(edit, mates);
  if (!Array.isArray(outcome)) return outcome;
  return outcome.map((each) => ({ ...each, paragraph: movedPlace(spans, paragraph, 'after') }));
}

/**
 * Moves edits on from the document they name to that document with `over` made.  `ties` says where
 * they go when both add paragraphs at one place.  Edits that do what `over` already does are
 * dropped.  Those that cannot be moved are left out, and returned as conflicts.
 */
export function rebaseEdits(
  edits: readonly DocumentEdit[],
  over: readonly DocumentEdit[],
  ties: Ties = 'after',
): Rebased {
  const held = [...over];
  const spans = held.flatMap((edit) => spanOf(edit) ?? []);
  const result: Rebased = { edits: [], conflicts: [] };
  for (const edit of edits) {
    const outcome = overAll(edit, held, spans, ties);
    if (Array.isArray(outcome)) result.edits.push(...outcome);
    else result.conflicts.push({ ...outcome, edit });
  }
  return result;
}
