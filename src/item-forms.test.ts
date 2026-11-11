import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { PARA, table } from '../test/rtf-builder.ts';
import { readParagraphs } from './edit-pieces.ts';
import { applyEdits, type ItemEdit, readForEditing } from './editable.ts';
import { type CompiledText, sealOf } from './item-compile.ts';
import {
  markdownEdits,
  markdownItems,
  readItems,
  structuredEdits,
  structuredItems,
} from './item-forms.ts';
import { findItems, findText, parseSelector } from './selector.ts';
import { styleRoles } from './style-mapping.ts';
import { plainText } from './text-compare.ts';

/** A project to edit, and the items and places a selector names in it. */
function opened(text: string, selector = ['id:A']) {
  const model = readForEditing(writeFixture({ items: [{ id: 'A', title: 'A', text }] }));
  const { items, within } = parseSelector(selector);
  const found = findItems(model.project, model.documents, items);
  const places = within && findText(found, model.documents, within);
  const roles = styleRoles(model.project);
  return { model, roles, items: readItems(model, found, places) };
}

/** Item A's compiled text, as a compile might give it. */
const COMPILES = { pieces: new Map([['A', ['A\n\none\ntwo']]]) };
const SEAL = sealOf(['A\n\none\ntwo']);
/** The compiled block of item A, as the Markdown form writes it. */
const BLOCK = [
  `<!-- compiled A ${SEAL}: read only, as the compile writes this item; import refuses the item if it changes -->`,
  '```\nA\n\none\ntwo\n```',
  '<!-- end of compiled A -->',
].join('\n\n');

/** Item A's paragraphs as plain text, once edits are made. */
const madeText = (model: ReturnType<typeof opened>['model'], edits: ItemEdit[]) =>
  readParagraphs(
    model.project,
    applyEdits(model.project, model.documents, edits).get('A')!.content,
  ).map(({ text }) => plainText(text));

describe('item forms', () => {
  it('writes each item after the comment that names it, with its compiled text, in both forms', () => {
    const { items, roles } = opened(`one${PARA}two`);
    expect(markdownItems(items, roles, COMPILES)).toBe(
      `<!-- item A -->\n\none\n\ntwo\n\n${BLOCK}\n`,
    );
    expect(structuredItems(items, roles, COMPILES)).toEqual([
      {
        item: 'A',
        title: 'A',
        paragraphs: [{ text: [{ text: 'one' }] }, { text: [{ text: 'two' }] }],
        compiled: { kind: 'text', pieces: ['A\n\none\ntwo'], seal: SEAL },
      },
    ]);
  });

  it('changes nothing for a form as it was written', () => {
    const { model, items, roles } = opened(`one${PARA}two`);
    expect(markdownEdits(model, items, markdownItems(items, roles, COMPILES), roles)).toEqual({
      edits: [],
      problems: [],
      refused: [],
    });
    const structured = structuredItems(items, roles, COMPILES);
    expect(structuredEdits(model, items, structured, roles)).toEqual({
      edits: [],
      problems: [],
      refused: [],
    });
  });

  it('refuses an item whose compiled text changed, making none of its edits', () => {
    const { model, items, roles } = opened(`one${PARA}two`);
    const markdown = markdownItems(items, roles, COMPILES)
      .replace('two', 'second')
      .replace('one\ntwo\n```', 'one\nsecond\n```');
    const refused = [{ item: 'A', reason: expect.stringContaining('reference only') }];
    expect(markdownEdits(model, items, markdown, roles)).toEqual({
      edits: [],
      problems: [],
      refused,
    });
    const [structured] = structuredItems(items, roles, COMPILES);
    const compiled: CompiledText = { kind: 'text', pieces: ['changed'], seal: SEAL };
    const changed = { ...structured!, paragraphs: [{ text: [{ text: 'second' }] }], compiled };
    expect(structuredEdits(model, items, [changed], roles)).toEqual({
      edits: [],
      problems: [],
      refused,
    });
  });

  it('stops on Markdown with no place, refusing nothing', () => {
    const { model, items, roles } = opened('one');
    expect(markdownEdits(model, items, '***\n', roles)).toEqual({
      edits: [],
      problems: [expect.stringContaining('no place')],
      refused: [],
    });
  });

  it('shows and changes only the stretch a selector names, and leaves the rest', () => {
    const { model, items, roles } = opened(`one${PARA}two${PARA}three`, ['id:A', 'text:two']);
    const markdown = markdownItems(items, roles, COMPILES);
    expect(markdown).toBe(`<!-- item A -->\n\ntwo\n\n${BLOCK}\n`);
    const { edits } = markdownEdits(model, items, markdown.replace('two', 'second'), roles);
    expect(madeText(model, edits)).toEqual(['one', 'second', 'three']);
  });

  it('shows all of a table a selector reaches into', () => {
    const grid = table([[{ text: 'x' }, { text: 'y' }]]);
    const { items, roles } = opened(`before${PARA}${grid}\\pard after`, ['id:A', 'text:y']);
    expect(
      structuredItems(items, roles, COMPILES)[0]!.paragraphs.map(({ cell }) => cell?.column),
    ).toEqual([0, 1]);
  });

  it('shows nothing of an item no place is in', () => {
    const { model } = opened('one');
    const [item] = findItems(model.project, model.documents, parseSelector(['id:A']).items);
    expect(readItems(model, [item!], [])[0]).toMatchObject({ first: 0, count: 0 });
  });

  it('adds a style a role needs, only when there is a change', () => {
    const { model, items, roles } = opened('one');
    const before = model.project.styles.length;
    const { edits } = markdownEdits(
      model,
      items,
      `<!-- item A -->\n\n#### Deep\n\n${BLOCK}`,
      roles,
    );
    expect(edits.length).toBeGreaterThan(0);
    expect(model.project.styles.map(({ name }) => name)).toContain('Heading 4');
    expect(model.project.styles.length).toBe(before + 1);
    markdownEdits(model, items, `<!-- item A -->\n\none \`code\`\n\n${BLOCK}`, roles);
    expect(model.project.styles.map(({ name }) => name)).toContain('Code Span');
  });

  it('stops on an item not read, Markdown with no item, and Markdown that has no place', () => {
    const { model, items, roles } = opened('one');
    const other = `<!-- item Z -->\n\nx\n\n<!-- compiled Z: the compile leaves this item out -->`;
    expect(markdownEdits(model, items, other, roles).problems).toEqual([
      'The file names items that were not read: Z',
    ]);
    expect(markdownEdits(model, items, 'x\n', roles).problems).toEqual([
      'The Markdown must start with the comment that names its item.',
    ]);
    expect(markdownEdits(model, items, '***\n', roles).problems[0]).toContain('no place');
  });
});
