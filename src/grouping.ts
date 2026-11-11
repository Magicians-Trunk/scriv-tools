/** A document's paragraphs grouped as the compile reads them: table rows and list items. */
import type { Alignment, ListLevel, RichDocument, TableRow } from './rich-text.ts';

export interface RtfListItem {
  /** The nesting level, from 0. */
  level: number;
  /** The marker as drawn, such as `•` or `2.`. */
  marker: string;
  /** The level's number format from the list table (`\levelnfc`: 0 decimal, 23 bullet…). */
  format?: number;
  /** A level in a bullet's format whose text still writes a number, which Scrivener numbers. */
  counted?: true;
}

/** The list table's bullet format (`\levelnfc23`). */
const BULLET_FORMAT = 23;

/** Whether a list level's text writes a number, whatever its format says. */
export function writesNumber({ text }: ListLevel): boolean {
  return text.parts.some((part) => typeof part !== 'string');
}

/** A paragraph as the compile reads it: its content, or a table row's cells; a list item's. */
export interface Grouped<T> {
  content: T;
  /** Which of the document's paragraphs it is, when it is one of them and in no table. */
  index?: number;
  list?: RtfListItem;
  row?: GroupedCell<T>[];
}

/** A table cell as the compile reads it: its paragraphs, alignment and merge. */
export interface GroupedCell<T> {
  paragraphs: T[];
  /** Which of the document's paragraphs each is; none for one another document included. */
  indices: number[];
  alignment: Alignment;
  /**
   * `first` starts cells merged across columns and `rest` continues them; `top` starts cells
   * merged down rows and `below` continues them.
   */
  merge: 'none' | 'first' | 'rest' | 'top' | 'below';
  /** Set when the cell holds a table of its own. */
  nested?: boolean;
}

/** What grouping needs of a document: its lists, and its paragraphs' formatting and ends. */
/**
 * A document's paragraphs grouped as the compile reads them: a table's paragraphs into rows of
 * cells, and list items with their marker, level and number format.  A document ending in a paragraph mark has an empty last line, but not
 * after a table, where Cocoa always writes a mark that is not part of the text.
 */
export function groupParagraphs<T>(
  document: Pick<RichDocument<T>, 'lists' | 'listOverrides' | 'paragraphs'>,
  empty: T,
): Grouped<T>[] {
  const paragraphs: Grouped<T>[] = [];
  // Each list item's number formats, by the override (`\ls`) it names.
  const lists = new Map(document.lists.map((list) => [list.id, list.levels]));
  const levelsOf = new Map(
    document.listOverrides.map(({ override, listId }) => [override, lists.get(listId)]),
  );
  let row: TableRow | undefined;
  let cells: GroupedCell<T>[] = [];
  let cellParagraphs: T[] = [];
  let cellIndices: number[] = [];
  let nested = false;
  for (const [index, paragraph] of document.paragraphs.entries()) {
    row = paragraph.row ?? row;
    const { content } = paragraph;
    const { table } = paragraph.format;
    if ((table?.depth ?? 1) > 1) nested = true;
    const { kind } = paragraph.end;
    if (kind !== 'paragraph' && kind !== 'document') {
      const cell: GroupedCell<T> = {
        paragraphs: [...cellParagraphs, content],
        indices: [...cellIndices, index],
        alignment: paragraph.format.alignment ?? 'left',
        merge: row?.cells[cells.length]?.merge ?? 'none',
      };
      if (nested) cell.nested = true;
      cells.push(cell);
      cellParagraphs = [];
      cellIndices = [];
      // A row of a table inside a cell ends that cell's table; the cell after it holds it.
      nested = kind === 'nestrow';
      if (kind === 'row') {
        paragraphs.push({ content: empty, row: cells });
        cells = [];
      }
      continue;
    }
    if (table?.inTable || cells.length > 0 || cellParagraphs.length > 0) {
      cellParagraphs.push(content);
      cellIndices.push(index);
      continue;
    }
    const read: Grouped<T> = { content, index };
    if (paragraph.marker) {
      const level = paragraph.format.list?.level ?? 0;
      const marker = paragraph.marker
        .map((run) => run.text)
        .join('')
        .trim();
      const item: RtfListItem = { level, marker };
      const override = paragraph.format.list?.override;
      const format = override === undefined ? undefined : levelsOf.get(override)?.[level];
      if (format) item.format = format.numberFormat;
      if (format?.numberFormat === BULLET_FORMAT && writesNumber(format)) item.counted = true;
      read.list = item;
    }
    paragraphs.push(read);
  }
  const last = document.paragraphs.at(-1);
  if (last?.end.kind === 'paragraph' && paragraphs.at(-1)?.row === undefined) {
    paragraphs.push({ content: empty });
  }
  return paragraphs;
}
