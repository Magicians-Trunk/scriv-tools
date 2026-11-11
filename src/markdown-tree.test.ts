import { describe, expect, it } from 'vite-plus/test';
import { type Block, MarkdownError, orStop, readMarkdown, writeMarkdown } from './markdown-tree.ts';

const text = (value: string) => [{ value }];

describe('writing and reading', () => {
  it('reads back what it writes, block for block', () => {
    const blocks: Block[] = [
      { kind: 'item', item: 'A-1' },
      { kind: 'text', shape: { kind: 'heading', depth: 2 }, atoms: text('Title') },
      { kind: 'text', shape: { kind: 'paragraph' }, atoms: text('one * two [x] # y') },
      { kind: 'text', shape: { kind: 'quote' }, atoms: text('said') },
      { kind: 'text', shape: { kind: 'quote' }, atoms: text('more') },
      { kind: 'text', shape: { kind: 'list', ordered: false, level: 0 }, atoms: text('a') },
      { kind: 'text', shape: { kind: 'list', ordered: false, level: 1 }, atoms: text('b') },
      { kind: 'text', shape: { kind: 'list', ordered: true, level: 0 }, atoms: text('c') },
      { kind: 'text', shape: { kind: 'code' }, atoms: text('line `one') },
      { kind: 'text', shape: { kind: 'code' }, atoms: text('line two') },
      {
        kind: 'text',
        shape: { kind: 'paragraph' },
        atoms: [
          { value: 'plain ' },
          { value: 'code', code: true },
          { value: ' ' },
          { value: 'loud', bold: true },
          { value: ' ' },
          { value: 'slant', italic: true },
          { value: ' ' },
          { value: 'here', link: 'https://a.example' },
          { value: '', note: true },
          { value: 'said', note: true, footnote: true },
        ],
      },
      {
        kind: 'text',
        shape: { kind: 'paragraph' },
        atoms: [{ value: 'one' }, { value: '\n', line: true }, { value: 'two' }],
      },
    ];
    expect(readMarkdown(writeMarkdown(blocks))).toEqual(blocks);
  });

  it('writes a level Markdown cannot reach under the deepest there is', () => {
    const atoms = text('deep');
    const blocks: Block[] = [
      { kind: 'text', shape: { kind: 'list', ordered: false, level: 0 }, atoms: text('top') },
      { kind: 'text', shape: { kind: 'list', ordered: false, level: 3 }, atoms },
    ];
    expect(readMarkdown(writeMarkdown(blocks))).toMatchObject([
      { shape: { level: 0 } },
      { shape: { level: 1 } },
    ]);
  });

  it('stops on what has no place in a project', () => {
    expect(() => readMarkdown('---')).toThrow(MarkdownError);
    expect(() => readMarkdown('<div>x</div>')).toThrow('has no place');
    expect(() => readMarkdown('a <b>x</b>')).toThrow('has no place');
    expect(() => readMarkdown('* a\n\n  ---\n')).toThrow('inside a quote');
    expect(() => readMarkdown('a[^1]\n\n[^1]: note\n\n    * item\n')).toThrow('in a footnote');
  });
});

const bug = () => {
  throw new TypeError('a bug');
};

describe('orStop', () => {
  it('hands on what stopped, and lets anything else through', () => {
    const stopped: string[] = [];
    orStop(
      () => {
        throw new MarkdownError('no place');
      },
      (message) => stopped.push(message),
    );
    expect(stopped).toEqual(['no place']);
    expect(() => orStop(bug, () => {})).toThrow(TypeError);
  });
});
