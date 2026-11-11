import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { BoundText } from './bound-text.ts';
import { Placeholders, numberingTag } from './placeholders.ts';
import { type BinderItem } from './binder-item.ts';
import { compileInput, readModel } from './model.ts';
import { findItem } from './project.ts';

const input = compileInput(
  readModel(
    writeFixture({
      items: [
        {
          id: 'PART',
          type: 'Folder',
          title: 'Big Part',
          children: [
            {
              id: 'CHAPTER',
              title: 'A Chapter',
              label: '1',
              status: '2',
              children: [
                { id: 'SCENE', title: 'Scene', children: [{ id: 'BEAT', title: 'Beat' }] },
              ],
            },
          ],
        },
      ],
    }),
  ),
);
const names = {
  projectTitle: 'Project',
  abbreviatedTitle: 'Proj',
  author: 'Ada',
  forename: '',
  surname: '',
};
const fresh = () => new Placeholders(input, names);
const item = (id: string) => findItem(input.index, id);
const dated = (created: string): BinderItem => ({ ...item('BEAT'), created });
const evaluate = (placeholders: Placeholders, source: string, described?: BinderItem) =>
  placeholders.evaluate(BoundText.of(source), described).text.text;

describe('Placeholders', () => {
  it('spells numbers in words past nineteen, and stops past ninety-nine', () => {
    const words = evaluate(fresh(), '<$w> '.repeat(21)).trim().split(' ');
    expect(words.slice(-2)).toEqual(['twenty', 'twenty-one']);
    expect(() => evaluate(fresh(), '<$W>'.repeat(100))).toThrow(
      'numbering in words past ninety-nine',
    );
  });

  it('stops on alphabetical numbering past z, and on a reference before its stream', () => {
    expect(() => evaluate(fresh(), '<$l>'.repeat(27))).toThrow('alphabetical numbering past z');
    expect(() => evaluate(fresh(), '<$n#figure>')).toThrow('<$n#figure> before its stream');
  });

  it('formats binder dates with Unicode patterns, including names and quoted text', () => {
    expect(
      evaluate(
        fresh(),
        "<$createdDate:yy MMMM MMM M d H ss 'at' HH>",
        dated('2026-03-05 07:08:09 -0500'),
      ),
    ).toBe('26 March Mar 3 5 7 09 at 07');
  });

  it.each([
    ['<$longCreatedTime>', 'placeholder <$longCreatedTime>'],
    ['<$createdDate:yyyy QQ>', 'date pattern QQ'],
  ])('stops on %s', (source, feature) => {
    expect(() => evaluate(fresh(), source, dated('2026-03-05 07:08:09 -0500'))).toThrow(
      `Unsupported: ${feature}`,
    );
  });

  it('stops on a binder date it cannot read', () => {
    expect(() => evaluate(fresh(), '<$createdDate:yyyy>', dated(''))).toThrow(
      'Unreadable binder date',
    );
  });

  it('reads document variables, with empty labels, statuses and synopses when there are none', () => {
    expect(
      evaluate(
        fresh(),
        '<$level1_title_no_spaces>|<$label>|<$status>|<$synopsis>|<$descendantCount>',
        item('CHAPTER'),
      ),
    ).toBe('BigPart|Blue|Done||2');
    expect(evaluate(fresh(), '<$label>|<$status>', item('SCENE'))).toBe('|');
  });

  it.each([
    ['<$level5_title>', 'BEAT'],
    ['<$parenttitle>', 'DRAFT'],
    ['<$position>', 'DRAFT'],
    ['<$parentposition>', 'PART'],
    ['<$parentposition>', 'DRAFT'],
  ])('stops on %s above the top of the binder, for %s', (source, id) => {
    expect(() => evaluate(fresh(), source, item(id))).toThrow('above the top of the binder');
  });

  it('stops on <$hn_levelN> past level 1, which Scrivener numbers by no rule found yet', () => {
    const placeholders = new Placeholders(input, names, {
      numbers: new Map(),
      positions: new Map(),
      now: new Date(),
    });
    expect(() => evaluate(placeholders, '<$hn_level2>', item('PART'))).toThrow(
      'Unsupported: placeholder <$hn_level2>',
    );
  });

  it('evaluates a placeholder inside another first, and escapes either with one backslash', () => {
    const placeholders = fresh();
    expect(
      evaluate(
        placeholders,
        '<$n:toc:<$title_no_spaces>> <$n:toc:<$title_no_spaces>> <$n:toc:x> \\<$n:toc:<$title>>',
        item('CHAPTER'),
      ),
    ).toBe('1 1 2 <$n:toc:<$title>>');
    expect(evaluate(fresh(), '<$n:a:\\<$title>>', item('CHAPTER'))).toBe('1');
  });

  it('finds the hierarchical numbering a text uses, inside other placeholders too', () => {
    expect(numberingTag('\\<$hn> <$n:x:<$ahn>> <$aon>')).toBe('ahn');
    expect(numberingTag('<$n> plain')).toBeUndefined();
  });

  it('writes an escaped placeholder as written, inner escapes too, except <$linkID>', () => {
    expect(evaluate(fresh(), '\\<$img:\\<$custom:G>> \\<$linkID>', item('PART'))).toBe(
      '<$img:<$custom:G>> \\<$linkID>',
    );
  });

  it('leaves an unknown placeholder as written with its argument evaluated', () => {
    expect(evaluate(fresh(), '<$nope:\\<$title>> <$nope:<$title>>', item('PART'))).toBe(
      '<$nope:<$title>> <$nope:Big Part>',
    );
  });

  it('evaluates what it can before replacements, and leaves the rest for after them', () => {
    const known = fresh().evaluateKnown(
      BoundText.of('<$title> \\<$title> <$custom:Nowhere> <$toc> <$nope> <$n:x:<$custom:No>>'),
      item('PART'),
    );
    expect(known.text).toBe(
      'Big Part \\<$title> <$custom:Nowhere> <$toc> <$nope> <$n:x:<$custom:No>>',
    );
    // Layout text waits for the replacements, but for its <$title>.
    const layout = BoundText.join(['<$title> ', BoundText.deferred('<$title> <$projecttitle>')]);
    expect(fresh().evaluateKnown(layout, item('PART')).text).toBe(
      'Big Part Big Part <$projecttitle>',
    );
    expect(() => fresh().evaluateKnown(BoundText.of('<$createdDate>'), dated('bad'))).toThrow(
      'Unreadable binder date',
    );
  });

  it('evaluates a last paragraph between replacements, leaving what the second pass decides', () => {
    const text = BoundText.of('<$title>\n<$title> \\<$title> <$custom:Nowhere>');
    expect(fresh().evaluateFrom(text, 9, item('PART')).text).toBe(
      '<$title>\nBig Part \\<$title> <$custom:Nowhere>',
    );
  });

  it('reads text that only looks like a placeholder as text', () => {
    expect(evaluate(fresh(), '<$ x> <$1> <$n;x> <$n:open <$n>', item('CHAPTER'))).toBe(
      '<$ x> <$1> <$n;x> <$n:open 1',
    );
  });

  it('leaves anything that is not a documented placeholder as written', () => {
    expect(evaluate(fresh(), '<$nonsense> <$template_projectName>', item('PART'))).toBe(
      '<$nonsense> <$template_projectName>',
    );
    expect(() => evaluate(fresh(), '<$hn_level3>', item('PART'))).toThrow('<$hn_level3>');
    expect(evaluate(fresh(), '<$p> <$include> <$include:nothing here>', item('PART'))).toBe(
      '<$p> <$include> <$include:nothing here>',
    );
    expect(() => evaluate(fresh(), '<$include:Big Part>', item('PART'))).toThrow(
      'Unsupported: <$include:Big Part> naming a document',
    );
  });

  it('needs an item for document variables, and a whole compile for <$hn>', () => {
    expect(() => evaluate(fresh(), '<$title>')).toThrow('Unsupported: placeholder <$title>');
    expect(() => evaluate(fresh(), '<$hn>', item('PART'))).toThrow('<$hn> outside a whole compile');
    expect(() => evaluate(fresh(), '<$doccount>')).toThrow('<$doccount> outside a whole compile');
  });
});
