import { localFiles } from './local-files.ts';
import { describe, expect, it } from 'vite-plus/test';
import { linkField, type LinkTarget } from './link-target.ts';
import { markupRuns, markupText, parseMarkup } from './markup.ts';
import { struckChangesMarkup, struckOut } from './struck-text.ts';
import {
  type Includes,
  type MarkupInput,
  type ResolvedNode,
  resolveMarkup,
} from './resolve-markup.ts';
import { rtfDocument } from '../test/rtf-builder.ts';
import { LINE_BREAK, type Run } from './rich-text.ts';
import { readRichText } from './rich-text-reader.ts';
import { readDocumentText } from './document.ts';

/** Formatting with nothing set, and struck through. */
const PLAIN = {};
const STRUCK = { strike: { style: 'strike' } };
const text = (value: string): Run => ({ text: value, format: PLAIN });
/** Struck-through text. */
const struck = (value: string): Run => ({ text: value, format: STRUCK });
const lineBreak: Run = { text: LINE_BREAK, format: PLAIN };

/** Runs, and runs of runs, as one paragraph's runs. */
type Part = Run | Run[];
const runs = (...parts: Part[]): Run[] => parts.flat();

/** A hyperlink field's runs: its text, each run of it carrying the field. */
const link = (target: string, ...content: Part[]): Run[] =>
  runs(...content).map((run) => ({
    ...run,
    format: { ...run.format, field: `HYPERLINK "${target}"` },
  }));

const STYLE_IDS = Array.from({ length: 16 }, (_, index) => String(index));

/** A compile whose styles are named by their numbers, as the document lists them. */
const input: MarkupInput = {
  project: {
    dir: '/nowhere/Fixture.scriv',
    files: localFiles,
    styles: STYLE_IDS.map((id) => ({ id, name: id })),
  },
  format: { annotationPrefix: '{>>', annotationSuffix: '<<}', commentFormat: '<$lnk>' },
  settings: {
    text: {
      convertLinks: true,
      removeAnnotations: false,
      removeComments: false,
      removeFootnotes: false,
      deleteStruckThrough: true,
    },
  },
};

const includes: Includes = {
  byId: (id) => [{ nodes: [{ kind: 'text', text: `text of ${id}` }] }],
  byTitle: (title) =>
    title === 'Named' ? [{ nodes: [{ kind: 'text', text: 'named text' }] }] : undefined,
};

/**
 * Resolved markup, with style markers written as `{P0}` and `{/C1}` (the styles are named by
 * their numbers), footnotes as `[^…]`, and included paragraphs as `(…|…)`.
 */
const show = (nodes: ResolvedNode[]): string =>
  nodes
    .map((node) => {
      if (node.kind === 'text' || node.kind === 'edge') return node.text;
      if (node.kind === 'footnote') return `[^${show(node.content)}]`;
      if (node.kind === 'bound') return `(${node.text} of ${node.item})`;
      if (node.kind === 'included') return `«${show(node.content)}»`;
      if (node.kind === 'include') {
        return `(${node.paragraphs.map((paragraph) => show(paragraph.nodes)).join('|')})`;
      }
      const scope = node.scope === 'paragraph' ? 'P' : 'C';
      return `{${node.closing ? '/' : ''}${scope}${node.name}}`;
    })
    .join('');

const resolved = (...content: Part[]) =>
  show(
    resolveMarkup(
      struckOut(parseMarkup(runs(...content))),
      { comments: [], styleIds: STYLE_IDS },
      input,
      includes,
    ),
  );

