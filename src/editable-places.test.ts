import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { annotation, footnote } from '../test/rtf-builder.ts';
import { changeItem, placeAt, readNotes } from './binder-edit.ts';
import { compileModel } from './compile.ts';
import { isPiece, readParagraphs } from './edit-pieces.ts';
import { styleRange } from './edit-styles.ts';
import {
  applyEdits,
  itemMarkdown,
  mapItemMarkdown,
  readEditable,
  readForEditing,
  type DocumentEdit,
} from './editable.ts';
import { styleMapping } from './style-mapping.ts';
import { addProjectStyle, setSectionTypes } from './format-manage.ts';
import { markdownLines } from './markdown-tree.ts';
import type { MarkupNode } from './markup.ts';
import { readModel } from './model.ts';
import {
  derivedTitle,
  draftFolder,
  isProjectFile,
  isProjectFolder,
  openProject,
  type Project,
  projectName,
} from './project.ts';
import { saveProject } from './save.ts';

const BOLD = String.raw`plain \b bold\b0  \ul under\ulnone  rest`;
const LINK = String.raw`see {\field{\*\fldinst{HYPERLINK "https://a.example"}}{\fldrslt linked}} here`;

/** A project with a character and a paragraph style, and one item of this text. */
function opened(text: string) {
  const project = openProject(writeFixture({ items: [{ id: 'A', title: 'First', text }] }));
  addProjectStyle(project, 'Mark', 'Char');
  addProjectStyle(project, 'Aside', 'Para');
  return project;
}

const editableOf = (project: Project) => {
  const model = readForEditing(project);
  const item = { ...draftFolder(project).children[0]!, children: [] };
  return { model, editable: readEditable(model, [item]) };
};

/** Styles a place, saves, and reads the first paragraph's pieces back. */
function styled(
  project: Project,
  paragraph: number,
  style: string | undefined,
  range?: { from: number; to: number },
) {
  const model = readForEditing(project);
  const named = style === undefined ? {} : { style };
  const change: DocumentEdit = range
    ? { kind: 'character', paragraph, start: range.from, end: range.to, ...named }
    : { kind: 'style', paragraph, ...named };
  const edit = { item: 'A', edit: change };
  saveProject(project, { documents: applyEdits(project, model.documents, [edit]) });
  return readParagraphs(project, readForEditing(project).documents.text('A'));
}

/** The nodes of the first paragraph, and the link's, once a stretch of text is styled. */
function linkStyled(
  range: { from: number; to: number },
  style: string | undefined = 'Mark',
  from = opened(LINK),
) {
  styled(from, 0, style, range);
  const [paragraph] = readForEditing(from).documents.text('A').paragraphs;
  const link = paragraph!.content.find((node) => node.kind === 'link');
  return { content: paragraph!.content, link: link?.kind === 'link' ? link.content : [] };
}

const kinds = (nodes: MarkupNode[]) => nodes.map(({ kind }) => kind);

describe('an item alone in Markdown', () => {
  it('reads without the comment that says whose it is, and maps a change', () => {
    const { editable } = editableOf(opened('one words'));
    const markdown = itemMarkdown(editable, 'A');
    expect(markdown).toContain('one words');
    expect(markdown).not.toContain('<!--');
    const { edits, problems } = mapItemMarkdown(editable, 'A', markdown.replace('one', 'changed'));
    expect(problems).toEqual([]);
    expect(edits.length).toBeGreaterThan(0);
  });

  it('maps by what the stylesheet says, with what a caller chooses', () => {
    const model = readForEditing(opened('one'));
    expect(styleMapping(model.project, { quote: 'Aside' }).quote).toBe('Aside');
  });
});

