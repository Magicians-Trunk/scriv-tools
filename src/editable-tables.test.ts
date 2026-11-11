import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { type FixtureOptions, writeFixture } from '../test/fixture.ts';
import { annotation, footnote, PARA, preserved, table } from '../test/rtf-builder.ts';
import { compileModel, compileWithImages } from './compile.ts';
import { projectDocuments } from './document.ts';
import { insertParagraphs, removeParagraphs } from './edit.ts';
import { readParagraphs } from './edit-pieces.ts';
import { replaceNoteText } from './edit-text.ts';
import { applyEdits, readEditable, readForEditing } from './editable.ts';
import { mapEdits } from './map-markdown.ts';
import { mapStructured } from './map-structured.ts';
import { markupText } from './markup.ts';
import { readModel } from './model.ts';
import { openProject } from './project.ts';
import { saveProject } from './save.ts';
import { findItems } from './selector.ts';
import { styleMapping } from './style-mapping.ts';

const GRID = table([
  [{ text: 'head' }, { text: 'more' }],
  [{ text: 'left' }, { text: 'right' }],
]);

function opened(text: string, options: Partial<FixtureOptions> = {}) {
  const dir = writeFixture({ ...options, items: [{ id: 'A', title: 'A', text }] });
  const model = readModel(dir);
  const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
  const mapping = styleMapping(model.project);
  return { dir, model, items, mapping, editable: readEditable(model, items) };
}

/** Saves what a change to the Markdown comes to, and gives the document's paragraphs after it. */
function edited(text: string, change: (markdown: string) => string) {
  const { dir, model, mapping, editable } = opened(text);
  const { edits, problems } = mapEdits(editable, change(editable.markdown), mapping);
  expect(problems).toEqual([]);
  saveProject(model.project, { documents: applyEdits(model.project, model.documents, edits) });
  const after = readModel(dir);
  const paragraphs = readParagraphs(after.project, after.documents.text('A'));
  return { dir, paragraphs, words: paragraphs.map(({ text: t }) => t.map((p) => p.text).join('')) };
}

function stopped(text: string, change: (markdown: string) => string) {
  const { mapping, editable } = opened(text);
  return mapEdits(editable, change(editable.markdown), mapping).problems;
}

const linked = (file: string) => `\\{$SCRImageLink[w:1;h:1]=${file}\\}`;

