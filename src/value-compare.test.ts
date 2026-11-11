import { describe, expect, it } from 'vite-plus/test';
import { valueChanges } from './value-compare.ts';

const text = (words: string) => ({
  source: words,
  paragraphs: [{ content: [{ kind: 'text', text: words, format: {} }] }],
});

describe('the changes between two values', () => {
  it('goes into lists of one length by place, and takes others as a whole', () => {
    expect(valueChanges({ list: [1, 2] }, { list: [1, 3] })).toEqual([
      { path: ['list', 1], was: 2, now: 3 },
    ]);
    expect(valueChanges([1], [1, 2])).toEqual([{ path: [], was: [1], now: [1, 2] }]);
  });

  it('shows rich text as its words', () => {
    expect(valueChanges(text('one'), text('two'))).toEqual([{ path: [], was: 'one', now: 'two' }]);
  });
});
