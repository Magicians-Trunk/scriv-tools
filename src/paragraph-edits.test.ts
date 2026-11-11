import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { footnote } from '../test/rtf-builder.ts';
import { readDocumentText } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { applyEdits, readForEditing } from './editable.ts';
import { addMissingStyles, addProjectStyle } from './format-manage.ts';
import {
  paragraphEdits,
  retypedParagraphs,
  shownPiece,
  type WrittenParagraph,
} from './paragraph-edits.ts';
import { openProject, type Project } from './project.ts';
import { saveProject } from './save.ts';
import { headingLevel, styleRoles } from './style-mapping.ts';

const opened = (text: string) =>
  openProject(writeFixture({ items: [{ id: 'A', title: 'A', text }] }));

const held = (project: Project) =>
  readParagraphs(project, readForEditing(project).documents.text('A'));

/** Saves paragraphs as they now stand, and reads them back. */
function saved(project: Project, after: WrittenParagraph[]) {
  const { documents } = readForEditing(project);
  const edits = paragraphEdits('A', held(project), after);
  saveProject(project, { documents: applyEdits(project, documents, edits) });
  return held(project).map(({ paragraph: _paragraph, ...rest }) => rest);
}

const words = (read: WrittenParagraph[]) =>
  read.map(({ text }) => text.map((piece) => piece.text).join(''));