describe('tables in Markdown', () => {
  it('shows a table, and reads back with nothing changed', () => {
    const { editable, mapping } = opened(`before${PARA}${GRID}\\pard after`);
    expect(editable.markdown).toContain('| head | more |');
    expect(editable.markdown).toContain('| left | right |');
    const { edits, problems } = mapEdits(editable, editable.markdown, mapping);
    expect({ edits, problems }).toEqual({ edits: [], problems: [] });
  });

  it('says where each paragraph is in the structured form', () => {
    const { editable } = opened(GRID);
    const cells = editable.structured[0]!.paragraphs.flatMap(({ cell }) => (cell ? [cell] : []));
    expect(cells.at(-1)).toEqual({ table: 0, row: 1, column: 1, part: 0 });
  });

  it('counts tables apart', () => {
    const { editable } = opened(`${GRID}\\pard between${PARA}${GRID}`);
    const cells = editable.structured[0]!.paragraphs.flatMap(({ cell }) => (cell ? [cell] : []));
    expect(new Set(cells.map(({ table: at }) => at)).size).toBe(2);
    expect(editable.markdown.split('| head | more |')).toHaveLength(3);
  });

  it('changes a cell', () => {
    const { words } = edited(GRID, (text) => text.replace('right', 'changed'));
    expect(words).toContain('changed');
    expect(words).toContain('left');
  });

  it('keeps an empty cell in its place', () => {
    const text = table([
      [{ text: 'a' }, { text: '' }],
      [{ text: 'b' }, { text: 'c' }],
    ]);
    expect(edited(text, (markdown) => markdown.replace('| c |', '| d |')).words).toContain('d');
  });

  it('shows and changes each paragraph of a cell', () => {
    const text = table([[{ text: `one${PARA}two` }, { text: 'x' }]]);
    expect(opened(text).editable.markdown).toContain('one<br>two');
    expect(edited(text, (markdown) => markdown.replace('two', 'three')).words).toContain('three');
  });

  it('adds after a table', () => {
    const { words } = edited(`${GRID}\\pard after`, (text) =>
      text.replace('after', 'after\n\nmore text'),
    );
    expect(words.at(-1)).toBe('more text');
  });

  it('takes out a whole table', () => {
    const { words } = edited(`before${PARA}${GRID}\\pard after`, (text) =>
      text.replace(/^\|.*\n/gm, ''),
    );
    expect(words.join()).not.toContain('head');
    expect(words).toContain('after');
  });

  it('reads a whole table when a selection reaches into it', () => {
    const { model, items } = opened(`before${PARA}${GRID}`);
    const place = { item: items[0]!, first: 1, count: 1 };
    const { markdown } = readEditable(model, items, {}, [place]);
    expect(markdown).toContain('| left | right |');
  });

  it('adds plain text after a table outside it, in a document with nothing else', () => {
    const { paragraphs, words } = edited(GRID, (text) => `${text}\nnew text\n`);
    expect(words.at(-1)).toBe('new text');
    expect(paragraphs.at(-1)?.cell).toBeUndefined();
  });

  it('keeps a table whole', () => {
    const { dir, model } = opened(GRID);
    const document = projectDocuments(dir).text('A');
    expect(() => removeParagraphs(document, 0, 1)).toThrow('Part of a table');
    expect(() => insertParagraphs(model.project, document, 1, [{ text: 'x' }])).toThrow(
      'inside a table',
    );
  });

  it('keeps the place of a merged cell, which the compile writes nothing of', () => {
    const merged = table([
      [{ text: 'wide', merge: 'first' }, { merge: 'rest' }],
      [{ text: 'a' }, { text: 'b' }],
    ]);
    expect(edited(merged, (text) => text.replace('| b |', '| c |')).words).toContain('c');
  });

  it('ends a table at the text after it, with no word saying its last row', () => {
    const open = GRID.replace('\\lastrow', '');
    const { editable } = opened(`${open}\\pard between${PARA}${open}`);
    const cells = editable.structured[0]!.paragraphs.flatMap(({ cell }) => (cell ? [cell] : []));
    expect(cells.at(-1)?.table).toBe(1);
  });

  it('leaves the compile as it was', () => {
    const { model } = opened(GRID);
    expect(compileModel(model)).toContain('| left | right |');
  });
});

describe('reading with no compile', () => {
  const noLayout: Partial<FixtureOptions> = {
    compile: (settings) => {
      settings.formats = [];
    },
  };

  it('reads both forms of a project the compile stops on', () => {
    const dir = writeFixture({
      items: [{ id: 'A', title: 'A', text: 'one' }],
      format: (format) => {
        format.postProcessing = { enabled: true };
      },
    });
    const model = readForEditing(dir);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    expect(editable.markdown).toContain('one');
    expect(editable.structured[0]?.paragraphs).toHaveLength(1);
  });

  it('stops on what is not the compile stopping', () => {
    const { model, items } = opened('one');
    const broken = {
      ...model,
      documents: {
        ...model.documents,
        text: () => {
          throw new Error('unreadable');
        },
      },
    };
    expect(() => readEditable(broken, items)).toThrow('unreadable');
  });

  it('reads a project with no compile format', () => {
    const dir = writeFixture({ ...noLayout, items: [{ id: 'A', title: 'A', text: 'one' }] });
    const project = openProject(dir);
    project.styles = [];
    const model = readForEditing(dir);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    expect(readEditable(model, items).markdown).toContain('one');
  });
});

/** Markdown with its first footnote left out. */
const remove = (markdown: string) => markdown.replace(/\[\^1\]:.*\n/, '').replace('[^1]', '');

const NOTE_MARKER = '![note](scrivener:note)';
const PICTURE = String.raw`{\*\shppict{\pict\picw1\pich1\jpegblip ffd8}}`;
const withoutMarker = (markdown: string) => markdown.replace(NOTE_MARKER, '');
const footnoted = (markdown: string) => `${markdown.replace(NOTE_MARKER, '[^1]')}\n[^1]: new\n`;
const withoutFirstLine = (markdown: string) => markdown.replace(/^one.*\n/m, '');