describe('parseMarkup', () => {
  it('reads style markers, and drops heading and keep-with-next markers', () => {
    expect(resolved(text('<$ScrKeepWithNext><$Scr_H::1><$Scr_Ps::0>a<!$Scr_Cs::12>b'))).toBe(
      '{P0}a{/C12}b',
    );
  });

  it('reads markup inside footnotes, links included, and keeps it as typed in annotations', () => {
    expect(
      resolved(
        text('a{\\Scrv_fn=<$Scr_Cs::0>x{\\Scrv_ps=y\\end_Scrv_ps} '),
        link('https://x.test', text('<$Scr_Cs::0>site')),
        text('\\end_Scrv_fn}<!$Scr_Cs::0>'),
      ),
    ).toBe('a[^{C0}xy [{C0}site](https://x.test)]{/C0}');
    expect(
      resolved(
        text('{\\Scrv_annot \\text=<$Scr_Cs::0>'),
        link('https://x.test', text('<$Scr_Cs::1>')),
        link('scrivlnk://D', text('<$title>')),
        text('\\end_Scrv_annot}'),
      ),
    ).toBe('{>><$Scr_Cs::0>[<$Scr_Cs::1>](https://x.test)<$title><<}');
  });

  it('stops on a document included in an annotation', () => {
    expect(() =>
      resolved(
        text('{\\Scrv_annot \\text='),
        link('scrivlnk://D', text('<$include>')),
        text('\\end_Scrv_annot}'),
      ),
    ).toThrow('Unsupported: an annotation with an included document');
  });

  it('keeps Preserve Formatting text in the paragraph, markers and all', () => {
    expect(resolved(text('{\\Scrv_ps=<$Scr_Cs::4>raw<!$Scr_Cs::4>\\end_Scrv_ps}'))).toBe(
      '{C4}raw{/C4}',
    );
  });

  it('keeps an ending with no matching start as text', () => {
    expect(resolved(text('a\\end_Scrv_fn} {\\Scrv_ps=b\\end_Scrv_annot}\\end_Scrv_ps}'))).toBe(
      'a\\end_Scrv_fn} b\\end_Scrv_annot}',
    );
  });

  it('keeps struck text marked, and knows strike-through that cuts across markup', () => {
    const cut = struck('Cs::1>gone');
    expect(parseMarkup([text('<$Scr_'), cut, text('kept')])).toEqual([
      {
        kind: 'style',
        scope: 'character',
        index: 1,
        closing: false,
        source: '<$Scr_Cs::1>',
        // Written across a change of formatting, each part keeps its own.
        format: PLAIN,
        mixed: [
          { length: 6, format: PLAIN },
          { length: 6, format: STRUCK },
        ],
      },
      { kind: 'text', text: 'gone', format: STRUCK },
      { kind: 'text', text: 'kept', format: PLAIN },
    ]);
    expect(struckChangesMarkup(parseMarkup(runs(text('<$Scr_'), cut, text('<$Scr_Cs::2>'))))).toBe(
      true,
    );
    const word = struck('b');
    expect(struckChangesMarkup(parseMarkup(runs(text('a '), word, text(' c'))))).toBe(false);
    expect(resolved(text('a '), word, text(' c'))).toBe('a  c');
    const noted = [text('a{\\Scrv_fn=n\\end_Scrv_fn} '), word];
    expect(struckChangesMarkup(parseMarkup(noted))).toBe(false);
    expect(struckChangesMarkup(parseMarkup(runs(link('https://x.test', text('a '), word))))).toBe(
      false,
    );
    expect(struckChangesMarkup(parseMarkup(runs(text('a <$title> '), word, lineBreak)))).toBe(
      false,
    );
  });

  it("deletes markup struck through with its text, keeping a struck note's own text", () => {
    const nodes = parseMarkup([
      struck('{\\Scrv_fn='),
      text('note'),
      struck('\\end_Scrv_fn}{$SCRImageLink[w:1;h:1]=y.png}'),
      text(' after'),
    ]);
    expect(nodes).toEqual([
      {
        kind: 'footnote',
        content: [{ kind: 'text', text: 'note', format: PLAIN }],
        open: { format: STRUCK },
        close: { format: STRUCK },
      },
      {
        kind: 'image',
        path: 'y.png',
        source: '{$SCRImageLink[w:1;h:1]=y.png}',
        format: STRUCK,
      },
      { kind: 'text', text: ' after', format: PLAIN },
    ]);
    expect(struckOut(nodes)).toEqual([{ kind: 'text', text: 'note after', format: PLAIN }]);
    expect(parseMarkup([struck('x <$title>')])).toEqual([
      { kind: 'text', text: 'x ', format: STRUCK },
      { kind: 'placeholder', name: 'title', argument: [], slashes: 0, format: STRUCK },
    ]);
  });

  it('writes every kind of markup back as the runs it was read from', () => {
    const BOLD = { bold: true };
    const content = runs(
      text('a <$title> <$Scr_Ps::0><$Scr_H::1>{\\Scrv_fn=n\\end_Scrv_fn}'),
      { text: '{\\Scrv_annot \\color={\\R=1} \\text=x\\end_Scrv_annot}', format: BOLD },
      text('{\\Scrv_ps=p\\end_Scrv_ps}{$SCRImageLink[w:1;h:1]=i.png}<$Scr_'),
      struck('Cs::1>'),
      lineBreak,
      link('https://x.test', text('site')),
    );
    const expected = [
      { text: 'a <$title> <$Scr_Ps::0><$Scr_H::1>{\\Scrv_fn=n\\end_Scrv_fn}', format: PLAIN },
      { text: '{\\Scrv_annot \\color={\\R=1} \\text=x\\end_Scrv_annot}', format: BOLD },
      { text: '{\\Scrv_ps=p\\end_Scrv_ps}{$SCRImageLink[w:1;h:1]=i.png}<$Scr_', format: PLAIN },
      { text: 'Cs::1>', format: STRUCK },
      { text: LINE_BREAK, format: PLAIN },
      // A link's text keeps its field.
      { text: 'site', format: { field: 'HYPERLINK "https://x.test"' } },
    ];
    expect(markupRuns(parseMarkup(content))).toEqual(expected);
  });

  it('stops the compile on a footnote that starts in a link and ends outside it', () => {
    expect(() =>
      resolved(link('https://x.test', text('{\\Scrv_fn=a')), text('\\end_Scrv_fn}')),
    ).toThrow('Unsupported: a footnote, annotation or Preserve Formatting across paragraphs');
  });
});

