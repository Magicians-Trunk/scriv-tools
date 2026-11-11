/** Typed edits on a document's tables: a new one, and rows and columns added or taken away. */
import type { DocumentText } from './document.ts';
import { startDocument } from './edit.ts';
import { join, openAfter, openAt, type Paragraph, transition } from './edit-markers.ts';
import {
  cutsNote,
  cutsTable,
  EditError,
  firstText,
  inlineNodes,
  type NewParagraph,
  NOTE_ACROSS,
  paragraphAt,
  plainNeighbour,
  type Styles,
} from './edit-pieces.ts';
import type { PlainLook } from './plain-look.ts';
import {
  type Border,
  type CharacterFormat,
  type ParagraphFormat,
  same,
  type TableCell,
  type TableRow,
} from './rich-text.ts';

/** A paragraph of a table being shaped: one the table holds, by its index, or a new one. */
export type TableParagraph = number | Pick<NewParagraph, 'text'>;

/** A table's shape: its rows, each of cells, each of paragraphs. */
export type TableShape = TableParagraph[][][];

/** A cell or row border that draws nothing, as Scrivener writes a new table's. */
const NO_BORDER: Border = { style: 'brdrnil' };

/** How wide a new table's columns are, in twips. */
const COLUMN_WIDTH = 2160;

/** A new table's row, as Scrivener writes one. */
const NEW_ROW: TableRow = {
  depth: 1,
  flags: 1,
  gap: 108,
  left: -108,
  borders: { left: NO_BORDER, right: NO_BORDER },
  cells: [],
};

/** A new table's cell, as Scrivener writes one. */
const NEW_CELL: TableCell = {
  right: COLUMN_WIDTH,
  verticalAlign: 'top',
  noShading: true,
  borders: { top: NO_BORDER, left: NO_BORDER, bottom: NO_BORDER, right: NO_BORDER },
  padding: { left: 100, right: 100 },
  gap: true,
};

/** A new table's paragraph format, as Scrivener writes one. */
const NEW_FORMAT: ParagraphFormat = {
  table: { depth: 1, inTable: true },
  defaultTab: 720,
  tightenFactor: 0,
};

/** A cell's layout, and how wide it is in its row. */
interface Laid {
  cell: TableCell;
  width: number;
}

/** A row's cell by its place, with its width. */
function laidOut({ cells }: TableRow, at: number): Laid | undefined {
  const cell = cells[at];
  return cell && { cell, width: cell.right - (cells[at - 1]?.right ?? 0) };
}

/** The layout a new cell takes: of the cell at its place in a row, or that row's last. */
function copiedCell(row: TableRow, column: number): Laid {
  const laid = laidOut(row, column) ?? laidOut(row, row.cells.length - 1);
  const { merge: _, ...cell } = laid?.cell ?? NEW_CELL;
  return { cell, width: laid?.width ?? COLUMN_WIDTH };
}

/** A row of a table, in the document: its layout, and its paragraphs by cell. */
interface HeldRow {
  layout: TableRow;
  cells: number[][];
}

/** A table's rows.  One inside a table stops: its cells are not the table's. */
function rowsIn({ paragraphs }: DocumentText, first: number, count: number): HeldRow[] {
  const rows: HeldRow[] = [];
  let cell: number[] = [];
  let cells: number[][] = [];
  let layout = NEW_ROW;
  for (let index = first; index < first + count; index += 1) {
    const { row, end, format } = paragraphs[index]!;
    if ((format.table?.depth ?? 1) > 1) {
      throw new EditError('A table inside a table keeps its rows and columns.');
    }
    layout = row ?? layout;
    cell.push(index);
    if (end.kind === 'paragraph') continue;
    cells.push(cell);
    cell = [];
    if (end.kind === 'row') {
      rows.push({ layout, cells });
      cells = [];
    }
  }
  return rows;
}

/** Where a paragraph kept is: its row's layout and its column. */
type Places = Map<number, { layout: TableRow; column: number }>;

/** The first paragraph kept among these, when any is. */
const keptIn = (paragraphs: TableParagraph[]) =>
  paragraphs.find((paragraph) => typeof paragraph === 'number');

