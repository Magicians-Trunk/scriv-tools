import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vite-plus/test';
import { readBlocks, readMarkdownParts, rereadMarkdown } from './markdown-parts.ts';
import { type Block, readMarkdown } from './markdown-tree.ts';

/** What a read gives, or the message it stops with. */
function outcome(read: () => Block[]) {
  try {
    return read();
  } catch (failed) {
    return String(failed);
  }
}

describe('reading again after a change', () => {
  const SAMPLE = [
    '# Title',
    'one *two* three',
    '* a\n* b\n\n* c',
    '```\ncode\n\nmore\n```',
    '> said\n> more',
    '| a | b |\n| - | - |\n| c | d |',
    '<!-- item A-1 -->',
    'last **words**',
  ].join('\n\n');
  const INSERTS = [
    'x',
    '\n',
    '\n\n',
    '```\n',
    '- ',
    '    ',
    '| ',
    '#',
    '<!--',
    '[^1]',
    '\n[x]: y\n',
  ];

  /** The inserts and cuts, two characters apart, that read again otherwise than a whole read. */
  const misread = (sample: string) => {
    const before = readMarkdownParts(sample);
    const changes = [];
    for (let at = 0; at <= sample.length; at += 2) {
      for (const insert of INSERTS) changes.push(sample.slice(0, at) + insert + sample.slice(at));
      changes.push(sample.slice(0, at) + sample.slice(at + 3));
    }
    return changes.filter(
      (now) =>
        !isDeepStrictEqual(
          outcome(() => readBlocks(rereadMarkdown(before, now))),
          outcome(() => readMarkdown(now)),
        ),
    );
  };

  it('reads what a whole read reads, wherever a change is made', () => {
    expect(misread(SAMPLE)).toEqual([]);
  }, 30_000);

  it('reads by the footnotes, wherever they are and a change is made', () => {
    const noted = '[^2]: first\n\none[^1] and two\n\n* two[^2]\n\n[^1]: said\n\nlast';
    expect(misread(noted)).toEqual([]);
  }, 30_000);

  it('parses only the parts a change touches', () => {
    const before = readMarkdownParts(SAMPLE);
    const after = rereadMarkdown(before, SAMPLE.replace('said', 'told'));
    expect(after.parts.slice(0, 3)).toEqual(before.parts.slice(0, 3));
    expect(after.parts[2]).toBe(before.parts[2]);
    expect(after.parts.at(-1)!.blocks).toBe(before.parts.at(-1)!.blocks);
    expect(after.parts[4]!.blocks).not.toBe(before.parts[4]!.blocks);
  });

  it('parses only the parts a change touches with the definitions, and the whole for one', () => {
    const noted = readMarkdownParts('one[^1]\n\ntwo\n\nmiddle\n\nend\n\n[^1]: said\n');
    const typed = rereadMarkdown(noted, 'one[^1]\n\ntwo\n\nmuddle\n\nend\n\n[^1]: said\n');
    expect(typed.parts[0]!.blocks).toBe(noted.parts[0]!.blocks);
    expect(readBlocks(typed)).toEqual(
      readMarkdown('one[^1]\n\ntwo\n\nmuddle\n\nend\n\n[^1]: said\n'),
    );
    const defined = rereadMarkdown(noted, 'one[^1]\n\ntwo\n\nmiddle\n\nend\n\n[^1]: told\n');
    expect(defined.parts[0]!.blocks).not.toBe(noted.parts[0]!.blocks);
    expect(readBlocks(defined)[0]).toEqual(readMarkdown('one[^1]\n\n[^1]: told\n')[0]);
    expect(readBlocks(rereadMarkdown(readMarkdownParts('one'), ''))).toEqual([]);
    expect(readBlocks(rereadMarkdown(readMarkdownParts(''), 'one'))).toEqual(readMarkdown('one'));
    const ended = rereadMarkdown(readMarkdownParts('one\n\n'), 'one\n\ntwo');
    expect(readBlocks(ended)).toEqual(readMarkdown('one\n\ntwo'));
  });
});
