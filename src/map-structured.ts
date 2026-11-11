/** Taking a change to the structured form back to the documents, piece by piece. */
import { matches } from './diff.ts';
import type { Inline, NewParagraph, ReadParagraph } from './edit-pieces.ts';
import type { TableParagraph, TableShape } from './edit-tables.ts';
import { type DocumentEdit, type Editable, joinRemovals, type MappedEdits } from './editable.ts';
import { same } from './rich-text.ts';
import { commonEnd, commonStart, plainText } from './text-compare.ts';

/** A structured paragraph as edited: one with no `paragraph` is new. */
export type EditedParagraph = Omit<ReadParagraph, 'paragraph'> & { paragraph?: number };

export interface EditedDocument {
  item: string;
  paragraphs: EditedParagraph[];
}

/** Whether two pieces differ in their text alone, and neither is a note. */
function sameButText(a: Inline, b: Inline): boolean {
  return a.note === undefined && same({ ...a, text: '' }, { ...b, text: '' });
}

/** Whether two pieces are one note that holds text, differing in that text alone. */
function sameNote(a: Inline, b: Inline): boolean {
  const holdsText = a.note === 'footnote' || a.note === 'annotation' || a.note === 'preserved';
  return holdsText && same({ ...a, text: '' }, { ...b, text: '' });
}

/** What a piece keeps by becoming another: nothing if it cannot, or what text stays, and itself. */
function keeps(a: Inline, b: Inline): number {
  if (!sameButText(a, b) && !sameNote(a, b)) return 0;
  const start = commonStart(a.text, b.text);
  return 1 + start + commonEnd(a.text, b.text, start);
}

/** Which pieces became which, in order: the pairs that keep the most, by a table from the end. */
function pairPieces(before: Inline[], after: Inline[]): { a: number; b: number }[] {
  const best = before.map(() => after.map(() => 0));
  const bestFrom = (a: number, b: number) => best[a]?.[b] ?? 0;
  for (let a = before.length - 1; a >= 0; a -= 1) {
    for (let b = after.length - 1; b >= 0; b -= 1) {
      const paired = keeps(before[a]!, after[b]!);
      const pairing = paired > 0 ? paired + bestFrom(a + 1, b + 1) : 0;
      best[a]![b] = Math.max(pairing, bestFrom(a + 1, b), bestFrom(a, b + 1));
    }
  }
  const pairs: { a: number; b: number }[] = [];
  let a = 0;
  let b = 0;
  while (a < before.length && b < after.length) {
    const paired = keeps(before[a]!, after[b]!);
    if (paired > 0 && bestFrom(a, b) === paired + bestFrom(a + 1, b + 1)) {
      pairs.push({ a, b });
      a += 1;
      b += 1;
    } else if (bestFrom(a + 1, b) >= bestFrom(a, b + 1)) a += 1;
    else b += 1;
  }
  return pairs;
}

/**
 * The edits that change a paragraph's pieces, from the last back: what did not change is not
 * touched, so all it holds stays, and a piece changed in its text alone keeps what else it is,
 * whatever is added or removed beside it.
 */
function textEdits(paragraph: number, before: Inline[], after: Inline[]): DocumentEdit[] {
  const edits: DocumentEdit[] = [];
  const onePiece = (at: number, old: Inline, edited: Inline) => {
    if (old.note !== undefined) {
      edits.push({ kind: 'note', paragraph, piece: at, text: edited.text });
      return;
    }
    const offset = plainText(before.slice(0, at)).length;
    const start = commonStart(old.text, edited.text);
    const end = commonEnd(old.text, edited.text, start);
    const text = edited.text.slice(start, edited.text.length - end);
    const range = { start: offset + start, end: offset + old.text.length - end };
    edits.push({ kind: 'replace', paragraph, ...range, text });
  };
  const replaced = (first: number, oldEnd: number, from: number, newEnd: number) => {
    if (first === oldEnd && from === newEnd) return;
    const text = after.slice(from, newEnd);
    edits.push({ kind: 'inlines', paragraph, first, count: oldEnd - first, text });
    // New pieces take the style of what they replace, so styled text that goes leaves it first.
    const pieces = before.slice(first, oldEnd);
    if (plainText(pieces.filter(({ style }) => style !== undefined)) !== '') {
      const start = plainText(before.slice(0, first)).length;
      edits.push({ kind: 'character', paragraph, start, end: start + plainText(pieces).length });
    }
  };
  const gap = (a: number, oldEnd: number, b: number, newEnd: number) => {
    let first = a;
    let from = b;
    for (const pair of pairPieces(before.slice(a, oldEnd), after.slice(b, newEnd))) {
      const old = a + pair.a;
      const edited = b + pair.b;
      replaced(first, old, from, edited);
      onePiece(old, before[old]!, after[edited]!);
      first = old + 1;
      from = edited + 1;
    }
    replaced(first, oldEnd, from, newEnd);
  };
  let a = 0;
  let b = 0;
  for (const match of matches(before, after, same)) {
    gap(a, match.a, b, match.b);
    a = match.a + match.length;
    b = match.b + match.length;
  }
  gap(a, before.length, b, after.length);
  return edits.toReversed();
}