describe('edits from paragraphs as they stand', () => {
  it('makes none for what is the same, however its pieces are split', () => {
    const project = opened(String.raw`one \b two\b0  three\par four`);
    expect(paragraphEdits('A', held(project), held(project))).toEqual([]);
    const [first, second] = held(project);
    const split = first!.text.flatMap((piece) =>
      Array.from(piece.text, (text) => ({ ...piece, text })),
    );
    expect(paragraphEdits('A', held(project), [{ text: split }, second!])).toEqual([]);
  });

  it('changes only the characters that differ', () => {
    const project = opened('one words');
    const edits = paragraphEdits('A', held(project), [{ text: [{ text: 'one word' }] }]);
    expect(edits.map(({ edit }) => edit)).toEqual([
      { kind: 'replace', paragraph: 0, start: 8, end: 9, text: [] },
    ]);
  });

  it('sets and takes off bold and italics on part of a paragraph', () => {
    const project = opened('one words');
    const marked = saved(project, [
      { text: [{ text: 'one ' }, { text: 'wo', bold: true, italic: true }, { text: 'rds' }] },
    ]);
    expect(marked[0]!.text.find(({ text }) => text === 'wo')).toMatchObject({
      bold: true,
      italic: true,
    });
    const plain = saved(project, [{ text: [{ text: 'one words' }] }]);
    expect(plain[0]!.text.some(({ bold, italic }) => bold || italic)).toBe(false);
  });

  it('adds and takes off a character style', () => {
    const project = opened('one words');
    addMissingStyles(project, ['Code Span'], styleRoles(project));
    const look = { style: 'Code Span' };
    const styled = saved(project, [{ text: [{ text: 'one ' }, { text: 'words', ...look }] }]);
    expect(styled[0]!.text.at(-1)).toEqual({ text: 'words', style: 'Code Span' });
    const plain = saved(project, [{ text: [{ text: 'one words' }] }]);
    expect(plain[0]!.text.some(({ style }) => style)).toBe(false);
  });

  it('adds and takes off a link', () => {
    const project = opened('one words');
    const link = { kind: 'address' as const, address: 'https://example.com/' };
    const withLink = saved(project, [{ text: [{ text: 'one ' }, { text: 'words', link }] }]);
    expect(withLink[0]!.text.at(-1)).toEqual({ text: 'words', link });
    const plain = saved(project, [{ text: [{ text: 'one words' }] }]);
    expect(plain[0]!.text.some(({ link: linked }) => linked)).toBe(false);
  });

  it('lines paragraphs up by their words, adding and removing around those that stay', () => {
    const project = opened(String.raw`one\par two\par three`);
    const result = saved(project, [
      { text: [{ text: 'new' }] },
      { text: [{ text: 'one' }] },
      { text: [{ text: 'three' }] },
      { text: [{ text: 'end' }] },
    ]);
    expect(words(result)).toEqual(['new', 'one', 'three', 'end']);
  });

  it('types into an empty paragraph, and keeps one that stays empty, in its style', () => {
    const project = opened(String.raw`one\par `);
    const style = styleRoles(project).headings[1]!;
    addMissingStyles(project, [style], styleRoles(project));
    const empty = saved(project, [{ text: [{ text: 'one' }] }, { style, text: [] }]);
    expect(empty.at(-1)).toEqual({ style, text: [] });
    expect(paragraphEdits('A', held(project), empty)).toEqual([]);
    const typed = saved(project, [{ text: [{ text: 'one' }] }, { style, text: [{ text: 'now' }] }]);
    expect(typed.at(-1)).toMatchObject({ style, text: [{ text: 'now' }] });
  });

  it('keeps a note in place, and takes one out', () => {
    const text = `one${footnote('the note')} two`;
    const project = opened(text);
    const [read] = held(project);
    const edited = read!.text.map((piece) =>
      piece.text === ' two' ? { ...piece, text: ' three' } : piece,
    );
    const kept = saved(project, [{ text: edited }]);
    expect(kept[0]!.text.find(({ note }) => note)).toMatchObject({ text: 'the note' });
    const gone = saved(project, [{ text: [{ text: 'one three' }] }]);
    expect(gone[0]!.text.some(({ note }) => note)).toBe(false);
  });

  it('adds a note between words, and words after a note that ends a paragraph', () => {
    const project = opened('one two');
    const note = { text: 'the note', note: 'footnote' as const };
    const added = saved(project, [{ text: [{ text: 'one' }, note, { text: ' two' }] }]);
    expect(words(added)).toEqual(['onethe note two']);
    const ending = opened(`one${footnote('the note')}`);
    const [read] = held(ending);
    const more = saved(ending, [{ text: [...read!.text, { text: ' more' }] }]);
    expect(more[0]!.text.at(-1)).toMatchObject({ text: ' more' });
    const between = opened(`one${footnote('the note')} two`);
    const [pieces] = held(between);
    const [start, kept, end] = pieces!.text;
    const typed = saved(between, [{ text: [start!, kept!, { text: 'more' }, end!] }]);
    expect(typed[0]!.text.map(({ text }) => text)).toEqual(['one', 'the note', 'more two']);
  });

  it('makes a list item of a new paragraph', () => {
    const project = opened('one');
    const list = { ordered: true, level: 0 };
    const added = saved(project, [{ text: [{ text: 'one' }] }, { text: [{ text: 'two' }], list }]);
    expect(added[1]).toMatchObject({ list });
  });

  it('never leaves a link on words that were not in it', () => {
    const project = opened('one words');
    const link = { kind: 'address' as const, address: 'docs/configuration.md' };
    saved(project, [{ text: [{ text: 'Configuration', link }] }, { text: [{ text: 'Next' }] }]);
    const [first] = saved(project, [{ text: [{ text: '## Documentation' }] }]);
    expect(first!.text).toEqual([{ text: '## Documentation' }]);
  });

  it('keeps a link on new words given it, and takes its words out of others', () => {
    const project = opened('one words');
    const link = { kind: 'address' as const, address: 'docs/a.md' };
    saved(project, [{ text: [{ text: 'See ' }, { text: 'one word', link }, { text: ' now' }] }]);
    const [changed] = saved(project, [
      { text: [{ text: 'See ' }, { text: 'one more word', link }, { text: ' now' }] },
    ]);
    expect(changed!.text[1]).toEqual({ text: 'one more word', link });
    const [plain] = saved(project, [{ text: [{ text: 'See [one more word](docs/a.md) now' }] }]);
    expect(plain!.text).toEqual([{ text: 'See [one more word](docs/a.md) now' }]);
  });

  it('makes a link bold, whole', () => {
    const project = opened('one words');
    const link = { kind: 'address' as const, address: 'https://example.com/' };
    saved(project, [{ text: [{ text: 'one ' }, { text: 'words', link }] }]);
    const strong = saved(project, [
      { text: [{ text: 'one ' }, { text: 'words', link, bold: true }] },
    ]);
    expect(strong[0]!.text.at(-1)).toMatchObject({ text: 'words' });
  });

  it('makes text bold around what is not text', () => {
    const project = opened('one <$n> two');
    const [read] = saved(project, [{ text: [{ text: 'one <$n> two', bold: true }] }]);
    expect(read!.text.at(-1)).toMatchObject({ text: ' two', bold: true });
  });

  it('starts new pieces from what their paragraph style sets', () => {
    const project = opened('one');
    const style = addProjectStyle(project, 'Loud', 'Para');
    style.format = readDocumentText(String.raw`{\rtf1\ansi \b\i Sample\b0\i0}`);
    saved(project, [{ style: 'Loud', text: [{ text: 'one' }] }]);
    const link = { kind: 'address' as const, address: 'https://example.com/' };
    const after = saved(project, [
      { style: 'Loud', text: [{ text: 'one ' }, { text: 'two', link }] },
    ]);
    expect(words(after)).toEqual(['one two']);
  });

  it('says which text is a placeholder, when asked', () => {
    const project = opened('one <$n> two');
    const { documents } = readForEditing(project);
    const read = readParagraphs(project, documents.text('A'), { placeholders: true });
    expect(read[0]!.text.find(({ placeholder }) => placeholder)).toMatchObject({ text: '<$n>' });
    expect(held(project)[0]!.text.some(({ placeholder }) => placeholder)).toBe(false);
  });

  it('changes a paragraph style and a list', () => {
    const project = opened('one');
    addMissingStyles(project, ['Block Quote'], styleRoles(project));
    const text = [{ text: 'one' }];
    expect(saved(project, [{ style: 'Block Quote', text }])[0]!.style).toBe('Block Quote');
    const list = { ordered: false, level: 0 };
    expect(saved(project, [{ text, list }])[0]).toMatchObject({ list });
    expect(saved(project, [{ text }])[0]).toEqual({ text });
  });
});

