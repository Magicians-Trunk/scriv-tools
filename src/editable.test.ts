import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { type FixtureOptions, STYLES, writeFixture } from '../test/fixture.ts';
import {
  annotation,
  footnote,
  LINE,
  link,
  listItem,
  PARA,
  preserved,
  rtfDocument,
} from '../test/rtf-builder.ts';
import { compileModel } from './compile.ts';
import { insertParagraphs, removeParagraphs } from './edit.ts';
import { projectDocuments } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { applyEdits, readEditable, readForEditing } from './editable.ts';
import { mapEdits } from './map-markdown.ts';
import { type EditedDocument, mapStructured } from './map-structured.ts';
import type { ItemSpec } from '../test/binder-items.ts';
import { type MarkupNode, markupText } from './markup.ts';
import { readModel } from './model.ts';
import { openProject } from './project.ts';
import { saveProject } from './save.ts';
import { findItems } from './selector.ts';
import { type StyleMapping, styleMapping } from './style-mapping.ts';

const BLANK = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'blank.scriv');
const REAL_STYLES = openProject(BLANK).styles;

/** A project of these items, read with the real styles Scrivener writes. */
function read(items: ItemSpec[], options: Partial<FixtureOptions> = {}) {
  const dir = writeFixture({ ...options, items });
  const model = readModel(dir);
  for (const style of model.project.styles) {
    const real = REAL_STYLES.find(({ name }) => name === style.name);
    if (real) style.format = real.format;
  }
  const mapping: StyleMapping = styleMapping(model.project);
  return { dir, model, mapping };
}

/** Makes the edit the Markdown's change comes to, and gives the project's compile after it. */
function changed(items: ItemSpec[], change: (markdown: string) => string, ids = ['A']) {
  const { dir, model, mapping } = read(items);
  const selected = ids.flatMap((id) =>
    findItems(model.project, model.documents, { kind: 'id', id }),
  );
  const editable = readEditable(model, selected);
  const { edits, problems: stopped } = mapEdits(editable, change(editable.markdown), mapping);
  expect(stopped).toEqual([]);
  const documents = applyEdits(model.project, model.documents, edits);
  saveProject(model.project, { documents });
  return compileModel(readModel(dir), { onLeftAsWritten: () => {} });
}

/** What stops the Markdown's change. */
function problems(
  items: ItemSpec[],
  change: (markdown: string) => string,
  options?: Partial<FixtureOptions>,
) {
  const { model, mapping } = read(items, options);
  const selected = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
  const editable = readEditable(model, selected);
  return mapEdits(editable, change(editable.markdown), mapping).problems;
}

const A = (text: string, styles?: string[]): ItemSpec => ({
  id: 'A',
  title: 'A',
  text,
  ...(styles ? { styles } : {}),
});

/** The start of a PNG file of a size: its signature and its header chunk. */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(header);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

const addedItem = (text: string) => `${text}\n<!-- item Z -->\n`;
const swappedItem = (text: string) => text.replace('one', '<!-- item Z -->');
const deepHeading = (text: string) => text.replace('one', 'one\n\n#### Deep');
const deepRestyle = (text: string) => text.replace('one', '#### one');
const addedNote = (text: string) => text.replace('one', 'one ![note](scrivener:note)');

const bullet = (text: string) => listItem(1, 0, '•', text);

