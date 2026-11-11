import { localFiles } from './local-files.ts';
import { type BinderItem } from './binder-item.ts';
import { readDocumentText, type DocumentText } from './document.ts';
import { escapeText } from './rtf-text.ts';
import { rtfDocument } from '../test/rtf-builder.ts';
import { describe, expect, it } from 'vite-plus/test';
import type { CompileFormat, FormatStyle } from './compile-format.ts';
import { renderText, type TextInput, type TextLayout, type TextOptions } from './document-text.ts';
import { LINE_BREAK } from './rich-text.ts';

const style = (overrides: Partial<FormatStyle> = {}): FormatStyle => ({
  prefix: '',
  suffix: '',
  paraPrefix: '',
  deleteText: false,
  paragraphOnly: false,
  rawMarkup: false,
  ...overrides,
});

const format: CompileFormat = {
  name: 'Test',
  id: 'TEST',
  file: 'test.scrformat',
  source: 'project',
  layouts: new Map(),
  folderSeparators: { before: '\n', between: '\n' },
  textSeparators: { before: '\n', between: '\n' },
  styles: new Map([
    ['Heading', style({ prefix: '# ' })],
    ['Code Block', style({ prefix: '```', suffix: '```' })],
    ['Quote', style()],
    ['Marked', style({ paraPrefix: '| ' })],
    ['Code Span', style()],
    ['Mark', style({ prefix: '{==', suffix: '==}' })],
    ['Caption', style()],
    ['Gone', style({ deleteText: true })],
    ['Callout', style({ prefix: '<', suffix: '>', paragraphOnly: true })],
    ['Enumerated', style({ prefix: '[list]', paraPrefix: '- ' })],
  ]),
  blockQuoteStyle: 'Quote',
  codeBlockStyle: 'Code Block',
  codeSpanStyle: 'Code Span',
  captionStyle: 'Caption',
  annotationPrefix: '{>>',
  annotationSuffix: '<<}',
  commentFormat: '<$lnk> (<$cmt>)',
  removeSmartPunctuation: false,
  paragraphSpacing: false,
  updateTitleLinks: false,
  usePandocSyntax: false,
  metadata: [],
  replacements: [],
  addClosingHashes: false,
  notesBeforeText: false,
  includeSubtitles: false,
};

const STYLE_NAMES = [
  'Heading',
  'Code Block',
  'Quote',
  'Marked',
  'Code Span',
  'Mark',
  'Unknown',
  'Caption',
  'Gone',
  'Callout',
  'Enumerated',
];

const options: TextOptions = {
  convertLists: true,
  convertLinks: false,
  removeAnnotations: true,
  removeComments: true,
  removeFootnotes: true,
  deleteStruckThrough: false,
};

/** RTF as written, set apart from text, which the helpers escape. */
interface Rtf {
  rtf: string;
}

const rtfOf = (part: string | Rtf) => (typeof part === 'string' ? escapeText(part) : part.rtf);

/** A paragraph's content, text and RTF together. */
const inlines = (...parts: (string | Rtf)[]): Rtf => ({ rtf: parts.map(rtfOf).join('') });

const link = (target: string, text: string): Rtf => ({
  rtf: `{\\field{\\*\\fldinst{HYPERLINK "${target}"}}{\\fldrslt ${escapeText(text)}}}`,
});

const struck = (text: string): Rtf => ({ rtf: `{\\strike ${escapeText(text)}}` });

/** A paragraph of the document: its RTF, and whether it is a table row, which ends itself. */
type Paragraph = string | Rtf | { row: string };

/**
 * The paragraphs as one document's RTF, each starting its formatting over, after `\uc0`, as
 * `escapeText` writes for.
 */
