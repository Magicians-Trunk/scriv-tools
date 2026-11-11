import { describe, expect, it } from 'vite-plus/test';
import {
  type OutputNode,
  insertAfter,
  isBlank,
  markup,
  serialize,
  text,
  without,
  uppercaseWords,
} from './output.ts';

const run = (...children: OutputNode[]): OutputNode => ({
  kind: 'run',
  open: '<',
  close: '>',
  children,
});
const footnote = (...children: OutputNode[]): OutputNode => ({ kind: 'footnote', children });
/** The nodes written, each footnote marker as `[number:text]`. */
const write = (nodes: OutputNode[]) => {
  const { text: written, notes } = serialize(nodes, 0);
  return written.text.replaceAll(/\[\^cf(\d+)\]/g, (_, number: string) => {
    return `[${number}:${notes[Number(number) - 1]!.text}]`;
  });
};

describe('the output tree', () => {
  it('writes a run between its prefix and suffix only when it holds text', () => {
    expect(
      write([run(text('a')), run(markup('m')), run(footnote(text('n'))), run(run(text('b')))]),
    ).toBe('<a>m<[1:n]><<b>>');
  });

  it('numbers kept footnotes in order, and leaves out empty ones', () => {
    expect(write([text('a'), footnote(), footnote(text('x')), footnote(markup('y'))])).toBe(
      'a[1:x][2:y]',
    );
  });

  it('is blank when nothing in it writes anything', () => {
    expect(isBlank([text(''), run(markup('')), footnote(text(''))])).toBe(true);
    expect(isBlank([run(markup('m'))])).toBe(false);
  });

  it('puts a node after another wherever it sits, and says when it is not there', () => {
    const target = markup('x');
    const nodes = [text('a'), footnote(text('n')), run(target)];
    expect(insertAfter(nodes, target, text('y'))).toBe(true);
    expect(insertAfter(nodes, markup('z'), text('w'))).toBe(false);
    expect(write(nodes)).toBe('a[1:n]<xy>');
  });

  it('sets the first words of the text in capitals, leaving markup and notes alone', () => {
    const nodes = [
      markup('`x` '),
      run(text('one two')),
      footnote(text('note')),
      text(' three four'),
    ];
    expect(uppercaseWords(nodes, 3)).toBe(0);
    expect(write(nodes)).toBe('`x` <ONE TWO>[1:note] THREE four');
  });

  it('takes one node out wherever it sits', () => {
    const target = markup('x');
    expect(write(without([run(text('a'), footnote(target, text('b'))), target], target))).toBe(
      '<a[1:b]>',
    );
  });
});
