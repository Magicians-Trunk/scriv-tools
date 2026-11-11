/**
 * The edits between two versions of a document.  Where a typed edit says a change it is used, and
 * tried: a paragraph it does not bring to the new version exactly, and any change of a table's
 * shape, goes as the paragraphs themselves.  So making the edits gives the new version, always.
 */
import {
  type ChangedLine,
  compareDocument,
  type DocumentLine,
  documentFaces,
  paragraphFace,
} from './document-compare.ts';
import type { DocumentText } from './document.ts';
import { alignWords } from './align.ts';
import { cutsNote, cutsTable, type Inline, type Styles } from './edit-pieces.ts';
import { stretchOf } from './edit-stretch.ts';
import { type DocumentEdit, inMakingOrder, makeEdit } from './editable.ts';
import { paragraphEdits } from './paragraph-edits.ts';
import { same } from './rich-text.ts';
import { plainText, wordsOf } from './text-compare.ts';

/** Makes edits, all of whose places are in the document as it stands. */
export function makeEdits(project: Styles, document: DocumentText, edits: readonly DocumentEdit[]) {
  for (const edit of inMakingOrder(edits)) makeEdit(project, edit, document);
}

/** The pieces of a stretch of a paragraph's text. */
function piecesBetween(text: Inline[], start: number, end: number): Inline[] {
  let at = 0;
  return text
    .filter(({ note }) => note === undefined)
    .flatMap((piece) => {
      const from = Math.max(start - at, 0);
      const to = Math.min(end - at, piece.text.length);
      at += piece.text.length;
      return from < to ? [{ ...piece, text: piece.text.slice(from, to) }] : [];
    });
}

/**
 * New words for those they take the place of.  Words that look as those did go as text alone: so
 * they keep the font and all else written there, which pieces have no way to say.
 */
function wordsFor([old]: Inline[], pieces: Inline[]): string | Inline[] {
  const [piece] = pieces;
  const alike =
    old && piece && pieces.length === 1 && same({ ...old, text: '' }, { ...piece, text: '' });
  return alike ? piece.text : pieces;
}

type Replace = Extract<DocumentEdit, { kind: 'replace' }>;

const isReplace = (edit: DocumentEdit): edit is Replace => edit.kind === 'replace';

/** Whether an edit puts in pieces a word's place cannot say: a note, or what goes after one. */
const holdsNote = (edit: DocumentEdit) =>
  (edit.kind === 'inlines' && edit.text.length > 0) ||
  (edit.kind === 'replace' &&
    typeof edit.text !== 'string' &&
    edit.text.some(({ note }) => note !== undefined));

/** A replacement, with the style that goes cleared first, as new text takes the style it replaces. */
function wordEdits(
  place: { paragraph: number; start: number; end: number },
  old: Inline[],
  pieces: Inline[],
): DocumentEdit[] {
  const text = wordsFor(old, pieces);
  const replace: DocumentEdit = { kind: 'replace', ...place, text };
  const clears =
    typeof text !== 'string' &&
    place.end > place.start &&
    old.some(({ style }) => style !== undefined);
  return clears ? [{ kind: 'character', ...place }, replace] : [replace];
}

/**
 * A paragraph's edits, each change to its text one edit to the words it changes: the unit a person
 * reads, chooses and rejects, so two changes to one word are one conflict.
 */
function typedEdits({ was, now }: ChangedLine): DocumentEdit[] {
  const edits = paragraphEdits('', [was], [now]).map(({ edit }) => edit);
  const before = plainText(was.text);
  const after = plainText(now.text);
  const { paragraph } = was;
  const words = alignWords(before, after).flatMap(({ start, end, nowStart, nowEnd }) =>
    wordEdits(
      { paragraph, start, end },
      piecesBetween(was.text, start, Math.max(end, start + 1)),
      piecesBetween(now.text, nowStart, nowEnd),
    ),
  );
  if (edits.some(holdsNote)) return edits;
  const gone = edits.filter(isReplace).filter((edit) => !keepsWords(edit, before));
  const clearsGone = (edit: DocumentEdit) =>
    edit.kind === 'character' &&
    gone.some(({ start, end }) => start === edit.start && end === edit.end);
  const kept = edits.filter((edit) => !gone.some((each) => each === edit) && !clearsGone(edit));
  return [...kept, ...words];
}

/** Whether a replacement leaves its words as they read, which changes only a link. */
function keepsWords(edit: Replace, before: string): boolean {
  return wordsOf(edit.text) === before.slice(edit.start, edit.end);
}

/** Where in its table a paragraph is. */
const cellPlace = ({ cell }: ChangedLine['was']) => cell && [cell.row, cell.column, cell.part];

/** Whether a line changes a table's shape, which only the table as a whole can do. */
function reshapesTable(line: DocumentLine): boolean {
  if (line.kind === 'added') return !!line.now.cell;
  if (line.kind === 'removed') return !!line.was.cell;
  return !same(cellPlace(line.was), cellPlace(line.now));
}

const isGap = ({ kind }: DocumentLine) => kind === 'added' || kind === 'removed';

