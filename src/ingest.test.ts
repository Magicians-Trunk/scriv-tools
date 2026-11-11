import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { applyEdits, readForEditing } from './editable.ts';
import { ingestMarkdown } from './ingest.ts';
import { readModel } from './model.ts';
import { compileModel } from './compile.ts';
import { findItem, flatten, indexBinder, openProject } from './project.ts';
import { saveProject } from './save.ts';
import { styleRoles } from './style-mapping.ts';

function folder(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-ingest-'));
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}

function opened() {
  const dir = writeFixture({
    items: [{ id: 'A', title: 'one', text: 'old words', custom: { place: 'one.md' } }],
    scrivx: (scrivx) => {
      scrivx.customFields.push({ id: 'place', type: 'Text', title: 'Place' });
    },
  });
  return dir;
}

function ingest(dir: string, source: string, field?: string) {
  const model = readForEditing(dir);
  const draft = findItem(indexBinder(model.project.binder), 'DRAFT');
  const result = ingestMarkdown(model, draft, source, styleRoles(model.project), field);
  expect(result.problems).toEqual([]);
  saveProject(model.project, {
    documents: applyEdits(model.project, model.documents, result.edits),
  });
  return result;
}

describe('ingestMarkdown', () => {
  it('updates an item by title, and makes new items and folders', () => {
    const dir = opened();
    const root = folder({ 'one.md': 'new words\n', 'sub/two.md': 'second\n', 'skip.txt': 'no' });
    const { added } = ingest(dir, root);
    expect(added).toEqual(['sub', 'two']);
    const compiled = compileModel(readModel(dir), { onLeftAsWritten: () => {} });
    expect(compiled).toContain('new words');
    expect(compiled).toContain('second');
    expect(compiled).not.toContain('old words');
  });

  it('changes nothing the second time', () => {
    const dir = opened();
    const root = folder({ 'one.md': 'new words\n', 'sub/two.md': 'second\n' });
    ingest(dir, root);
    const again = ingest(dir, root);
    expect(again.edits).toEqual([]);
    expect(again.added).toEqual([]);
  });

  it('finds an item by a field wherever it is, and records it on a new one', () => {
    const dir = opened();
    const root = folder({ 'one.md': 'by field\n', 'three.md': 'third\n' });
    ingest(dir, root, 'place');
    const items = flatten(openProject(dir).binder);
    expect(items.find(({ title }) => title === 'three')?.metadata?.custom.place).toBe('three.md');
    expect(compileModel(readModel(dir), { onLeftAsWritten: () => {} })).toContain('by field');
  });

  it('saves nothing when an item would not say what its file does', () => {
    const dir = opened();
    const root = folder({ 'one.md': 'see <$Scr_H::1>this\n', 'two.md': 'second\n' });
    const model = readForEditing(dir);
    const draft = findItem(indexBinder(model.project.binder), 'DRAFT');
    const result = ingestMarkdown(model, draft, root, styleRoles(model.project));
    expect(result.edits).toEqual([]);
    expect(result.problems).toEqual([
      'A: Writing it would not give what the file says: paragraph 1 would read "see this", not what the file says.',
    ]);
  });

  it('takes one file', () => {
    const dir = opened();
    const root = folder({ 'one.md': 'single\n' });
    ingest(dir, path.join(root, 'one.md'));
    expect(compileModel(readModel(dir), { onLeftAsWritten: () => {} })).toContain('single');
  });

  it('reads a child-holding item as one document', () => {
    const dir = writeFixture({
      items: [
        {
          id: 'F',
          title: 'one',
          type: 'Text',
          text: 'parent',
          children: [{ id: 'C', title: 'child', text: 'kept' }],
        },
      ],
    });
    ingest(dir, folder({ 'one.md': 'changed\n' }));
    const compiled = compileModel(readModel(dir), { onLeftAsWritten: () => {} });
    expect(compiled).toContain('changed');
    expect(compiled).toContain('kept');
  });
});
