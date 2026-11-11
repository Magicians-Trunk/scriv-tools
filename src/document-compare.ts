/**
 * Comparing two versions of a document, as data.  What is compared is all a reader of the document
 * can see, and nothing of how it is written: where a style's markers fall, which number a list has
 * or how a font table is ordered never shows.
 */
import { alignParagraphs, alignWords } from './align.ts';
import { matches } from './diff.ts';
import { commentText, type DocumentText } from './document.ts';
import {
  type Inline,
  type NoteKind,
  type ReadParagraph,
  readParagraph,
  readParagraphs,
} from './edit-pieces.ts';
import type { Styles } from './edit-pieces.ts';
import { type LinkTarget } from './link-target.ts';
import { type MarkupNode } from './markup.ts';
import { placeholderText } from './placeholder-syntax.ts';
import { canonical, type CharacterFormat, type ParagraphFormat, same } from './rich-text.ts';
import { plainText } from './text-compare.ts';

/** A run of a paragraph's text in one formatting, with what else it holds as written. */
interface LookRun {
  length: number;
  format: CharacterFormat;
  held?: unknown;
}

/** Runs of nodes' text: every part of them, as a list with no markers. */
function runsOf(nodes: readonly MarkupNode[]): LookRun[] {
  return nodes.flatMap((node): LookRun[] => {
    switch (node.kind) {
      case 'style':
      case 'tag':
        return [];
      case 'link':
        return runsOf(node.content);
      case 'footnote':
      case 'preserved':
        return runsOf(node.content);
      case 'annotation':
        return [{ length: 0, format: {}, held: node.opening }, ...runsOf(node.content)];
      case 'picture':
        return [{ length: 1, format: node.format, held: node.picture }];
      case 'image':
        return [{ length: 1, format: node.format, held: node.source }];
      case 'text':
        return [{ length: node.text.length, format: node.format }];
      case 'placeholder':
        return [{ length: placeholderText(node).length, format: node.format }];
      default:
        return [{ length: 1, format: node.format }];
    }
  });
}

/** Formatting as a reader sees it: a link's field writes the link, and off is the same as unset. */
function seenFormat({ field: _field, bold, italic, ...format }: CharacterFormat): CharacterFormat {
  return { ...format, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) };
}

/** Runs of what a reader sees, those that look the same as one. */
function looksOf(nodes: readonly MarkupNode[]): LookRun[] {
  const looks: LookRun[] = [];
  for (const { format: written, ...run } of runsOf(nodes)) {
    const format = seenFormat(written);
    const last = looks.at(-1);
    if (last && last.held === undefined && run.held === undefined && same(last.format, format)) {
      last.length += run.length;
    } else looks.push({ ...run, format });
  }
  return looks;
}

/** A paragraph as a reader sees it, whatever writes it. */
export interface ParagraphFace {
  read: ReadParagraph;
  format: ParagraphFormat;
  looks: LookRun[];
  /** The text and notes that say two paragraphs read the same. */
  words: string;
  /** All of it, to compare. */
  whole: string;
}

const notesOf = (text: Inline[]) => text.filter(({ note }) => note !== undefined);

/** Pieces with those that look alike side by side as one, however their text came to be split. */
function joined(text: Inline[]): Inline[] {
  const pieces: Inline[] = [];
  for (const piece of text) {
    const last = pieces.at(-1);
    const alike = last && same({ ...last, text: '' }, { ...piece, text: '' });
    if (alike && piece.note === undefined) last.text += piece.text;
    else pieces.push({ ...piece });
  }
  return pieces;
}

/** A paragraph as a reader sees it, from how it reads. */
function faceOf(document: DocumentText, read: ReadParagraph): ParagraphFace {
  const { paragraph, style, text, list, cell } = read;
  const { list: _list, table: _table, ...format } = document.paragraphs[paragraph]!.format;
  const looks = looksOf(document.paragraphs[paragraph]!.content);
  const place = cell && [cell.row, cell.column, cell.part];
  const notes = notesOf(text).map(({ note, text: held }) => [note, held]);
  const words = JSON.stringify([plainText(text), notes]);
  const whole = canonical([style, joined(text), list, place, format, looks]);
  return { read, format, looks, words, whole };
}

/** Each paragraph of a document as a reader sees it. */
export const documentFaces = (project: Styles, document: DocumentText): ParagraphFace[] =>
  readParagraphs(project, document).map((read) => faceOf(document, read));

