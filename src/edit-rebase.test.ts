import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { makeEdits } from './document-edits.ts';
import { projectDocuments } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { rebaseEdits } from './edit-rebase.ts';
import { stretchOf } from './edit-stretch.ts';
import { applyEdits, type DocumentEdit } from './editable.ts';
import { openProject } from './project.ts';
import { plainText } from './text-compare.ts';

const replace = (paragraph: number, start: number, end: number, text: string): DocumentEdit => ({
  kind: 'replace',
  paragraph,
  start,
  end,
  text,
});
const style = (paragraph: number, name: string): DocumentEdit => ({
  kind: 'style',
  paragraph,
  style: name,
});
const insert = (at: number, text: string): DocumentEdit => ({
  kind: 'insert',
  at,
  paragraphs: [{ text }],
});
const remove = (first: number, count: number): DocumentEdit => ({ kind: 'remove', first, count });

function opened(text: string) {
  const project = openProject(writeFixture({ items: [{ id: 'A', title: 'A', text }] }));
  const document = () => projectDocuments(project.dir).text('A');
  const words = (held: ReturnType<typeof document>) =>
    readParagraphs(project, held).map((each) => plainText(each.text));
  return { project, document, words };
}

const stretch = stretchOf(opened('held').document(), 0, 1);
const whole = (first: number, count: number): DocumentEdit => ({
  kind: 'paragraphs',
  first,
  count,
  stretch,
});

const noteEdit = (piece: number, text: string): DocumentEdit => ({
  kind: 'note',
  paragraph: 0,
  piece,
  text,
});

const commentEdit = (id: string, words?: string): DocumentEdit =>
  words === undefined
    ? { kind: 'comment', id }
    : { kind: 'comment', id, comment: { id, color: [words.length], text: stretchDocument } };

const inNote = (piece: number, name: string): DocumentEdit => ({
  kind: 'character',
  paragraph: 0,
  start: 0,
  end: 5,
  piece,
  style: name,
});

describe('making edits in one paragraph', () => {
  it('sets a look over a stretch with a placeholder in it, which keeps its own', () => {
    const { project, document, words } = opened('one <$n> two');
    const held = document();
    const look: DocumentEdit = { kind: 'look', paragraph: 0, start: 0, end: 12, bold: true };
    makeEdits(project, held, [look]);
    expect(words(held)).toEqual(['one <$n> two']);
  });

  it('reads every offset in the paragraph as it stands, in whatever order they are given', () => {
    const { project, document, words } = opened('one two three');
    const ascending = [replace(0, 0, 3, 'first'), replace(0, 8, 13, 'third')];
    const held = document();
    makeEdits(project, held, ascending);
    expect(words(held)).toEqual(['first two third']);
    const item = ascending.map((edit) => ({ item: 'A', edit }));
    const made = applyEdits(project, projectDocuments(project.dir), item);
    expect(words(made.get('A')!.content)).toEqual(['first two third']);
  });

  it('leaves other edits in a paragraph their turn', () => {
    const { project, document, words } = opened('one two');
    const held = document();
    makeEdits(project, held, [
      replace(0, 0, 3, 'first'),
      { kind: 'comment', id: 'X' },
      replace(0, 4, 7, 'second'),
    ]);
    expect(words(held)).toEqual(['first second']);
  });
});

