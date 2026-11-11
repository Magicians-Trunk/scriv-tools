import { describe, expect, it } from 'vite-plus/test';
import { BoundText } from './bound-text.ts';
import { applyReplacements, type Replacement } from './replacements.ts';

const replaceText = (text: string, replacements: Replacement[]) =>
  applyReplacements(BoundText.of(text), replacements).text;

const replacement = (overrides: Partial<Replacement>): Replacement => ({
  replace: '',
  with: '',
  regex: false,
  caseSensitive: false,
  ...overrides,
});

describe('applyReplacements', () => {
  it('runs in order, each feeding the next', () => {
    const replacements = [
      replacement({ replace: 'alpha', with: 'beta' }),
      replacement({ replace: 'beta', with: 'gamma' }),
    ];
    expect(replaceText('alpha beta', replacements)).toBe('gamma gamma');
  });

  it('matches plain text in any case, writing capitals only for an all-capitals match', () => {
    const colour = replacement({ replace: 'Colour', with: 'color' });
    expect(replaceText('Colour colour COLOUR 3.', [colour])).toBe('color color COLOR 3.');
    const strict = replacement({ replace: 'Teh', with: 'The', caseSensitive: true });
    expect(replaceText('Teh teh TEH', [strict])).toBe('The teh TEH');
    const symbols = replacement({ replace: '1+1', with: 'two' });
    expect(replaceText('1+1 and 11', [symbols])).toBe('two and 11');
  });

  it('reads $@ as any text on one line, used wherever the replacement repeats it', () => {
    const emphasis = replacement({ replace: '<<em:$@>>', with: '*$@* ($@)' });
    expect(replaceText('<<em:a b>> <<em:>> <<em:x\ny>>', [emphasis])).toBe(
      '*a b* (a b) ** () <<em:x\ny>>',
    );
  });

  it('runs regular expressions with back-references, ignoring case unless asked', () => {
    const pixels = replacement({ replace: '(\\d+)px', with: '$1 pixels', regex: true });
    expect(replaceText('10px 3PX', [pixels])).toBe('10 pixels 3 pixels');
    const strict = replacement({ replace: 'a(b)', with: '$1', regex: true, caseSensitive: true });
    expect(replaceText('ab AB', [strict])).toBe('b AB');
  });

  it("reads a regular expression's replacement text as ICU does: backslash escapes, $n groups", () => {
    const icu = replacement({ replace: 'a(b)?', with: '\\\\x\\$1 $1 $2 $& $', regex: true });
    expect(replaceText('ab a', [icu])).toBe('\\x$1 b  $& $ \\x$1   $& $');
  });
});