/** A paragraph's markup, read from RTF as a document's is. */
const markupOf = (body: string) => {
  const [paragraph] = readRichText(rtfDocument(body)).paragraphs;
  return parseMarkup(paragraph!.content);
};

describe('parseMarkup on read RTF', () => {
  it('reads each hyperlink as a link to its target, and other fields as text', () => {
    const nodes = markupOf(
      'See {\\field{\\*\\fldinst{HYPERLINK "scrivlnk://ABC"}}{\\fldrslt {\\b this} page}} and ' +
        '{\\field{\\*\\fldinst HYPERLINK "https://x.test"}{\\fldrslt site}}{\\field{\\*\\fldinst PAGE}{\\fldrslt 3}}',
    );
    expect(nodes.map((node) => (node.kind === 'link' ? node.target : markupText([node])))).toEqual([
      'See ',
      { kind: 'document', id: 'ABC' },
      ' and ',
      { kind: 'address', address: 'https://x.test' },
      '3',
    ]);
    expect(markupText(nodes)).toBe('See this page and site3');
  });

  it('reads a line break, written either way, as a node of its own, in its formatting', () => {
    const nodes = markupOf('a\\line \\b b\\uc0\\u8232 c');
    expect(nodes.map((node) => node.kind)).toEqual(['text', 'break', 'text', 'break', 'text']);
    expect(nodes[3]).toEqual({ kind: 'break', format: expect.objectContaining({ bold: true }) });
  });
});

describe('resolveMarkup', () => {
  it('reads a linked image as its path, and keeps it as typed in an annotation', () => {
    expect(
      resolved(
        text('a {$SCRImageLink[w:16;h:16]=/gfx/x.jpg} b '),
        text('{\\Scrv_annot \\text={$SCRImageLink[w:1;h:1]=y.png}\\end_Scrv_annot}'),
      ),
    ).toBe('a MISSING_IMAGE:/gfx/x.jpg b {>>{$SCRImageLink[w:1;h:1]=y.png}<<}');
  });

  it('binds placeholder text that a document link starts to the linked document', () => {
    expect(
      resolved(
        link('scrivlnk://D3', text('<$Scr_Cs::0><$title><!$Scr_Cs::0>')),
        text(' '),
        link('https://x.test', text('<$title>')),
        text(' '),
        link('scrivlnk://D4', text('<$title> and more')),
        link('scrivlnk://D5', text('{$SCRImageLink[w:1;h:1]=i.png}')),
        link('scrivlnk://D6', text('<$title>{\\Scrv_fn=n\\end_Scrv_fn}')),
      ),
    ).toBe(
      '{C0}(<$title> of D3){/C0} [<$title>](https://x.test) (<$title> and more of D4)[MISSING_IMAGE:i.png][](<$title> of D6)[^n]',
    );
  });

  it('puts a document <$include:title> names in its place, and leaves other text be', () => {
    expect(
      resolved(
        text(
          '<$include:Named> and <$include:Other> \\<$include:Named> <$include:<$title>> <$include:Named>',
        ),
      ),
    ).toBe('(named text) and <$include:Other> \\<$include:Named> <$include:<$title>> (named text)');
  });

  it('puts the text of a document a link includes in its place', () => {
    expect(
      resolved(
        link('scrivlnk://D1', text('<$include>')),
        text(' '),
        link('https://x.test', text('<$include>')),
        text(' '),
        link('scrivlnk://D2', text('<$include>'), text('x')),
      ),
    ).toBe('(text of D1) [<$include>](https://x.test) (<$include>x of D2)');
  });
});

describe('comment templates', () => {
  it('put the linked text and the comment in, and leave other placeholders for later', () => {
    const nodes = resolveMarkup(
      parseMarkup(link('scrivcmt://C', text('words'))),
      {
        comments: [
          {
            id: 'C',
            collapsed: false,
            color: [1, 1, 1],
            text: readDocumentText(rtfDocument('note')),
          },
        ],
        styleIds: [],
      },
      {
        ...input,
        format: { ...input.format, commentFormat: '<$lnk> (<$cmt>) <$title> \\<$cmt>' },
      },
      includes,
    );
    expect(show(nodes)).toBe('words (note) <$title> \\<$cmt>');
  });
});

describe('markupText', () => {
  it('reads link text and line breaks, and leaves out markers and notes', () => {
    const content = runs(
      text('<$Scr_Cs::0>see{\\Scrv_fn=n\\end_Scrv_fn} '),
      link('https://x.test', text('site')),
      lineBreak,
    );
    expect(markupText(parseMarkup(content))).toBe(`see site${LINE_BREAK}`);
  });
});

describe('linkField', () => {
  it('writes each kind of target as the field it is read from', () => {
    const targets: LinkTarget[] = [
      { kind: 'document', id: 'A' },
      { kind: 'comment', id: 'B' },
      { kind: 'address', address: 'https://a.example' },
    ];
    for (const target of targets) {
      const format = { field: linkField(target) };
      expect(parseMarkup([{ text: 'x', format }])).toMatchObject([{ kind: 'link', target }]);
    }
  });
});
