import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { readAgain } from './document.ts';
import { type Inline, type ReadParagraph, readParagraphs } from './edit-pieces.ts';
import { applyEdits, readForEditing } from './editable.ts';
import { addMissingStyles, addProjectStyle } from './format-manage.ts';
import type { ItemCompiles } from './item-compile.ts';
import {
  markdownEdits,
  markdownItems,
  readItems,
  structuredEdits,
  structuredItems,
  unwritten,
} from './item-forms.ts';
import { paragraphEdits, shownPiece, type WrittenParagraph } from './paragraph-edits.ts';
import { flatten, openProject, type Project } from './project.ts';
import { saveProject } from './save.ts';
import { styleRoles } from './style-mapping.ts';

const MARKS = { strong: 'Strong', emphasis: 'Emphasis' };
const link = { kind: 'address' as const, address: 'https://example.com/' };

/** A project whose item A holds these paragraphs, in a project with each style they name. */
function holding(paragraphs: WrittenParagraph[]): Project {
  const project = openProject(writeFixture({ items: [{ id: 'A', title: 'A', text: 'x' }] }));
  const roles = styleRoles(project);
  addMissingStyles(project, [roles.code, roles.codeSpan], roles);
  for (const name of ['Strong', 'Emphasis', 'Mark']) addProjectStyle(project, name, 'Char');
  const { documents } = readForEditing(project);
  const read = readParagraphs(project, documents.text('A'));
  const edits = paragraphEdits('A', read, paragraphs, MARKS);
  saveProject(project, { documents: applyEdits(project, documents, edits) });
  return project;
}

/** Paragraphs as a form shows them: no place, and bold and italic as looks. */
const asShown = (read: ReadParagraph[]): WrittenParagraph[] =>
  read.map(({ paragraph: _paragraph, ...rest }) => ({
    ...rest,
    text: rest.text.map((piece) => shownPiece(piece, MARKS)),
  }));

/** Item A's paragraphs as its file reads. */
const shown = (project: Project) =>
  asShown(readParagraphs(project, readForEditing(project).documents.text('A')));

/** One character of a paragraph's text and how it looks: what a piece is, apart from its split. */
const characters = (pieces: Inline[]) =>
  pieces.flatMap(({ text, ...look }) => Array.from(text, (character) => ({ character, look })));

/** Paragraphs as each character with its look, so pieces split differently compare the same. */
const looked = (paragraphs: WrittenParagraph[]) =>
  paragraphs.map(({ text, ...rest }) => ({ ...rest, text: characters(text) }));

/** Characters back into pieces of one look each. */
function joined(cells: ReturnType<typeof characters>): Inline[] {
  const out: Inline[] = [];
  for (const { character, look } of cells) {
    const last = out.at(-1);
    const { text: _, ...held } = last ?? { text: '' };
    if (last && JSON.stringify(held) === JSON.stringify(look)) last.text += character;
    else out.push({ ...look, text: character });
  }
  return out;
}

/** The edits for `after`, made in memory on item A, and its file read again. */
function madeAndRead(
  project: Project,
  after: WrittenParagraph[],
  { documents } = readForEditing(project),
) {
  const read = readParagraphs(project, documents.text('A'));
  const made = applyEdits(project, documents, paragraphEdits('A', read, after, MARKS));
  return asShown(readParagraphs(project, readAgain(made.get('A')!.content)));
}

/** A code block, then text with every kind of character style beside, between and around. */
const STYLED: WrittenParagraph[] = [
  { style: 'Code Block', text: [{ text: 'make all' }] },
  {
    text: [
      { text: 'ab', style: 'Code Span' },
      { text: 'c' },
      { text: 'de', style: 'Mark' },
      { text: 'fg', style: 'Code Span' },
      { text: 'h' },
      { text: 'ij', bold: true },
      { text: 'k' },
      { text: 'lm', link },
      { text: 'n' },
      { text: 'op', style: 'Code Span' },
    ],
  },
  { text: [{ text: 'q' }, { text: 'rs', style: 'Mark' }] },
];