describe('readEditable', () => {
  it('gives each item in both forms', () => {
    const { model } = read([A(`one <$Scr_Cs::0>two<!$Scr_Cs::0>`, [STYLES.codeSpan])]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const { structured, markdown } = readEditable(model, items);
    expect(markdown).toContain('one `two`');
    expect(structured).toEqual([
      {
        item: 'A',
        title: 'A',
        paragraphs: [
          {
            paragraph: 0,
            text: [{ text: 'one ' }, { text: 'two', style: 'Code Span' }],
          },
        ],
      },
    ]);
  });

  it('takes in the items under an item, and sets apart items that are not neighbours', () => {
    const { model } = read([
      { id: 'F', title: 'F', type: 'Folder', children: [A('in the folder')] },
      { id: 'M', title: 'M', text: 'skipped' },
      { id: 'Z', title: 'Z', text: 'last' },
    ]);
    const find = (id: string) => findItems(model.project, model.documents, { kind: 'id', id });
    const { structured, markdown } = readEditable(model, [...find('F'), ...find('Z')]);
    expect(structured.map(({ item }) => item)).toEqual(['F', 'A', 'Z']);
    expect(markdown).toContain('in the folder');
    expect(markdown).toContain('last');
    expect(markdown).not.toContain('skipped');
  });

  it('shows an item the compile leaves out in its own words, in both forms', () => {
    const { model } = read([{ ...A('hidden'), include: false }]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const { structured, markdown } = readEditable(model, items);
    expect(structured[0]?.paragraphs).toHaveLength(1);
    expect(markdown).toContain('hidden');
  });
});

describe('style names', () => {
  it('mean nothing to a heading, which its sample says: renamed, the Markdown and the edits are the same', () => {
    const items = [A(`<$Scr_Ps::0>Title<!$Scr_Ps::0>${PARA}body`, [STYLES.heading])];
    const { model } = read(items);
    const selected = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const before = readEditable(model, selected).markdown;
    const names = new Map(model.project.styles.map(({ name }, index) => [name, `Zq${index}`]));
    for (const style of model.project.styles) style.name = names.get(style.name)!;
    const editable = readEditable(model, selected);
    expect(editable.markdown).toBe(before);
    const mapping = styleMapping(model.project);
    const edited = `${editable.markdown}\n# New\n`;
    const { edits } = mapEdits(editable, edited, mapping);
    expect(edits).toMatchObject([{ edit: { paragraphs: [{ style: names.get('Heading 1') }] } }]);
  });
});

describe('a heading as Scrivener writes it', () => {
  /** Keep-with-next and heading tags first, then the style, closed in the next paragraph. */
  const HEADING = `<$ScrKeepWithNext><$Scr_H::1><$Scr_Ps::0>Title${PARA}<!$Scr_H::1><!$Scr_Ps::0>`;

  it('reads as being in its style, and the text after it as not', () => {
    const { model } = read([A(`${HEADING}body`, [STYLES.heading])]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const [title, body] = readEditable(model, items).structured[0]!.paragraphs;
    expect(title?.style).toBe('Heading 1');
    expect(body?.style).toBeUndefined();
  });

  it('gives plain text the look of the body, not of a heading', () => {
    const near = { id: 'N', title: 'N', text: `${HEADING}\\fs30 body`, styles: [STYLES.heading] };
    const headingOnly = { id: 'H', title: 'H', text: HEADING, styles: [STYLES.heading] };
    expect(fontAdded([headingOnly, near])).toMatchObject({ format: { size: 15 } });
  });

  it('keeps keep-with-next when the markers around it change', () => {
    const second = `<$ScrKeepWithNext><$Scr_H::1><$Scr_Ps::0>Next${PARA}<!$Scr_H::1><!$Scr_Ps::0>`;
    const { model } = read([A(`one${PARA}${second}body`, [STYLES.heading])]);
    const document = model.documents.text('A');
    insertParagraphs(model.project, document, 1, [{ style: 'Block Quote', text: 'said' }]);
    removeParagraphs(document, 0, 1);
    const tags = document.paragraphs.flatMap(({ content }) =>
      content.flatMap((node) => (node.kind === 'tag' ? [node.source] : [])),
    );
    expect(tags).toContain('<$ScrKeepWithNext>');
  });
});

describe('readEditable within', () => {
  it('reads only those paragraphs, and leaves the others out of a structured change', () => {
    const { model } = read([A(`one${PARA}two${PARA}three`)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const place = { item: items[0]!, first: 1, count: 1 };
    const editable = readEditable(model, items, {}, [place]);
    expect(editable.markdown).toContain('two');
    expect(editable.markdown).not.toContain('one');
    expect(editable.structured[0]?.paragraphs).toEqual([{ paragraph: 1, text: [{ text: 'two' }] }]);
    const paragraphs = [{ paragraph: 1, text: [{ text: 'two' }] }];
    expect(mapStructured(editable, [{ item: 'A', paragraphs }]).edits).toEqual([]);
  });

  it('reads nothing of Markdown for a paragraph the compile leaves out of its document', () => {
    const included = { id: 'B', title: 'B', text: 'included', include: false };
    const { model } = read([A(`<$include:B>${PARA}body`), included]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const { markdown } = readEditable(model, items);
    expect(markdown).toContain('body');
    expect(markdown).not.toContain('included');
  });
});

describe('mapEdits', () => {
  it('makes nothing of no change', () => {
    expect(changed([A('one')], (text) => text)).toContain('one');
  });

  it('changes text, leaving formatting the Markdown does not show', () => {
    const bold = `{\\b heavy}`;
    const { dir, model, mapping } = read([A(`a ${bold} b`)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const { edits } = mapEdits(editable, editable.markdown.replace(' b', ' c'), mapping);
    const documents = applyEdits(model.project, model.documents, edits);
    saveProject(model.project, { documents });
    const [, heavy] = readModel(dir).documents.text('A').paragraphs[0]!.content;
    expect(heavy).toMatchObject({ text: 'heavy', format: { bold: true } });
  });

  it('reads character styles in new text', () => {
    const out = changed([A('one two')], (text) => text.replace('two', '`two` three'));
    expect(out).toContain('one `two` three');
  });

  it('adds at the very start or end of a paragraph, or to an empty one', () => {
    expect(changed([A('one')], (text) => text.replace('one', 'zero one'))).toContain('zero one');
    expect(changed([A('one')], (text) => text.replace('one', 'one more'))).toContain('one more');
    const empty = `one${PARA}${PARA}two`;
    expect(changed([A(empty)], (text) => text.replace('one\n\n', 'one\nfilled\n'))).toContain(
      'filled',
    );
  });

  it('adds lines after the line before, in the style the mapping gives them', () => {
    const out = changed([A(`one${PARA}two`)], (text) =>
      text.replace('one\n', 'one\n\n# Title\n\n> said\n'),
    );
    expect(out).toContain('one\n# Title\n> said\ntwo');
  });

  it('adds a line above the first paragraph, under the title', () => {
    const out = changed([A('one')], (text) => text.replace('one', 'zero\n\none'));
    expect(out).toContain('zero\none');
  });

  it('adds no empty paragraph around what it adds, whatever the format does with spacing', () => {
    const list = changed([A('one')], (text) => text.replace('one', 'one\n\n* a\n* b\n\n1. c'));
    expect(list).toContain('one\n\n* a\n* b\n1. c');
    const empty = `one${PARA}${PARA}two`;
    expect(changed([A(empty)], (text) => text.replace('one\n', 'one\n\nmore\n'))).toContain(
      'one\nmore\n\ntwo',
    );
  });

  it('removes lines', () => {
    const out = changed([A(`one${PARA}two${PARA}three`)], (text) => text.replace('two\n\n', ''));
    expect(out).toContain('one\nthree');
  });

  it('changes a paragraph style by its mark, its text left alone', () => {
    const text = `<$Scr_Ps::0>Title<!$Scr_Ps::0>${PARA}<$Scr_Ps::1>said<!$Scr_Ps::1>${PARA}body`;
    const out = changed([A(text, [STYLES.heading, STYLES.blockQuote])], (markdown) =>
      markdown.replace('# Title', 'Title').replace('> said', '# said'),
    );
    expect(out).toContain('Title\n# said\nbody');
  });

  it('rewrites a paragraph whose mark and text both change', () => {
    const text = `<$Scr_H::1><$Scr_Ps::0>Title${PARA}<!$Scr_H::1><!$Scr_Ps::0>body`;
    const out = changed([A(text, [STYLES.heading])], (markdown) =>
      markdown.replace('# Title', 'Other'),
    );
    expect(out).toContain('Other\nbody');
  });

  it('follows a paragraph over more than one line', () => {
    const item = listItem(1, 0, '•', `one${LINE}two`);
    const out = changed([A(`${item}${PARA}after`)], (text) => text.replace('two', 'second'));
    expect(out).toContain('* one\n\n\tsecond');
  });

  it('makes two changes in one paragraph over more than one line', () => {
    const item = listItem(1, 0, '•', `one${LINE}two`);
    const out = changed([A(`${item}${PARA}after`)], (text) =>
      text.replace('one', 'first').replace('two', 'second'),
    );
    expect(out).toContain('* first\n\n\tsecond');
  });

  it('takes empty lines between changed paragraphs as nothing', () => {
    const out = changed([A(`one${PARA}two`)], (text) =>
      text.replace('one\n\ntwo', 'one more\n\n\n\ntwo more'),
    );
    expect(out).toContain('one more\ntwo more');
  });

  it('adds lines between two documents to the document before', () => {
    const { model, mapping } = read([A('one'), { id: 'B', title: 'B', text: 'two' }]);
    const items = ['A', 'B'].flatMap((id) =>
      findItems(model.project, model.documents, { kind: 'id', id }),
    );
    const editable = readEditable(model, items);
    const edited = editable.markdown.replace('one', 'one\n\nnew');
    expect(mapEdits(editable, edited, mapping).edits).toMatchObject([
      { item: 'A', edit: { kind: 'insert', at: 1 } },
    ]);
  });

  it('adds lines under a title with no text to that document', () => {
    const items = [{ id: 'A', title: 'Empty' }];
    const { model, mapping } = read(items);
    const selected = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, selected);
    const { edits, problems: stopped } = mapEdits(editable, `${editable.markdown}\nnew\n`, mapping);
    expect(stopped).toEqual([]);
    expect(edits).toMatchObject([{ item: 'A', edit: { kind: 'insert', at: 0 } }]);
  });

  it('reads a list from its paragraphs, with or without a list style', () => {
    const items = [A(`${listItem(1, 0, '•', 'plain list')}${PARA}after`)];
    const { model } = read(items);
    const selected = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, selected);
    expect(editable.structured[0]?.paragraphs[0]?.list).toEqual({ ordered: false, level: 0 });
    expect(editable.markdown).toContain('* plain list');
  });

  it('adds lists and nesting from Markdown, in a project with no list style', () => {
    const out = changed([A('one')], (text) =>
      text.replace('one', 'one\n\n* a\n  * b\n* c\n\n1. d\n'),
    );
    expect(out).toContain('* a\n    * b\n* c');
    expect(out).toContain('1. d');
  });

  it('moves a list item to another level, and out of the list', () => {
    const source = `${bullet('a')}${bullet('b')}${bullet('c')}after`;
    const out = changed([A(source)], (text) =>
      text.replace('* b', '  * b').replace('* c\n', '\nc\n'),
    );
    expect(out).toContain('* a\n    * b');
    expect(out).toContain('c\nafter');
  });

  it('stops on changing or removing what starts an item, and says what to do', () => {
    const [changedItem] = problems([A('one')], (text) => text.replace('item A', 'item Z'));
    expect(changedItem).toContain('must stay');
    expect(changedItem).toContain('structured form');
    const [removed] = problems([A('one')], (text) => text.replace('<!-- item A -->', ''));
    expect(removed).toContain('must stay');
  });

  it('stops on adding what starts an item', () => {
    expect(problems([A('one')], addedItem)[0]).toContain('cannot be added');
    expect(problems([A('one')], swappedItem)[0]).toContain('must stay');
  });

  it('stops on text whose places its first read does not hold', () => {
    const { model, mapping } = read([A('one two')]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const unplaced = editable.blocks.map((block) =>
      block.kind === 'text'
        ? { ...block, places: block.places.map((each) => each.map(() => -1)) }
        : block,
    );
    const changedMarkdown = editable.markdown.replace('one two', 'one three');
    const stopped = mapEdits({ ...editable, blocks: unplaced }, changedMarkdown, mapping);
    expect(stopped.problems[0]).toContain('cannot follow back');
  });

  it('stops on Markdown that has no place, and on nodes nothing is mapped to', () => {
    expect(problems([A('one')], (text) => `${text}\n---\n`)[0]).toContain('has no place');
    const { model, mapping } = read([A('one')]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const shallow = { ...mapping, headings: { 1: 'Heading 1' } };
    for (const change of [deepHeading, deepRestyle]) {
      const { problems: found } = mapEdits(editable, change(editable.markdown), shallow);
      expect(found[0]).toContain('No style is mapped');
    }
  });

  it('stops on a code span when no style is mapped to code', () => {
    const { model, mapping } = read([A('one')]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const none = { ...mapping };
    delete none.codeSpan;
    const edited = editable.markdown.replace('one', 'one `two`');
    expect(mapEdits(editable, edited, none).problems[0]).toContain('No style is mapped to code');
  });

  it('adds an annotation and Preserve Formatting', () => {
    const { dir, model, mapping } = read([A('one')]);
    const editable = readEditable(
      model,
      findItems(model.project, model.documents, { kind: 'id', id: 'A' }),
    );
    const notes =
      'one ![aside](scrivener:annotation) ![*kept*](scrivener:preserved) ![](scrivener:preserved)';
    const { edits } = mapEdits(editable, editable.markdown.replace('one', notes), mapping);
    saveProject(model.project, { documents: applyEdits(model.project, model.documents, edits) });
    const after = readModel(dir);
    expect(readParagraphs(after.project, after.documents.text('A'))[0]?.text).toEqual([
      { text: 'one ' },
      { text: 'aside', note: 'annotation' },
      { text: ' ' },
      { text: 'kept', note: 'preserved' },
      { text: ' ' },
      { text: '', note: 'preserved' },
    ]);
  });

  it('stops on adding a note, and on Markdown the first read cannot follow', () => {
    expect(problems([A('one')], addedNote)[0]).toContain('Only a footnote, picture');
    const { model, mapping } = read([A('one')]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const unfollowed = { ...editable, blocks: editable.blocks.slice(0, 1) };
    expect(mapEdits(unfollowed, editable.markdown, mapping).problems[0]).toContain(
      'cannot be followed',
    );
    const atomless = editable.blocks.map((block) =>
      block.kind === 'text' ? { ...block, atoms: [], places: [] } : block,
    );
    const changedMarkdown = editable.markdown.replace('one', 'two');
    const stopped = mapEdits({ ...editable, blocks: atomless }, changedMarkdown, mapping);
    expect(stopped.problems[0]).toContain('cannot be followed');
  });

  it('stops on blocks with no document to go in', () => {
    const { model, mapping } = read([A('one')]);
    const [problem] = mapEdits(readEditable(model, []), 'new', mapping).problems;
    expect(problem).toContain('no document to go in');
  });

  it('adds before the first paragraph of a part of a document', () => {
    const { model, mapping } = read([A(`one${PARA}two`)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items, {}, [{ item: items[0]!, first: 1, count: 1 }]);
    const edited = editable.markdown.replace('two', 'new\n\ntwo');
    expect(mapEdits(editable, edited, mapping).edits).toMatchObject([
      { item: 'A', edit: { kind: 'insert', at: 1 } },
    ]);
  });

  it('adds pieces beside others, with what Markdown can say of them', () => {
    const out = changed([A('one two')], (text) =>
      text.replace('one two', 'one **loud** [here](https://b.example) two'),
    );
    expect(out).toContain('loud');
    const start = changed([A('`one`')], (text) => text);
    expect(start).toContain('`one`');
  });

  it('changes a line of a code block, and adds one', () => {
    const code = `<$Scr_Ps::0>one${PARA}two${PARA}<!$Scr_Ps::0>after`;
    const out = changed([A(code, [STYLES.codeBlock])], (text) =>
      text.replace('two', 'second\nthird'),
    );
    expect(out).toContain('one\n\tsecond\n\tthird');
  });

  it('adds italics, and a piece where there was none', () => {
    const out = changed([A('one')], (text) => text.replace('one', 'one *slant*'));
    expect(out).toContain('slant');
    const span = `a<$Scr_Cs::0>c<!$Scr_Cs::0>`;
    const between = changed([A(span, [STYLES.codeSpan])], (text) =>
      text.replace('a`c`', 'a**b**`c`'),
    );
    expect(between).toContain('ab`c`');
  });

  it('takes a code span off, leaving the text around it as it was', () => {
    const span = `<$Scr_Cs::0>one<!$Scr_Cs::0> two`;
    const out = changed([A(span, [STYLES.codeSpan])], (text) => text.replace('`one`', 'one'));
    expect(out).toContain('one two');
    expect(out).not.toContain('`');
  });

  it('keeps a line break at the start or end of a list item', () => {
    const lead = listItem(1, 0, '•', `${LINE}one`);
    expect(changed([A(`${lead}${PARA}after`)], (text) => text.replace('one', 'first'))).toContain(
      'first',
    );
    const trail = listItem(1, 0, '•', `one${LINE}`);
    expect(changed([A(`${trail}${PARA}after`)], (text) => text.replace('one', 'first'))).toContain(
      'first',
    );
  });

  it('removes a whole piece', () => {
    const text = `a <$Scr_Cs::0>b<!$Scr_Cs::0> c`;
    expect(
      changed([A(text, [STYLES.codeSpan])], (markdown) => markdown.replace('`b`', '')),
    ).toContain('a  c');
  });
});

/** The note's nodes after the edit, in a project with the note `rich` writes. */
function noteAfter(text: string, edit: (paragraphs: EditedDocument['paragraphs']) => void) {
  const { dir, model } = read([A(text)]);
  const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
  const editable = readEditable(model, items);
  const paragraphs: EditedDocument['paragraphs'] = structuredClone(
    editable.structured[0]!.paragraphs,
  );
  edit(paragraphs);
  const mapped = mapStructured(editable, [{ item: 'A', paragraphs }]);
  expect(mapped.problems).toEqual([]);
  saveProject(model.project, {
    documents: applyEdits(model.project, model.documents, mapped.edits),
  });
  return readModel(dir).documents.text('A').paragraphs[0]!.content;
}

const held = (content: MarkupNode[]) =>
  content.flatMap((node) => (node.kind === 'footnote' ? node.content : []));

describe('what the text holds besides its words', () => {
  const ADDRESS = 'https://a.example';
  const RICH = `<$Scr_Cs::0>code<!$Scr_Cs::0> {\\b heavy} ${link(ADDRESS, 'here')} end${footnote('note')}`;

  const rich = (words: string, target: string) =>
    `${words}${footnote(`a {\\b bold} ${link(ADDRESS, 'linked')} ${target}`)}`;

  /** What is left of a paragraph's content, by kind, after a structured edit. */
  function kinds(edit: (paragraphs: EditedDocument['paragraphs']) => void) {
    const { dir, model } = read([A(RICH, [STYLES.codeSpan])]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const paragraphs: EditedDocument['paragraphs'] = structuredClone(
      editable.structured[0]!.paragraphs,
    );
    edit(paragraphs);
    const mapped = mapStructured(editable, [{ item: 'A', paragraphs }]);
    expect(mapped.problems).toEqual([]);
    const documents = applyEdits(model.project, model.documents, mapped.edits);
    saveProject(model.project, { documents });
    const [paragraph] = readModel(dir).documents.text('A').paragraphs;
    return paragraph!.content;
  }

  it('shows them in the structured form', () => {
    const { model } = read([A(RICH, [STYLES.codeSpan])]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const [document] = readEditable(model, items).structured;
    expect(document?.paragraphs[0]?.text).toEqual([
      { text: 'code', style: 'Code Span' },
      { text: ' ' },
      { text: 'heavy', bold: true },
      { text: ' ' },
      { text: 'here', link: { kind: 'address', address: ADDRESS } },
      { text: ' end' },
      { text: 'note', note: 'footnote' },
    ]);
  });

  it('keeps them through a structured text change', () => {
    const content = kinds((paragraphs) => {
      const last = paragraphs[0]!.text.find(({ text }) => text === ' end')!;
      last.text = ' finish';
    });
    expect(content.map(({ kind }) => kind)).toContain('link');
    expect(content.map(({ kind }) => kind)).toContain('footnote');
    expect(content).toContainEqual(expect.objectContaining({ text: 'heavy' }));
    expect(markupText(content)).toContain(' finish');
    const heavy = content.find((node) => node.kind === 'text' && node.text === 'heavy');
    expect(heavy).toMatchObject({ format: { bold: true } });
  });

  it('keeps them through a structured style change, which makes the text alike', () => {
    const content = kinds((paragraphs) => {
      paragraphs[0]!.style = 'Heading 1';
    });
    expect(content.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['link', 'footnote']));
    // A Paragraph+Character style makes the paragraph's text alike, its bold too.
    const heavy = content.find((node) => node.kind === 'text' && node.text.includes('heavy'));
    expect(heavy).toMatchObject({ text: ' heavy ' });
  });

  it('keeps them through a style change in Markdown', () => {
    const text = `<$Scr_H::1><$Scr_Ps::0>a {\\b heavy} ${link(ADDRESS, 'here')}${footnote('note')}${PARA}<!$Scr_H::1><!$Scr_Ps::0>body`;
    const { dir, model, mapping } = read([A(text, [STYLES.heading])]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const mapped = mapEdits(editable, editable.markdown.replace('# a', 'a'), mapping);
    expect(mapped.problems).toEqual([]);
    const documents = applyEdits(model.project, model.documents, mapped.edits);
    saveProject(model.project, { documents });
    const { content } = readModel(dir).documents.text('A').paragraphs[0]!;
    expect(content.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['link', 'footnote']));
    // The bold is the heading's own look, so out of the heading it takes plain text's.
    const [plain] = content;
    expect(plain).toMatchObject({ kind: 'text', text: 'a heavy ' });
    expect(plain?.kind === 'text' && plain.format.bold).toBeFalsy();
  });

  describe('a note changed beside pieces added or removed', () => {
    it('keeps bold and links with a piece added beside it', () => {
      const content = noteAfter(rich('one', 'end'), (paragraphs) => {
        const [words, note] = paragraphs[0]!.text;
        paragraphs[0]!.text = [
          words!,
          { text: 'new', bold: true },
          { ...note!, text: `${note!.text}!` },
        ];
      });
      expect(markupText(held(content))).toContain('end!');
      expect(held(content).map(({ kind }) => kind)).toContain('link');
      expect(held(content)).toContainEqual(
        expect.objectContaining({ text: 'bold', format: expect.objectContaining({ bold: true }) }),
      );
      expect(markupText(content)).toBe('onenew');
    });

    it('keeps them with a piece removed beside it', () => {
      const content = noteAfter(`{\\b gone}${rich(' kept', 'end')}`, (paragraphs) => {
        const [, words, note] = paragraphs[0]!.text;
        paragraphs[0]!.text = [words!, { ...note!, text: `${note!.text}!` }];
      });
      expect(held(content).map(({ kind }) => kind)).toContain('link');
      expect(markupText(content)).toBe(' kept');
    });

    it('pairs a changed note with the note it most resembles', () => {
      const text = `one${footnote('dropped')}${rich(' two', 'end')}`;
      const content = noteAfter(text, (paragraphs) => {
        const [first, , second, note] = paragraphs[0]!.text;
        paragraphs[0]!.text = [first!, second!, { ...note!, text: `${note!.text}!` }];
      });
      expect(held(content).map(({ kind }) => kind)).toContain('link');
      expect(markupText(held(content))).not.toContain('dropped');
    });

    it('keeps a note when the text before it goes and new text comes after it', () => {
      const content = noteAfter(rich('one', 'end'), (paragraphs) => {
        const [, note] = paragraphs[0]!.text;
        paragraphs[0]!.text = [{ ...note!, text: 'a bold linked' }, { text: 'after' }];
      });
      expect(held(content).map(({ kind }) => kind)).toContain('link');
      expect(markupText(content)).toBe('after');
    });
  });

  it('removes one that is taken out of the structured form, and only that', () => {
    const content = kinds((paragraphs) => {
      paragraphs[0]!.text = paragraphs[0]!.text.filter(({ link: target }) => !target);
    });
    expect(content.map(({ kind }) => kind)).not.toContain('link');
    expect(content.map(({ kind }) => kind)).toContain('footnote');
  });

  it('adds links, bold, italics and footnotes put in the structured form', () => {
    const link2 = { kind: 'address', address: 'https://b.example' } as const;
    const content = kinds((paragraphs) => {
      paragraphs[0]!.text.push(
        { text: 'new', link: link2 },
        { text: 'loud', bold: true, italic: true },
        { text: 'aside', note: 'footnote' },
      );
    });
    expect(content.filter(({ kind }) => kind === 'link')).toHaveLength(2);
    expect(content.filter(({ kind }) => kind === 'footnote')).toHaveLength(2);
    const loud = content.find((node) => node.kind === 'text' && node.text === 'loud');
    expect(loud).toMatchObject({ format: { bold: true, italic: true } });
  });

  it('shows italics, images and notes of every kind', () => {
    const text = `{\\i slant} \\{$SCRImageLink[1,1]=pic.png\\}${annotation('aside')}${preserved('as is')}`;
    const { model } = read([A(text)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const pieces = readEditable(model, items).structured[0]?.paragraphs[0]?.text;
    expect(pieces).toEqual(
      expect.arrayContaining([
        { text: 'slant', italic: true },
        { text: 'pic.png', note: 'image' },
        { text: 'aside', note: 'annotation' },
        { text: 'as is', note: 'preserved' },
      ]),
    );
  });

  it('adds every kind of note in the structured form', () => {
    const content = kinds((paragraphs) => {
      paragraphs[0]!.text.push(
        { text: 'kept', note: 'preserved' },
        { text: 'aside', note: 'annotation' },
        { text: 'pic.png', note: 'image', size: { width: 40, height: 30 } },
      );
    });
    expect(content.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['preserved', 'annotation', 'image']),
    );
    expect(content).toContainEqual(expect.objectContaining({ kind: 'image', path: 'pic.png' }));
  });

  it('embeds a picture from its file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-pic-')), 'shot.PNG');
    fs.writeFileSync(file, png(4, 6));
    const content = kinds((paragraphs) => {
      paragraphs[0]!.text.push({ text: file, note: 'picture' });
    });
    const picture = content.find((node) => node.kind === 'picture');
    expect(picture).toMatchObject({ picture: { name: 'shot', extension: 'png' } });
    expect(JSON.stringify(picture)).toContain('89504e47');
    expect(JSON.stringify(picture)).toContain('picw4');
    expect(JSON.stringify(picture)).toContain('picwgoal80');
    expect(JSON.stringify(picture)).toContain('pichgoal120');
  });

  it('shows a picture at a size asked for, and keeps its own size', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-pic-')), 'shot.png');
    fs.writeFileSync(file, png(4, 6));
    const content = kinds((paragraphs) => {
      paragraphs[0]!.text.push({ text: file, note: 'picture', size: { width: 2, height: 3 } });
    });
    const picture = JSON.stringify(content.find((node) => node.kind === 'picture'));
    expect(picture).toContain('picw4');
    expect(picture).toContain('pich6');
    expect(picture).toContain('picwgoal40');
    expect(picture).toContain('pichgoal60');
  });

  it("links an image at its file's own size", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-pic-')), 'shot.png');
    fs.writeFileSync(file, png(4, 6));
    const content = kinds((paragraphs) => {
      paragraphs[0]!.text.push({ text: file, note: 'image' });
    });
    expect(JSON.stringify(content)).toContain('w:4;h:6');
  });

  it('shows a picture in both forms, and takes one out in the structured form', () => {
    const picture = String.raw`{\*\shppict{\pict {\*\nisusfilename shot}\picw1\pich1\jpegblip ffd8}}`;
    const { dir, model } = read([A(`one ${picture} two`)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const [document] = editable.structured;
    expect(document?.paragraphs[0]?.text).toContainEqual({ text: 'shot', note: 'picture' });
    expect(editable.markdown).toContain('![note](scrivener:note)');
    const text = document!.paragraphs[0]!.text.filter(({ note }) => !note);
    const mapped = mapStructured(editable, [{ item: 'A', paragraphs: [{ paragraph: 0, text }] }]);
    const documents = applyEdits(model.project, model.documents, mapped.edits);
    saveProject(model.project, { documents });
    const { content } = readModel(dir).documents.text('A').paragraphs[0]!;
    expect(content.map(({ kind }) => kind)).not.toContain('picture');
  });

  it('lists a picture with no file name in the structured form', () => {
    const picture = String.raw`{\*\shppict{\pict\picw1\pich1\jpegblip ffd8}}`;
    const dir = writeFixture({ items: [A(`one ${picture}`)] });
    const project = openProject(dir);
    const [paragraph] = readParagraphs(project, projectDocuments(dir).text('A'));
    expect(paragraph?.text).toContainEqual({ text: '', note: 'picture' });
  });

  it('stops on a picture with no size it can read, or not a picture', () => {
    expect(() =>
      kinds((paragraphs) => {
        paragraphs[0]!.text.push({ text: 'shot.png', note: 'picture' });
      }),
    ).toThrow('has no size this can read');
    expect(() =>
      kinds((paragraphs) => {
        const size = { width: 1, height: 1 };
        paragraphs[0]!.text.push({ text: 'notes.txt', note: 'picture', size });
      }),
    ).toThrow('not a picture this can embed');
  });

  it('stops on an image with no size it can read', () => {
    expect(() =>
      kinds((paragraphs) => {
        paragraphs[0]!.text.push({ text: 'pic.png', note: 'image' });
      }),
    ).toThrow('has no size this can read');
  });

  it('adds a footnote from Markdown, and shows one as a footnote', () => {
    const { model, mapping } = read([A(`one${footnote('kept')}`)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    expect(editable.markdown).toContain('[^1]: kept');
    const edited = editable.markdown
      .replace('one[^1]', 'one[^1] two[^2]')
      .concat('\n[^2]: added\n');
    const { edits, problems: stopped } = mapEdits(editable, edited, mapping);
    expect(stopped).toEqual([]);
    const documents = applyEdits(model.project, model.documents, edits);
    const { content } = documents.get('A')!.content.paragraphs[0]!;
    expect(content.filter(({ kind }) => kind === 'footnote')).toHaveLength(2);
  });

  it('adds to an empty paragraph, and restyles one', () => {
    const { dir, model } = read([A(PARA)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const paragraphs = [{ paragraph: 0, text: [{ text: 'filled', bold: true as const }] }];
    const mapped = mapStructured(editable, [{ item: 'A', paragraphs }]);
    const documents = applyEdits(model.project, model.documents, mapped.edits);
    saveProject(model.project, { documents });
    expect(compileModel(readModel(dir), { onLeftAsWritten: () => {} })).toContain('filled');
    const restyled = mapStructured(editable, [
      { item: 'A', paragraphs: [{ paragraph: 0, style: 'Heading 1', text: [] }] },
    ]);
    const again = applyEdits(model.project, model.documents, restyled.edits);
    expect(again.get('A')?.content.paragraphs[0]?.content).toContainEqual(
      expect.objectContaining({ kind: 'style', scope: 'paragraph' }),
    );
  });

  it('takes a note left out of a rewritten paragraph as removed', () => {
    const text = `<$Scr_H::1><$Scr_Ps::0>a${footnote('note')}${PARA}<!$Scr_H::1><!$Scr_Ps::0>body`;
    const compiled = changed([A(text, [STYLES.heading])], (markdown) =>
      markdown.replace('# a[^1]', 'other').replace(/\[\^1\]:.*\n/, ''),
    );
    expect(compiled).toContain('other');
    expect(compiled).not.toContain('note');
  });
});

/** The font of text added to the empty item `E`, beside these items. */
function fontAdded(others: ItemSpec[], preferences?: string) {
  const items = [{ id: 'E', title: 'E' }, ...others];
  const { dir, model, mapping } = read(items);
  if (preferences !== undefined) {
    const file = path.join(dir, 'Settings', 'projectpreferences.xml');
    fs.writeFileSync(file, preferences);
  }
  const selected = findItems(model.project, model.documents, { kind: 'id', id: 'E' });
  const editable = readEditable(model, selected);
  const { edits } = mapEdits(editable, `${editable.markdown}\nnew\n`, mapping);
  const documents = applyEdits(model.project, model.documents, edits);
  const [paragraph] = documents.get('E')!.content.paragraphs;
  return paragraph!.content.find((node) => node.kind === 'text');
}

describe('plain text in a document with none to copy', () => {
  const ARIAL = `\\f1\\fs30 sample`;

  it('copies the nearest plain text in the binder', () => {
    const near = { id: 'N', title: 'N', text: ARIAL };
    expect(fontAdded([near])).toMatchObject({ format: { size: 15 } });
  });

  it('gives text written into an empty paragraph that look too', () => {
    const { model } = read([A(PARA), { id: 'N', title: 'N', text: ARIAL }]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const paragraphs = [{ paragraph: 0, text: [{ text: 'filled' }] }];
    const { edits } = mapStructured(editable, [{ item: 'A', paragraphs }]);
    const documents = applyEdits(model.project, model.documents, edits);
    expect(documents.get('A')?.content.paragraphs[0]?.content).toContainEqual(
      expect.objectContaining({ text: 'filled', format: expect.objectContaining({ size: 15 }) }),
    );
    const direct = applyEdits(model.project, model.documents, [
      { item: 'A', edit: { kind: 'replace', paragraph: 0, start: 0, end: 0, text: 'typed' } },
    ]);
    expect(direct.get('A')?.content.paragraphs[0]?.content).toContainEqual(
      expect.objectContaining({ text: 'typed', format: expect.objectContaining({ size: 15 }) }),
    );
  });

  it('falls back on the format the project stores, then on none', () => {
    const stored = rtfDocument(`\\fs40 Attributes`);
    const xml = `<ProjectPreferences Version="1.0"><TextFormatRTFData><![CDATA[${stored}]]></TextFormatRTFData></ProjectPreferences>`;
    expect(fontAdded([], xml)).toMatchObject({ format: { size: 20 } });
    expect(fontAdded([], '<ProjectPreferences Version="1.0"></ProjectPreferences>')).toMatchObject({
      format: {},
    });
    expect(fontAdded([])).toMatchObject({ format: {} });
  });
});

/** Makes the edit to the structured form, and gives the project's compile after it. */
function restructured(text: string, edit: (paragraphs: EditedDocument['paragraphs']) => void) {
  const { dir, model } = read([A(text, [STYLES.codeSpan])]);
  const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
  const editable = readEditable(model, items);
  const paragraphs: EditedDocument['paragraphs'] = structuredClone(
    editable.structured[0]!.paragraphs,
  );
  edit(paragraphs);
  const mapped = mapStructured(editable, [{ item: 'A', paragraphs }]);
  expect(mapped.problems).toEqual([]);
  const documents = applyEdits(model.project, model.documents, mapped.edits);
  saveProject(model.project, { documents });
  return compileModel(readModel(dir), { onLeftAsWritten: () => {} });
}

describe('lists in the structured form', () => {
  it('adds an item, and takes one out of its list', () => {
    const source = `${bullet('a')}${bullet('b')}after`;
    const out = restructured(source, (paragraphs) => {
      paragraphs[0]!.list = { ordered: false, level: 1 };
      delete paragraphs[1]!.list;
      paragraphs.push({ text: [{ text: 'new' }], list: { ordered: true, level: 0 } });
    });
    expect(out).toContain('new');
    expect(out).toContain('after');
  });
});

describe('mapStructured', () => {
  it('changes plain text by the part that differs', () => {
    const out = restructured('one two', (paragraphs) => {
      paragraphs[0]!.text = [{ text: 'one three' }];
    });
    expect(out).toContain('one three');
  });

  it('changes styled text whole', () => {
    const out = restructured('one <$Scr_Cs::0>two<!$Scr_Cs::0>', (paragraphs) => {
      paragraphs[0]!.text = [{ text: 'a ' }, { text: 'b', style: 'Code Span' }];
    });
    expect(out).toContain('a `b`');
  });

  it('adds, removes and restyles', () => {
    const out = restructured(`one${PARA}two${PARA}three`, (paragraphs) => {
      paragraphs[0]!.style = 'Heading 1';
      paragraphs.splice(
        1,
        1,
        { text: [{ text: 'new' }] },
        { style: 'Heading 1', text: [{ text: 'x' }] },
      );
    });
    expect(out).toContain('# one\nnew\n# x\nthree');
  });

  it('takes a paragraph out of its style', () => {
    const { model } = read([A(`<$Scr_Ps::0>one<!$Scr_Ps::0>`, [STYLES.heading])]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const { edits } = mapStructured(editable, [
      { item: 'A', paragraphs: [{ paragraph: 0, text: [{ text: 'one' }] }] },
    ]);
    expect(edits).toEqual([{ item: 'A', edit: { kind: 'style', paragraph: 0, list: null } }]);
  });

  it('stops on an item not read, a paragraph not there, or one out of order', () => {
    const { model } = read([A(`one${PARA}two`)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const text = [{ text: 'x' }];
    expect(mapStructured(editable, [{ item: 'Z', paragraphs: [] }]).problems[0]).toContain(
      'not among the items',
    );
    const missing = [{ item: 'A', paragraphs: [{ paragraph: 9, text }] }];
    expect(mapStructured(editable, missing).problems[0]).toContain('no paragraph 9');
    const moved = [
      {
        item: 'A',
        paragraphs: [
          { paragraph: 1, text },
          { paragraph: 0, text },
        ],
      },
    ];
    expect(mapStructured(editable, moved).problems[0]).toContain('no paragraph 0');
  });
});

describe('reading a project to edit', () => {
  it('reads no compile format, so one that cannot be read changes nothing', () => {
    const project = openProject(writeFixture({ items: [A('one')] }));
    Object.defineProperty(project, 'compileSettings', {
      get() {
        throw new Error('unreadable');
      },
    });
    const model = readForEditing(project);
    expect(readEditable(model, project.binder).markdown).toContain('one');
  });
});

/** The compile, once the first paragraph's pieces are the pieces given. */
const pieces = (source: string, text: EditedDocument['paragraphs'][number]['text']) =>
  restructured(source, (paragraphs) => {
    paragraphs[0]!.text = text;
  });

describe('code that stops being code', () => {
  const OPENING = `<$Scr_Cs::0>old<!$Scr_Cs::0> rest`;
  const WHOLE = `<$Scr_Cs::0>all of it<!$Scr_Cs::0>`;
  const code = [STYLES.codeSpan];

  it('stays plain when the Markdown rewords a paragraph that opens with it', () => {
    const out = changed([A(OPENING, code)], (text) => text.replace('`old` rest', 'new words'));
    expect(out).toContain('new words');
    expect(out).not.toContain('`');
  });

  it('applies in the Markdown when only the backticks go', () => {
    expect(changed([A(WHOLE, code)], (text) => text.replaceAll('`', ''))).not.toContain('`');
    const out = changed([A(OPENING, code)], (text) => text.replace('`old`', 'old'));
    expect(out).toContain('old rest');
    expect(out).not.toContain('`');
  });

  it('keeps code the Markdown still has among what it replaces', () => {
    const out = changed([A(OPENING, code)], (text) => text.replace('`old` rest', 'a `b` c'));
    expect(out).toContain('a `b` c');
  });

  it('stays plain when the structured form rewords it', () => {
    const out = pieces(OPENING, [{ text: 'new words' }]);
    expect(out).toContain('new words');
    expect(out).not.toContain('`');
  });

  it('applies in the structured form when only the style goes', () => {
    expect(pieces(WHOLE, [{ text: 'all of it' }])).not.toContain('`');
    const out = pieces(OPENING, [{ text: 'old' }, { text: ' rest' }]);
    expect(out).toContain('old rest');
    expect(out).not.toContain('`');
  });

  it('leaves a note in a style where it is', () => {
    const noted = `<$Scr_Cs::0>${footnote('note')}<!$Scr_Cs::0> rest`;
    expect(pieces(noted, [{ text: ' rest' }])).toContain('rest');
  });

  it('keeps the code either side of what leaves it', () => {
    const out = pieces(WHOLE, [
      { text: 'all', style: 'Code Span' },
      { text: ' of ' },
      { text: 'it', style: 'Code Span' },
    ]);
    expect(out).toContain('`all` of `it`');
  });

  it('takes the look of plain text, not of a paragraph that opens with code', () => {
    const near = `<$Scr_Cs::0>{\\fs44 near}<!$Scr_Cs::0> rest`;
    const source = `{\\fs30 plain}${PARA}${near}${PARA}<$Scr_Cs::0>{\\fs44\\b old}<!$Scr_Cs::0>`;
    const { dir, model, mapping } = read([A(source, code)]);
    const items = findItems(model.project, model.documents, { kind: 'id', id: 'A' });
    const editable = readEditable(model, items);
    const { edits } = mapEdits(editable, editable.markdown.replace('`old`', 'old'), mapping);
    saveProject(model.project, { documents: applyEdits(model.project, model.documents, edits) });
    const nodes = readModel(dir).documents.text('A').paragraphs[2]!.content;
    expect(nodes).toEqual([expect.objectContaining({ text: 'old' })]);
    expect(nodes[0]).toMatchObject({ format: { size: 15, bold: true } });
  });
});