/** A row's layout: each cell kept as it was, each new one like the row it follows. */
function rowLayout(row: TableParagraph[][], follows: TableRow, places: Places): TableRow {
  const { lastRow: _, ...layout } = follows;
  let right = 0;
  const cells = row.map((paragraphs, column) => {
    const place = places.get(keptIn(paragraphs) ?? -1);
    const laid = (place && laidOut(place.layout, place.column)) ?? copiedCell(follows, column);
    right += laid.width;
    return { ...laid.cell, right };
  });
  return { ...layout, cells };
}

/** Each row with as many cells as the widest, and each cell with a paragraph. */
function evened(rows: TableShape): TableShape {
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) =>
    Array.from({ length: width }, (_, column) => {
      const cell = row[column] ?? [];
      return cell.length > 0 ? cell : [{ text: '' }];
    }),
  );
}

/** A row's cells: a paragraph kept keeps all it holds, and a new one looks like the cell above. */
function rowCells(
  project: Styles,
  document: DocumentText,
  row: TableParagraph[][],
  above: Paragraph[][],
  look: CharacterFormat,
): Paragraph[][] {
  const cells = row.map((paragraphs, column) => {
    const over = above[column]?.[0] ?? above.at(-1)?.[0];
    const format = (over && firstText(over.content)?.format) ?? look;
    return paragraphs.map((paragraph): Paragraph => {
      if (typeof paragraph === 'number') {
        const { row: _, ...kept } = paragraphAt(document, paragraph);
        return { ...kept, end: { format: kept.end.format, kind: 'paragraph' } };
      }
      return {
        format: over?.format ?? NEW_FORMAT,
        content: inlineNodes(project, document, paragraph.text, format),
        end: { kind: 'paragraph', format },
      };
    });
  });
  cells.forEach((cell, column) => {
    const last = cell.at(-1)!;
    last.end = { ...last.end, kind: column === cells.length - 1 ? 'row' : 'cell' };
  });
  return cells;
}

/**
 * Makes `count` paragraphs from `first`, all of one table, into a table of this shape; with none,
 * adds a new table before the paragraph at `first`.  A cell kept keeps its layout, and a new one
 * takes that of the cell above it, or the last of the row above.  Column widths stay, so a table
 * given a column grows.  Rows with merged cells must stay as they are.
 */
export function shapeTable(
  project: Styles,
  document: DocumentText,
  first: number,
  count: number,
  shape: TableShape,
  plain?: PlainLook,
): void {
  if (cutsTable(document, first) || cutsTable(document, first + count)) {
    throw new EditError('A table changes as a whole, and none can go inside another.');
  }
  if (cutsNote(document, first) || cutsNote(document, first + count)) {
    throw new EditError(NOTE_ACROSS);
  }
  if (shape.flat().length === 0) throw new EditError('A table has at least one cell.');
  const rows = evened(shape);
  const held = rowsIn(document, first, count);
  const merged = held.filter(({ layout }) => layout.cells.some(({ merge }) => merge));
  if (merged.some(({ cells }) => !rows.some((row) => same(row, cells)))) {
    throw new EditError('A row with merged cells cannot change.');
  }
  startDocument(project, document);
  const places: Places = new Map();
  for (const { layout, cells } of held) {
    cells.forEach((cell, column) => {
      for (const index of cell) places.set(index, { layout, column });
    });
  }
  const neighbour = firstText(plainNeighbour(document, first)?.content ?? [])?.format;
  const look = neighbour ?? plain?.character ?? {};
  let follows = held[0]?.layout ?? NEW_ROW;
  let above: Paragraph[][] = [];
  const built = rows.flatMap((row) => {
    follows = places.get(keptIn(row.flat()) ?? -1)?.layout ?? follows;
    follows = rowLayout(row, follows, places);
    above = rowCells(project, document, row, above, look);
    above[0]![0]!.row = follows;
    return above.flat();
  });
  const last = built.at(-1)!;
  last.end = { ...last.end, lastRow: true };
  const before = openAt(document, first);
  const after = openAt(document, first + count);
  const { format } = last.end;
  if (count === 0) built[0]!.content.unshift(...transition(before, {}, format));
  const nodes = built.flatMap(({ content }) => content);
  const open = openAfter(nodes, count === 0 ? {} : before);
  const previous = document.paragraphs[first - 1];
  document.paragraphs.splice(first, count, ...built);
  if (previous?.end.kind === 'document') previous.end = { ...previous.end, kind: 'paragraph' };
  join(document, first + built.length, open, after, format);
}