/** What a change at a place does to a paragraph's characters, by the look of what goes in. */
const CHANGES: {
  name: string;
  at: (cells: ReturnType<typeof characters>, place: number) => void;
}[] = [
  ...[{}, { style: 'Code Span' }, { style: 'Mark' }, { bold: true as const }].map((look) => ({
    name: `inserts ${JSON.stringify(look)}`,
    at: (cells: ReturnType<typeof characters>, place: number) =>
      cells.splice(place, 0, { character: 'X', look }),
  })),
  ...[{}, { style: 'Code Span' }].map((look) => ({
    name: `replaces with ${JSON.stringify(look)}`,
    at: (cells: ReturnType<typeof characters>, place: number) =>
      cells.splice(place, 1, { character: 'Y', look }),
  })),
  { name: 'deletes', at: (cells, place) => cells.splice(place, 1) },
];

describe('edits beside styled text', () => {
  const project = holding(STYLED);
  const start = shown(project);

  it('holds the text it is given to start with', () => {
    expect(looked(start)).toEqual(looked(STYLED));
  });

  it('inserts, replaces and deletes at every place, each change in its own look', () => {
    const model = readForEditing(project);
    const wrong: string[] = [];
    for (const [paragraph, { text }] of start.entries()) {
      const length = characters(text).length;
      for (const change of CHANGES) {
        for (let place = 0; place <= length; place += 1) {
          if (place === length && !change.name.startsWith('inserts')) continue;
          // Text in a link goes as one, so a change inside one changes it whole.
          const cells = characters(text);
          if (cells[place - 1]?.look.link && cells[place]?.look.link) continue;
          change.at(cells, place);
          const after = start.map((each, at) =>
            at === paragraph ? { ...each, text: joined(cells) } : each,
          );
          const back = madeAndRead(project, after, model);
          if (JSON.stringify(looked(back)) !== JSON.stringify(looked(after))) {
            wrong.push(`paragraph ${paragraph} ${change.name} at ${place}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps the code span an insert goes after, and the plain text an insert goes before', () => {
    const after = structuredClone(start);
    after[1]!.text.splice(4, 0, { text: ' and more' });
    const back = madeAndRead(project, after);
    expect(back[1]!.text.slice(3, 5)).toEqual([
      { text: 'fg', style: 'Code Span' },
      { text: ' and moreh' },
    ]);
  });

  it('appends after a code span that ends a paragraph, and before one that starts it', () => {
    const after = structuredClone(start);
    after[1]!.text.push({ text: ', at the end' });
    after[1]!.text.unshift({ text: 'At the start, ' });
    const back = madeAndRead(project, after);
    expect(back[1]!.text.at(0)).toEqual({ text: 'At the start, ' });
    expect(back[1]!.text.at(-1)).toEqual({ text: ', at the end' });
    expect(back[0]).toEqual(start[0]);
  });
});

/** Item A's compiled text, as a compile might give it. */
const compiles = (text: string): ItemCompiles => ({ pieces: new Map([['A', [text]]]) });

/** The item forms on a project: export, edit, import, save, and read again. */
function throughForms(paragraphs: WrittenParagraph[]) {
  const project = holding(paragraphs);
  const model = readForEditing(project);
  const roles = styleRoles(project);
  const items = readItems(
    model,
    flatten(project.binder).filter(({ id }) => id === 'A'),
  );
  const compiled = compiles('compiled');
  return {
    markdown: markdownItems(items, roles, compiled),
    structured: structuredItems(items, roles, compiled),
    importing(edited: string | ReturnType<typeof structuredItems>) {
      const imported =
        typeof edited === 'string'
          ? markdownEdits(model, items, edited, roles)
          : structuredEdits(model, items, edited, roles);
      saveProject(project, { documents: applyEdits(project, model.documents, imported.edits) });
      return { imported, after: shown(project) };
    },
  };
}

describe('a sentence changed after a code block and between code spans, in both forms', () => {
  const OLD = 'and copies `tool` and its helpers into `out/`.';
  const NEW = 'and places `tool` and its helpers in `out/`, as each build does.';
  const README: WrittenParagraph[] = [
    { style: 'Code Block', text: [{ text: 'make build' }] },
    {
      text: [
        { text: 'make build', style: 'Code Span' },
        { text: ' compiles the TOOLs, and copies ' },
        { text: 'tool', style: 'Code Span' },
        { text: ' and its helpers into ' },
        { text: 'out/', style: 'Code Span' },
        { text: '.' },
      ],
    },
    { text: [{ text: 'Then run it.' }] },
  ];
  const WANTED: Inline[] = [
    { text: 'make build', style: 'Code Span' },
    { text: ' compiles the TOOLs, and places ' },
    { text: 'tool', style: 'Code Span' },
    { text: ' and its helpers in ' },
    { text: 'out/', style: 'Code Span' },
    { text: ', as each build does.' },
  ];

  it('changes only that sentence, through the Markdown form', () => {
    const forms = throughForms(README);
    expect(forms.markdown).toContain(OLD);
    const { imported, after } = forms.importing(forms.markdown.replace(OLD, NEW));
    expect(imported.refused).toEqual([]);
    expect(looked(after)).toEqual(looked([README[0]!, { text: WANTED }, README[2]!]));
  });

  it('changes only that sentence, through the structured form', () => {
    const forms = throughForms(README);
    const edited = structuredClone(forms.structured);
    const text = edited[0]!.paragraphs[1]!.text;
    text[1]!.text = ' compiles the TOOLs, and places ';
    text[3]!.text = ' and its helpers in ';
    text[5]!.text = ', as each build does.';
    const { imported, after } = forms.importing(edited);
    expect(imported.refused).toEqual([]);
    expect(looked(after)).toEqual(looked([README[0]!, { text: WANTED }, README[2]!]));
  });
});

describe('an append to a list item that ends in code spans', () => {
  const ITEM: WrittenParagraph = {
    list: { ordered: false, level: 0 },
    text: [
      { text: 'Where it shows - ' },
      { text: 'panel.json', style: 'Code Span' },
      { text: ' entries under ' },
      { text: 'example.org/', style: 'Code Span' },
      { text: '.' },
    ],
  };

  it('puts the words at the end of the item, not at its start', () => {
    const forms = throughForms([ITEM, { text: [{ text: 'After the list.' }] }]);
    const old = '`example.org/`.';
    expect(forms.markdown).toContain(old);
    const added = '`example.org/`, with the name people see and the page it opens.';
    const { imported, after } = forms.importing(forms.markdown.replace(old, added));
    expect(imported.refused).toEqual([]);
    expect(after[0]!.text.map(({ text }) => text).join('')).toBe(
      'Where it shows - panel.json entries under example.org/, with the name people see and the page it opens.',
    );
    expect(after[0]!.text.at(-1)).toEqual({
      text: ', with the name people see and the page it opens.',
    });
  });
});

/** A project whose item A says "one " and then "two" in a code span, to edit. */
function codeEnding() {
  const made = holding([{ text: [{ text: 'one ' }, { text: 'two', style: 'Code Span' }] }]);
  return { model: readForEditing(made), roles: styleRoles(made) };
}

describe('the check that an import writes what its file says', () => {
  it('refuses an item whose edits would give other words', () => {
    const { model, roles } = codeEnding();
    const edits = [
      { item: 'A', edit: { kind: 'replace' as const, paragraph: 0, start: 0, end: 0, text: 'x' } },
    ];
    const asked = [{ item: 'A', paragraphs: [{ text: [{ text: 'one two' }] }] }];
    expect(unwritten(model, edits, asked, roles)).toEqual([
      {
        item: 'A',
        reason:
          'Writing it would not give what the file says: paragraph 1 would read "xone two", not what the file says.',
      },
    ]);
  });

  it('refuses an item whose edits would give the right words in other styles', () => {
    const { model, roles } = codeEnding();
    const edits = [
      {
        item: 'A',
        edit: { kind: 'character' as const, paragraph: 0, start: 4, end: 7 },
      },
    ];
    const asked = [
      {
        item: 'A',
        paragraphs: [{ text: [{ text: 'one ' }, { text: 'two', style: 'Code Span' }] }],
      },
    ];
    expect(unwritten(model, edits, asked, roles)).toEqual([
      {
        item: 'A',
        reason:
          'Writing it would not give what the file says: its words would be right, but not their styles.',
      },
    ]);
  });

  it('refuses an item whose edits would leave out a paragraph', () => {
    const { model, roles } = codeEnding();
    const edits = [
      { item: 'A', edit: { kind: 'replace' as const, paragraph: 0, start: 0, end: 0, text: '' } },
    ];
    const asked = [
      {
        item: 'A',
        paragraphs: [
          { text: [{ text: 'one ' }, { text: 'two', style: 'Code Span' }] },
          { text: [{ text: 'three' }] },
        ],
      },
    ];
    expect(unwritten(model, edits, asked, roles)[0]!.reason).toBe(
      'Writing it would not give what the file says: paragraph 2 would read "", not what the file says.',
    );
  });

  it('passes an item with nothing to change', () => {
    const { model, roles } = codeEnding();
    const asked = [
      {
        item: 'A',
        paragraphs: [{ text: [{ text: 'one ' }, { text: 'two', style: 'Code Span' }] }],
      },
    ];
    expect(unwritten(model, [], asked, roles)).toEqual([]);
  });
});

/** A project whose item A says "one", and its forms with A's text in place of that. */
function typing(text: string) {
  const model = readForEditing(writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] }));
  const roles = styleRoles(model.project);
  const items = readItems(
    model,
    flatten(model.project.binder).filter(({ id }) => id === 'A'),
  );
  const [form] = structuredItems(items, roles, compiles('compiled'));
  const paragraphs = [{ style: roles.headings[2]!, text: [{ text }] }];
  return { model, roles, items, form: { ...form!, paragraphs } };
}

describe('text that would not read back as typed', () => {
  it('refuses Scrivener markup typed as words, and adds no style for it', () => {
    const { model, roles, items, form } = typing('see <$Scr_H::1>this');
    const styles = model.project.styles.map(({ name }) => name);
    expect(styles).not.toContain(roles.headings[2]);
    expect(structuredEdits(model, items, [form], roles)).toEqual({
      edits: [],
      problems: [],
      refused: [
        {
          item: 'A',
          reason:
            'Writing it would not give what the file says: paragraph 1 would read "see this", not what the file says.',
        },
      ],
    });
    expect(model.project.styles.map(({ name }) => name)).toEqual(styles);
  });

  it('makes the edits of an item it can write, beside one it refuses', () => {
    const fixture = writeFixture({
      items: [
        { id: 'A', title: 'A', text: 'one' },
        { id: 'B', title: 'B', text: 'two' },
      ],
    });
    const model = readForEditing(fixture);
    const roles = styleRoles(model.project);
    const items = readItems(
      model,
      flatten(model.project.binder).filter(({ id }) => id !== 'DRAFT'),
    );
    const forms = structuredItems(items, roles, compiles('compiled'));
    const edited = forms.map((form) => ({
      ...form,
      paragraphs: [
        {
          style: roles.headings[2]!,
          level: 2,
          text: [{ text: form.item === 'A' ? 'see <$Scr_Cs::0>this' : 'second' }],
        },
      ],
    }));
    const { edits, refused } = structuredEdits(model, items, edited, roles);
    expect(refused.map(({ item }) => item)).toEqual(['A']);
    expect(new Set(edits.map(({ item }) => item))).toEqual(new Set(['B']));
    expect(model.project.styles.map(({ name }) => name)).toContain(roles.headings[2]);
  });
});
