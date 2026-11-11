import { describe, expect, it } from 'vite-plus/test';
import { type FixtureOptions, writeFixture } from '../test/fixture.ts';
import { footnote, PARA, table } from '../test/rtf-builder.ts';
import { compileModel } from './compile.ts';
import { projectDocuments } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { shapeTable } from './edit-tables.ts';
import { applyEdits, readEditable } from './editable.ts';
import { mapEdits } from './map-markdown.ts';
import { type EditedDocument, type EditedParagraph, mapStructured } from './map-structured.ts';
import { readModel } from './model.ts';
import { saveProject } from './save.ts';
import { findItems } from './selector.ts';
import { styleMapping } from './style-mapping.ts';

const GRID = table([
  [{ text: 'head' }, { text: 'more' }],
  [{ text: 'left' }, { text: 'right' }],
  [{ text: 'low' }, { text: 'end' }],
]);

function opened(text: string, options: Partial<FixtureOptions> = {}) {
  const dir = writeFixture({ ...options, items: [{ id: 'A', title: 'A', text }] });
  const model = readModel(dir);
  const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
  const mapping = styleMapping(model.project);
  return { dir, model, mapping, editable: readEditable(model, items) };
}

/** What a project's document reads after it is saved: the rows of its tables, and its text. */
function after(dir: string) {
  const model = readModel(dir);
  const read = readParagraphs(model.project, model.documents.text('A'));
  const rows: string[][] = [];
  for (const { text, cell } of read) {
    if (!cell) continue;
    const row = (rows[cell.row] ??= []);
    const words = text.map((piece) => piece.text).join('');
    row[cell.column] = cell.part > 0 ? `${row[cell.column]}/${words}` : words;
  }
  const words = read.map(({ text }) => text.map((piece) => piece.text).join(''));
  return { rows, words, read, compiled: compileModel(model, { onLeftAsWritten: () => {} }) };
}

/** Saves what a change to the Markdown comes to. */
function markdown(text: string, change: (written: string) => string) {
  const { dir, model, mapping, editable } = opened(text);
  const { edits, problems } = mapEdits(editable, change(editable.markdown), mapping);
  expect(problems).toEqual([]);
  saveProject(model.project, { documents: applyEdits(model.project, model.documents, edits) });
  return after(dir);
}

const problemsOf = (text: string, change: (written: string) => string) => {
  const { mapping, editable } = opened(text);
  return mapEdits(editable, change(editable.markdown), mapping).problems;
};

/** Saves what a change to the structured form comes to. */
function structured(text: string, change: (paragraphs: EditedParagraph[]) => EditedParagraph[]) {
  const { dir, model, editable } = opened(text);
  const edited: EditedDocument = {
    item: 'A',
    paragraphs: change(structuredClone(editable.structured[0]!.paragraphs)),
  };
  const { edits, problems } = mapStructured(editable, [edited]);
  expect(problems).toEqual([]);
  saveProject(model.project, { documents: applyEdits(model.project, model.documents, edits) });
  return after(dir);
}

/** A new cell in the structured form. */
const cell = (text: string, row: number, column: number, at = 9): EditedParagraph => ({
  text: [{ text }],
  cell: { table: at, row, column, part: 0 },
});

const NEW_TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n';

describe('a new table', () => {
  it('goes in from Markdown, and the compile writes it', () => {
    const { rows, compiled } = markdown(`one${PARA}two`, (text) =>
      text.replace('one\n', `one\n\n${NEW_TABLE}`),
    );
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(compiled).toContain('| a | b |');
    expect(compiled).toContain('| 1 | 2 |');
  });

  it('keeps its place among what else is added', () => {
    const { words } = markdown('one', (text) => `${text}\nmore\n\n${NEW_TABLE}\nlast\n`);
    expect(words).toEqual(['one', 'more', 'a', 'b', '1', '2', 'last']);
  });

  it('goes at the end, where the paragraph before gains a mark', () => {
    const { words, rows } = markdown('one', (text) => `${text}\n${NEW_TABLE}`);
    expect(words.at(0)).toBe('one');
    expect(rows).toHaveLength(2);
  });

  it('comes of a paragraph turned into a table, and a paragraph of a table', () => {
    const { rows } = markdown(`one${PARA}two`, (text) => text.replace('one', NEW_TABLE));
    expect(rows[0]).toEqual(['a', 'b']);
    const plain = markdown(`${table([[{ text: 'only' }]])}\\pard after`, (text) =>
      text.replace(/\|.*\n\|.*\n/, 'plain\n'),
    );
    expect(plain.rows).toEqual([]);
    expect(plain.words).toContain('plain');
  });

  it('goes in from the structured form, in order with new paragraphs', () => {
    const { words, rows, read } = structured(`one${PARA}two`, ([one, two]) => [
      one!,
      { text: [{ text: 'before' }] },
      cell('a', 0, 0),
      cell('b', 0, 1),
      cell('c', 1, 0),
      cell('d', 1, 1),
      { text: [{ text: 'after' }] },
      two!,
    ]);
    expect(words).toEqual(['one', 'before', 'a', 'b', 'c', 'd', 'after', 'two']);
    expect(rows[1]).toEqual(['c', 'd']);
    expect(read[5]?.cell).toEqual({ table: 0, row: 1, column: 1, part: 0 });
  });

  it('takes a cell of several paragraphs, and pads a short row', () => {
    const second = { ...cell('b2', 0, 1), cell: { table: 9, row: 0, column: 1, part: 1 } };
    const { rows } = structured('one', ([one]) => [
      one!,
      cell('a', 0, 0),
      cell('b', 0, 1),
      second,
      cell('c', 1, 0),
    ]);
    expect(rows).toEqual([
      ['a', 'b/b2'],
      ['c', ''],
    ]);
  });

  it('goes in a document with no text', () => {
    const { dir, model } = opened('');
    const documents = model.documents;
    const edit = { kind: 'table' as const, first: 0, count: 0, rows: [[[{ text: 'x' }]]] };
    saveProject(model.project, {
      documents: applyEdits(model.project, documents, [{ item: 'A', edit }]),
    });
    expect(after(dir).rows).toEqual([['x']]);
  });

  it('ends a style open where it goes, and the text after goes on in it', () => {
    const text = `<$Scr_Ps::0>one${PARA}two<!$Scr_Ps::0>`;
    const { dir, model } = opened(text, {});
    const document = projectDocuments(dir).text('A');
    document.styleIds = ['S'];
    shapeTable(model.project, document, 1, 0, [[[{ text: 'x' }]]]);
    const nodes = document.paragraphs[1]!.content;
    expect(nodes[0]).toMatchObject({ kind: 'style', closing: true, index: 0 });
    expect(document.paragraphs[2]!.content[0]).toMatchObject({ kind: 'style', closing: false });
  });
});

