import { describe, expect, it } from 'vite-plus/test';
import { buildParagraph, NO_STYLE } from './paragraph.ts';

describe('buildParagraph', () => {
  it('stops on an included document it is handed, which only paragraphs can take', () => {
    const environment = {
      format: { codeSpanStyle: '', blockQuoteStyle: '', codeBlockStyle: '' },
      styleOf: (name: string) => ({ name, style: NO_STYLE }),
      textStyle: undefined,
    };
    const open = { paragraph: undefined, character: undefined };
    expect(() => buildParagraph([{ kind: 'include', paragraphs: [] }], open, environment)).toThrow(
      'Unsupported: an included document inside a footnote or link',
    );
  });
});
