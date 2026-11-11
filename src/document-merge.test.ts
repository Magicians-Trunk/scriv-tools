import { describe, expect, it } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { PARA, table } from '../test/rtf-builder.ts';
import { makeEdits } from './document-edits.ts';
import { mergeDocument } from './document-merge.ts';
import { projectDocuments } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { openProject } from './project.ts';
import { plainText } from './text-compare.ts';

function merged(
  base: string,
  ours: string,
  theirs: string,
  choose?: Parameters<typeof mergeDocument>[4],
) {
  const styles = [STYLES.heading];
  const items = [base, ours, theirs].map((text, at) => {
    const id = 'ABC'[at]!;
    return { id, title: id, text, styles };
  });
  const project = openProject(writeFixture({ items }));
  const documents = projectDocuments(project.dir);
  const [a, b, c] = ['A', 'B', 'C'].map((id) => documents.text(id));
  const result = mergeDocument(project, a!, b!, c!, choose);
  const read = readParagraphs(project, result.document);
  return { ...result, read, words: read.map(({ text }) => plainText(text)) };
}

const cell = (text: string) => ({ text });

const row = (a: string, b: string) => [cell(a), cell(b)];

const grid = (...rows: ReturnType<typeof row>[]) => table(rows);

describe('merging a document', () => {
  it('applies changes to different paragraphs', () => {
    const { words, conflicts } = merged(
      `first line here${PARA}second line here`,
      `first line changed${PARA}second line here`,
      `first line here${PARA}second words here`,
    );
    expect(conflicts).toEqual([]);
    expect(words).toEqual(['first line changed', 'second words here']);
  });

  it('applies changes to different words of a paragraph', () => {
    const base = 'alpha beta gamma delta';
    const both = merged(base, 'ALPHA beta gamma delta', 'alpha beta gamma DELTA');
    expect(both.words).toEqual(['ALPHA beta gamma DELTA']);
  });

  it('applies a restyle beside changed words', () => {
    const project = openProject(
      writeFixture({
        items: [
          { id: 'A', title: 'A', text: 'alpha beta gamma delta' },
          { id: 'B', title: 'B', text: 'alpha beta gamma changed' },
        ],
      }),
    );
    const documents = projectDocuments(project.dir);
    const restyled = documents.text('A');
    makeEdits(project, restyled, [{ kind: 'style', paragraph: 0, style: 'Heading 1' }]);
    const { conflicts, document } = mergeDocument(
      project,
      documents.text('A'),
      documents.text('B'),
      restyled,
    );
    expect(conflicts).toEqual([]);
    const [read] = readParagraphs(project, document);
    expect(read).toMatchObject({ style: 'Heading 1' });
    expect(plainText(read!.text)).toBe('alpha beta gamma changed');
  });

  it('conflicts on the same words and keeps ours, until a person chooses', () => {
    const args = ['the old word stays', 'the new word stays', 'the other word stays'] as const;
    const left = merged(...args);
    expect(left.conflicts).toHaveLength(1);
    expect(left.conflicts[0]?.reason).toBe('words');
    expect(left.words).toEqual(['the new word stays']);
    expect(merged(...args, () => 'theirs')).toMatchObject({
      conflicts: [],
      words: ['the other word stays'],
    });
    expect(merged(...args, () => 'ours')).toMatchObject({
      conflicts: [],
      words: ['the new word stays'],
    });
  });

  it('conflicts on two changes to one word', () => {
    const { conflicts } = merged('the color here', 'the colour here', 'the colors here');
    expect(conflicts).toHaveLength(1);
  });

  it('adds both sides new paragraphs at one place, ours first, and one the same only once', () => {
    const base = `one${PARA}two`;
    expect(merged(base, `one${PARA}ours${PARA}two`, `one${PARA}theirs${PARA}two`).words).toEqual([
      'one',
      'ours',
      'theirs',
      'two',
    ]);
    const same = `one${PARA}new${PARA}two`;
    expect(merged(base, same, same).words).toEqual(['one', 'new', 'two']);
  });

  it('adds a row to a table beside a paragraph the other side removed', () => {
    const { refused, conflicts, words } = merged(
      `${grid(row('a', 'b'), row('c', 'd'))}after${PARA}more`,
      `${grid(row('a', 'b'), row('c', 'd'))}after`,
      `${grid(row('a', 'b'), row('c', 'd'), row('e', 'f'))}after${PARA}more`,
    );
    expect(conflicts).toEqual([]);
    expect(refused).toBeUndefined();
    expect(words.slice(-3)).toEqual(['e', 'f', 'after']);
  });
});