/** A project with styles for bold and italic, and one that means neither. */
function withMarks(text: string) {
  const project = opened(text);
  addProjectStyle(project, 'Strong', 'Char');
  addProjectStyle(project, 'Emphasis', 'Char');
  addProjectStyle(project, 'Mark', 'Char');
  return project;
}

describe('bold and italic in a project with styles for them', () => {
  const marks = { strong: 'Strong', emphasis: 'Emphasis' };

  /** The stored paragraphs once `after` is saved. */
  function written(project: Project, after: WrittenParagraph[]) {
    const { documents } = readForEditing(project);
    const edits = paragraphEdits('A', held(project), after, marks);
    saveProject(project, { documents: applyEdits(project, documents, edits) });
    return held(project).map(({ text }) => text);
  }

  const shown = (project: Project) =>
    held(project).map(({ text }) => ({ text: text.map((piece) => shownPiece(piece, marks)) }));

  it('writes the style, shows it as the look, and takes it off', () => {
    const project = withMarks('one words');
    const bold: WrittenParagraph[] = [{ text: [{ text: 'one ' }, { text: 'words', bold: true }] }];
    expect(written(project, bold)[0]).toMatchObject([
      { text: 'one ' },
      { text: 'words', style: 'Strong' },
    ]);
    expect(shown(project)[0]!.text[1]).toEqual({ text: 'words', bold: true });
    expect(paragraphEdits('A', held(project), shown(project), marks)).toEqual([]);
    expect(written(project, [{ text: [{ text: 'one words' }] }])[0]).toEqual([
      { text: 'one words' },
    ]);
  });

  it('does the same for italics', () => {
    const project = withMarks('one words');
    const italic: WrittenParagraph[] = [
      { text: [{ text: 'one ' }, { text: 'words', italic: true }] },
    ];
    expect(written(project, italic)[0]![1]).toMatchObject({ text: 'words', style: 'Emphasis' });
    expect(shown(project)[0]!.text[1]).toEqual({ text: 'words', italic: true });
    expect(written(project, [{ text: [{ text: 'one words' }] }])[0]).toEqual([
      { text: 'one words' },
    ]);
  });

  it('leaves a look already there, and takes it off as a look', () => {
    const project = withMarks(String.raw`one \b two\b0  three`);
    const before = shown(project);
    expect(paragraphEdits('A', held(project), before, marks)).toEqual([]);
    const read = written(project, [{ text: [{ text: 'one two three' }] }])[0]!;
    expect(read.map(({ text }) => text).join('')).toBe('one two three');
    expect(read.some(({ bold }) => bold)).toBe(false);
  });

  it('keeps a look on text in another style, or with no style for it', () => {
    const project = withMarks('one words');
    const inMark = [{ text: [{ text: 'one words', style: 'Mark' }] }];
    written(project, inMark);
    const both: WrittenParagraph[] = [
      { text: [{ text: 'one words', style: 'Mark', bold: true, italic: true }] },
    ];
    expect(written(project, both)[0]![0]).toMatchObject({
      style: 'Mark',
      bold: true,
      italic: true,
    });
    const plain = opened('one');
    const edits = paragraphEdits('A', held(plain), [{ text: [{ text: 'one', bold: true }] }]);
    expect(edits.map(({ edit }) => edit)).toMatchObject([{ kind: 'look', bold: true }]);
  });

  it('adds a look to text whose style means the other, and keeps the style', () => {
    const project = withMarks('one');
    written(project, [{ text: [{ text: 'one', bold: true }] }]);
    const both: WrittenParagraph[] = [{ text: [{ text: 'one', bold: true, italic: true }] }];
    expect(written(project, both)[0]![0]).toMatchObject({ style: 'Strong', italic: true });
    expect(written(project, [{ text: [{ text: 'one', bold: true }] }])[0]![0]).toEqual({
      text: 'one',
      style: 'Strong',
    });
  });

  it('writes new text and new paragraphs in the style', () => {
    const project = withMarks('one');
    const [first, second, third] = written(project, [
      { text: [{ text: 'one' }, { text: ' more', bold: true }] },
      { text: [{ text: 'two', bold: true, italic: true }] },
      { text: [{ text: 'three', italic: true }, { text: ' four' }] },
    ]);
    expect(first![1]).toMatchObject({ text: ' more', style: 'Strong' });
    expect(second![0]).toMatchObject({ text: 'two', style: 'Strong', italic: true });
    expect(third![0]).toMatchObject({ text: 'three', style: 'Emphasis' });
  });

  it('keeps new text in its own style, and the other look where only one has a style', () => {
    const project = withMarks('one');
    const added: WrittenParagraph[] = [
      { text: [{ text: 'one' }] },
      { text: [{ text: 'two', style: 'Mark', bold: true }] },
      { text: [{ text: 'three', bold: true, italic: true }] },
    ];
    const edits = paragraphEdits('A', held(project), added, { emphasis: 'Emphasis' });
    expect(edits.map(({ edit }) => edit)).toMatchObject([
      {
        kind: 'insert',
        paragraphs: [
          { text: [{ text: 'two', style: 'Mark', bold: true }] },
          { text: [{ text: 'three', style: 'Emphasis', bold: true }] },
        ],
      },
    ]);
  });

  it('holds a styled and a bare look apart in one stretch', () => {
    const project = withMarks(String.raw`\b one\b0  two`);
    written(project, [
      {
        text: [
          { text: 'one', bold: true },
          { text: ' two', bold: true },
        ],
      },
    ]);
    const read = written(project, [{ text: [{ text: 'one two' }] }]);
    expect(read[0]).toEqual([{ text: 'one' }, { text: ' two' }]);
  });

  it('takes a style off text that replaces what was in it', () => {
    const project = withMarks('one words');
    written(project, [{ text: [{ text: 'one ' }, { text: 'words', style: 'Mark' }] }]);
    const read = written(project, [{ text: [{ text: 'one plain' }] }]);
    expect(read[0]).toEqual([{ text: 'one plain' }]);
  });

  it('gives a project the roles only for styles it has', () => {
    expect(styleRoles(withMarks('one'))).toMatchObject(marks);
    expect(styleRoles(opened('one'))).not.toHaveProperty('strong');
  });
});

