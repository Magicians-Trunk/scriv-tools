import { describe, expect, it } from 'vite-plus/test';
import { BoundText } from './bound-text.ts';

/** The text with each bound range in brackets, tagged with its item, and each cell in braces. */
const show = ({ text, marks }: BoundText) => {
  let shown = text;
  for (const mark of marks.toSorted((a, b) => b.start - a.start || a.end - b.end)) {
    const [open, close] = 'item' in mark ? ['[', `|${mark.item}]`] : ['{', '}'];
    shown = `${shown.slice(0, mark.start)}${open}${shown.slice(mark.start, mark.end)}${close}${shown.slice(mark.end)}`;
  }
  return shown;
};

describe('BoundText', () => {
  it('joins parts, moving their marks along', () => {
    const joined = BoundText.join(
      [
        'a ',
        BoundText.bound('<$title>', 'X'),
        BoundText.bound('', 'Y'),
        BoundText.trimmed('c', 'start'),
      ],
      '-',
    );
    expect(show(joined)).toBe('a -[<$title>|X]--{c}');
    expect(joined.itemAt(3, 11)).toBe('X');
    expect(joined.itemAt(2, 11)).toBeUndefined();
    expect(joined.isPartlyBound(2, 11)).toBe(true);
    expect(joined.isPartlyBound(3, 11)).toBe(false);
    expect(joined.isPartlyBound(0, 2)).toBe(false);
  });

  it('keeps marks through edits, an edit taking those of the first character it replaces', () => {
    const text = BoundText.join([
      'xx ',
      BoundText.bound('<$a', 'A'),
      '> yy ',
      BoundText.bound('b', 'B'),
    ]);
    const replaced = text.replace(/<\$a>/g, () => '<$long>').replace(/x/g, () => 'zz');
    expect(show(replaced)).toBe('zzzz [<$long>|A] yy [b|B]');
    expect(text.replace(/q/g, () => 'w')).toBe(text);
    expect(show(text.replace(/x <\$/g, () => '-'))).toBe('x-[a|A]> yy [b|B]');
    expect(show(BoundText.of('ab').replace(/a/g, () => 'c'))).toBe('cb');
    expect(show(BoundText.bound('abc', 'Q').replace(/b/g, () => 'XY'))).toBe('[aXYc|Q]');
    expect(show(text.replace(/<\$a/g, () => ''))).toBe('xx > yy [b|B]');
    expect(show(text.replace(/x(?= )|(?=y)/g, () => ''))).toBe('x [<$a|A]> yy [b|B]');
  });

  it("gives each item's sections in order, an empty one keeping its place through edits", () => {
    const text = BoundText.join([
      BoundText.section(BoundText.of('one'), 'A'),
      ' ',
      BoundText.section(BoundText.of(''), 'E'),
      BoundText.section(BoundText.of('note'), 'A'),
    ]).edit([{ start: 0, end: 3, text: 'first' }]);
    expect(text.sections()).toEqual(
      new Map([
        ['A', ['first', 'note']],
        ['E', ['']],
      ]),
    );
  });

  it('finishes each trimmed range trimmed at its side', () => {
    const table = BoundText.join([
      '| ',
      BoundText.trimmed('  a ', 'start'),
      ' | ',
      BoundText.trimmed('b', 'start'),
      ' |',
    ]);
    expect(table.finish().text).toBe('| a  | b |');
    expect(
      BoundText.join([
        BoundText.trimmed(BoundText.bound(' z ', 'Z'), 'end'),
        '|',
        BoundText.trimmed('\n y \n', 'both'),
      ]).finish().text,
    ).toBe(' z|y');
  });

  it('finishes a trimmed range inside another before the one around it', () => {
    const inner = BoundText.trimmed(' a ', 'both');
    expect(BoundText.trimmed(BoundText.join([inner, ' b  ']), 'end').finish().text).toBe('a b');
  });

  it('counts the line breaks after a list that ends the text', () => {
    const list = BoundText.listLine(BoundText.of('* a'));
    expect(BoundText.join([list, '\n\n']).breaksAfterList()).toBe(2);
    expect(BoundText.join([list, '\nb']).breaksAfterList()).toBeUndefined();
    expect(BoundText.of('a\n').breaksAfterList()).toBeUndefined();
  });
});
