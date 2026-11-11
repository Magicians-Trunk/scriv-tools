import { describe, expect, it } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { PARA } from '../test/rtf-builder.ts';
import { projectDocuments } from './document.ts';
import { openProject } from './project.ts';
import { findItems, findText, parseSelector, SelectorError } from './selector.ts';

const heading = (level: number, text: string) =>
  `<$Scr_H::${level}>${text}<!$Scr_H::${level}>${PARA}`;

function opened() {
  const dir = writeFixture({
    items: [
      {
        id: 'PART',
        title: 'Part/One',
        type: 'Folder',
        children: [
          {
            id: 'A',
            title: 'Scene',
            custom: { place: 'sea' },
            text: `${heading(1, 'Top')}first${PARA}${heading(2, 'Inner')}second${PARA}`,
          },
          { id: 'B', custom: { place: 'sea' }, text: `third${PARA}${heading(1, 'Next')}fourth` },
        ],
      },
    ],
  });
  const project = openProject(dir);
  return { project, documents: projectDocuments(dir) };
}

describe('parseSelector', () => {
  it('reads each form', () => {
    expect(parseSelector(['id:A'])).toEqual({ items: { kind: 'id', id: 'A' } });
    expect(parseSelector(['path:Draft/A:B', 'heading:Top'])).toEqual({
      items: { kind: 'path', path: 'Draft/A:B' },
      within: { kind: 'heading', text: 'Top' },
    });
    expect(parseSelector(['field:place=a=b', 'text:x'])).toEqual({
      items: { kind: 'field', field: 'place', value: 'a=b' },
      within: { kind: 'text', text: 'x' },
    });
  });

  it('stops on anything else', () => {
    expect(() => parseSelector([])).toThrow(SelectorError);
    expect(() => parseSelector(['id:A', 'text:x', 'text:y'])).toThrow(SelectorError);
    expect(() => parseSelector(['nope'])).toThrow('Not a selector');
    expect(() => parseSelector(['title:A'])).toThrow('Not a selector of items');
    expect(() => parseSelector(['field:noequals'])).toThrow('Not a selector of items');
    expect(() => parseSelector(['id:A', 'id:B'])).toThrow('Not a selector of text');
  });
});

describe('findItems', () => {
  it('finds by ID, by path through a title with a slash, and by a field', () => {
    const { project, documents } = opened();
    const ids = (selector: Parameters<typeof findItems>[2]) =>
      findItems(project, documents, selector).map((item) => item.id);
    expect(ids({ kind: 'id', id: 'A' })).toEqual(['A']);
    expect(ids({ kind: 'path', path: 'Draft/Part/One/Scene' })).toEqual(['A']);
    expect(ids({ kind: 'path', path: 'Draft/Part/One/third' })).toEqual(['B']);
    expect(ids({ kind: 'field', field: 'place', value: 'sea' })).toEqual(['A', 'B']);
  });

  it('stops when nothing matches', () => {
    const { project, documents } = opened();
    expect(() => findItems(project, documents, { kind: 'id', id: 'Z' })).toThrow('Nothing matches');
    expect(() => findItems(project, documents, { kind: 'path', path: 'Draft/Z' })).toThrow(
      'Nothing matches',
    );
  });
});

describe('findText', () => {
  it('runs a section to the next heading of its level or higher, across documents', () => {
    const { project, documents } = opened();
    const items = findItems(project, documents, { kind: 'field', field: 'place', value: 'sea' });
    const places = findText(items, documents, { kind: 'heading', text: 'Top' });
    expect(places.map(({ item, first, count }) => [item.id, first, count])).toEqual([
      ['A', 0, 4],
      ['B', 0, 1],
    ]);
  });

  it('ends a lower section at the next heading above it, and at the end of the text', () => {
    const { project, documents } = opened();
    const items = findItems(project, documents, { kind: 'field', field: 'place', value: 'sea' });
    const inner = findText(items, documents, { kind: 'heading', text: 'Inner' });
    expect(inner.map(({ item, first, count }) => [item.id, first, count])).toEqual([
      ['A', 2, 2],
      ['B', 0, 1],
    ]);
    const last = findText(items, documents, { kind: 'heading', text: 'Next' });
    expect(last.map(({ item, first, count }) => [item.id, first, count])).toEqual([['B', 1, 2]]);
  });

  it('reads a heading whose tags open and close across paragraphs', () => {
    const dir = writeFixture({
      items: [{ id: 'A', title: 'A', text: `<$Scr_H::1>Title${PARA}<!$Scr_H::1>body${PARA}` }],
    });
    const documents = projectDocuments(dir);
    const items = findItems(openProject(dir), documents, { kind: 'id', id: 'A' });
    const [place] = findText(items, documents, { kind: 'heading', text: 'Title' });
    expect(place).toMatchObject({ first: 0, count: 2 });
  });

  it('reads a heading of more than one piece of text', () => {
    const text = `<$Scr_H::1>a <$Scr_Cs::0>b<!$Scr_Cs::0><!$Scr_H::1>${PARA}body`;
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text, styles: [STYLES.codeSpan] }] });
    const documents = projectDocuments(dir);
    const items = findItems(openProject(dir), documents, { kind: 'id', id: 'A' });
    const [place] = findText(items, documents, { kind: 'heading', text: 'a b' });
    expect(place).toMatchObject({ first: 0, count: 2 });
  });

  it('finds paragraphs by text, and stops when nothing matches', () => {
    const { project, documents } = opened();
    const items = findItems(project, documents, { kind: 'id', id: 'A' });
    const [place] = findText(items, documents, { kind: 'text', text: 'sec' });
    expect(place).toMatchObject({ first: 3, count: 1 });
    expect(() => findText(items, documents, { kind: 'text', text: 'zzz' })).toThrow(
      'Nothing matches',
    );
    expect(() => findText(items, documents, { kind: 'heading', text: 'first' })).toThrow(
      'Nothing matches',
    );
  });
});
