/** Rebased edits are made on ours: this holds them to it when the document will not take them. */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { mergeDocument } from './document-merge.ts';
import { projectDocuments } from './document.ts';
import { EditError } from './edit-pieces.ts';
import { mergeProjects } from './project-merge.ts';
import { openProject } from './project.ts';

/** What the next `makeEdits` will throw.  A plain function: a `vi.fn` that throws fails the test. */
const refusal = vi.hoisted((): { error?: Error } => ({}));

vi.mock('./document-edits.ts', async (original) => {
  const actual = await original<typeof import('./document-edits.ts')>();
  return {
    ...actual,
    makeEdits: (...args: Parameters<typeof actual.makeEdits>) => {
      if (refusal.error) throw refusal.error;
      actual.makeEdits(...args);
    },
  };
});

function merged() {
  const items = ['one words', 'two words', 'one more'].map((text, at) => {
    const id = 'ABC'[at]!;
    return { id, title: id, text };
  });
  const project = openProject(writeFixture({ items }));
  const documents = projectDocuments(project.dir);
  const [a, b, c] = ['A', 'B', 'C'].map((id) => documents.text(id));
  return { ours: b!, result: () => mergeDocument(project, a!, b!, c!) };
}

function version(text: string) {
  const project = openProject(writeFixture({ items: [{ id: 'A', title: 'A', text }] }));
  return { project, documents: projectDocuments(project.dir) };
}

describe('a merge the document will not take', () => {
  afterEach(() => {
    delete refusal.error;
  });

  it('says why, and stays as ours has it', () => {
    const { ours, result } = merged();
    refusal.error = new EditError('It will not go.');
    const { document, refused } = result();
    expect(refused).toBe('It will not go.');
    expect(document.source).toBe(ours.source);
  });

  it('lets through what is no refusal', () => {
    const { result } = merged();
    refusal.error = new RangeError('A fault here.');
    expect(result).toThrow('A fault here.');
  });

  it('says so for the document, in a merge of projects', () => {
    const [base, ours, theirs] = ['words here', 'ours here', 'words theirs'].map(version);
    refusal.error = new EditError('It will not go.');
    expect(mergeProjects(base!, ours!, theirs!).conflicts).toMatchObject([
      { kind: 'refused', item: 'A', part: 'content', reason: 'It will not go.' },
    ]);
  });
});
