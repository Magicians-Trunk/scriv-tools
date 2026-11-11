import { describe, expect, it } from 'vite-plus/test';
import { type CompiledText, sealOf } from './item-compile.ts';
import { readItemsMarkdown, writeItemsMarkdown } from './items-markdown.ts';
import type { TextBlock } from './markdown-tree.ts';

const words = (value: string): TextBlock => ({
  kind: 'text',
  shape: { kind: 'paragraph' },
  atoms: [{ value }],
});
const text = (...pieces: string[]): CompiledText => ({
  kind: 'text',
  pieces,
  seal: sealOf(pieces),
});
const SEAL = sealOf(['A *one*\n', '```\nfenced\n```']);
const OPEN = `<!-- compiled A ${SEAL}: read only, as the compile writes this item; import refuses the item if it changes -->`;

/** Why the first item's compiled block is not as written. */
const broken = (markdown: string) => readItemsMarkdown(markdown)[0]!.broken;

describe('items Markdown', () => {
  it("writes each item's words, then its compiled text fenced between two comments", () => {
    const markdown = writeItemsMarkdown([
      { item: 'A', blocks: [words('one')], compiled: text('A *one*\n', '```\nfenced\n```') },
      { item: 'B', blocks: [], compiled: { kind: 'left out' } },
      { item: 'C', blocks: [words('three')], compiled: { kind: 'stopped' } },
    ]);
    expect(markdown).toBe(
      [
        '<!-- item A -->',
        'one',
        OPEN,
        '```\nA *one*\n\n```',
        '````\n```\nfenced\n```\n````',
        '<!-- end of compiled A -->',
        '<!-- item B -->',
        '<!-- compiled B: the compile leaves this item out -->',
        '<!-- item C -->',
        'three',
        '<!-- compiled C: none, as the compile stops -->\n',
      ].join('\n\n'),
    );
    expect(readItemsMarkdown(markdown)).toEqual([
      { item: 'A', blocks: [words('one')], compiled: text('A *one*\n', '```\nfenced\n```') },
      { item: 'B', blocks: [], compiled: { kind: 'left out' } },
      { item: 'C', blocks: [words('three')], compiled: { kind: 'stopped' } },
    ]);
  });

  it('reads footnotes after the last compiled block as no text of its own', () => {
    const markdown = writeItemsMarkdown([
      {
        item: 'A',
        blocks: [{ ...words('see'), atoms: [{ value: 'a note', note: true, footnote: true }] }],
        compiled: { kind: 'left out' },
      },
    ]);
    expect(readItemsMarkdown(markdown)[0]).not.toHaveProperty('broken');
  });

  it('says how a compiled block is not as written', () => {
    const item = '<!-- item A -->\n\n';
    const end = '\n\n<!-- end of compiled A -->';
    expect(broken(`${item}${OPEN}\n\n\`\`\`\nx\n\`\`\`\n\nprose${end}`)).toContain('not as export');
    expect(broken(`${item}${OPEN}\n\n\`\`\`\nx\n\`\`\``)).toContain('not as export');
    expect(broken(`${item}${OPEN}${end}\n\nafter`)).toContain('Text follows');
    expect(broken(`${item}${OPEN}${end}\n\n${OPEN}${end}`)).toContain('more than one');
    expect(broken(`${item}${OPEN.replace('A', 'B')}${end}`)).toContain('not as export');
    expect(broken(`${item}${OPEN.replace(` ${SEAL}`, '')}${end}`)).toContain('not as export');
    expect(
      broken(`${item}<!-- compiled A ${SEAL}: the compile leaves this item out -->`),
    ).toContain('not as export');
    expect(broken(`${item}<!-- compiled A: something else -->`)).toContain('not as export');
    expect(broken(`${item}${end}`)).toContain('not as export');
    expect(
      readItemsMarkdown(`${item}${OPEN}\n\n\`\`\`\nx\n\`\`\`\n\nprose${end}`)[0],
    ).toMatchObject({
      blocks: [],
    });
    expect(readItemsMarkdown(`${item}${OPEN}${end}\n\n${OPEN}${end}`)[0]!.compiled).toEqual({
      kind: 'text',
      pieces: [],
      seal: SEAL,
    });
  });

  it('stops on a compiled block or text before any item', () => {
    expect(() => readItemsMarkdown(OPEN)).toThrow('must start with the comment');
    expect(() => readItemsMarkdown('words')).toThrow('must start with the comment');
  });
});
