import { describe, expect, it } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { footnote, LIST, listItem, PARA, PLAIN, table } from '../test/rtf-builder.ts';
import { compareDocument } from './document-compare.ts';
import { documentEdits, makeEdits, reverseEdits } from './document-edits.ts';
import { projectDocuments, readDocumentText } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { stretchOf } from './edit-stretch.ts';
import type { DocumentEdit } from './editable.ts';
import { openProject } from './project.ts';
import { plainText } from './text-compare.ts';

function versions(...texts: string[]) {
  const items = texts.map((text, at) => {
    const id = 'ABCD'[at]!;
    return { id, title: id, text, styles: [STYLES.heading, STYLES.codeSpan] };
  });
  const project = openProject(writeFixture({ items }));
  const documents = projectDocuments(project.dir);
  return { project, read: (id: string) => documents.text(id) };
}

/** The edits from one text to another, once they have proved to give it. */
function proved(was: string, now: string) {
  const { project, read } = versions(was, now);
  const edits = documentEdits(project, read('A'), read('B'));
  const made = read('A');
  makeEdits(project, made, edits);
  expect(compareDocument(project, made, read('B')).changed).toBe(false);
  return { edits, words: readParagraphs(project, made).map(({ text }) => plainText(text)) };
}

const cell = (text: string) => ({ text });

const grid = (...rows: string[][]) => table(rows.map((row) => row.map(cell)));

const across = (a: string, b: string) => footnote(`${a}${PARA}${b}`);

const comment = (id: string, words: string) => ({
  id,
  color: [1, 0, 0],
  text: readDocumentText(`{\\rtf1\\ansi ${words}}`),
});