describe('rebasing edits', () => {
  it('moves a paragraph on by what came and went before it', () => {
    const { edits } = rebaseEdits([style(5, 'S')], [insert(2, 'a'), remove(3, 1), remove(0, 1)]);
    expect(edits).toEqual([style(5, 'S')].map((each) => ({ ...each, paragraph: 4 })));
    expect(rebaseEdits([replace(1, 0, 1, 'x')], [whole(0, 1)]).edits).toEqual([
      replace(1, 0, 1, 'x'),
    ]);
  });

  it('moves an offset on by what changed before it in its paragraph', () => {
    const over = [replace(0, 0, 3, 'longer')];
    expect(rebaseEdits([replace(0, 4, 7, 'b')], over).edits).toEqual([replace(0, 7, 10, 'b')]);
    const list: DocumentEdit = {
      kind: 'replace',
      paragraph: 0,
      start: 0,
      end: 1,
      text: [{ text: 'ab' }],
    };
    expect(rebaseEdits([replace(0, 4, 7, 'b')], [list]).edits).toEqual([replace(0, 5, 8, 'b')]);
    expect(rebaseEdits([replace(0, 0, 1, 'b')], [replace(0, 4, 7, 'x')]).edits).toEqual([
      replace(0, 0, 1, 'b'),
    ]);
  });

  it('drops what the other side did as well', () => {
    for (const edit of [
      replace(0, 0, 1, 'x'),
      insert(1, 'x'),
      remove(1, 1),
      style(0, 'S'),
      whole(0, 1),
    ]) {
      expect(rebaseEdits([edit], [edit])).toEqual({ edits: [], conflicts: [] });
    }
    const comment: DocumentEdit = { kind: 'comment', id: 'A' };
    expect(rebaseEdits([comment], [comment]).edits).toEqual([]);
    const note: DocumentEdit = { kind: 'note', paragraph: 0, piece: 1, text: 'x' };
    expect(rebaseEdits([note], [note]).edits).toEqual([]);
    const pieces: DocumentEdit = { kind: 'inlines', paragraph: 0, first: 0, count: 1, text: [] };
    expect(rebaseEdits([pieces], [pieces]).edits).toEqual([]);
  });

  it('conflicts on the same words', () => {
    const [mine, theirs] = [replace(0, 4, 7, 'a'), replace(0, 5, 6, 'b')];
    expect(rebaseEdits([mine], [theirs]).conflicts).toEqual([
      { reason: 'words', edit: mine, over: theirs },
    ]);
  });

  it('conflicts when text goes in at one place, and on a look over changed words', () => {
    expect(rebaseEdits([replace(0, 2, 2, 'a')], [replace(0, 2, 2, 'b')]).conflicts).toHaveLength(1);
    const character: DocumentEdit = {
      kind: 'character',
      paragraph: 0,
      start: 0,
      end: 5,
      style: 'S',
    };
    const look: DocumentEdit = { kind: 'look', paragraph: 0, start: 0, end: 5, bold: true };
    expect(rebaseEdits([character], [replace(0, 1, 2, 'b')]).conflicts).toHaveLength(1);
    expect(rebaseEdits([look], [character]).conflicts).toHaveLength(1);
    expect(rebaseEdits([look], [replace(0, 6, 7, 'b')]).edits).toEqual([look]);
  });

  it('keeps text and paragraph style apart, and conflicts on two styles', () => {
    expect(rebaseEdits([style(0, 'S')], [replace(0, 0, 1, 'a')]).edits).toEqual([style(0, 'S')]);
    expect(rebaseEdits([replace(0, 0, 1, 'a')], [style(0, 'S')]).conflicts).toEqual([]);
    expect(rebaseEdits([style(0, 'S')], [style(0, 'T')]).conflicts[0]?.reason).toBe('style');
  });

  it('conflicts on one note, and on what can move its pieces', () => {
    const pieces: DocumentEdit = { kind: 'inlines', paragraph: 0, first: 0, count: 1, text: [] };
    expect(rebaseEdits([noteEdit(1, 'a')], [noteEdit(2, 'b')]).edits).toEqual([noteEdit(1, 'a')]);
    expect(rebaseEdits([noteEdit(1, 'a')], [noteEdit(1, 'b')]).conflicts[0]?.reason).toBe('note');
    expect(rebaseEdits([noteEdit(1, 'a')], [pieces]).conflicts).toHaveLength(1);
    expect(rebaseEdits([noteEdit(1, 'a')], [replace(0, 0, 1, 'b')]).edits).toHaveLength(1);
    const rich: DocumentEdit = { kind: 'replace', paragraph: 0, start: 0, end: 1, text: [] };
    expect(rebaseEdits([noteEdit(1, 'a')], [rich]).conflicts).toHaveLength(1);
    expect(rebaseEdits([replace(0, 0, 1, 'a')], [pieces]).conflicts).toHaveLength(1);
    expect(rebaseEdits([pieces], [replace(0, 0, 1, 'a')]).conflicts).toHaveLength(1);
    expect(rebaseEdits([pieces], [style(0, 'S')]).edits).toEqual([pieces]);
    expect(rebaseEdits([replace(0, 0, 1, 'a')], [noteEdit(1, 'a')]).edits).toHaveLength(1);
  });

  it('conflicts on a change to what the other side removed', () => {
    const [change, gone] = [replace(2, 0, 1, 'a'), remove(1, 3)];
    expect(rebaseEdits([change], [gone]).conflicts[0]?.reason).toBe('removed');
    expect(rebaseEdits([gone], [change]).conflicts[0]?.reason).toBe('removed');
  });

  it('removes what is left of a removal, around what the other side removed or added', () => {
    expect(rebaseEdits([remove(1, 4)], [remove(2, 1)]).edits).toEqual([remove(1, 3)]);
    expect(rebaseEdits([remove(1, 3)], [insert(2, 'kept')]).edits).toEqual([
      remove(1, 1),
      remove(3, 2),
    ]);
    expect(rebaseEdits([remove(1, 2)], [remove(0, 5)]).edits).toEqual([]);
    expect(rebaseEdits([remove(1, 2)], [whole(1, 1)]).conflicts[0]?.reason).toBe('paragraphs');
  });

  it('moves paragraphs put in, and conflicts when they meet a change', () => {
    expect(rebaseEdits([whole(2, 1)], [insert(0, 'a')]).edits).toEqual([whole(3, 1)]);
    expect(rebaseEdits([whole(1, 3)], [insert(2, 'a')]).conflicts[0]?.reason).toBe('paragraphs');
    expect(rebaseEdits([whole(1, 2)], [remove(2, 1)]).conflicts[0]?.reason).toBe('paragraphs');
    expect(rebaseEdits([whole(0, 1)], [whole(0, 1), whole(3, 1)]).edits).toEqual([]);
    expect(rebaseEdits([whole(0, 2)], [whole(1, 1)]).conflicts).toHaveLength(1);
    expect(rebaseEdits([whole(5, 0)], [remove(0, 1)]).edits).toEqual([whole(4, 0)]);
  });

  it('orders paragraphs added at one place by `ties`, and puts them beside what went', () => {
    expect(rebaseEdits([insert(1, 'a')], [insert(1, 'b')]).edits).toEqual([insert(2, 'a')]);
    const before = rebaseEdits([insert(1, 'a')], [insert(1, 'b')], 'before');
    expect(before.edits).toEqual([insert(1, 'a')]);
    expect(rebaseEdits([insert(2, 'a')], [remove(1, 3)]).edits).toEqual([insert(1, 'a')]);
    const made = whole(1, 3);
    expect(rebaseEdits([insert(2, 'a')], [made]).edits).toEqual([insert(2, 'a')]);
    expect(rebaseEdits([insert(2, 'a')], [made], 'before').edits).toEqual([insert(1, 'a')]);
    expect(rebaseEdits([insert(4, 'a')], [insert(1, 'b')]).edits).toEqual([insert(5, 'a')]);
    expect(rebaseEdits([insert(0, 'a')], [insert(1, 'b')]).edits).toEqual([insert(0, 'a')]);
  });

  it('conflicts on one comment changed two ways, and leaves others', () => {
    expect(rebaseEdits([commentEdit('A')], [commentEdit('B')]).edits).toEqual([commentEdit('A')]);
    expect(rebaseEdits([commentEdit('A')], [commentEdit('A', 'x')]).conflicts[0]?.reason).toBe(
      'comment',
    );
  });

  it('counts a table by the paragraphs its shape comes to, as one whole', () => {
    const rows = [
      [[{ text: 'a' }], [{ text: 'b' }]],
      [[{ text: 'c' }], [{ text: 'd' }]],
    ];
    const table = (first: number, count: number): DocumentEdit => ({
      kind: 'table',
      first,
      count,
      rows,
    });
    expect(rebaseEdits([style(3, 'S')], [table(1, 0)]).edits).toEqual([
      { ...style(3, 'S'), paragraph: 7 },
    ]);
    expect(rebaseEdits([style(5, 'S')], [table(0, 2)]).edits).toEqual([
      { ...style(5, 'S'), paragraph: 7 },
    ]);
    expect(rebaseEdits([table(2, 0)], [insert(0, 'a')]).edits).toEqual([table(3, 0)]);
    expect(rebaseEdits([table(2, 2)], [insert(0, 'a')]).edits).toEqual([table(3, 2)]);
    expect(rebaseEdits([table(2, 2)], [style(3, 'S')]).conflicts[0]?.reason).toBe('removed');
    expect(rebaseEdits([table(2, 2)], [table(2, 2)]).edits).toEqual([]);
  });

  it("takes a stretch of a note as the note, not as the paragraph's text", () => {
    expect(rebaseEdits([inNote(1, 'S')], [replace(0, 0, 3, 'longer')]).edits).toEqual([
      inNote(1, 'S'),
    ]);
    expect(rebaseEdits([replace(0, 0, 3, 'longer')], [inNote(1, 'S')]).edits).toHaveLength(1);
    expect(rebaseEdits([inNote(1, 'S')], [inNote(1, 'T')]).conflicts[0]?.reason).toBe('note');
    expect(rebaseEdits([inNote(1, 'S')], [inNote(2, 'T')]).edits).toEqual([inNote(1, 'S')]);
  });

  it('agrees both ways: each side over the other gives one document', () => {
    const { project, document, words } = opened('one two\\\nthree four\\\nfive six');
    const ours = [replace(0, 0, 3, 'first'), insert(1, 'new'), remove(2, 1)];
    const theirs = [replace(0, 4, 7, 'second'), replace(1, 0, 5, 'third'), insert(1, 'other')];
    const left = document();
    makeEdits(project, left, ours);
    makeEdits(project, left, rebaseEdits(theirs, ours, 'after').edits);
    const right = document();
    makeEdits(project, right, theirs);
    makeEdits(project, right, rebaseEdits(ours, theirs, 'before').edits);
    expect(words(left)).toEqual(['first second', 'new', 'other', 'third four']);
    expect(words(right)).toEqual(words(left));
  });
});

const stretchDocument = opened('held').document();
