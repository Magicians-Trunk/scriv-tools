import { describe, expect, it } from 'vite-plus/test';
import { rtfDocument } from '../test/rtf-builder.ts';
import { readRichText } from './rich-text-reader.ts';
import { groupParagraphs } from './grouping.ts';

/** A document's paragraphs grouped as the compile reads them, their content as its text. */
const grouped = (source: string) => {
  const document = readRichText(source);
  const paragraphs = document.paragraphs.map((paragraph) => ({
    ...paragraph,
    content: paragraph.content.map((run) => run.text).join(''),
  }));
  return groupParagraphs({ ...document, paragraphs }, '').map((paragraph) => {
    const shown = { ...paragraph };
    delete shown.index;
    return shown;
  });
};

describe('groupParagraphs', () => {
  it('keeps each paragraph, and the empty last line after a closing paragraph mark', () => {
    expect(grouped(rtfDocument('One.  Two\\\n\\\nThree\\\n'))).toEqual([
      { content: 'One.  Two' },
      { content: '' },
      { content: 'Three' },
      { content: '' },
    ]);
    expect(grouped(rtfDocument('A\\par B'))).toEqual([{ content: 'A' }, { content: 'B' }]);
    expect(grouped(rtfDocument(''))).toEqual([]);
  });

  it("says which of the document's paragraphs each is", () => {
    const document = readRichText(rtfDocument('A\\par B'));
    const paragraphs = document.paragraphs.map((paragraph) => ({ ...paragraph, content: '' }));
    const indexes = groupParagraphs({ ...document, paragraphs }, '').map(({ index }) => index);
    expect(indexes).toEqual([0, 1]);
  });

  it('gives list items their level and marker as drawn', () => {
    const source = rtfDocument(
      '\\ls1\\ilvl0 {\\listtext\t\\uc0\\u8226 \t}One\\\n{\\listtext\t{\\f1 2.}\t}Two\\\n\\pard\\ilvl1 Plain',
    );
    expect(grouped(source)).toEqual([
      { content: 'One', list: { level: 0, marker: '•', format: 23 } },
      { content: 'Two', list: { level: 0, marker: '2.', format: 23 } },
      { content: 'Plain' },
    ]);
  });

  it("gives each list item its level's format from the list table, through its override", () => {
    const source =
      '{\\rtf1{\\*\\listtable{\\list{\\listlevel\\levelnfc23}{\\listlevel\\levelnfc4}\\listid7}}' +
      '{\\*\\listoverridetable{\\listoverride\\listid7\\ls2}}' +
      '\\pard\\ls2\\ilvl1 {\\listtext a.}x\\\n\\pard\\ilvl0 {\\listtext -}y}';
    expect(grouped(source)).toEqual([
      { content: 'x', list: { level: 1, marker: 'a.', format: 4 } },
      { content: 'y', list: { level: 0, marker: '-' } },
    ]);
  });

  it('reads a list marker with no list, or a list the document does not define, as a plain item', () => {
    expect(grouped(rtfDocument('{\\listtext -}a\\par\\ls9\\ilvl1{\\listtext *}b'))).toEqual([
      { content: 'a', list: { level: 0, marker: '-' } },
      { content: 'b', list: { level: 1, marker: '*' } },
    ]);
  });

  it('reads cells beyond the row’s cell definitions, and \\itap with no level, as plain cells', () => {
    expect(grouped(rtfDocument('\\trowd\\pard\\intbl\\itap a\\cell \\row '))).toEqual([
      { content: '', row: [{ paragraphs: ['a'], indices: [0], alignment: 'left', merge: 'none' }] },
    ]);
  });

  it('groups table rows into cells with their alignment and merges, a nested table marked', () => {
    const source = rtfDocument(
      '\\itap1\\trowd\\clmgf\\cellx100\\clmrg\\cellx200\\clvmgf\\cellx300' +
        '\\pard\\intbl\\qc Wide\\cell \\pard\\intbl\\cell \\pard\\intbl\\qr Tall\\cell \\row ' +
        '\\itap1\\trowd\\clvmrg\\cellx100\\cellx200\\cellx300' +
        '\\pard\\intbl\\qj One\\\nTwo\\cell \\pard\\intbl\\itap2 x\\nestcell \\nestrow ' +
        '\\pard\\intbl\\ql y\\cell \\lastrow\\row \\pard',
    );
    expect(grouped(source)).toEqual([
      {
        content: '',
        row: [
          { paragraphs: ['Wide'], indices: [0], alignment: 'center', merge: 'first' },
          { paragraphs: [''], indices: [1], alignment: 'left', merge: 'rest' },
          { paragraphs: ['Tall'], indices: [2], alignment: 'right', merge: 'top' },
        ],
      },
      {
        content: '',
        row: [
          { paragraphs: ['One', 'Two'], indices: [3, 4], alignment: 'justified', merge: 'below' },
          { paragraphs: ['x'], indices: [5], alignment: 'left', merge: 'none', nested: true },
          { paragraphs: ['y'], indices: [6], alignment: 'left', merge: 'none', nested: true },
        ],
      },
    ]);
  });
});