/** Where each line starts in each version, and where the last ends. */
function linePlaces(lines: DocumentLine[]) {
  let was = 0;
  let now = 0;
  const places = lines.map((line) => {
    const place = { was, now };
    if (line.kind !== 'added') was += 1;
    if (line.kind !== 'removed') now += 1;
    return place;
  });
  return [...places, { was, now }];
}

/**
 * The runs of lines that go as whole paragraphs: those `rough` says must, widened to what can be
 * cut there, and to what came and went beside them.
 */
function wholeRuns(
  lines: DocumentLine[],
  was: DocumentText,
  now: DocumentText,
  rough: (line: DocumentLine, at: number) => boolean,
) {
  const places = linePlaces(lines);
  const cuts = (at: number) =>
    [cutsTable, cutsNote].some((cut) => cut(was, places[at]!.was) || cut(now, places[at]!.now));
  const runs: { from: number; to: number }[] = [];
  for (const [at, line] of lines.entries()) {
    if (!rough(line, at)) continue;
    let from = at;
    let to = at + 1;
    while (cuts(from) || (from > 0 && isGap(lines[from - 1]!))) from -= 1;
    while (cuts(to) || (to < lines.length && isGap(lines[to]!))) to += 1;
    const last = runs.at(-1);
    if (last && from <= last.to) last.to = to;
    else runs.push({ from, to });
  }
  return runs;
}

/** The edit that makes lines from `from` to `to` whole. */
function wholeEdit(
  places: { was: number; now: number }[],
  from: number,
  to: number,
  now: DocumentText,
): DocumentEdit {
  const first = places[from]!.was;
  const count = places[to]!.was - first;
  const added = places[to]!.now - places[from]!.now;
  if (added === 0) return { kind: 'remove', first, count };
  return { kind: 'paragraphs', first, count, stretch: stretchOf(now, places[from]!.now, added) };
}

/** Makes a paragraph's typed edits in `trial`, and says if that brings it to the new version. */
function reaches(
  project: Styles,
  trial: DocumentText,
  edits: DocumentEdit[],
  { was }: ChangedLine,
  whole: string,
): boolean {
  // An edit to a paragraph reaches no further than the markers of those on either side.
  const first = Math.max(was.paragraph - 1, 0);
  const held = structuredClone(trial.paragraphs.slice(first, was.paragraph + 2));
  try {
    makeEdits(project, trial, edits);
    if (paragraphFace(project, trial, was.paragraph).whole === whole) return true;
  } catch {
    // A typed edit that cannot be made says only that this paragraph goes whole.
  }
  trial.paragraphs.splice(first, held.length, ...held);
  return false;
}

/** The edits that turn one version of a document into another.  Making them gives `now`. */
export function documentEdits(
  project: Styles,
  was: DocumentText,
  now: DocumentText,
): DocumentEdit[] {
  const { lines, comments } = compareDocument(project, was, now);
  const faces = documentFaces(project, now);
  const places = linePlaces(lines);
  const trial = structuredClone(was);
  const typed = new Map<number, DocumentEdit[]>();
  const whole = new Set<number>();
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at]!;
    if (line.kind !== 'changed') continue;
    const edits = typedEdits(line);
    const target = faces[places[at]!.now]!.whole;
    if (reaches(project, trial, edits, line, target)) typed.set(at, edits);
    else whole.add(at);
  }
  const crossesNote = (at: number) =>
    cutsNote(was, places[at]!.was) || cutsNote(now, places[at]!.now);
  const runs = wholeRuns(
    lines,
    was,
    now,
    (line, at) =>
      reshapesTable(line) ||
      whole.has(at) ||
      (isGap(line) && (crossesNote(at) || crossesNote(at + 1))),
  );
  const edits: DocumentEdit[] = [];
  for (let at = 0; at < lines.length;) {
    const run = runs.find(({ from }) => from === at);
    let to = at;
    while (to < lines.length && isGap(lines[to]!)) to += 1;
    if (run) to = run.to;
    if (to > at) edits.push(wholeEdit(places, at, to, now));
    else edits.push(...(typed.get(at) ?? []));
    at = Math.max(to, at + 1);
  }
  for (const { id } of comments) {
    const comment = now.comments.find((each) => each.id === id);
    edits.push({ kind: 'comment', id, ...(comment ? { comment } : {}) });
  }
  return edits;
}

/** A document with edits made, the one given left as it was. */
function edited(project: Styles, document: DocumentText, edits: readonly DocumentEdit[]) {
  const copy = structuredClone(document);
  makeEdits(project, copy, edits);
  return copy;
}

/** One change that does what `first`, then `second`, do: `second` names places after `first`. */
export function composeEdits(
  project: Styles,
  document: DocumentText,
  first: readonly DocumentEdit[],
  second: readonly DocumentEdit[],
): DocumentEdit[] {
  return documentEdits(
    project,
    document,
    edited(project, edited(project, document, first), second),
  );
}

/**
 * The edits that take back some of a change and keep the rest, by places in the document as the
 * change left it: which is how part of a proposal is rejected.
 */
export function reverseEdits(
  project: Styles,
  document: DocumentText,
  edits: readonly DocumentEdit[],
  undone: readonly DocumentEdit[] = edits,
): DocumentEdit[] {
  const kept = edits.filter((edit) => !undone.includes(edit));
  return documentEdits(project, edited(project, document, edits), edited(project, document, kept));
}