function body(paragraphs: Paragraph[]): string {
  return (
    '\\uc0 ' +
    paragraphs
      .map((paragraph, index) => {
        if (typeof paragraph === 'object' && 'row' in paragraph) return paragraph.row;
        // Every paragraph but the document's last ends with its mark, before a table too.
        const ends = index === paragraphs.length - 1 ? '' : '\\\n';
        return `\\pard ${rtfOf(paragraph)}${ends}`;
      })
      .join('')
  );
}

/** A document read as the project reads one, from its RTF, its styles listed by name. */
const documentOf = (source: string): DocumentText =>
  readDocumentText(source, STYLE_NAMES, [
    {
      id: 'C1',
      collapsed: false,
      color: [1, 1, 1],
      text: readDocumentText(rtfDocument('a comment')),
    },
  ]);

/** The paragraphs of each document the tests include, by binder ID; by default two of them. */
type Included = Record<string, Paragraph[]>;

/** A binder item a document link can include. */
const linkable = (id: string, title?: string): BinderItem => ({
  id,
  type: 'Text',
  created: '',
  modified: '',
  keywords: [],
  bookmarks: [],
  children: [],
  ...(title === undefined ? {} : { title }),
});

/**
 * A compile of the test documents: styles named as the documents number them, no linked image
 * there, and each included document read from its paragraphs.
 */
function inputFor(overrides: Partial<TextOptions>, included: Included): TextInput {
  const items = ['C', 'D', 'E', 'N', 'T'].map((id) => linkable(id));
  const named = linkable('NAMED', 'Named');
  return {
    project: {
      dir: '/nowhere/Test.scriv',
      files: localFiles,
      styles: STYLE_NAMES.map((name) => ({ id: name, name })),
    },
    format,
    settings: { text: { ...options, ...overrides } },
    documents: {
      text: (id) => {
        const paragraphs = id === 'NAMED' ? ['named text'] : included[id];
        if (paragraphs?.length === 0) return documentOf('');
        return documentOf(rtfDocument(body(paragraphs ?? [`included ${id}`, bullet('and more')])));
      },
    },
    index: {
      byId: new Map([...items, named].map((item) => [item.id, item])),
      byTitle: new Map([['Named', named]]),
    },
  };
}

/**
 * A document's compiled text, each footnote marker written with its number and text, as
 * `[^1:text]`.
 */
const render = (
  paragraphs: Paragraph[],
  overrides: Partial<TextOptions> = {},
  layout: TextLayout = {},
  included: Included = {},
) => renderDocument(documentOf(rtfDocument(body(paragraphs))), overrides, layout, included);

const renderDocument = (
  document: DocumentText,
  overrides: Partial<TextOptions> = {},
  layout: TextLayout = {},
  included: Included = {},
) => {
  const { text, notes } = renderText(document, inputFor(overrides, included), layout);
  return text?.text.replaceAll(/\[\^cf(\d+)\]/g, (_, number: string) => {
    return `[^${number}:${notes[Number(number) - 1]!.text}]`;
  });
};

/**
 * A list item, in the builder's list table: drawn bullets in its bulleted list (1), anything
 * else in its numbered one (2).
 */
const bullet = (text: string, marker = '•', level = 0): Rtf => {
  const list = ['•', '◦'].includes(marker) ? 1 : 2;
  return {
    rtf: `\\ls${list}\\ilvl${level} {\\listtext\t${escapeText(marker)}\t}${escapeText(text)}`,
  };
};