describe('the edits between two versions', () => {
  it('says word changes as edits to the words, and restyles of text as such', () => {
    expect(proved('one two three', 'one 2 three').edits.map(({ kind }) => kind)).toEqual([
      'replace',
    ]);
    const styled = proved('one two', 'one <$Scr_Cs::1>two<!$Scr_Cs::1>');
    expect(styled.edits.map(({ kind }) => kind)).toEqual(['character']);
    expect(proved('one two', String.raw`one \b two\b0 `).edits.map(({ kind }) => kind)).toEqual([
      'look',
    ]);
  });

  it('makes none for the same', () => {
    expect(proved('one', 'one').edits).toEqual([]);
  });

  it('adds and removes paragraphs together, and alone', () => {
    expect(proved(`one${PARA}two`, 'one').edits.map(({ kind }) => kind)).toEqual(['remove']);
    expect(proved('one', `one${PARA}two`).edits.map(({ kind }) => kind)).toEqual(['paragraphs']);
    const swapped = proved(`keep${PARA}alpha beta${PARA}end`, `keep${PARA}gamma delta${PARA}end`);
    expect(swapped.edits).toMatchObject([{ kind: 'paragraphs', first: 1, count: 1 }]);
  });

  it('changes a table by its words, and its shape only as a whole', () => {
    const words = proved(
      `${grid(['a', 'b'], ['c', 'd'])}after`,
      `${grid(['a', 'x'], ['c', 'd'])}after`,
    );
    expect(words.edits.map(({ kind }) => kind)).toEqual(['paragraphs']);
    const grown = proved(
      `before${PARA}${grid(['a', 'b'])}after`,
      `before${PARA}${grid(['a', 'b'], ['c', 'd'])}after`,
    );
    expect(grown.edits).toMatchObject([{ kind: 'paragraphs', first: 1 }]);
    proved(`${grid(['a', 'b'])}after`, 'after');
    proved('after', `${grid(['a', 'b'])}after`);
    proved(`text${PARA}new${PARA}more`, `text${PARA}${grid(['a'])}new words${PARA}more`);
  });

  it('keeps whole a note across paragraphs', () => {
    const changed = proved(
      `one${across('a note', 'goes on')} two`,
      `one${across('a note', 'went on')} two`,
    );
    expect(changed.edits.length).toBeGreaterThan(0);
    proved(`one${across('a', 'b')} two`, 'one two');
    proved('one two', `one${across('a', 'b')} two`);
    proved(`first${PARA}one${across('a', 'b')} two`, `first${PARA}gone${across('a', 'b')} two`);
  });

  it('will not put a stretch inside a note across paragraphs', () => {
    const { project, read } = versions(`one${across('a', 'b')} two`);
    const document = read('A');
    const stretch = stretchOf(document, 0, 1);
    const edit: DocumentEdit = { kind: 'paragraphs', first: 1, count: 0, stretch };
    expect(() => makeEdits(project, document, [edit])).toThrow('must stay whole');
  });

  it('brings lists and styles from the other document, under its own numbers', () => {
    const list = `${LIST}${listItem(1, 0, '•', 'one')}${listItem(1, 0, '•', 'two')}${PLAIN}`;
    proved('plain', `plain${PARA}${list}after`);
    proved(`${list}after`, `${list}more${PARA}after`);
    const { project, read } = versions('text', '<$Scr_Ps::0>head<!$Scr_Ps::0>');
    const held = stretchOf(read('B'), 0, 1);
    const document = read('A');
    document.styleIds = [];
    makeEdits(project, document, [{ kind: 'paragraphs', first: 0, count: 1, stretch: held }]);
    expect(document.styleIds).toEqual([STYLES.heading]);
  });

  it('carries a heading open across paragraphs into what it is put in', () => {
    const { project, read } = versions('text', `<$Scr_H::1>one${PARA}two<!$Scr_H::1>`);
    const document = read('A');
    const stretch = stretchOf(read('B'), 1, 1);
    makeEdits(project, document, [{ kind: 'paragraphs', first: 0, count: 1, stretch }]);
    expect(readParagraphs(project, document).map(({ text }) => plainText(text))).toEqual(['two']);
  });

  it('leaves a list its document never defined as no list', () => {
    const list = `${LIST}${listItem(1, 0, '•', 'one')}${PLAIN}`;
    const { project, read } = versions('text', list);
    const source = read('B');
    source.lists = [];
    const stretch = stretchOf(source, 0, 1);
    const document = read('A');
    const lists = structuredClone(document.lists);
    makeEdits(project, document, [{ kind: 'paragraphs', first: 0, count: 1, stretch }]);
    expect(document.lists).toEqual(lists);
  });

  it('stops on putting paragraphs inside a table', () => {
    const { project, read } = versions(table([[cell('a'), cell('b')]]));
    const stretch = stretchOf(read('A'), 0, 1);
    const edit = { kind: 'paragraphs', first: 1, count: 0, stretch } as const;
    expect(() => makeEdits(project, read('A'), [edit])).toThrow('Part of a table');
  });

  it('says a comment that came, changed and went', () => {
    const { project, read } = versions('text');
    const was = { ...read('A'), comments: [comment('X', 'gone'), comment('Y', 'old')] };
    const now = { ...read('A'), comments: [comment('Y', 'new'), comment('Z', 'came')] };
    const edits = documentEdits(project, was, now);
    expect(edits.map((edit) => edit.kind === 'comment' && edit.id)).toEqual(['X', 'Y', 'Z']);
    const made = structuredClone(was);
    makeEdits(project, made, edits);
    expect(compareDocument(project, made, now).changed).toBe(false);
  });
});

describe('taking back part of a change', () => {
  it('undoes one edit and keeps the rest, in the document as the change left it', () => {
    const { project, read } = versions(
      `one two${PARA}three four${PARA}five`,
      `ONE two${PARA}three FOUR${PARA}five`,
    );
    const edits = documentEdits(project, read('A'), read('B'));
    expect(edits).toHaveLength(2);
    const back = reverseEdits(project, read('A'), edits, [edits[1]!]);
    const made = read('B');
    makeEdits(project, made, back);
    expect(readParagraphs(project, made).map(({ text }) => plainText(text))).toEqual([
      'ONE two',
      'three four',
      'five',
    ]);
  });
});