/** One paragraph of a document as a reader sees it. */
export const paragraphFace = (project: Styles, document: DocumentText, at: number) =>
  faceOf(document, readParagraph(project, document, at));

/** One value that changed. */
export interface Changed<T> {
  was: T;
  now: T;
}

/** Words that changed, by where they were in the old paragraph's text. */
export interface WordChange extends Changed<string> {
  start: number;
  end: number;
}

/** How a piece of text looks, apart from its words. */
export interface TextLook {
  style?: string;
  bold?: true;
  italic?: true;
  link?: LinkTarget;
}

/** Text that stayed and looks otherwise: a stretch of the old paragraph's text. */
export interface TextLookChange extends Changed<TextLook> {
  start: number;
  end: number;
  text: string;
}

/** A note of a paragraph added, removed or changed: its kind, and its text each way. */
export interface NoteChange {
  note: NoteKind;
  was?: string;
  now?: string;
}

/** A paragraph that is still there and changed, each kind of change apart from the others. */
export interface ChangedLine extends Changed<ReadParagraph> {
  kind: 'changed';
  words: WordChange[];
  /** Paragraph style, when it changed. */
  style?: Changed<string | undefined>;
  list?: Changed<ReadParagraph['list']>;
  looks: TextLookChange[];
  notes: NoteChange[];
  /** What changed of the paragraph's own formatting, by name, when its style did not. */
  formatting: string[];
}

/** A paragraph of the comparison, in reading order. */
export type DocumentLine =
  | ({ kind: 'same' } & Changed<ReadParagraph>)
  | { kind: 'added'; now: ReadParagraph }
  | { kind: 'removed'; was: ReadParagraph }
  | ChangedLine;

/** A linked comment that came, went or changed, with its text each way. */
export interface CommentChange {
  id: string;
  was?: string;
  now?: string;
}

export interface DocumentComparison {
  lines: DocumentLine[];
  comments: CommentChange[];
  /** Whether anything differs at all. */
  changed: boolean;
}

/** The look of each character of text the pieces read as. */
function characterLooks(text: Inline[]): TextLook[] {
  return text
    .filter(({ note }) => note === undefined)
    .flatMap(({ text: words, style, bold, italic, link }) => {
      const look: TextLook = {
        ...(style === undefined ? {} : { style }),
        ...(bold ? { bold } : {}),
        ...(italic ? { italic } : {}),
        ...(link ? { link } : {}),
      };
      return Array.from({ length: words.length }, () => look);
    });
}

/** Where text that stayed sits in each version, in order. */
function keptRanges(was: string, now: string) {
  const kept: { a: number; b: number; length: number }[] = [];
  let a = 0;
  let b = 0;
  for (const hunk of alignWords(was, now)) {
    if (hunk.start > a) kept.push({ a, b, length: hunk.start - a });
    a = hunk.end;
    b = hunk.nowEnd;
  }
  if (was.length > a) kept.push({ a, b, length: was.length - a });
  return kept;
}

/** The text that stayed in two versions of a paragraph and looks otherwise, each look a stretch. */
function lookChanges(was: Inline[], now: Inline[]): TextLookChange[] {
  const before = plainText(was);
  const from = characterLooks(was);
  const to = characterLooks(now);
  const changes: TextLookChange[] = [];
  for (const { a, b, length } of keptRanges(before, plainText(now))) {
    for (let at = 0; at < length; at += 1) {
      const look = { was: from[a + at]!, now: to[b + at]! };
      if (same(look.was, look.now)) continue;
      const last = changes.at(-1);
      if (last?.end === a + at && same(last.was, look.was) && same(last.now, look.now)) {
        last.end += 1;
        last.text += before[a + at]!;
      } else {
        changes.push({ start: a + at, end: a + at + 1, text: before[a + at]!, ...look });
      }
    }
  }
  return changes;
}

const noteKey = ({ note, text }: Inline) => JSON.stringify([note, text]);