describe('notes in Markdown', () => {
  const text = `one${footnote('note')} two`;

  it('removes a footnote and keeps the text around it', () => {
    const { paragraphs, words } = edited(text, (markdown) =>
      markdown.replace('[^1]', '').replace(/\[\^1\]:.*\n/, ''),
    );
    expect(paragraphs[0]?.text.some(({ note }) => note)).toBe(false);
    expect(words[0]).toBe('one two');
  });

  it('removes one footnote of two, and a change to the text beside it', () => {
    const two = `a${footnote('first')} b${footnote('second')} c`;
    const { paragraphs } = edited(two, (markdown) =>
      markdown.replace('[^1] b', ' changed').replace(/\[\^1\]:.*\n/, ''),
    );
    const pieces = paragraphs[0]!.text;
    expect(pieces.filter(({ note }) => note).map((piece) => piece.text)).toEqual(['second']);
    expect(
      pieces
        .filter(({ note }) => !note)
        .map((piece) => piece.text)
        .join(''),
    ).toContain('changed');
  });

  it('keeps apart what differs either side of a note taken out', () => {
    const bold = edited(`\\b a\\b0 ${footnote('x')}b`, remove).paragraphs[0]!.text;
    expect(bold.map(({ text: piece }) => piece)).toEqual(['a', 'b']);
    const both = edited(`${footnote('x')}${footnote('y')}b`, remove).paragraphs[0]!.text;
    expect(both.map(({ text: piece }) => piece)).toEqual(['y', 'b']);
    const lines = edited(`a\\line ${footnote('x')}\\line b`, remove).paragraphs[0]!.text;
    expect(lines.map(({ text: piece }) => piece).join('')).toContain('a');
  });

  it('stops on a note whose text around it swaps places', () => {
    const problems = stopped(`\\b a\\b0 ${footnote('x')}b`, (markdown) =>
      markdown.replace('**a**[^1]b', 'b[^1]**a**'),
    );
    expect(problems[0]).toContain('moves a note');
  });

  it('keeps what a footnote holds when its words change', () => {
    const formatted = `one${footnote('\\b strong\\b0  plain')} two`;
    const { dir } = edited(formatted, (markdown) => markdown.replace(' plain', ' changed'));
    const [note] = projectDocuments(dir)
      .text('A')
      .paragraphs[0]!.content.filter(({ kind }) => kind === 'footnote');
    const runs = note?.kind === 'footnote' ? note.content : [];
    expect(markupText(runs)).toBe('strong changed');
    expect(
      runs.some((run) => run.kind === 'text' && run.format.bold && run.text === 'strong'),
    ).toBe(true);
  });

  it("keeps an annotation's colour when the structured form changes its words", () => {
    const { dir, model, editable } = opened(`one${annotation('old words')} two`);
    const [first] = editable.structured[0]!.paragraphs;
    const pieces = first!.text.map((piece) =>
      piece.note ? { ...piece, text: 'new words' } : piece,
    );
    const { edits } = mapStructured(editable, [
      { item: 'A', paragraphs: [{ ...first!, text: pieces }] },
    ]);
    const before = model.documents
      .text('A')
      .paragraphs[0]!.content.find(({ kind }) => kind === 'annotation');
    saveProject(model.project, { documents: applyEdits(model.project, model.documents, edits) });
    const after = projectDocuments(dir)
      .text('A')
      .paragraphs[0]!.content.find(({ kind }) => kind === 'annotation');
    expect(after?.kind === 'annotation' && markupText(after.content)).toBe('new words');
    expect(after?.kind === 'annotation' && after.opening).toBe(
      before?.kind === 'annotation' && before.opening,
    );
  });

  it('stops on a change that cuts a link inside a note, and on a piece that is no note', () => {
    const link = String.raw`{\field{\*\fldinst{HYPERLINK "https://a.example"}}{\fldrslt linked}}`;
    const { dir, model } = opened(`one${footnote(`x ${link} y`)}`);
    const document = projectDocuments(dir).text('A');
    expect(() => replaceNoteText(model.project, document, 0, 1, 'x linked z y')).not.toThrow();
    const cut = projectDocuments(dir).text('A');
    expect(() => replaceNoteText(model.project, cut, 0, 1, 'xed y')).toThrow('part of the way');
    expect(() => replaceNoteText(model.project, cut, 0, 0, 'a')).toThrow('not a note');
  });

  it('stops on a footnote turned into a note Markdown cannot make', () => {
    const problems = stopped(text, (markdown) =>
      markdown.replace('[^1]', NOTE_MARKER).replace(/\[\^1\]:.*\n/, ''),
    );
    expect(problems[0]).toContain('Only a footnote, picture');
  });

  it('changes Preserve Formatting by its words, and replaces a picture as a whole', () => {
    const { editable } = opened(`one${preserved('old')}${PICTURE}`);
    const [first] = editable.structured[0]!.paragraphs;
    const changed = first!.text.map((piece) =>
      piece.note ? { ...piece, text: `${piece.text}2` } : piece,
    );
    const { edits } = mapStructured(editable, [
      { item: 'A', paragraphs: [{ ...first!, text: changed }] },
    ]);
    const kinds = edits.map(({ edit }) => edit.kind);
    expect(kinds.toSorted()).toEqual(['inlines', 'note']);
  });

  it('changes a footnote in its place', () => {
    const { paragraphs } = edited(text, (markdown) => markdown.replace(']: note', ']: other'));
    expect(paragraphs[0]?.text.find(({ note }) => note)?.text).toBe('other');
    expect(paragraphs[0]?.text.at(-1)?.text).toBe(' two');
  });

  it('stops on leaving out a note whose content Markdown does not show', () => {
    const note = `one${annotation('kept')} two`;
    expect(stopped(note, withoutMarker)[0]).toContain('does not show');
    expect(stopped(note, footnoted)[0]).toContain('does not show');
    expect(stopped(`${note}${PARA}after`, withoutFirstLine)[0]).toContain('does not show');
  });

  it('stops on removing an embedded picture, and its paragraph, in Markdown', () => {
    expect(stopped(`one ${PICTURE} two`, withoutMarker)[0]).toContain('does not show');
    expect(stopped(`${PICTURE}${PARA}after`, withoutMarker)[0]).toContain('does not show');
  });

  it('removes such a note in the structured form', () => {
    const { editable } = opened(`one ${PICTURE} two`);
    const [first] = editable.structured[0]!.paragraphs;
    const words = first!.text.filter(({ note }) => !note);
    const { edits, problems } = mapStructured(editable, [
      { item: 'A', paragraphs: [{ ...first!, text: words }] },
    ]);
    expect(problems).toEqual([]);
    expect(edits).toHaveLength(1);
  });

  it('moves a note by the text around it', () => {
    const { paragraphs } = edited(`a${footnote('x')} b`, (markdown) =>
      markdown.replace('a[^1] b', 'a b[^1]'),
    );
    expect(paragraphs[0]?.text.map(({ text: piece }) => piece)).toEqual(['a b', 'x']);
  });
});