describe('a style at a place', () => {
  it('styles a paragraph, reads it back, and clears it', () => {
    const project = opened(String.raw`one\par two`);
    expect(styled(project, 1, 'Aside')[1]?.style).toBe('Aside');
    expect(styled(project, 1, undefined)[1]?.style).toBeUndefined();
  });

  it('keeps what the text holds, the marks and all, styling only around it', () => {
    const [paragraph] = styled(opened(BOLD), 0, 'Mark', { from: 3, to: 18 });
    expect(paragraph!.text.find(({ text }) => text.includes('bold'))).toMatchObject({
      bold: true,
      style: 'Mark',
    });
    expect(paragraph!.text.map(({ text }) => text).join('')).toBe('plain bold under rest');
  });

  it('keeps a footnote inside what is styled', () => {
    const text = `one${footnote('the note')} two`;
    const [paragraph] = styled(opened(text), 0, 'Mark', { from: 0, to: 7 });
    expect(paragraph!.text.find(({ note }) => note)).toMatchObject({
      text: 'the note',
      note: 'footnote',
    });
  });

  it('takes a link whole, with its markers outside it', () => {
    const [paragraph] = styled(opened(LINK), 0, 'Mark', { from: 0, to: 15 });
    expect(paragraph!.text.find(({ link }) => link)).toMatchObject({ style: 'Mark' });
  });

  it('starts and ends inside a link, which stays one link', () => {
    const { content, link } = linkStyled({ from: 6, to: 8 });
    expect(content.filter(({ kind }) => kind === 'link')).toHaveLength(1);
    expect(kinds(link)).toEqual(['text', 'style', 'text', 'style', 'text']);
    expect(link[1]).toMatchObject({ closing: false, format: { field: expect.any(String) } });
  });

  it('starts inside a link and ends after it', () => {
    const { content, link } = linkStyled({ from: 6, to: 15 });
    expect(kinds(link)).toEqual(['text', 'style', 'text']);
    expect(content.at(-1)).toMatchObject({ kind: 'style', closing: true });
  });

  it('starts before a link and ends inside it', () => {
    const { content, link } = linkStyled({ from: 0, to: 8 });
    expect(content[0]).toMatchObject({ kind: 'style', closing: false });
    expect(kinds(link)).toEqual(['text', 'style', 'text']);
    expect(link[1]).toMatchObject({ closing: true });
  });

  it('ends at the end of a link, outside it, from inside it', () => {
    const { content, link } = linkStyled({ from: 6, to: 10 });
    expect(kinds(link)).toEqual(['text', 'style', 'text']);
    expect(content.at(-2)).toMatchObject({ kind: 'style', closing: true });
  });

  it('clears a style that started inside a link', () => {
    const from = opened(LINK);
    linkStyled({ from: 6, to: 8 }, 'Mark', from);
    const { link } = linkStyled({ from: 0, to: 15 }, undefined, from);
    expect(kinds(link)).toEqual(['text']);
  });

  it('compiles a style that starts inside a link', () => {
    const project = opened(LINK);
    linkStyled({ from: 6, to: 8 }, 'Mark', project);
    expect(compileModel(readModel(project.dir))).toContain('see linked here');
  });

  it('stops part of the way through a placeholder', () => {
    const project = opened('one <$n> two');
    const document = readForEditing(project).documents.text('A');
    expect(() => styleRange(project, document, 0, { start: 5, end: 6 }, 'Mark')).toThrow(
      'part of the way through a placeholder',
    );
  });

  it('styles text in a footnote, and stops on an annotation or what is no note', () => {
    const project = opened(`one${footnote('a word here')}${annotation('kept')}`);
    const document = readForEditing(project).documents.text('A');
    styleRange(project, document, 0, { start: 2, end: 6, piece: 1 }, 'Mark');
    const [, note] = document.paragraphs[0]!.content.filter(isPiece);
    expect(note?.kind === 'footnote' && kinds(note.content)).toEqual([
      'text',
      'style',
      'text',
      'style',
      'text',
    ]);
    const range = { start: 0, end: 1 };
    expect(() => styleRange(project, document, 0, { ...range, piece: 2 }, 'Mark')).toThrow(
      'An annotation cannot hold a style',
    );
    expect(() => styleRange(project, document, 0, { ...range, piece: 0 }, 'Mark')).toThrow(
      'not a note',
    );
  });

  it('restyles text inside another style, and clears it, whatever is either side', () => {
    const project = opened('one words');
    addProjectStyle(project, 'Other', 'Char');
    styled(project, 0, 'Mark', { from: 0, to: 9 });
    const [inside] = styled(project, 0, 'Other', { from: 4, to: 6 });
    expect(inside!.text.map(({ text, style }) => [text, style])).toEqual([
      ['one ', 'Mark'],
      ['wo', 'Other'],
      ['rds', 'Mark'],
    ]);
    const [cleared] = styled(project, 0, undefined, { from: 0, to: 9 });
    expect(cleared!.text.every(({ style }) => style === undefined)).toBe(true);
  });

  it('styles to the end of the text', () => {
    const [paragraph] = styled(opened('one words'), 0, 'Mark', { from: 4, to: 9 });
    expect(paragraph!.text.at(-1)).toMatchObject({ text: 'words', style: 'Mark' });
  });

  it('leaves the compile as it was given no style at all', () => {
    const project = opened('one words');
    const before = compileModel(readModel(project));
    styled(project, 0, undefined, { from: 0, to: 3 });
    expect(compileModel(readModel(project))).toBe(before);
  });
});