describe('a table reshaped', () => {
  it('gains a row in Markdown, at its end or inside it', () => {
    const last = markdown(GRID, (text) => `${text.trimEnd()}\n| new | row |\n`);
    expect(last.rows.at(-1)).toEqual(['new', 'row']);
    expect(last.rows).toHaveLength(4);
    expect(last.compiled).toContain('| new | row |');
    const inside = markdown(GRID, (text) => text.replace('| low', '| new | row |\n| low'));
    expect(inside.rows.map(([first]) => first)).toEqual(['head', 'left', 'new', 'low']);
  });

  it('loses a row in Markdown, even its last', () => {
    const { rows } = markdown(GRID, (text) => text.replace('| left | right |\n', ''));
    expect(rows).toEqual([
      ['head', 'more'],
      ['low', 'end'],
    ]);
    const last = markdown(`${GRID}\\pard after`, (text) => text.replace('| low | end |\n', ''));
    expect(last.rows).toHaveLength(2);
    expect(last.words.at(-1)).toBe('after');
    expect(last.compiled).toContain('after');
  });

  it('gains and loses a column in Markdown', () => {
    const added = markdown(GRID, (text) =>
      text
        .replace('| head | more |', '| head | new | more |')
        .replace('| - | - |', '| - | - | - |')
        .replace('| left | right |', '| left | x | right |')
        .replace('| low | end |', '| low | y | end |'),
    );
    expect(added.rows[1]).toEqual(['left', 'x', 'right']);
    expect(added.compiled).toContain('| left | x | right |');
    const lost = markdown(GRID, (text) =>
      text
        .replace('| head | more |', '| more |')
        .replace('| - | - |', '| - |')
        .replace('| left | right |', '| right |')
        .replace('| low | end |', '| end |'),
    );
    expect(lost.rows).toEqual([['more'], ['right'], ['end']]);
  });

  it('changes a cell and its shape together', () => {
    const { rows } = markdown(GRID, (text) =>
      text.replace('right', 'changed').replace('| low | end |', '| low | end |\n| x | y |'),
    );
    expect(rows).toEqual([
      ['head', 'more'],
      ['left', 'changed'],
      ['low', 'end'],
      ['x', 'y'],
    ]);
  });

  it('gains and loses a paragraph of a cell', () => {
    const gained = markdown(GRID, (text) => text.replace('| left |', '| left<br>next |'));
    expect(gained.rows[1]![0]).toBe('left/next');
    const two = table([[{ text: `one${PARA}two` }, { text: 'x' }]]);
    const lost = markdown(two, (text) => text.replace('one<br>two', 'one'));
    expect(lost.rows).toEqual([['one', 'x']]);
  });

  it('keeps what a cell holds, and the layout of what stays', () => {
    const text = table([
      [{ text: `a${footnote('note')}` }, { text: 'b' }],
      [{ text: 'c' }, { text: 'd' }],
    ]);
    const { read } = markdown(text, (written) =>
      written.replace('| c | d |', '| c | d |\n| e | f |'),
    );
    expect(read[0]?.text).toContainEqual({ text: 'note', note: 'footnote' });
  });

  it('stops on losing a note Markdown hides', () => {
    const hidden = table([
      [{ text: 'a' }, { text: 'b' }],
      [{ text: `\\{\\\\Scrv_ps=kept\\\\end_Scrv_ps\\}c` }, { text: 'd' }],
    ]);
    const problems = problemsOf(hidden, (text) => text.replace(/^\| !.*\n/m, ''));
    expect(problems[0]).toContain('removes a note');
  });

  it('gains and loses rows in the structured form', () => {
    const added = structured(GRID, (paragraphs) => [
      ...paragraphs,
      cell('e', 3, 0, 0),
      cell('f', 3, 1, 0),
    ]);
    expect(added.rows.at(-1)).toEqual(['e', 'f']);
    const lost = structured(`${GRID}\\pard after`, (paragraphs) =>
      paragraphs.filter(({ cell: place }) => place?.row !== 2),
    );
    expect(lost.rows).toHaveLength(2);
    expect(lost.words.at(-1)).toBe('after');
  });

  it('adds after a table that lost its last row', () => {
    const { words } = structured(`${GRID}\\pard after`, (paragraphs) => {
      const kept = paragraphs.filter(({ cell: place }) => place?.row !== 2);
      return kept.toSpliced(-1, 0, { text: [{ text: 'new' }] });
    });
    expect(words.slice(-2)).toEqual(['new', 'after']);
  });

  it('loses a column in the structured form, and changes a cell too', () => {
    const { rows } = structured(GRID, (paragraphs) =>
      paragraphs
        .filter(({ cell: place }) => place?.column === 1)
        .map((each) => (each.cell?.row === 0 ? { ...each, text: [{ text: 'top' }] } : each)),
    );
    expect(rows).toEqual([['top'], ['right'], ['end']]);
  });

  it('stops on a new cell in a style, or a paragraph moved in or out', () => {
    const { editable } = opened(`one${PARA}${GRID}`);
    const [one, ...rest] = editable.structured[0]!.paragraphs;
    const styled = [{ ...cell('x', 0, 0), style: 'Block Quote' }, ...rest];
    const moved = [{ ...one!, cell: { table: 0, row: 0, column: 0, part: 0 } }, ...rest];
    const out = rest.map(({ paragraph, text }) => ({ paragraph, text }));
    const problems = (paragraphs: EditedParagraph[]) =>
      mapStructured(editable, [{ item: 'A', paragraphs }]).problems;
    expect(problems(styled)[0]).toContain('no paragraph style');
    expect(problems(moved)[0]).toContain('cannot move');
    expect(problems(out)[0]).toContain('cannot move');
  });

  it('leaves a row with merged cells as it is', () => {
    const merged = table([
      [{ text: 'wide', merge: 'first' }, { merge: 'rest' }],
      [{ text: 'a' }, { text: 'b' }],
    ]);
    const added = markdown(merged, (text) => `${text.trimEnd()}\n| c | d |\n`);
    expect(added.rows.at(-1)).toEqual(['c', 'd']);
    const { model, mapping, editable } = opened(merged);
    const { edits } = mapEdits(
      editable,
      editable.markdown.replace(/^\| wide.*\n/m, '| x | y |\n'),
      mapping,
    );
    expect(edits.at(-1)?.edit.kind).not.toBe('table');
    const lost = {
      item: 'A',
      edit: { kind: 'table' as const, first: 0, count: 4, rows: [[[2], [3]]] },
    };
    expect(() => applyEdits(model.project, model.documents, [lost])).toThrow('merged cells');
  });

  it('stops on a table inside a table, on part of one, and inside a note', () => {
    const { dir, model } = opened(GRID);
    const document = projectDocuments(dir).text('A');
    expect(() => shapeTable(model.project, document, 1, 0, [])).toThrow('as a whole');
    document.paragraphs[0]!.format = { table: { depth: 2, inTable: true } };
    expect(() => shapeTable(model.project, document, 0, 6, [[[0]]])).toThrow('inside a table');
    const across = opened(`\\{\\\\Scrv_fn=a${PARA}b\\\\end_Scrv_fn\\}`);
    const held = projectDocuments(across.dir).text('A');
    expect(() => shapeTable(model.project, held, 1, 0, [[[{ text: 'x' }]]])).toThrow('across');
  });

  it('stops on a table with no cell', () => {
    const { dir, model } = opened('one');
    const document = projectDocuments(dir).text('A');
    expect(() => shapeTable(model.project, document, 0, 0, [])).toThrow('at least one cell');
    expect(() => shapeTable(model.project, document, 0, 0, [[]])).toThrow('at least one cell');
  });

  it('leaves no word of the last row in a row that no longer is', () => {
    const { dir, model } = opened(GRID);
    const document = projectDocuments(dir).text('A');
    document.paragraphs[4]!.row!.lastRow = true;
    document.paragraphs[1]!.format = {};
    shapeTable(model.project, document, 0, 6, [[[0], [1]], [[4], [5]], [[{ text: 'x' }]]]);
    expect(document.paragraphs[2]!.row?.lastRow).toBeUndefined();
    expect(document.paragraphs.at(-1)?.end.lastRow).toBe(true);
  });
});
