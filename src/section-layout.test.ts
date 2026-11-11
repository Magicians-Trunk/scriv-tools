import { describe, expect, it } from 'vite-plus/test';
import { lateSuffixParts, layoutText, prefixAlone } from './section-layout.ts';

describe('layout prefixes and suffixes', () => {
  it('write their lines as text, a prefix alone without its closing empty paragraphs', () => {
    expect(layoutText(['a', '', 'b'])).toBe('a\n\nb');
    expect(prefixAlone(['a', '', ''])).toEqual({ text: 'a', droppedBreaks: 2 });
    expect(prefixAlone(['', ''])).toEqual({ text: '', droppedBreaks: 2 });
  });

  it('part a late suffix into its leading line breaks and the rest', () => {
    expect(lateSuffixParts(['', '```', 'x', '```', '', ''])).toEqual({
      breaks: 1,
      rest: '```\nx\n```\n\n',
    });
    expect(lateSuffixParts(['RETURN', ''])).toEqual({ breaks: 0, rest: 'RETURN\n' });
    // Nothing but empty paragraphs: a line break fewer than it has paragraphs.
    expect(lateSuffixParts(['', '', ''])).toEqual({ breaks: 2, rest: '' });
  });
});