/** The notes that differ: those in the same place of what changed are one note changed. */
function noteChanges(was: Inline[], now: Inline[]): NoteChange[] {
  const before = notesOf(was);
  const after = notesOf(now);
  const changes: NoteChange[] = [];
  let a = 0;
  let b = 0;
  const gap = (wasEnd: number, nowEnd: number) => {
    for (; a < wasEnd || b < nowEnd; a += 1, b += 1) {
      const old = a < wasEnd ? before[a] : undefined;
      const next = b < nowEnd ? after[b] : undefined;
      changes.push({
        note: (old ?? next)!.note!,
        ...(old ? { was: old.text } : {}),
        ...(next ? { now: next.text } : {}),
      });
    }
    a = wasEnd;
    b = nowEnd;
  };
  for (const match of matches(before.map(noteKey), after.map(noteKey))) {
    gap(match.a, match.b);
    a += match.length;
    b += match.length;
  }
  gap(before.length, after.length);
  return changes;
}

/** The names of what differs between two records. */
function differingKeys(was: object, now: object): string[] {
  const held = new Map(Object.entries(was));
  const next = new Map(Object.entries(now));
  const keys = new Set([...held.keys(), ...next.keys()]);
  return [...keys].filter((key) => !same(held.get(key), next.get(key)));
}

/** What differs of the direct formatting of two versions of a paragraph, by name. */
function formattingChanges(was: ParagraphFace, now: ParagraphFace): string[] {
  const looks = (face: ParagraphFace) =>
    Object.fromEntries(
      face.looks
        .flatMap(({ format: { bold: _b, italic: _i, ...format } }) => Object.entries(format))
        .map(([key, value]) => [key, canonical(value)]),
    );
  return [
    ...new Set([
      ...differingKeys(was.format, now.format),
      ...differingKeys(looks(was), looks(now)),
    ]),
  ];
}

function changedLine(was: ParagraphFace, now: ParagraphFace): ChangedLine {
  const { text, style, list } = was.read;
  const before = plainText(text);
  const after = plainText(now.read.text);
  const words = alignWords(before, after).map(({ start, end, nowStart, nowEnd }) => ({
    start,
    end,
    was: before.slice(start, end),
    now: after.slice(nowStart, nowEnd),
  }));
  const restyled = style !== now.read.style;
  const line: ChangedLine = {
    kind: 'changed',
    was: was.read,
    now: now.read,
    words,
    looks: lookChanges(text, now.read.text),
    notes: noteChanges(text, now.read.text),
    formatting: restyled ? [] : formattingChanges(was, now),
  };
  if (restyled) line.style = { was: style, now: now.read.style };
  if (!same(list, now.read.list)) line.list = { was: list, now: now.read.list };
  return line;
}

/** The two versions' paragraphs lined up. */
export function alignFaces(was: ParagraphFace[], now: ParagraphFace[]) {
  const plain = (faces: ParagraphFace[]) => faces.map(({ read }) => plainText(read.text));
  const words = (faces: ParagraphFace[]) => faces.map((face) => face.words);
  return alignParagraphs(plain(was), plain(now), { was: words(was), now: words(now) });
}

/** A comment as a reader sees it. */
function commentFace(project: Styles, { color, footnote, text }: DocumentText['comments'][number]) {
  const whole = documentFaces(project, text).map((face) => face.whole);
  return JSON.stringify([color, footnote, whole]);
}

function commentChanges(project: Styles, was: DocumentText, now: DocumentText): CommentChange[] {
  const before = new Map(was.comments.map((comment) => [comment.id, comment]));
  const after = new Map(now.comments.map((comment) => [comment.id, comment]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const old = before.get(id);
    const next = after.get(id);
    if (old && next && commentFace(project, old) === commentFace(project, next)) return [];
    return [
      {
        id,
        ...(old ? { was: commentText(old) } : {}),
        ...(next ? { now: commentText(next) } : {}),
      },
    ];
  });
}

/** Compares two versions of a document, styles named by `project`. */
export function compareDocument(
  project: Styles,
  was: DocumentText,
  now: DocumentText,
): DocumentComparison {
  const before = documentFaces(project, was);
  const after = documentFaces(project, now);
  const lines = alignFaces(before, after).map(({ was: a, now: b }): DocumentLine => {
    if (a === undefined) return { kind: 'added', now: after[b!]!.read };
    if (b === undefined) return { kind: 'removed', was: before[a]!.read };
    const left = before[a]!;
    const right = after[b]!;
    if (left.whole === right.whole) return { kind: 'same', was: left.read, now: right.read };
    return changedLine(left, right);
  });
  const comments = commentChanges(project, was, now);
  const changed = comments.length > 0 || lines.some(({ kind }) => kind !== 'same');
  return { lines, comments, changed };
}