describe('renderText', () => {
  it('has no text without paragraphs, and has text in a paragraph with nothing to write', () => {
    expect(render([])).toBeUndefined();
    // A paragraph whose text a style deletes.
    expect(render(['<$Scr_Cs::8>gone<!$Scr_Cs::8>'])).toBe('');
  });

  it('emits a paragraph style prefix once where its range opens, and drops markers', () => {
    expect(
      render([
        '<$ScrKeepWithNext><$Scr_H::1><$Scr_Ps::0>Title',
        '<!$Scr_H::1><!$Scr_Ps::0>Body',
        '<$Scr_Ps::6>Unstyled<!$Scr_Ps::6>',
      ]),
    ).toBe('# Title\nBody\nUnstyled');
  });

  it('ends a range on its last paragraph, and drops the suffix after an empty one', () => {
    expect(
      render([
        '<$Scr_Ps::1>one',
        'two',
        '<!$Scr_Ps::1>after',
        '<$Scr_Ps::1>three',
        '',
        '<!$Scr_Ps::1>end',
      ]),
    ).toBe('\t```one\n\ttwo```\nafter\n\t```three\n\nend');
    expect(render(['<$Scr_Ps::1>open to the end'])).toBe('\t```open to the end```');
    expect(render(['<$Scr_Ps::1>mid<!$Scr_Ps::1> rest'])).toBe('\t```mid``` rest');
  });

  it('ignores markers for styles the document does not list, and writes an ending with no style open as it is', () => {
    expect(render(['<$Scr_Ps::12>plain<!$Scr_Ps::12> and <!$Scr_Cs::4>closed'])).toBe(
      'plain and <!$Scr_Cs::4>closed',
    );
  });

  it('opens a paragraph-only style before character styles opened at the paragraph start', () => {
    expect(render(['<$Scr_Cs::5><$Scr_Ps::9>Tip<!$Scr_Cs::5> body<!$Scr_Ps::9>'])).toBe(
      '<{==Tip==} body>',
    );
    expect(render(['<$Scr_Ps::9>plain<!$Scr_Ps::9>'])).toBe('<plain>');
  });

  it("writes a style's paragraph prefix after its own prefix, where the style opens", () => {
    expect(render(['<$Scr_Ps::10>one', 'two<!$Scr_Ps::10>'])).toBe('[list]- one\n- two');
    expect(render(['a <$Scr_Ps::10>b', 'c<!$Scr_Ps::10>'])).toBe('a [list]b\n- c');
  });

  it('prefixes every non-empty line of block quotes and paragraph-prefix styles', () => {
    expect(render(['<$Scr_Ps::2>quoted', '', 'more<!$Scr_Ps::2>'])).toBe('> quoted\n\n> more');
    expect(render(['<$Scr_Ps::3>marked<!$Scr_Ps::3>'])).toBe('| marked');
  });

  it('wraps code spans, drops empty runs, and closes a run at each paragraph end', () => {
    expect(render(['Run <$Scr_Cs::4>make check<!$Scr_Cs::4> now'])).toBe('Run `make check` now');
    expect(render(['<$Scr_Cs::4><$Scr_Ps::0>makefile<!$Scr_Cs::4> notes'])).toBe(
      '`# makefile` notes',
    );
    expect(render(['<$Scr_Cs::4>first', '', 'last<!$Scr_Cs::4>'])).toBe('`first`\n\n`last`');
    expect(render(['x<$Scr_Cs::5><!$Scr_Cs::5>y <$Scr_Cs::5>hi<!$Scr_Cs::5>'])).toBe('xy {==hi==}');
  });

  it('converts lists, numbering each run and setting it apart with empty lines', () => {
    expect(
      render([
        'Before',
        bullet('one'),
        bullet('two'),
        'Between',
        bullet('first', '1.'),
        bullet('second', 'b.'),
        '',
        bullet('again', 'iv)'),
      ]),
    ).toBe('Before\n\n* one\n* two\n\nBetween\n\n1. first\n2. second\n\n1. again');
  });

  it('removes inline footnotes and annotations when the options say so', () => {
    expect(
      render(['A{\\Scrv_fn=note\\end_Scrv_fn} B{\\Scrv_annot \\text=x\\end_Scrv_annot}']),
    ).toBe('A B');
  });

  it('keeps footnotes, annotations and Preserve Formatting when asked', () => {
    expect(
      render(
        [
          'A{\\Scrv_fn=note\\end_Scrv_fn} B{\\Scrv_annot \\color={\\R=1} \\text=x\\end_Scrv_annot} ' +
            '{\\Scrv_ps=*raw*\\end_Scrv_ps}',
        ],
        { removeFootnotes: false, removeAnnotations: false },
      ),
    ).toBe('A[^1:note] B{>>x<<} *raw*');
  });

  it('styles footnote text, carries a character style across its edges, and drops a deleted note', () => {
    const on = { removeFootnotes: false };
    expect(render(['a{\\Scrv_fn=see <$Scr_Cs::4>x<!$Scr_Cs::4>\\end_Scrv_fn} b'], on)).toBe(
      'a[^1:see `x`] b',
    );
    expect(render(['<$Scr_Cs::5>a{\\Scrv_fn=n\\end_Scrv_fn}b<!$Scr_Cs::5>'], on)).toBe(
      '{==a[^1:{==n==}]b==}',
    );
    expect(render(['a{\\Scrv_fn=<$Scr_Cs::5>n\\end_Scrv_fn}b<!$Scr_Cs::5>'], on)).toBe(
      'a[^1:{==n==}]{==b==}',
    );
    expect(render(['a{\\Scrv_fn=<$Scr_Cs::8>gone\\end_Scrv_fn}<!$Scr_Cs::8> b'], on)).toBe('a b');
    expect(render(['<$Scr_Cs::5>a{\\Scrv_fn=n<!$Scr_Cs::5>\\end_Scrv_fn}b'], on)).toBe(
      '{==a[^1:{==n==}]==}b',
    );
  });

  it('stops on a footnote that runs across paragraphs', () => {
    expect(() => render(['{\\Scrv_fn=open', 'close\\end_Scrv_fn}'])).toThrow(
      'Unsupported: a footnote, annotation or Preserve Formatting across paragraphs',
    );
  });

  it('deletes struck-through text when asked, and keeps it otherwise', () => {
    const text = inlines('keep ', struck('gone'), ' kept');
    expect(render([text])).toBe('keep gone kept');
    expect(render([text], { deleteStruckThrough: true })).toBe('keep  kept');
  });

  it('stops on deleting strike-through that cuts across markup, in a paragraph or a cell', () => {
    const cut = inlines('<$Scr_', struck('Cs::1>gone'), 'kept');
    expect(render([cut])).toBe('```gonekept```');
    for (const paragraph of [cut, row({ paragraphs: [cut] })]) {
      expect(() => render([paragraph], { deleteStruckThrough: true })).toThrow(
        'Unsupported: struck-through text that cuts across Scrivener markup',
      );
    }
  });

  it('writes links as Markdown when asked, and linked comments by the format', () => {
    const text = inlines(
      link('https://x.test', 'web'),
      ' ',
      link('scrivlnk://D1', 'doc'),
      ' ',
      link('scrivcmt://C1', 'noted'),
      ' ',
      link('scrivcmt://C2', 'lost'),
    );
    expect(render([text])).toBe('web doc noted lost');
    expect(render([text], { convertLinks: true, removeComments: false })).toBe(
      '[web](https://x.test) [doc][] noted (a comment) lost ()',
    );
  });

  it('keeps line breaks in a paragraph, and continues a list item on a tab-indented paragraph', () => {
    expect(render([bullet(`a${LINE_BREAK}${LINE_BREAK}b`)])).toBe('* a\n\n\tb');
    expect(render([`one${LINE_BREAK}two`, bullet(`item${LINE_BREAK}more`)])).toBe(
      `one${LINE_BREAK}two\n\n* item\n\n\tmore`,
    );
  });

  it('indents nested lists four spaces a level, numbering each level and kind apart', () => {
    expect(
      render([
        bullet('one'),
        bullet('inner', '◦', 1),
        bullet('inner two', '◦', 1),
        bullet('two'),
        bullet('first', '1.'),
        bullet('sub', 'a.', 1),
        bullet('second', '2.'),
      ]),
    ).toBe('* one\n    * inner\n    * inner two\n* two\n1. first\n    1. sub\n2. second');
  });

  it('writes a heading style starting on a list item as the marker and the text', () => {
    expect(render([bullet('<$Scr_Ps::0>Heading item'), '<!$Scr_Ps::0>After'])).toBe(
      '* •\tHeading item\n\nAfter',
    );
    expect(render([bullet('<$Scr_Ps::0>Numbered', '1.'), '<!$Scr_Ps::0>After'])).toBe(
      '1. 1.\tNumbered\n\nAfter',
    );
  });

  it('leaves out text in a deleting style, and the lines it empties', () => {
    expect(
      render(['Kept', '<$Scr_Ps::8>gone', '<!$Scr_Ps::8>Also <$Scr_Cs::8>gone<!$Scr_Cs::8>kept']),
    ).toBe('Kept\nAlso kept');
  });

  it('replaces empty, unstyled lines with the blank line separator', () => {
    expect(
      render(['a', '', '<$Scr_Ps::2>', '<!$Scr_Ps::2>b'], {}, { blankLineSeparator: '* * *' }),
    ).toBe('a\n* * *\n\nb');
  });

  it('counts each level through the run of a list, across shallower items between', () => {
    expect(
      render([bullet('a', '•'), bullet('one', '1.', 1), bullet('b', '•'), bullet('two', '1.', 1)]),
    ).toBe('* a\n    1. one\n* b\n    2. two');
  });

  it.each([
    [undefined, 'a list item with no list definition'],
    [255, 'a list level with no marker'],
  ])('stops on a list item whose format is %s', (levelFormat, feature) => {
    // A list item in list 9, which the document defines only when there is a format to give it.
    const lists =
      levelFormat === undefined
        ? ''
        : `{\\*\\listtable{\\list{\\listlevel\\levelnfc${levelFormat}{\\leveltext\\'00;}}\\listid9}}` +
          '{\\*\\listoverridetable{\\listoverride\\listid9\\ls9}}';
    const source = `{\\rtf1\\ansi${lists}\\pard\\ls9\\ilvl0 {\\listtext\t\t}x}`;
    expect(() => renderDocument(documentOf(source))).toThrow(`Unsupported: ${feature}`);
  });

  it('stops on lists when list conversion is off', () => {
    expect(() => render([bullet('x')], { convertLists: false })).toThrow(
      'Unsupported: lists without list conversion',
    );
  });
});

