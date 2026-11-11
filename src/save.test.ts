import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { rtfDocument } from '../test/rtf-builder.ts';
import { textBytes } from './files.ts';
import { newBinderItem } from './binder-item.ts';
import { compileModel } from './compile.ts';
import { readFormatFile } from './compile-format.ts';
import { projectDocuments, readDocumentText } from './document.ts';
import { insertParagraphs } from './edit.ts';
import { readModel } from './model.ts';
import { findItem, flatten, indexBinder, openProject } from './project.ts';
import { readProjectFiles } from './project-files.ts';
import { saveProject } from './save.ts';
import { checksumOf } from './search-index.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');
const NOW = new Date(2026, 10, 2, 9, 30, 15);

/** A copy of a fixture project, to save into. */
function copyOf(name: string): string {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-tools-save-')), name);
  fs.cpSync(path.join(FIXTURES, name), copy, { recursive: true });
  return copy;
}

/** Every file in a folder, by path, with its bytes. */
const snapshot = (dir: string) =>
  new Map(
    fs
      .readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((file) => fs.statSync(path.join(dir, file)).isFile())
      .map((file) => [file, fs.readFileSync(path.join(dir, file)).toString('base64')]),
  );

describe('saveProject', () => {
  it('writes nothing for a project saved as it was read', () => {
    const dir = copyOf('basic.scriv');
    const before = snapshot(dir);
    expect(saveProject(openProject(dir))).toEqual({ written: [], removed: [], warnings: [] });
    expect(snapshot(dir)).toEqual(before);
  });

  it('refuses text in a PDF, which keeps a file of its own, and saves its notes', () => {
    const dir = copyOf('media.scriv');
    const pdf = 'FFAA67F3-106A-466C-8821-F82AD89A1E74';
    const project = openProject(dir);
    const documents = projectDocuments(dir);
    const text = documents.text(pdf);
    insertParagraphs(project, text, 0, [{ text: 'Typed over the PDF.' }]);
    const before = snapshot(dir);
    expect(() =>
      saveProject(project, { documents: new Map([[pdf, { content: text }]]), now: NOW }),
    ).toThrow('Unsupported: text in a PDF item, which keeps a file of its own');
    expect(snapshot(dir)).toEqual(before);
    const notes = documents.text(pdf, 'notes');
    insertParagraphs(project, notes, 0, [{ text: 'A note on the PDF.' }]);
    const saved = saveProject(openProject(dir), {
      documents: new Map([[pdf, { content: documents.text(pdf), notes }]]),
      now: NOW,
    });
    expect(saved.written).toContain(path.join(dir, 'Files', 'Data', pdf, 'notes.rtf'));
    expect(fs.existsSync(path.join(dir, 'Files', 'Data', pdf, 'content.rtf'))).toBe(false);
  });

  it('writes a changed document over its RTF and stamps it, and the project, as Scrivener does', () => {
    const dir = copyOf('basic.scriv');
    const project = openProject(dir);
    const chapter = project.binder[0]!.children[0]!.children[0]!;
    const documents = projectDocuments(dir);
    const text = documents.text(chapter.id);
    const [first] = text.paragraphs;
    first!.content = [{ kind: 'text', text: 'Rewritten.', format: {} }];
    const modId = project.modId;
    const result = saveProject(project, {
      documents: new Map([[chapter.id, { content: text, synopsis: 'Now with a synopsis' }]]),
      now: NOW,
    });
    const data = path.join(dir, 'Files', 'Data', chapter.id);
    expect(result.written).toEqual(
      expect.arrayContaining([
        path.join(data, 'content.rtf'),
        path.join(data, 'synopsis.txt'),
        project.file,
      ]),
    );
    const reopened = openProject(dir);
    const saved = findItem(indexBinder(reopened.binder), chapter.id);
    expect(saved.modified).toMatch(/^2026-11-02 09:30:15 [+-]\d{4}$/);
    expect(reopened.modified).toBe(saved.modified);
    expect(reopened.modId).not.toBe(modId);
    expect(projectDocuments(dir).synopsis(chapter.id)).toBe('Now with a synopsis');
    const compiled = compileModel(readModel(dir), { now: NOW });
    expect(compiled).toContain('Rewritten.');
  });

  it('writes a new item’s documents into a folder of its own, and removes what is emptied', () => {
    const dir = writeFixture({
      items: [{ id: 'A', title: 'A', text: 'a', synopsis: 'gone', styles: ['S-HEADING'] }],
    });
    const project = openProject(dir);
    const draft = project.binder[0]!;
    const added = newBinderItem('Text', 'New', NOW);
    draft.children.push(added, newBinderItem('Folder'));
    expect(added).toMatchObject({
      created: added.modified,
      textSettings: { textSelection: [0, 0] },
    });
    const fresh = readDocumentText(rtfDocument('<$Scr_Ps::0>new text<!$Scr_Ps::0>'), ['S-HEADING']);
    const plain = { ...projectDocuments(dir).text('A'), styleIds: [] };
    const result = saveProject(project, {
      documents: new Map([
        [added.id, { content: fresh }],
        ['A', { content: plain, synopsis: '' }],
      ]),
      now: NOW,
    });
    const data = path.join(dir, 'Files', 'Data');
    expect(result.written).toContain(path.join(data, added.id, 'content.rtf'));
    expect(result.removed).toEqual([
      path.join(data, 'A', 'content.styles'),
      path.join(data, 'A', 'synopsis.txt'),
    ]);
    expect(projectDocuments(dir).text(added.id).source).toBe(fresh.source);
    expect(projectDocuments(dir).text(added.id).styleIds).toEqual(['S-HEADING']);
  });

  it('saves a changed compile format, and warns of a project Scrivener may have open', () => {
    const dir = writeFixture({ items: [] });
    fs.writeFileSync(path.join(dir, 'Files', 'user.lock'), '');
    const file = path.join(dir, 'Settings', 'Compile Formats', 'Fixture-Format.scrformat');
    const format = readFormatFile(file, 'project');
    format.model.name = 'Renamed';
    const result = saveProject(openProject(dir), { formats: [format], now: NOW });
    expect(result.written).toContain(file);
    expect(result.warnings).toEqual([
      'Scrivener may have the project open, and could save over these changes.',
    ]);
    expect(readFormatFile(file, 'project').name).toBe('Renamed');
  });

  it('keeps a document’s comments and style IDs, and leaves alone what did not change', () => {
    const dir = copyOf('outstanding.scriv');
    const project = openProject(dir);
    const documents = projectDocuments(dir);
    const commented = fs
      .readdirSync(path.join(dir, 'Files', 'Data'))
      .find((id) => fs.existsSync(path.join(dir, 'Files', 'Data', id, 'content.comments')))!;
    const text = documents.text(commented);
    text.comments[0]!.collapsed = true;
    const result = saveProject(project, {
      documents: new Map([
        [commented, { content: text, notes: documents.text(commented, 'notes') }],
      ]),
      now: NOW,
    });
    const data = path.join(dir, 'Files', 'Data', commented);
    expect(result.written).toEqual([path.join(data, 'content.comments'), project.file]);
    expect(projectDocuments(dir).text(commented).comments[0]!.collapsed).toBe(true);
    const unchanged = openProject(dir);
    const same = new Map([[commented, { content: projectDocuments(dir).text(commented) }]]);
    expect(saveProject(unchanged, { documents: same }).written).toEqual([]);
  });

  it('saves a project that was never compiled, and has no styles', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A' }], neverCompiled: true });
    fs.rmSync(path.join(dir, 'Files', 'styles.xml'));
    const project = openProject(dir);
    project.binder[0]!.children[0]!.title = 'Renamed';
    expect(saveProject(project, { now: NOW }).written).toEqual([project.file]);
    expect(fs.existsSync(path.join(dir, 'Settings', 'compile.xml'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'Files', 'styles.xml'))).toBe(false);
  });

  it('refuses a project read with what it does not know, writing nothing', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A' }] });
    const file = path.join(dir, 'Fixture.scrivx');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<Binder>', '<Binder><Odd/>'));
    const before = snapshot(dir);
    const project = openProject(dir);
    project.binder[0]!.title = 'Changed';
    expect(() => saveProject(project, { now: NOW })).toThrow(
      'Unsupported: writing the project file, which holds a Odd element in Binder',
    );
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("Scrivener's records of a changed document", () => {
  const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<SearchIndexes Version="1.0">
    <Documents>
        <Document ID="A">
            <Title>A</Title>
            <Text>old</Text>
            <Comments>said</Comments>
        </Document>
        <Document ID="B">
            <Title>B</Title>
            <Text>stale</Text>
        </Document>
    </Documents>
</SearchIndexes>`;

  function recorded() {
    const dir = writeFixture({
      items: [
        { id: 'A', title: 'A', text: 'one' },
        { id: 'B', title: 'B', text: 'two' },
        { id: 'C', title: 'C', text: 'three' },
      ],
    });
    fs.writeFileSync(path.join(dir, 'Files', 'search.indexes'), INDEX);
    fs.writeFileSync(path.join(dir, 'Files', 'Data', 'docs.checksum'), 'b/content.rtf=stale');
    const project = openProject(dir);
    const documents = projectDocuments(dir);
    return { dir, project, documents };
  }

  it('keeps the checksums and search index up with it, and leaves the rest', () => {
    const { dir, project, documents } = recorded();
    const content = documents.text('A');
    content.paragraphs[0]!.content = [{ kind: 'text', text: 'Rewritten.', format: {} }];
    saveProject(project, { documents: new Map([['A', { content, synopsis: 'short' }]]) });
    const { checksums, searchIndex } = readProjectFiles(dir);
    const rtf = fs.readFileSync(path.join(dir, 'Files', 'Data', 'A', 'content.rtf'));
    expect(checksums?.get('a/content.rtf')).toBe(checksumOf(rtf));
    expect(checksums?.get('a/synopsis.txt')).toBe(checksumOf(textBytes('short')));
    expect(checksums?.get('b/content.rtf')).toBe('stale');
    expect(searchIndex?.documents[0]).toEqual({
      id: 'A',
      title: 'A',
      synopsis: 'short',
      text: 'Rewritten.',
      comments: 'said',
    });
    expect(searchIndex?.documents[1]?.text).toBe('stale');
  });

  it('adds what the index has not got, and drops what a document no longer has', () => {
    const { dir, project, documents } = recorded();
    const notes = documents.text('C', 'notes');
    insertParagraphs(project, notes, 0, [{ text: 'noted' }]);
    saveProject(project, { documents: new Map([['C', { notes, synopsis: 'short' }]]) });
    const entry = readProjectFiles(dir).searchIndex?.documents.at(-1);
    expect(entry).toEqual({ id: 'C', title: 'C', synopsis: 'short', notes: 'noted' });
    const emptied = saveProject(openProject(dir), {
      documents: new Map([['C', { synopsis: '' }]]),
    });
    expect(emptied.removed.some((file) => file.endsWith('synopsis.txt'))).toBe(true);
    expect(readProjectFiles(dir).checksums?.has('c/synopsis.txt')).toBe(false);
  });

  it('indexes an item with no title', () => {
    const dir = writeFixture({ items: [{ id: 'A', text: 'one' }] });
    fs.writeFileSync(path.join(dir, 'Files', 'search.indexes'), INDEX);
    const project = openProject(dir);
    const content = projectDocuments(dir).text('A');
    saveProject(project, { documents: new Map([['A', { content }]]) });
    expect(readProjectFiles(dir).searchIndex?.documents[0]?.title).toBeUndefined();
  });

  it('leaves the records as Scrivener wrote them for documents saved as they were read', () => {
    // Scrivener indexes a table's cells in its own way, which an unchanged document keeps.
    const dir = copyOf('tables.scriv');
    const before = snapshot(dir);
    const project = openProject(dir);
    const documents = projectDocuments(dir);
    const texts = flatten(project.binder).filter(({ type }) => type === 'Text');
    const unchanged = new Map(texts.map(({ id }) => [id, { content: documents.text(id) }]));
    expect(saveProject(project, { documents: unchanged }).written).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  it('writes neither record when a save changes no document, or there is none to write', () => {
    const { dir, project, documents } = recorded();
    const unchanged = saveProject(project, { documents: new Map() });
    expect(unchanged.written).toEqual([]);
    fs.rmSync(path.join(dir, 'Files', 'search.indexes'));
    fs.rmSync(path.join(dir, 'Files', 'Data', 'docs.checksum'));
    const content = documents.text('A');
    content.paragraphs[0]!.content = [{ kind: 'text', text: 'x', format: {} }];
    saveProject(project, { documents: new Map([['A', { content }]]) });
    expect(fs.existsSync(path.join(dir, 'Files', 'search.indexes'))).toBe(false);
  });
});
