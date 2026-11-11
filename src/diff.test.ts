import { describe, expect, it } from 'vite-plus/test';
import { matches } from './diff.ts';

const sameLetter = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

describe('matches', () => {
  it('finds what two texts start and end with', () => {
    expect(matches('abXcd', 'abYcd')).toEqual([
      { a: 0, b: 0, length: 2 },
      { a: 3, b: 3, length: 2 },
    ]);
  });

  it('finds common runs between them, taking equal elements as it is told', () => {
    expect(matches('xaby', 'zabw')).toEqual([{ a: 1, b: 1, length: 2 }]);
    expect(matches('xpy', 'zqpw')).toEqual([{ a: 1, b: 2, length: 1 }]);
    expect(matches('wpqx', 'ypz')).toEqual([{ a: 1, b: 1, length: 1 }]);
    expect(matches(['A'], ['a'], sameLetter)).toEqual([{ a: 0, b: 0, length: 1 }]);
  });

  it('leaves out empty lists, and what is too much to compare', () => {
    expect(matches('', 'a')).toEqual([]);
    expect(matches('a'.repeat(3000), 'b'.repeat(3000))).toEqual([]);
  });
});
