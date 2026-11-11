import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { link, PARA } from '../test/rtf-builder.ts';
import { compileModel } from './compile.ts';
import { projectDocuments, type Documents } from './document.ts';
import { insertParagraphs, removeParagraphs, setParagraphStyle } from './edit.ts';
import { EditError } from './edit-pieces.ts';
import { replaceRange, replaceText } from './edit-text.ts';
import type { MarkupNode } from './markup.ts';
import { readModel } from './model.ts';
import { openProject, type Project } from './project.ts';
import { saveProject } from './save.ts';

/** A one-document project; the edit runs on its text, which is saved and compiled. */
function edited(text: string, styles: string[], edit: Parameters<typeof run>[1]): string {
  const dir = writeFixture({ items: [{ id: 'A', title: 'A', text, styles }] });
  return run(dir, edit);
}

function run(
  dir: string,
  edit: (project: ReturnType<typeof openProject>, document: ReturnType<Documents['text']>) => void,
): string {
  const project = openProject(dir);
  const document = projectDocuments(dir).text('A');
  edit(project, document);
  saveProject(project, { documents: new Map([['A', { content: document }]]) });
  return compileModel(readModel(dir), { onLeftAsWritten: () => {} });
}

const body = (compiled: string) => compiled.slice(compiled.indexOf('\n') + 1);

/** The real styles Scrivener writes, under the IDs fixture documents use. */
const REAL_STYLES = openProject(
  path.join(import.meta.dirname, '..', 'test', 'fixtures', 'blank.scriv'),
).styles;

function withRealStyles(project: Project): void {
  for (const style of project.styles) {
    const real = REAL_STYLES.find(({ name }) => name === style.name);
    if (real) style.format = real.format;
  }
}

function styledRun(dir: string, edit: Parameters<typeof run>[1]): string {
  return run(dir, (project, document) => {
    withRealStyles(project);
    edit(project, document);
  });
}

/** A one-document project in real styles; `names` are the styles its markers number. */
function styled(text: string, names: string[], edit: Parameters<typeof run>[1]): string {
  const ids: Record<string, string> = {
    'Heading 1': STYLES.heading,
    'Code Span': STYLES.codeSpan,
    'Code Block': STYLES.codeBlock,
    'Block Quote': STYLES.blockQuote,
  };
  const item = { id: 'A', title: 'A', text };
  const items = [names.length > 0 ? { ...item, styles: names.map((name) => ids[name]!) } : item];
  return styledRun(writeFixture({ items }), edit);
}

/** Tries to replace `find` in a paragraph of text that holds it twice. */
const attempt =
  (find: string, paragraph = 0) =>
  () =>
    edited(`aa bb aa`, [], (project, document) => {
      replaceText(project, document, paragraph, find, 'x');
    });

/** Gives a style a list marker, as a list style has. */
function withMarker(project: Pick<Project, 'styles'>, name: string, marker: string): void {
  project.styles.find((style) => style.name === name)!.lists = [marker];
}

/** Runs an edit on a one-paragraph document, for states no compile would take. */
function unsaved(edit: Parameters<typeof run>[1]): void {
  const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] });
  const project = openProject(dir);
  withRealStyles(project);
  edit(project, projectDocuments(dir).text('A'));
}

describe('insertParagraphs', () => {
  it('adds plain text in the look of the text around it', () => {
    const out = edited(`one${PARA}two`, [], (project, document) => {
      insertParagraphs(project, document, 1, [{ text: 'new' }]);
    });
    expect(out).toContain('one\nnew\ntwo');
  });

  it('gives the document a paragraph mark when adding after its last paragraph', () => {
    const out = edited(`one${PARA}two`, [], (project, document) => {
      insertParagraphs(project, document, 2, [{ text: 'new' }]);
      expect(document.paragraphs.map(({ end }) => end.kind)).toEqual([
        'paragraph',
        'paragraph',
        'document',
      ]);
    });
    expect(out).toContain('two\nnew');
  });

  it('stops on a style the project does not have', () => {
    expect(() =>
      edited(`one`, [], (project, document) => {
        insertParagraphs(project, document, 0, [{ style: 'Nope', text: 'x' }]);
      }),
    ).toThrow(EditError);
  });

  it('leaves the document alone given nothing to add', () => {
    expect(
      body(
        edited(`one`, [], (project, document) => {
          insertParagraphs(project, document, 0, []);
        }),
      ),
    ).toContain('one');
  });
});