/** A table cell: its paragraphs, alignment, merge, and whether a table nests it. */
interface Cell {
  paragraphs: (string | Rtf)[];
  alignment?: 'left' | 'center' | 'right' | 'justified';
  merge?: 'first' | 'rest' | 'top' | 'below';
  nested?: boolean;
}

const cell = (text: string, overrides: Partial<Cell> = {}): Cell => ({
  paragraphs: text.split('\n'),
  ...overrides,
});

const MERGES = { first: 'clmgf', rest: 'clmrg', top: 'clvmgf', below: 'clvmrg' } as const;
const ALIGNMENTS = { left: '', center: '\\qc', right: '\\qr', justified: '\\qj' } as const;

/**
 * A table row as macOS writes one: its layout, each cell's edge and merge, then each cell's
 * paragraphs, the last ending the cell, the last cell's the row.
 */
const row = (...cells: Cell[]): { row: string } => {
  const layout = cells
    .map(({ merge }, index) => `${merge ? `\\${MERGES[merge]}` : ''}\\cellx${(index + 1) * 1000}`)
    .join('');
  const content = cells.map(({ paragraphs, alignment = 'left', nested }) => {
    const depth = nested ? 2 : 1;
    return paragraphs
      .map((paragraph, index) => {
        const last = index === paragraphs.length - 1;
        const align = last ? ALIGNMENTS[alignment] : '';
        return `\\pard\\intbl\\itap${depth}${align} ${rtfOf(paragraph)}${last ? '\\cell ' : '\\\n'}`;
      })
      .join('');
  });
  return { row: `\\itap1\\trowd ${layout}\n${content.join('')}\\row\n` };
};

