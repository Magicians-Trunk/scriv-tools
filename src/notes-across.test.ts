import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { PARA } from '../test/rtf-builder.ts';
import { compileModel } from './compile.ts';
import { documentRichText, projectDocuments } from './document.ts';
import { insertParagraphs, removeParagraphs, setParagraphStyle } from './edit.ts';
import { readParagraphs } from './edit-pieces.ts';
import { replaceInlines, replaceNoteText, replaceRange } from './edit-text.ts';
import { applyEdits, readEditable, readForEditing } from './editable.ts';
import { readModel } from './model.ts';
import { saveProject } from './save.ts';
import { findItems } from './selector.ts';
import { writeRichText } from './rich-text-writer.ts';

/** Markup as an RTF body writes it, its braces and backslashes escaped. */
const rtf = (written: string) => written.replaceAll(/[\\{}]/g, String.raw`\$&`);

const ACROSS = rtf(String.raw`before{\Scrv_fn=first`)
  .concat(PARA, 'middle', PARA)
  .concat(rtf(String.raw`last\end_Scrv_fn}after`), PARA, 'more');

const STOP = 'A note across paragraphs';

function opened(text: string) {
  const dir = writeFixture({ items: [{ id: 'A', title: 'A', text }] });
  const model = readModel(dir);
  return { dir, model, document: projectDocuments(dir).text('A') };
}

const words = (dir: string) =>
  readParagraphs(readModel(dir).project, projectDocuments(dir).text('A')).map(({ text }) => text);

describe('a note across paragraphs', () => {
  it('reads a part in each paragraph', () => {
    const { dir } = opened(ACROSS);
    expect(words(dir).slice(0, 3)).toEqual([
      [{ text: 'before' }, { text: 'first', note: 'footnote' }],
      [{ text: 'middle', note: 'footnote' }],
      [{ text: 'last', note: 'footnote' }, { text: 'after' }],
    ]);
  });

  it('writes back what it read', () => {
    const { document } = opened(ACROSS);
    const written = writeRichText(documentRichText(document));
    expect(written).toContain('\\{\\\\Scrv_fn=first');
    expect(written).toContain('last\\\\end_Scrv_fn\\}after');
    expect(written.match(/Scrv_fn=/g)).toHaveLength(1);
  });

  it('reads an annotation on as typed, and a note in a note', () => {
    const annotated = rtf(String.raw`{\Scrv_annot \color={\R=1\G=0\B=0} \text=a`)
      .concat(PARA)
      .concat(rtf(String.raw`<$Scr_Cs::0>b\end_Scrv_annot}c`));
    expect(words(opened(annotated).dir)).toEqual([
      [{ text: 'a', note: 'annotation' }],
      [{ text: '<$Scr_Cs::0>b', note: 'annotation' }, { text: 'c' }],
    ]);
    const nested = rtf(String.raw`{\Scrv_fn=a{\Scrv_ps=b`)
      .concat(PARA)
      .concat(rtf(String.raw`c\end_Scrv_ps}d\end_Scrv_fn}e`));
    expect(words(opened(nested).dir)).toEqual([
      [{ text: 'a', note: 'footnote' }],
      [{ text: 'd', note: 'footnote' }, { text: 'e' }],
    ]);
  });

  it('reads one that never ends to the end of the document', () => {
    const { document } = opened(`${rtf(String.raw`a{\Scrv_fn=b`)}${PARA}c`);
    expect(writeRichText(documentRichText(document))).toContain('Scrv_fn=b');
  });

  it('stops a compile, which shows the words, and saves with no change', () => {
    const { model, dir } = opened(ACROSS);
    expect(() => compileModel(model)).toThrow(
      'Unsupported: a footnote, annotation or Preserve Formatting across paragraphs',
    );
    const editing = readForEditing(dir);
    const items = findItems(editing.project, editing.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(editing, items);
    expect(editable.markdown).toContain('before[^1]');
    expect(editable.markdown).toContain('[^1]: first');
  });

  it('changes the text of a part', () => {
    const { dir, model } = opened(ACROSS);
    const edits = [
      { item: 'A', edit: { kind: 'note' as const, paragraph: 1, piece: 0, text: 'x' } },
    ];
    saveProject(model.project, { documents: applyEdits(model.project, model.documents, edits) });
    expect(words(dir)[1]).toEqual([{ text: 'x', note: 'footnote' }]);
    expect(words(dir)[0]).toEqual([{ text: 'before' }, { text: 'first', note: 'footnote' }]);
  });

  it('changes the text beside it', () => {
    const { dir, model, document } = opened(ACROSS);
    replaceRange(model.project, document, 2, { start: 0, end: 5 }, 'later');
    saveProject(model.project, { documents: new Map([['A', { content: document }]]) });
    expect(words(dir)[2]).toEqual([{ text: 'last', note: 'footnote' }, { text: 'later' }]);
  });

  it('goes with all its paragraphs', () => {
    const { dir, model, document } = opened(ACROSS);
    removeParagraphs(document, 0, 3);
    saveProject(model.project, { documents: new Map([['A', { content: document }]]) });
    expect(words(dir)).toEqual([[{ text: 'more' }]]);
  });

  it('stops on what would cut it', () => {
    const { model, document } = opened(ACROSS);
    const { project } = model;
    expect(() => removeParagraphs(document, 0, 1)).toThrow(STOP);
    expect(() => removeParagraphs(document, 1, 1)).toThrow(STOP);
    expect(() => insertParagraphs(project, document, 1, [{ text: 'x' }])).toThrow(STOP);
    expect(() => setParagraphStyle(project, document, 1, 'Block Quote')).toThrow(STOP);
    expect(() => replaceInlines(project, document, 0, 1, 1, [])).toThrow(STOP);
    expect(() => replaceInlines(project, document, 1, 0, 0, [{ text: 'x' }])).toThrow(STOP);
    expect(() => replaceInlines(project, document, 2, 0, 0, [{ text: 'x' }])).toThrow(STOP);
    expect(() => replaceRange(project, document, 1, { start: 0, end: 0 }, 'x')).toThrow(STOP);
  });

  it('keeps a note whole beside it, and its note text', () => {
    const { model, document } = opened(ACROSS);
    replaceNoteText(model.project, document, 1, 0, 'mid');
    replaceInlines(model.project, document, 3, 0, 1, [{ text: 'all' }]);
    expect(writeRichText(documentRichText(document))).toContain('mid');
  });
});