const newParagraph = ({ style, text, list }: EditedParagraph): NewParagraph => ({
  ...(style === undefined ? {} : { style }),
  text,
  ...(list ? { list } : {}),
});

/** A table's paragraphs as its rows and cells, in the order their numbers first come. */
function shapeOf(paragraphs: EditedParagraph[]): TableShape {
  const rows = new Map<number, Map<number, TableParagraph[]>>();
  for (const { paragraph, text, cell } of paragraphs) {
    const row = rows.get(cell!.row) ?? new Map<number, TableParagraph[]>();
    rows.set(cell!.row, row);
    row.set(cell!.column, [...(row.get(cell!.column) ?? []), paragraph ?? { text }]);
  }
  return [...rows.values()].map((row) => [...row.values()]);
}

/**
 * The typed edits that turn the structured form into the edited one.  Paragraphs that keep their
 * `paragraph` stay in order; one left out is removed; one with no `paragraph` is added there.
 * Paragraphs with a `cell` of one `table` are that table: its rows and columns are what they say.
 * With none of a table's paragraphs kept, they are a new table, and with none listed it goes.
 */
export function mapStructured(editable: Editable, edited: EditedDocument[]): MappedEdits {
  const result: MappedEdits = { edits: [], problems: [] };
  for (const { item, paragraphs } of edited) {
    const document = editable.structured.find((each) => each.item === item);
    if (!document) {
      result.problems.push(`Item ${item} is not among the items read.`);
      continue;
    }
    const add = (edit: DocumentEdit) => result.edits.push({ item, edit });
    const kept = new Set<number>();
    let at = 0;
    let waiting: NewParagraph[] = [];
    // What goes in one place, last first: each goes in before what is already there.
    let adding: DocumentEdit[] = [];
    let table: EditedParagraph[] = [];
    const hold = () => {
      if (waiting.length > 0) adding.unshift({ kind: 'insert', at, paragraphs: waiting });
      waiting = [];
    };
    const flush = () => {
      hold();
      adding.forEach(add);
      adding = [];
    };
    const endTable = () => {
      const number = table.find(({ paragraph }) => paragraph !== undefined)?.cell?.table;
      const rows = shapeOf(table);
      const held = document.paragraphs.filter(({ cell }) => cell && cell.table === number);
      const [start] = held;
      if (!start) {
        hold();
        if (table.length > 0) adding.unshift({ kind: 'table', first: at, count: 0, rows });
      } else if (!same(rows, shapeOf(held))) {
        for (const { paragraph } of held) kept.add(paragraph);
        add({ kind: 'table', first: start.paragraph, count: held.length, rows });
        at = start.paragraph + held.length;
      }
      table = [];
    };
    for (const paragraph of paragraphs) {
      if (paragraph.cell?.table !== table[0]?.cell?.table) endTable();
      if (paragraph.cell) table.push(paragraph);
      if (paragraph.paragraph === undefined) {
        if (!paragraph.cell) waiting.push(newParagraph(paragraph));
        else if (paragraph.style !== undefined || paragraph.list) {
          result.problems.push(`Item ${item}: a new cell takes no paragraph style or list.`);
        }
        continue;
      }
      const before = document.paragraphs.find((each) => each.paragraph === paragraph.paragraph);
      if (!before || paragraph.paragraph < at) {
        result.problems.push(`Item ${item} has no paragraph ${paragraph.paragraph} here.`);
        continue;
      }
      if (before.cell?.table !== paragraph.cell?.table) {
        result.problems.push(
          `Item ${item}: paragraph ${paragraph.paragraph} cannot move into or out of a table.`,
        );
        continue;
      }
      flush();
      at = paragraph.paragraph + 1;
      kept.add(paragraph.paragraph);
      textEdits(paragraph.paragraph, before.text, paragraph.text).forEach(add);
      if (before.style !== paragraph.style || !same(before.list, paragraph.list)) {
        const style = paragraph.style === undefined ? {} : { style: paragraph.style };
        add({
          kind: 'style',
          paragraph: paragraph.paragraph,
          ...style,
          list: paragraph.list ?? null,
        });
      }
    }
    endTable();
    flush();
    for (const { paragraph } of document.paragraphs) {
      if (!kept.has(paragraph)) add({ kind: 'remove', first: paragraph, count: 1 });
    }
  }
  return { ...result, edits: joinRemovals(result.edits) };
}