describe('pictures in Markdown', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000004000000060806000000', 'hex');
  const file = () => {
    const made = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-md-')), 'shot.png');
    fs.writeFileSync(made, png);
    return made;
  };

  it('exports a linked image, and one picture used twice once', () => {
    const image = file();
    const link = linked(image);
    const { model } = opened(link);
    expect(Buffer.from(compileWithImages(model).images[0]!.bytes).equals(png)).toBe(true);
    const twice = opened(`${link} ${link}`);
    expect(compileWithImages(twice.model).images).toHaveLength(1);
  });

  it('stops on two different images of one name', () => {
    const { model } = opened(`${linked(file())} ${linked(file())}`);
    expect(() => compileWithImages(model)).toThrow('two different images named shot');
  });

  it('embeds a picture inside a paragraph', () => {
    const image = file();
    const { paragraphs } = edited('one', (text) => text.replace('one', `one ![a](${image})`));
    expect(paragraphs[0]?.text.at(-1)).toMatchObject({ text: 'shot', note: 'picture' });
  });

  it('embeds a picture as a paragraph of its own, and exports it from a compile', () => {
    const image = file();
    const { dir } = edited('one', (text) => `${text}\n![a](${image})\n`);
    const { text, images } = compileWithImages(readModel(dir));
    expect(text).toContain('![][shot]');
    expect(images[0]?.file).toBe('shot.png');
    expect(Buffer.from(images[0]!.bytes).equals(png)).toBe(true);
  });
});
