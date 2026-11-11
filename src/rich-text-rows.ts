import type { Border, Borders, Color, TableCell, TableRow } from './rich-text.ts';

/** Words that start a table row's definition, and the words in one. */
export const ROW_WORDS = /^(tr\w+|taflags|brdr\w+|cl\w+|cellx|gaph|lastrow|nesttableprops)$/;

const SIDES: Record<string, keyof Borders> = { t: 'top', l: 'left', b: 'bottom', r: 'right' };

const newCell = (): TableCell => ({ right: 0, borders: {}, padding: {} });

/**
 * Reads the words of a table row's layout (`\\trowd…\\cellx`), which macOS writes before the
 * row's first paragraph: the row, then each cell up to its right edge.
 */
export class RowReader {
  private row: TableRow | undefined;
  private cell: TableCell = newCell();
  /** The border the next `\\brdr…` words describe. */
  private border: Border | undefined;
  /** `\\lastrow` came after the row's last cell: the row about to end is the table's last. */
  private lastRow = false;

  /** Reads one word, in a table nested `depth` deep, its colours from `colors`. */
  word(word: string, parameter: number | undefined, depth: number, colors: (Color | null)[]): void {
    if (word === 'trowd') {
      this.row = { depth: depth, borders: {}, cells: [] };
      this.cell = newCell();
      this.border = undefined;
      return;
    }
    // macOS writes `\lastrow` after the last cell, just before `\row`, not in the row's layout.
    if (word === 'lastrow' && !this.row) {
      this.lastRow = true;
      return;
    }
    const row = (this.row ??= { depth: 1, borders: {}, cells: [] });
    const cell = this.cell;
    const value = parameter ?? 0;
    const side = /^(?:tr|cl)brdr([tlbr])$/.exec(word)?.[1];
    if (side !== undefined) {
      const borders = word.startsWith('tr') ? row.borders : cell.borders;
      const name = SIDES[side]!;
      this.border = borders[name] = {};
      return;
    }
    if (word.startsWith('brdr')) {
      const border = (this.border ??= {});
      if (word === 'brdrw') border.width = value;
      else if (word === 'brdrcf') border.color = colors[value] ?? null;
      else border.style = word;
      return;
    }
    switch (word) {
      case 'taflags':
        row.flags = value;
        return;
      case 'trgaph':
        row.gap = value;
        return;
      case 'trleft':
        row.left = value;
        return;
      case 'trautofit':
        row.autofit = parameter !== 0;
        return;
      case 'lastrow':
        row.lastRow = true;
        return;
      case 'clvertalt':
      case 'clvertalc':
      case 'clvertalb':
        cell.verticalAlign = (
          { clvertalt: 'top', clvertalc: 'center', clvertalb: 'bottom' } as const
        )[word];
        return;
      case 'clcbpat':
        cell.background = colors[value] ?? null;
        return;
      case 'clshdrawnil':
        cell.noShading = true;
        return;
      case 'clpadl':
        cell.padding.left = value;
        return;
      case 'clpadr':
        cell.padding.right = value;
        return;
      case 'clpadt':
        cell.padding.top = value;
        return;
      case 'clpadb':
        cell.padding.bottom = value;
        return;
      case 'clmgf':
      case 'clmrg':
      case 'clvmgf':
      case 'clvmrg':
        cell.merge = ({ clmgf: 'first', clmrg: 'rest', clvmgf: 'top', clvmrg: 'below' } as const)[
          word
        ];
        return;
      case 'clwWidth':
        cell.width = { ...cell.width, value };
        return;
      case 'clftsWidth':
        cell.width = { ...cell.width, units: value };
        return;
      case 'gaph':
        cell.gap = true;
        return;
      case 'cellx':
        cell.right = value;
        row.cells.push(cell);
        this.cell = newCell();
        this.border = undefined;
        return;
      default: {
        const target = word.startsWith('cl') ? cell : row;
        (target.other ??= {})[word] = parameter ?? true;
      }
    }
  }

  /** The row whose layout has been read, for the paragraph that starts it. */
  /** Whether a row's layout, or its `\\lastrow`, waits for a paragraph. */
  pending(): boolean {
    return this.row !== undefined || this.lastRow;
  }

  take(): TableRow | undefined {
    const { row } = this;
    this.row = undefined;
    return row;
  }

  /** Whether `\\lastrow` marked the row about to end. */
  takeLastRow(): boolean {
    const { lastRow } = this;
    this.lastRow = false;
    return lastRow;
  }
}