describe('style roles', () => {
  it("goes by Scrivener's names, a sample's heading level, and then what it is told", () => {
    const project = opened('one');
    project.styles = [];
    expect(styleRoles(project)).toMatchObject({
      headings: { 1: 'Heading 1', 6: 'Heading 6' },
      quote: 'Block Quote',
      code: 'Code Block',
      codeSpan: 'Code Span',
    });
    expect(styleRoles(project, { quote: 'Aside' })).toMatchObject({
      headings: { 1: 'Heading 1', 2: 'Heading 2' },
      quote: 'Aside',
    });
  });

  it('adds only a style a role means, with a heading level for a heading', () => {
    const project = opened('one');
    project.styles = [];
    const roles = styleRoles(project);
    addMissingStyles(
      project,
      ['Heading 3', 'Code Span', 'Code Block', 'Block Quote', 'Nothing', 'Heading 3'],
      roles,
    );
    const types = project.styles.map(({ name, type }) => [name, type]);
    expect(types).toEqual([
      ['Heading 3', 'Para+Char'],
      ['Code Span', 'Char'],
      ['Code Block', 'Para+Char'],
      ['Block Quote', 'Para'],
    ]);
    expect(headingLevel(project.styles[0]!)).toBe(3);
    expect(styleRoles(project).headings[3]).toBe('Heading 3');
  });
});

describe('paragraphs retyped as lines', () => {
  it('types into an empty paragraph as plain text, and adds an empty line as none', () => {
    const after = retypedParagraphs([{ style: 'Aside', text: [] }], ['typed']);
    expect(after).toEqual([{ style: 'Aside', text: [{ text: 'typed' }] }]);
    expect(retypedParagraphs([], [''])).toEqual([{ text: [] }]);
  });

  it('restyles a paragraph as a heading with its level', () => {
    const before = [{ paragraph: 0, text: [{ text: 'h' }] }];
    const [edit] = paragraphEdits('A', before, [
      { style: 'Heading 1', level: 1, text: [{ text: 'h' }] },
    ]);
    expect(edit?.edit).toEqual({
      kind: 'style',
      paragraph: 0,
      style: 'Heading 1',
      level: 1,
      list: null,
    });
  });

  it('adds a heading with its level', () => {
    const [edit] = paragraphEdits(
      'A',
      [],
      [{ style: 'Heading 2', level: 2, text: [{ text: 'h' }] }],
    );
    expect(edit?.edit).toMatchObject({
      kind: 'insert',
      paragraphs: [{ style: 'Heading 2', level: 2 }],
    });
  });
});
