/** Comparing Markdown with its tables whole: which cell of a table became which. */
import { matches } from './diff.ts';
import type { Block, TextBlock } from './markdown-tree.ts';
import { same } from './rich-text.ts';
import type { BlockShape } from './style-mapping.ts';

/** A table cell's block. */
export type CellBlock = TextBlock & { shape: Extract<BlockShape, { kind: 'cell' }> };

/** A block that takes a paragraph style: all but a table's. */
export type StyledBlock = TextBlock & { shape: Exclude<BlockShape, { kind: 'cell' }> };

/** A block, or all of a table's, and where the first is among the blocks. */
export type Unit =
  | { kind: 'item'; at: number; item: string; blocks: [] }
  | { kind: 'text'; at: number; blocks: [StyledBlock] }
  | { kind: 'table'; at: number; blocks: CellBlock[] };

/** Whether a block is a table cell's. */
export const isCell = <T extends Block>(block: T): block is T & CellBlock =>
  block.kind === 'text' && block.shape.kind === 'cell';

/** Blocks with each table's taken together, to be compared as one. */
export function unitsOf(blocks: Block[]): Unit[] {
  const units: Unit[] = [];
  blocks.forEach((block, at) => {
    if (block.kind === 'item') {
      units.push({ kind: 'item', at, item: block.item, blocks: [] });
      return;
    }
    const { shape } = block;
    const last = units.at(-1);
    if (shape.kind !== 'cell') units.push({ kind: 'text', at, blocks: [{ ...block, shape }] });
    else if (last?.kind === 'table' && shape.row + shape.column + shape.part > 0) {
      last.blocks.push({ ...block, shape });
    } else units.push({ kind: 'table', at, blocks: [{ ...block, shape }] });
  });
  return units;
}

/** Whether two units read the same, wherever they are. */
export const sameUnit = (a: Unit, b: Unit) => same({ ...a, at: 0 }, { ...b, at: 0 });

/** A table's blocks, in rows of cells of paragraphs, by the numbers they carry. */
export function gridOf<T extends CellBlock>(blocks: T[]): T[][][] {
  const grid: T[][][] = [];
  for (const block of blocks) {
    const { row, column } = block.shape;
    const cells = (grid[row] ??= []);
    (cells[column] ??= []).push(block);
  }
  return grid;
}

/** For each element of `edited`, the element of `old` it was: what matches, then by order. */
function aligned<T>(old: T[], edited: T[], equal: (a: T, b: T) => boolean) {
  const from: (number | undefined)[] = edited.map(() => undefined);
  let a = 0;
  let b = 0;
  const gap = (oldEnd: number, newEnd: number) => {
    for (let at = 0; at < Math.min(oldEnd - a, newEnd - b); at += 1) from[b + at] = a + at;
  };
  for (const match of matches(old, edited, equal)) {
    gap(match.a, match.b);
    for (let at = 0; at < match.length; at += 1) from[match.b + at] = match.a + at;
    a = match.a + match.length;
    b = match.b + match.length;
  }
  gap(old.length, edited.length);
  return from;
}

/** What a cell reads, wherever it is in its table. */
const cellWords = (cell: CellBlock[] | undefined) => cell?.map(({ atoms }) => atoms);

/**
 * Which cell of the old table each cell of the edited one was, if it was one: columns go by their
 * first row, and rows by what they hold in the columns that stayed.
 */
export function pairCells(old: CellBlock[][][], edited: CellBlock[][][]) {
  const columns = aligned(old[0]!, edited[0]!, (a, b) => same(cellWords(a), cellWords(b)));
  const stayed = columns.flatMap((from, to) => (from === undefined ? [] : [{ from, to }]));
  const rows = aligned(
    old.map((row) => stayed.map(({ from }) => cellWords(row[from]))),
    edited.map((row) => stayed.map(({ to }) => cellWords(row[to]))),
    same,
  );
  return (row: number, column: number) => {
    const [fromRow, fromColumn] = [rows[row], columns[column]];
    if (fromRow === undefined || fromColumn === undefined) return undefined;
    return { row: fromRow, column: fromColumn };
  };
}
