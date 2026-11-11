import { describe, expect, it } from 'vite-plus/test';
import { markdownParagraphs, paragraphsMarkdown } from './markdown-form.ts';
import { readMarkdown } from './markdown-tree.ts';
import type { WrittenParagraph } from './paragraph-edits.ts';
import { LINE_BREAK } from './rich-text.ts';
import { styleRoles } from './style-mapping.ts';

const roles = styleRoles({ styles: [] });

const line = (text: string, style?: string): WrittenParagraph => ({
  ...(style === undefined ? {} : { style }),
  text: [{ text }],
});

/** A document's lines of words. */
const paragraphLines = (paragraphs: WrittenParagraph[]) =>
  paragraphs.map(({ text }) =>
    text
      .filter(({ note }) => !note)
      .map((piece) => piece.text)
      .join(''),
  );

const edited = (paragraphs: WrittenParagraph[], change: (markdown: string) => string) =>
  markdownParagraphs(
    readMarkdown(change(paragraphsMarkdown(paragraphs, roles))),
    paragraphs,
    roles,
  );

describe('the Markdown form', () => {
  it('shows what paragraphs are, by their roles, and a heading by its own level', () => {
    const markdown = paragraphsMarkdown(
      [
        { ...line('head', 'Heading 2'), level: 2 },
        line('named only', 'Heading 3'),
        { ...line('level only'), level: 4 },
        line('said', 'Block Quote'),
        line('x = 1', 'Code Block'),
        { ...line('item'), list: { ordered: false, level: 0 } },
        {
          text: [
            { text: 'a', bold: true },
            { text: 'b', italic: true },
            { text: 'c', style: 'Code Span' },
            { text: 'd', link: { kind: 'address', address: 'https://a.b' } },
            { text: 'e' },
            { text: LINE_BREAK },
            { text: 'f' },
          ],
        },
      ],
      roles,
    );
    expect(markdown).toContain('## head');
    expect(markdown).toContain('\nnamed only\n');
    expect(markdown).toContain('#### level only');
    expect(markdown).toContain('> said');
    expect(markdown).toContain('```\nx = 1\n```');
    expect(markdown).toContain('* item');
    expect(markdown).toContain('**a***b*`c`[d](https://a.b)e');
  });

  it('turns marks into the styles they mean, and back', () => {
    expect(edited([line('one')], (text) => `# ${text}`)).toEqual([
      { ...line('one', 'Heading 1'), level: 1 },
    ]);
    const heading = { ...line('one', 'Heading 1'), level: 1 };
    expect(edited([heading], (text) => text.replace('# ', ''))).toEqual([line('one')]);
    expect(edited([line('one')], (text) => `> ${text}`)).toEqual([line('one', 'Block Quote')]);
    expect(edited([line('one')], (text) => `\`\`\`\n${text}\`\`\`\n`)).toEqual([
      line('one', 'Code Block'),
    ]);
    expect(edited([line('one')], (text) => `1. ${text}`)).toEqual([
      { ...line('one'), list: { ordered: true, level: 0 } },
    ]);
  });

  it('keeps what Markdown cannot say: a style, a character style and an empty paragraph', () => {
    const paragraphs = [
      line('aside', 'Aside'),
      { text: [] },
      { text: [{ text: 'one ' }, { text: 'two', style: 'Mark' }] },
    ];
    const after = edited(paragraphs, (text) => text.replace('one', 'uno'));
    expect(after[0]).toEqual(line('aside', 'Aside'));
    expect(after[1]).toEqual({ text: [] });
    expect(after[2]?.text.at(-1)).toEqual({ text: 'two', style: 'Mark' });
  });

  it('keeps notes in their turn, and changes a footnote', () => {
    const hidden = { text: 'a comment', note: 'annotation' as const };
    const foot = { text: 'old', note: 'footnote' as const };
    const paragraphs = [{ text: [{ text: 'one' }, hidden, { text: 'two' }, foot] }];
    const after = edited(paragraphs, (text) => text.replace('old', 'new'));
    expect(after[0]?.text.filter(({ note }) => note)).toEqual([hidden, { ...foot, text: 'new' }]);
  });

  it('adds a picture, and drops a note that has no paragraph to come from', () => {
    const [first] = markdownParagraphs(readMarkdown('one ![x](a.png)\n'), [], roles);
    expect(first?.text.at(-1)).toEqual({ text: 'a.png', note: 'picture' });
    const [held] = markdownParagraphs(readMarkdown('one ![note](scrivener:note)\n'), [], roles);
    expect(held?.text).toEqual([{ text: 'one ' }]);
  });

  it('adds and takes away paragraphs, and keeps a table cell where it is', () => {
    const cell = { table: 0, row: 0, column: 0, part: 0 };
    const paragraphs = [{ ...line('a'), cell }, line('b'), line('c')];
    const after = edited(paragraphs, (text) => `${text.replace('c\n', '')}new\n\nnewer\n`);
    expect(paragraphLines(after)).toEqual(['a', 'b', 'new', 'newer']);
    expect(after[0]?.cell).toEqual(cell);
    const [typed] = edited([{ ...line('apple'), cell }], (text) => text.replace('apple', 'pear'));
    expect(typed).toEqual({ ...line('pear'), cell });
  });

  it('adds a paragraph before one that stays, and takes one out', () => {
    expect(paragraphLines(edited([line('a'), line('b')], (text) => `new\n\n${text}`))).toEqual([
      'new',
      'a',
      'b',
    ]);
    const kept = [line('a'), line('gone'), line('c')];
    expect(paragraphLines(edited(kept, (text) => text.replace('gone\n\n', '')))).toEqual([
      'a',
      'c',
    ]);
  });

  it('reads a line break, bold and a link, and keeps a list its style', () => {
    const list = { ordered: false, level: 0 };
    const [item] = edited([{ ...line('a', 'Aside'), list }], (text) => text.replace('a', 'b'));
    expect(item).toEqual({ ...line('b', 'Aside'), list });
    const [first] = markdownParagraphs(readMarkdown('**a**\\\n[b](https://a.b)\n'), [], roles);
    expect(first?.text).toEqual([
      { text: 'a', bold: true },
      { text: LINE_BREAK },
      { text: 'b', link: { kind: 'address', address: 'https://a.b' } },
    ]);
  });

  it('keeps code and italics, and passes over a comment that starts an item', () => {
    const paragraphs = [
      {
        text: [
          { text: 'a', style: 'Code Span' },
          { text: 'b', italic: true as const },
          { text: ' c' },
        ],
      },
    ];
    expect(edited(paragraphs, (text) => text.replace('c', 'd'))[0]?.text).toEqual([
      { text: 'a', style: 'Code Span' },
      { text: 'b', italic: true },
      { text: ' d' },
    ]);
    expect(
      paragraphLines(markdownParagraphs(readMarkdown('<!-- item A -->\n\none\n'), [], roles)),
    ).toEqual(['one']);
  });

  it('makes a footnote of one that is new', () => {
    const [first] = markdownParagraphs(readMarkdown('one[^1]\n\n[^1]: said\n'), [], roles);
    expect(first?.text.at(-1)).toEqual({ text: 'said', note: 'footnote' });
  });

  it('keeps an empty line in code where it was, adding no paragraph', () => {
    const code = [line('a', 'Code Block'), line('', 'Code Block'), line('b', 'Code Block')];
    code[1]!.text = [];
    const markdown = paragraphsMarkdown(code, roles);
    expect(markdown).toBe('```\na\n\nb\n```\n');
    expect(markdownParagraphs(readMarkdown(markdown), code, roles)).toEqual(code);
  });

  it('keeps each paragraph whose block says what it said as the same paragraph', () => {
    const paragraphs = [line('one'), line('two')];
    const typed = paragraphsMarkdown(paragraphs, roles).replace('two', 'three');
    const [kept, changed] = markdownParagraphs(readMarkdown(typed), paragraphs, roles);
    expect(kept).toBe(paragraphs[0]);
    expect(changed).toEqual(line('three'));
    const quoting = { ...roles, quote: 'Said' };
    expect(paragraphsMarkdown(paragraphs, quoting)).toBe(paragraphsMarkdown(paragraphs, roles));
  });
});