describe('removeParagraphs', () => {
  it('removes text, and hands the last paragraph the document end', () => {
    const out = edited(`one${PARA}two${PARA}three`, [], (_, document) => {
      removeParagraphs(document, 2, 1);
      expect(document.paragraphs.at(-1)?.end.kind).toBe('document');
    });
    expect(out).not.toContain('three');
  });
});

describe('replaceText', () => {
  it('replaces inside one run', () => {
    const out = edited(`hello there`, [], (project, document) => {
      replaceText(project, document, 0, 'there', 'world');
    });
    expect(out).toContain('hello world');
  });

  it('replaces inside a link, keeping the link', () => {
    const out = edited(`see ${link('https://a.example', 'old text')}`, [], (project, document) => {
      replaceText(project, document, 0, 'old', 'new');
    });
    expect(out).toContain('new text');
  });

  it('stops on text it cannot find, finds twice, or a missing paragraph', () => {
    expect(attempt('zz')).toThrow('does not hold');
    expect(attempt('aa')).toThrow('more than once');
    expect(attempt('bb', 4)).toThrow('no paragraph 4');
  });

  it('replaces a whole link and the text after it', () => {
    const out = edited(`${link('https://a.example', 'old')} rest`, [], (project, document) => {
      replaceText(project, document, 0, 'old rest', 'new');
    });
    expect(out).toContain('new');
    expect(out).not.toContain('a.example');
  });

  it('replaces text and the whole link after it', () => {
    const out = edited(`see ${link('https://a.example', 'old')}`, [], (project, document) => {
      replaceText(project, document, 0, 'see old', 'new');
    });
    expect(out).toContain('new');
    expect(out).not.toContain('a.example');
  });

  it('stops part of the way through a link', () => {
    expect(() =>
      edited(`see ${link('https://a.example', 'old text')}`, [], (project, document) => {
        replaceText(project, document, 0, 'see old', 'x');
      }),
    ).toThrow('part of the way');
  });
});

describe('replaceRange', () => {
  it('writes into an empty paragraph', () => {
    const out = edited(`one${PARA}${PARA}two`, [], (project, document) => {
      replaceRange(project, document, 1, { start: 0, end: 0 }, 'filled');
    });
    expect(out).toContain('one\nfilled\ntwo');
  });
});

describe('setParagraphStyle', () => {
  it('keeps the text, and leaves the paragraphs around it in their styles', () => {
    const out = styled(
      `<$Scr_Ps::0>one${PARA}<!$Scr_Ps::0>two`,
      ['Heading 1'],
      (project, document) => {
        setParagraphStyle(project, document, 1, 'Heading 1');
        setParagraphStyle(project, document, 0, undefined);
      },
    );
    expect(out).toContain('one\n# two');
  });

  it('keeps the character styles in the text', () => {
    const out = styled(`<$Scr_Cs::0>code<!$Scr_Cs::0> rest`, ['Code Span'], (project, document) => {
      setParagraphStyle(project, document, 0, 'Heading 1');
    });
    expect(out).toContain('# `code` rest');
  });
});

