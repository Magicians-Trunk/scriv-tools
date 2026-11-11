/** The proof of the compare: making its edits gives the other version, over every fixture. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { compareDocument } from './document-compare.ts';
import { composeEdits, documentEdits, makeEdits, reverseEdits } from './document-edits.ts';
import { mergeDocument } from './document-merge.ts';
import { type DocumentText, projectDocuments } from './document.ts';
import { EditError, readParagraphs } from './edit-pieces.ts';
import type { DocumentEdit } from './editable.ts';
import { memoryFiles } from './memory-files.ts';
import { flatten, openProject, type Project } from './project.ts';
import { type ItemDocumentsChange, saveProject } from './save.ts';
import { plainText } from './text-compare.ts';

const fixtures = path.join(import.meta.dirname, '..', 'test', 'fixtures');
const names = fs.readdirSync(fixtures).filter((name) => name.endsWith('.scriv'));

function opened(name: string) {
  const project = openProject(path.join(fixtures, name));
  const documents = projectDocuments(project.dir);
  const texts = flatten(project.binder).flatMap(({ id }) =>
    (['content', 'notes'] as const).map((part) => documents.text(id, part)),
  );
  return { project, texts: texts.filter(({ paragraphs }) => paragraphs.length > 0) };
}

const NOTHING = projectDocuments('/none').text;

/** A fixture's files in memory, so saving it changes nothing on disk. */
function heldFiles(name: string) {
  const dir = path.join(fixtures, name);
  const found = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  const files = found.filter((entry) => entry.isFile());
  return memoryFiles(
    files.map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [file, new Uint8Array(fs.readFileSync(file))] as const;
    }),
  );
}

const WORDS = new Intl.Segmenter('en', { granularity: 'word' });

/** The first and last words of each paragraph that has two, as edits, each making a new word. */
function endWords(project: Project, document: DocumentText) {
  const first: DocumentEdit[] = [];
  const last: DocumentEdit[] = [];
  for (const { paragraph, text } of readParagraphs(project, document)) {
    const words = Array.from(WORDS.segment(plainText(text))).filter((word) => word.isWordLike);
    if (words.length < 2) continue;
    const edit = (word: Intl.SegmentData, made: string): DocumentEdit => ({
      kind: 'replace',
      paragraph,
      start: word.index,
      end: word.index + word.segment.length,
      text: made,
    });
    const pair = [edit(words[0]!, 'oursword'), edit(words.at(-1)!, 'theirsword')];
    try {
      makeEdits(project, structuredClone(document), pair);
    } catch (error) {
      // A word that runs into a link or a note cannot be cut there: it is no word to prove on.
      if (!(error instanceof EditError)) throw error;
      continue;
    }
    first.push(pair[0]!);
    last.push(pair[1]!);
  }
  return { first, last };
}

describe.each(names)('%s', (name) => {
  const { project, texts } = opened(name);
  const made = (from: DocumentText, edits: Parameters<typeof makeEdits>[2]) => {
    const copy = structuredClone(from);
    makeEdits(project, copy, edits);
    return copy;
  };
  const differs = (a: DocumentText, b: DocumentText) => compareDocument(project, a, b).changed;

  it('turns every document into the next few, and to and from nothing', () => {
    const empty = NOTHING('none');
    const results = texts.flatMap((a, at) => {
      const next = [1, 2, 3].map((step) => texts[(at + step) % texts.length]!);
      return [
        ...[...next, empty].map((b) => differs(made(a, documentEdits(project, a, b)), b)),
        differs(made(empty, documentEdits(project, empty, a)), a),
      ];
    });
    expect(results).not.toContain(true);
  });

  it('takes a change back, and makes two changes as one', () => {
    const results = texts.flatMap((a, at) => {
      const b = texts[(at + 1) % texts.length]!;
      const c = texts[(at + 2) % texts.length]!;
      const edits = documentEdits(project, a, b);
      const next = documentEdits(project, b, c);
      return [
        differs(made(made(a, edits), reverseEdits(project, a, edits)), a),
        differs(made(a, composeEdits(project, a, edits, next)), made(made(a, edits), next)),
      ];
    });
    expect(results).not.toContain(true);
  });

  it('merges two changes to words of one paragraph, and reads the same once saved', () => {
    const files = heldFiles(name);
    const held = openProject(path.join(fixtures, name), files);
    const documents = projectDocuments(held.dir, files);
    const changes = new Map<string, ItemDocumentsChange>();
    const wanted = new Map<string, DocumentText>();
    for (const { id } of flatten(held.binder)) {
      const base = documents.text(id);
      const { first, last } = endWords(held, base);
      if (first.length === 0) continue;
      const edited = (edits: DocumentEdit[]) => {
        const copy = structuredClone(base);
        makeEdits(held, copy, edits);
        return copy;
      };
      const ours = edited(first);
      const kinds = documentEdits(held, base, ours).map(({ kind }) => kind);
      expect(new Set(kinds)).toEqual(new Set(['replace']));
      const merged = mergeDocument(held, base, ours, edited(last));
      expect(merged.conflicts).toEqual([]);
      const want = edited([...first, ...last]);
      expect(compareDocument(held, merged.document, want).changed).toBe(false);
      changes.set(id, { content: merged.document });
      wanted.set(id, want);
    }
    saveProject(held, { documents: changes });
    const again = openProject(held.dir, files);
    const saved = projectDocuments(again.dir, files);
    for (const [id, want] of wanted) {
      expect(compareDocument(again, saved.text(id), want).changed).toBe(false);
    }
  });
});