/** A document link whose whole text is `<$include>`. */
const include = (id: string) => link(`scrivlnk://${id}`, '<$include>');

describe('included documents', () => {
  const single: Included = { C: ['just C', ''], N: ['just N', ''] };

  it('put their paragraphs in place of the link, splitting the paragraph around it', () => {
    expect(render([inlines('before ', include('D'), ' after')])).toBe(
      'before included D\n\n* and more after',
    );
  });

  it('go inline in a footnote, paragraphs on tab-indented lines, or a table cell', () => {
    const on = { removeFootnotes: false };
    const note = inlines('a{\\Scrv_fn=', include('N'), '\\end_Scrv_fn}');
    expect(render([note], on, {}, single)).toBe('a[^1:just N]');
    expect(render([note], on)).toBe('a[^1:included N\n\tand more]');
    expect(() => render([row(cell('h')), row({ paragraphs: [inlines(include('C'))] })])).toThrow(
      'Unsupported: a table cell that includes more than one paragraph',
    );
    const included: Cell = { paragraphs: [inlines(include('C'))] };
    expect(render([row(cell('h')), row(included)], {}, {}, single)).toBe(
      '| h |\n| :----- |\n| just C |',
    );
  });

  it('keep their own styles, the styles around them open again after them', () => {
    // A character style closing, then one opening, each the included document's own.
    const closes: Included = { D: ['<!$Scr_Cs::5>x', 'middle', '<$Scr_Cs::4>y'] };
    expect(
      render([inlines('<$Scr_Cs::5>a ', include('D'), ' b<!$Scr_Cs::5>')], {}, {}, closes),
    ).toBe('{==a ==}x\n{==middle==}\n`y`{== b==}');
  });

  it('leave nothing when they are empty', () => {
    const empty: Included = { E: [] };
    expect(render([inlines('a', include('E'), 'b')], {}, {}, empty)).toBe('ab');
    const note = inlines('a{\\Scrv_fn=x', include('E'), '\\end_Scrv_fn}');
    expect(render([note], { removeFootnotes: false }, {}, empty)).toBe('a[^1:x]');
  });

  it('stop when they start or end with a table', () => {
    const table: Included = { T: [row(cell('x'))] };
    expect(() => render([inlines(include('T'))], {}, {}, table)).toThrow(
      'Unsupported: an included document that starts or ends with a table',
    );
  });
});