describe('edits in styles', () => {
  it('takes a heading from its style: sample tags, format and marker', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: `body` }] });
    const out = styledRun(dir, (project, document) => {
      insertParagraphs(project, document, 0, [{ style: 'Heading 1', text: 'Title' }]);
      const [paragraph] = document.paragraphs;
      expect(
        paragraph?.content.map((node) => ('source' in node ? node.source : node.kind)),
      ).toEqual([
        '<$ScrKeepWithNext>',
        '<$Scr_H::1>',
        expect.stringMatching(/^<\$Scr_Ps::\d+>$/),
        'text',
      ]);
      const [ending, styleEnding] = document.paragraphs[1]!.content;
      expect(ending).toMatchObject({ source: '<!$Scr_H::1>' });
      expect(styleEnding).toMatchObject({ kind: 'style', closing: true });
    });
    expect(out).toContain('# Title\nbody');
  });

  it('ends a heading in the text it goes on into, keeping that text out of its style', () => {
    const out = styled(
      `<$Scr_Ps::0>one${PARA}two${PARA}<!$Scr_Ps::0>body`,
      ['Heading 1'],
      (project, document) => {
        insertParagraphs(project, document, 1, [{ style: 'Heading 1', text: 'new' }]);
        const sources = document.paragraphs[2]!.content.flatMap((node) =>
          'source' in node ? [node.source] : [],
        );
        expect(sources).toEqual(['<!$Scr_H::1>', '<!$Scr_Ps::0>', '<$Scr_Ps::0>']);
      },
    );
    expect(out).toContain('# new');
  });

  it('gives what ends a document no paragraph mark', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A' }] });
    styledRun(dir, (project, document) => {
      insertParagraphs(project, document, 0, [{ style: 'Heading 1', text: 'only' }]);
      expect(document.paragraphs[0]?.end.kind).toBe('document');
      expect(document.paragraphs[0]?.content.at(-1)).toMatchObject({ closing: true });
    });
  });

  it('makes a heading a run of its own, beside a heading in the same style', () => {
    const out = styled(
      `<$Scr_Ps::0>one${PARA}<!$Scr_Ps::0>body`,
      ['Heading 1'],
      (project, document) => {
        insertParagraphs(project, document, 1, [{ style: 'Heading 1', text: 'two' }]);
      },
    );
    expect(out).toContain('# one\n# two\nbody');
  });

  it('closes and reopens a style around plain text put inside it', () => {
    const list = `<$Scr_Ps::0>one${PARA}two${PARA}<!$Scr_Ps::0>after`;
    const out = styled(list, ['Block Quote'], (project, document) => {
      insertParagraphs(project, document, 1, [{ text: 'plain' }]);
    });
    expect(out).toContain('> one\nplain\n> two');
  });

  it('joins a style that ended just before, instead of starting it again', () => {
    const out = styled(
      `<$Scr_Ps::0>one<!$Scr_Ps::0>${PARA}after`,
      ['Code Block'],
      (project, document) => {
        insertParagraphs(project, document, 1, [{ style: 'Code Block', text: 'two' }]);
      },
    );
    expect(out.match(/```/g)).toHaveLength(2);
  });

  it('lists a style the document has not used, for text and for paragraphs', () => {
    const out = styled(`hello there`, [], (project, document) => {
      replaceText(project, document, 0, 'there', [
        { text: 'a ' },
        { text: 'span', style: 'Code Span' },
      ]);
      expect(document.styleIds).toHaveLength(1);
    });
    expect(out).toContain('hello a `span`');
  });

  it('replaces across a character style, leaving nothing open', () => {
    const out = styled(`a <$Scr_Cs::0>b<!$Scr_Cs::0> c`, ['Code Span'], (project, document) => {
      replaceText(project, document, 0, 'a b c', 'plain');
      expect(document.paragraphs[0]?.content.map(({ kind }) => kind)).toEqual(['text']);
    });
    expect(out).toContain('plain');
  });

  it('keeps a character style open past a replacement that starts inside it', () => {
    const out = styled(
      `<$Scr_Cs::0>one two<!$Scr_Cs::0> three`,
      ['Code Span'],
      (project, document) => {
        replaceText(project, document, 0, 'two three', 'end');
      },
    );
    expect(out).toContain('`one end`');
  });

  it('removes a heading whose markers run on, leaving what follows out of its style', () => {
    const text = `<$Scr_H::1><$Scr_Ps::0>Title${PARA}<!$Scr_H::1><!$Scr_Ps::0>body${PARA}next`;
    const out = styled(text, ['Heading 1'], (_, document) => {
      removeParagraphs(document, 0, 1);
      expect(document.paragraphs[0]?.content.map(({ kind }) => kind)).toEqual(['text']);
    });
    expect(out).toContain('body\nnext');
  });

  it('keeps a style open when the paragraph that opened it goes', () => {
    const text = `<$Scr_Ps::0>one${PARA}two${PARA}<!$Scr_Ps::0>after`;
    const out = styled(text, ['Block Quote'], (_, document) => {
      removeParagraphs(document, 0, 1);
    });
    expect(out).toContain('> two\nafter');
  });

  it('keeps a heading open when the paragraph that opened it goes', () => {
    const text = `<$Scr_H::1>one${PARA}two<!$Scr_H::1>${PARA}after`;
    styled(text, [], (_, document) => {
      removeParagraphs(document, 0, 1);
      expect(document.paragraphs[0]?.content[0]).toMatchObject({ source: '<$Scr_H::1>' });
    });
  });

  it('ends a heading when the paragraph that ended it goes', () => {
    const text = `<$Scr_H::1>one${PARA}two<!$Scr_H::1>${PARA}after`;
    styled(text, [], (_, document) => {
      removeParagraphs(document, 1, 1);
      expect(document.paragraphs[1]?.content[0]).toMatchObject({ source: '<!$Scr_H::1>' });
    });
  });

  it('joins a paragraph that holds nothing but markers', () => {
    const text = `<$Scr_Ps::0>one${PARA}<!$Scr_Ps::0>`;
    styled(text, ['Block Quote'], (_, document) => {
      removeParagraphs(document, 0, 1);
      expect(document.paragraphs[0]?.content).toEqual([]);
    });
  });

  it('removes every paragraph, or none', () => {
    const out = styled(`one`, [], (_, document) => {
      removeParagraphs(document, 0, 0);
      expect(document.paragraphs).toHaveLength(1);
      removeParagraphs(document, 0, 1);
      expect(document.paragraphs).toHaveLength(0);
    });
    expect(out).not.toContain('one');
  });

  it('takes no look from a style that has no sample', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: `body` }] });
    run(dir, (project, document) => {
      insertParagraphs(project, document, 0, [{ style: 'Marked', text: 'x' }]);
      expect(document.paragraphs[0]?.format).toEqual({});
    });
  });

  it('takes no look from a paragraph that opens a style itself', () => {
    const out = styled(
      `plain${PARA}<$Scr_Ps::0>quote<!$Scr_Ps::0>`,
      ['Block Quote'],
      (project, document) => {
        const quote = document.paragraphs[1]!;
        quote.format = { ...quote.format, leftIndent: 720 };
        insertParagraphs(project, document, 2, [{ text: 'new' }]);
        expect(document.paragraphs[2]?.format.leftIndent).toBeUndefined();
      },
    );
    expect(out).toContain('new');
  });

  it('writes a new document with the RTF header macOS writes', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A' }] });
    styledRun(dir, (project, document) => {
      insertParagraphs(project, document, 0, [{ style: 'Heading 1', text: 'first' }]);
    });
    const written = fs.readFileSync(path.join(dir, 'Files', 'Data', 'A', 'content.rtf'), 'latin1');
    expect(written).toMatch(
      /^\{\\rtf1\\ansi\\ansicpg1252\\cocoartf\d+\n\\cocoatextscaling0\\cocoaplatform0\{\\fonttbl/,
    );
  });

  it('opens a new document as the project writes its own', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A' }] });
    styledRun(dir, (project, document) => {
      const [style] = project.styles;
      style!.format = { ...style!.format, settings: { ...style!.format.settings, cocoartf: 1234 } };
      insertParagraphs(project, document, 0, [{ text: 'first' }]);
    });
    const written = fs.readFileSync(path.join(dir, 'Files', 'Data', 'A', 'content.rtf'), 'latin1');
    expect(written).toContain('cocoartf1234');
  });

  it('adds to an empty document', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A' }] });
    const out = styledRun(dir, (project, document) => {
      insertParagraphs(project, document, 0, [{ text: 'first' }]);
    });
    expect(out).toContain('first');
  });
});

/** The markers each paragraph starts and ends with. */
const ends = ({ content }: { content: MarkupNode[] }) => {
  const sources = content.flatMap((node) => ('source' in node ? [node.source] : []));
  return { sources, last: content.at(-1)?.kind };
};

describe('a style ending before a list', () => {
  it('ends a heading before its mark when a list item is added after it', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{disc}');
      insertParagraphs(project, document, 1, [
        { style: 'Heading 1', text: 'Title' },
        { style: 'Bullet List', text: 'item' },
      ]);
      const [, title, item] = document.paragraphs;
      expect(ends(title!).last).toBe('style');
      expect(ends(title!).sources).toContain('<!$Scr_H::1>');
      expect(ends(item!).sources).not.toContain('<!$Scr_H::1>');
    });
  });

  it('ends one list before its mark when another follows', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{disc}');
      withMarker(project, 'Code Block', '{decimal}.');
      insertParagraphs(project, document, 1, [
        { style: 'Bullet List', text: 'a' },
        { style: 'Code Block', text: 'b' },
      ]);
      const [, a, b] = document.paragraphs;
      expect(ends(a!).last).toBe('style');
      expect(ends(b!).sources.filter((source) => source.startsWith('<!'))).toHaveLength(1);
    });
  });

  it('ends a style before its mark when the text after it is a list item', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{disc}');
      insertParagraphs(project, document, 1, [{ style: 'Bullet List', text: 'item' }]);
      insertParagraphs(project, document, 1, [{ style: 'Heading 1', text: 'Title' }]);
      const [, title, item] = document.paragraphs;
      expect(ends(title!).last).toBe('style');
      expect(ends(item!).sources.some((source) => source.startsWith('<!$Scr_H'))).toBe(false);
    });
  });

  it('writes a marker in the formatting of the paragraph it is in', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{disc}');
      insertParagraphs(project, document, 1, [{ style: 'Bullet List', text: 'item' }]);
      insertParagraphs(project, document, 1, [{ style: 'Heading 1', text: 'Title' }]);
      const { content } = document.paragraphs[2]!;
      const [format] = content.flatMap((node) => (node.kind === 'text' ? [node.format] : []));
      const opening = content.find((node) => node.kind === 'style' && !node.closing);
      expect(opening).toMatchObject({ format });
    });
  });

  it('keeps what goes on open across a list item', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{disc}');
      insertParagraphs(project, document, 1, [
        { style: 'Bullet List', text: 'a' },
        { style: 'Bullet List', text: 'b' },
      ]);
      expect(ends(document.paragraphs[1]!).last).toBe('text');
    });
  });
});

describe('lists', () => {
  it('starts a list, then goes on with it', () => {
    const out = styled(`one`, [], (project, document) => {
      withMarker(project, 'Bullet List', '{disc}');
      const lists = document.lists.length;
      insertParagraphs(project, document, 1, [
        { style: 'Bullet List', text: 'a' },
        { style: 'Bullet List', text: 'b' },
      ]);
      expect(document.lists).toHaveLength(lists + 1);
      expect(document.paragraphs[2]?.marker?.[0]?.text).toBe('\t•\t');
    });
    expect(out).toContain('* a\n* b');
  });

  it('numbers a list from its marker, and joins the list after it', () => {
    const out = styled(`one`, [], (project, document) => {
      withMarker(project, 'Bullet List', '{decimal}.');
      const lists = document.lists.length;
      insertParagraphs(project, document, 1, [{ style: 'Bullet List', text: 'b' }]);
      insertParagraphs(project, document, 1, [{ style: 'Bullet List', text: 'a' }]);
      expect(document.lists).toHaveLength(lists + 1);
      expect(document.paragraphs[2]?.marker?.[0]?.text).toBe('\t2.\t');
    });
    expect(out).toContain('1. a\n2. b');
  });

  it('numbers a list again when an item goes', () => {
    styled(`one`, [], (project, document) => {
      withMarker(project, 'Bullet List', '{decimal}.');
      insertParagraphs(project, document, 1, [
        { style: 'Bullet List', text: 'a' },
        { style: 'Bullet List', text: 'b' },
      ]);
      removeParagraphs(document, 1, 1);
      expect(document.paragraphs[1]?.marker?.[0]?.text).toBe('\t1.\t');
    });
  });

  it('numbers only the top level, past items with no marker', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{decimal}.');
      insertParagraphs(project, document, 1, [
        { style: 'Bullet List', text: 'a' },
        { style: 'Bullet List', text: 'b' },
        { style: 'Bullet List', text: 'c' },
      ]);
      const [, a, b, c] = document.paragraphs;
      const { list } = a!.format;
      delete b!.marker;
      c!.format = { ...c!.format, list: { override: list!.override, level: 1 } };
      c!.marker = [{ text: '\ta.\t', format: {} }];
      removeParagraphs(document, 1, 1);
      insertParagraphs(project, document, 1, [{ style: 'Bullet List', text: 'z' }]);
      expect(document.paragraphs[3]?.marker?.[0]?.text).toBe('\ta.\t');
    });
  });

  it('leaves a list item alone when it is given the style it has', () => {
    unsaved((project, document) => {
      const [first] = document.paragraphs;
      first!.marker = [{ text: '\t•\t', format: {} }];
      setParagraphStyle(project, document, 0, undefined);
      expect(document.paragraphs[0]?.marker).toBeDefined();
    });
  });

  it('writes every number format it knows', () => {
    for (const [marker, second] of [
      ['{upper-roman}.', 'II.'],
      ['{lower-roman}.', 'ii.'],
      ['{upper-alpha}.', 'B.'],
      ['{lower-alpha})', 'b)'],
      ['({decimal})', '(2)'],
    ] as const) {
      unsaved((project, document) => {
        withMarker(project, 'Bullet List', marker);
        const item = { style: 'Bullet List', text: 'x' };
        insertParagraphs(project, document, 1, [item, item]);
        expect(document.paragraphs[2]?.marker?.[0]?.text).toBe(`\t${second}\t`);
      });
    }
  });

  it('counts from where a list starts, or from 1 when it does not say', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{decimal}.');
      const item = { style: 'Bullet List', text: 'x' };
      insertParagraphs(project, document, 1, [item]);
      const [level] = document.lists.at(-1)!.levels;
      level!.startAt = 5;
      insertParagraphs(project, document, 2, [item]);
      expect(document.paragraphs[2]?.marker?.[0]?.text).toBe('\t6.\t');
      delete level!.startAt;
      insertParagraphs(project, document, 3, [item]);
      expect(document.paragraphs[3]?.marker?.[0]?.text).toBe('\t3.\t');
    });
  });

  it('stops on a marker with no name', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', 'plain');
      expect(() =>
        insertParagraphs(project, document, 1, [{ style: 'Bullet List', text: 'x' }]),
      ).toThrow('a list marked plain');
    });
  });

  it('counts past the first letters and tens', () => {
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{lower-alpha}.');
      const items = Array.from({ length: 28 }, () => ({ style: 'Bullet List', text: 'x' }));
      insertParagraphs(project, document, 1, items);
      expect(document.paragraphs[28]?.marker?.[0]?.text).toBe('\tab.\t');
    });
    unsaved((project, document) => {
      withMarker(project, 'Bullet List', '{upper-roman}.');
      const items = Array.from({ length: 14 }, () => ({ style: 'Bullet List', text: 'x' }));
      insertParagraphs(project, document, 1, items);
      expect(document.paragraphs[14]?.marker?.[0]?.text).toBe('\tXIV.\t');
    });
  });

  it('adds levels as the editor does: hyphens, each set further in', () => {
    unsaved((project, document) => {
      insertParagraphs(project, document, 1, [
        { text: 'a', list: { ordered: true, level: 0 } },
        { text: 'b', list: { ordered: true, level: 1 } },
        { text: 'c', list: { ordered: true, level: 2 } },
        { text: 'd', list: { ordered: true, level: 0 } },
      ]);
      const [, a, b, c, d] = document.paragraphs;
      const list = document.lists.at(-1)!;
      expect(list.levels.map(({ marker }) => marker)).toEqual([
        '{decimal}.',
        '{hyphen}',
        '{hyphen}',
      ]);
      expect(list.levels[2]?.text.templateId).toBe((list.id - 1) * 100 + 3);
      expect(a?.marker?.[0]?.text).toBe('\t1.\t');
      expect(b?.marker?.[0]?.text).toBe('\t⁃\t');
      expect(c?.format).toMatchObject({
        leftIndent: 2160,
        firstIndent: -2160,
        tabs: [{ position: 1660 }, { position: 2160 }],
        list: { level: 2 },
      });
      expect(d?.marker?.[0]?.text).toBe('\t2.\t');
    });
  });

  it('starts a new list when a list of the other kind is beside it', () => {
    unsaved((project, document) => {
      insertParagraphs(project, document, 1, [
        { text: 'a', list: { ordered: false, level: 0 } },
        { text: 'b', list: { ordered: true, level: 0 } },
      ]);
      const [, a, b] = document.paragraphs;
      expect(a?.format.list?.override).not.toBe(b?.format.list?.override);
      expect(b?.marker?.[0]?.text).toBe('\t1.\t');
    });
  });

  it('turns a list item into a paragraph, and back, whatever its style', () => {
    unsaved((project, document) => {
      insertParagraphs(project, document, 1, [{ text: 'a', list: { ordered: false, level: 0 } }]);
      setParagraphStyle(project, document, 1, undefined, null);
      expect(document.paragraphs[1]?.marker).toBeUndefined();
      setParagraphStyle(project, document, 1, undefined, { ordered: false, level: 0 });
      expect(document.paragraphs[1]?.marker?.[0]?.text).toBe('\t•\t');
    });
  });

  it('stops on a marker it cannot write', () => {
    expect(() =>
      styled(`one`, [], (project, document) => {
        withMarker(project, 'Bullet List', '{mystery}');
        insertParagraphs(project, document, 1, [{ style: 'Bullet List', text: 'a' }]);
      }),
    ).toThrow('a list marked {mystery}');
  });
});