describe('places in Markdown', () => {
  it('reads lines of words without their marks', () => {
    expect(markdownLines('# A **bold** title\n\none\ntwo\n\n---\n')).toEqual([
      'A bold title',
      'one',
      'two',
      '',
    ]);
  });
});

describe('titles and names', () => {
  it('takes a title from the synopsis, then the text, then what the item is', () => {
    expect(derivedTitle('Text', ' \nFrom synopsis', ['text'])).toBe('From synopsis');
    expect(derivedTitle('Text', '', ['', ' text '])).toBe('text');
    expect(derivedTitle('Text', '', [])).toBe('Untitled Document');
    expect(derivedTitle('Folder', '', [])).toBe('Untitled Folder');
  });

  it('knows a project by its folder and file', () => {
    expect(isProjectFolder('a.scriv')).toBe(true);
    expect(isProjectFolder('a.txt')).toBe(false);
    expect(isProjectFile('a.scrivx')).toBe(true);
    expect(projectName({ dir: '/x/a.scriv' })).toBe('a');
  });
});

describe('an item changed whole', () => {
  it('sets metadata, custom fields and documents, and reads notes back', () => {
    const project = opened('one');
    project.customFields.push({ id: 'F', title: 'Field', type: 'Text' });
    const { model } = editableOf(project);
    const item = draftFolder(project).children[0]!;
    const change = changeItem(project, model.documents, item, {
      title: '',
      include: false,
      custom: { F: 'held' },
      synopsis: 'short',
      notes: 'a note\nand more',
    });
    expect(item.title).toBeUndefined();
    expect(item.metadata?.custom.F).toBe('held');
    saveProject(project, { documents: new Map([['A', change]]) });
    const { documents } = readForEditing(project);
    expect(documents.synopsis('A')).toBe('short');
    expect(readNotes(project, documents, 'A')).toBe('a note\nand more');
    changeItem(project, documents, item, { custom: { F: '' } });
    expect(item.metadata?.custom.F).toBeUndefined();
  });
});

describe('a place in the binder', () => {
  it('is beside an item, counting without the one moving, or under it', () => {
    const project = openProject(
      writeFixture({
        items: [
          { id: 'A', title: 'A', text: 'a' },
          { id: 'B', title: 'B', text: 'b' },
        ],
      }),
    );
    const draft = draftFolder(project);
    const [first, second] = draft.children;
    expect(placeAt(project, second!, 'before')).toEqual({ parent: draft, index: 1 });
    expect(placeAt(project, second!, 'after', first)).toEqual({ parent: draft, index: 1 });
    expect(placeAt(project, first!, 'into')).toEqual({ parent: first });
    expect(() => placeAt(project, draft, 'before')).toThrow('Nothing goes beside');
  });
});

describe('section types', () => {
  it('names the item a type is set on, and one it cannot name as no type', () => {
    const project = opened('one');
    const { definitions, levels } = project.sectionTypes;
    const item = draftFolder(project).children[0]!;
    item.metadata = { custom: {}, sectionType: { id: 'NOT-LISTED' } };
    expect(() => {
      setSectionTypes(project, { definitions, levels });
    }).toThrow('"undefined" is still set on "First"');
  });
});