describe('tables', () => {
  it('writes the header, the alignment row and the body, set apart from the text around them', () => {
    expect(
      render([
        'Before',
        row(
          cell('Name'),
          cell('Value', { alignment: 'center' }),
          cell('Size', { alignment: 'right' }),
        ),
        row(
          cell('a'),
          cell('<$Scr_Cs::4>x<!$Scr_Cs::4>', { alignment: 'center' }),
          cell('', { alignment: 'right' }),
        ),
        'After',
      ]),
    ).toBe(
      'Before\n\n| Name | Value | Size |\n| :----- | :-----: | -----: |\n| a | `x` |  |\n\nAfter',
    );
  });

  it('runs the header to the first row without merged cells, and writes merged cells as ||', () => {
    expect(
      render([
        row(cell('Wide', { merge: 'first' }), cell('', { merge: 'rest' })),
        row(cell('l'), cell('r')),
        row(cell('Spans', { merge: 'first' }), cell('', { merge: 'rest' })),
      ]),
    ).toBe('| Wide ||\n| l | r |\n| :----- | :----- |\n| Spans ||');
  });

  it('writes a caption from either side under the table, in place of the empty line on its side', () => {
    expect(render(['Text', '<$Scr_Ps::7>Above', row(cell('<!$Scr_Ps::7>t')), 'More'])).toBe(
      'Text\n| t |\n| :----- |\n[Above]\n\nMore',
    );
    expect(render(['Text', row(cell('t')), '<$Scr_Ps::7>Below', '<!$Scr_Ps::7>More'])).toBe(
      'Text\n\n| t |\n| :----- |\n[Below]\nMore',
    );
  });

  it('writes a caption that is not next to a table as a plain line', () => {
    expect(render(['Text', '<$Scr_Ps::7>Lonely caption'])).toBe('Text\nLonely caption');
  });

  it('adds a space after cells aligned unlike the first row, under its first two cells only', () => {
    expect(
      render([
        row(
          cell('Wide', { alignment: 'center', merge: 'first' }),
          cell('', { merge: 'rest' }),
          cell('C', { alignment: 'right' }),
          cell('D', { alignment: 'right' }),
        ),
        row(cell('a'), cell('b'), cell('c'), cell('d')),
        row(cell('e'), cell('f'), cell(''), cell('h', { alignment: 'right' })),
      ]),
    ).toBe(
      '| Wide || C | D |\n| a  | b | c  | d |\n| :----- | :----- | :----- | :----- |\n| e  | f |  | h |',
    );
  });

  it('sets a table after a list apart once', () => {
    expect(render([bullet('item'), row(cell('t'))])).toBe('* item\n\n| t |\n| :----- |');
  });

  it('writes vertical merges, multi-paragraph and justified cells, and uneven rows as Scrivener does', () => {
    expect(
      render([
        row(cell('H1'), cell('H2')),
        row(cell('tall', { merge: 'top' }), cell('r1')),
        row(cell('', { merge: 'below' }), cell('r2')),
        row(cell('one\ntwo'), cell('j', { alignment: 'justified' })),
        row(cell('short')),
        row(cell('w1'), cell('w2'), cell('w3', { alignment: 'right' })),
      ]),
    ).toBe(
      '| H1 | H2 |\n| :----- | :----- |\n| tall | r1 | r2 |\n| one two  | j  |\n| short |\n| w1 | w2 | w3 |',
    );
  });

  it.each([
    [[row(cell('x', { nested: true }))], 'nested tables'],
    [
      [row(cell('x', { merge: 'first' }), cell('', { merge: 'rest' }))],
      'a table whose every row has merged cells',
    ],
    [[row(cell('x', { alignment: 'justified' }))], 'a justified cell in the alignment row'],
    [
      [row(cell('', { merge: 'below' }), cell('x')), row(cell('a'), cell('b'))],
      'a table whose first row continues a merge from above',
    ],
    [[row(cell('<$Scr_Ps::0>x'))], 'paragraph styles in table cells'],
    [['<$Scr_Ps::5>a', row(cell('<!$Scr_Ps::5>x'))], 'paragraph styles in table cells'],
  ] as const)('stops on unsupported tables: %#', (paragraphs, feature) => {
    expect(() => render([...paragraphs])).toThrow(`Unsupported: ${feature}`);
  });
});

/** Bold text, as RTF writes it. */
const bold = (text: string): Rtf => ({ rtf: `{\\b ${escapeText(text)}}` });

describe('converting rich text to MultiMarkdown', () => {
  const on = { richText: { escape: true } };

  it('marks bold inside a paragraph style, and writes none of what a style deletes', () => {
    expect(render([inlines('<$Scr_Ps::0>', bold('H'), '<!$Scr_Ps::0>')], on)).toBe('# **H**');
    expect(render([inlines('a<$Scr_Cs::8>', bold('gone'), '<!$Scr_Cs::8>b')], on)).toBe('ab');
  });

  it('runs bold on straight across a change of formatting, and keeps leading space outside', () => {
    expect(render([inlines(bold('one'), { rtf: '{\\b\\fs30 two}' })], on)).toBe('**onetwo**');
    expect(render([inlines('a', bold(' x'))], on)).toBe('a **x**');
  });
});
