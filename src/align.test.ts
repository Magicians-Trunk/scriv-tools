import { describe, expect, it } from 'vite-plus/test';
import { alignParagraphs, alignWords } from './align.ts';

describe('lining up paragraphs', () => {
  it('matches what reads the same, and what is most alike between', () => {
    const was = ['one', 'the quick brown fox jumps', 'gone for good', 'three'];
    const now = ['one', 'brand new words here', 'the quick red fox jumps', 'three'];
    expect(alignParagraphs(was, now)).toEqual([
      { was: 0, now: 0 },
      { now: 1 },
      { was: 1, now: 2 },
      { was: 2 },
      { was: 3, now: 3 },
    ]);
  });

  it('never pairs what shares too little, or has no words', () => {
    expect(alignParagraphs(['alpha beta'], ['gamma delta'])).toEqual([{ was: 0 }, { now: 0 }]);
    expect(alignParagraphs(['...'], ['!!!'])).toEqual([{ was: 0 }, { now: 0 }]);
    expect(alignParagraphs(['alpha'], [])).toEqual([{ was: 0 }]);
    expect(alignParagraphs([], ['alpha'])).toEqual([{ now: 0 }]);
  });

  it('prefers the better of two pairings, in order', () => {
    const was = ['a b c d', 'e f g h'];
    const now = ['e f g x'];
    expect(alignParagraphs(was, now)).toEqual([{ was: 0 }, { was: 1, now: 0 }]);
    expect(alignParagraphs(now, was)).toEqual([{ now: 0 }, { was: 0, now: 1 }]);
  });

  it('takes what must match from `key` when that is more than the text', () => {
    const lines = alignParagraphs(['same'], ['same'], { was: ['x'], now: ['y'] });
    expect(lines).toEqual([{ was: 0, now: 0 }]);
  });
});

describe('lining up words', () => {
  it('gives the stretches that differ, a word at a time', () => {
    expect(alignWords('one two three', 'one 2 three four')).toEqual([
      { start: 4, end: 7, nowStart: 4, nowEnd: 5 },
      { start: 13, end: 13, nowStart: 11, nowEnd: 16 },
    ]);
    expect(alignWords('same', 'same')).toEqual([]);
  });
});
