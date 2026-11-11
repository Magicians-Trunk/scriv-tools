/**
 * Every fixture document read and written back with nothing changed: each form of it gives back no
 * edit, and a save of all of it writes no file.  `headings.scriv` holds Scrivener's heading tags in
 * its documents' text.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { readNotes } from './binder-edit.ts';
import { keptDocuments } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { shownParagraphs } from './item-forms.ts';
import { markdownParagraphs, paragraphsMarkdown } from './markdown-form.ts';
import { readMarkdown } from './markdown-tree.ts';
import { memoryFiles } from './memory-files.ts';
import { paragraphEdits, retypedParagraphs } from './paragraph-edits.ts';
import { flatten, openProject } from './project.ts';
import { saveProject } from './save.ts';
import { styleRoles } from './style-mapping.ts';

const fixtures = path.join(import.meta.dirname, '..', 'test', 'fixtures');
const names = fs.readdirSync(fixtures).filter((name) => name.endsWith('.scriv'));

/** A fixture's files in memory, so saving it changes nothing on disk. */
function held(name: string) {
  const dir = path.join(fixtures, name);
  const found = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  const files = memoryFiles(
    found
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [file, new Uint8Array(fs.readFileSync(file))] as const;
      }),
  );
  const project = openProject(dir, files);
  return { project, files, documents: keptDocuments(dir, files) };
}

describe.each(names)('%s read and rewritten', (name) => {
  it('gives no edit from any form of a document, and saves no file', () => {
    const { project, files, documents } = held(name);
    const roles = styleRoles(project);
    const changed: string[] = [];
    const changes = new Map();
    for (const { id } of flatten(project.binder)) {
      const read = readParagraphs(project, documents.text(id), { placeholders: true });
      const shown = shownParagraphs(read, roles);
      const markdown = markdownParagraphs(
        readMarkdown(paragraphsMarkdown(shown, roles)),
        shown,
        roles,
      );
      const notes = readParagraphs(project, documents.text(id, 'notes'));
      const lines = readNotes(project, documents, id);
      const retyped = retypedParagraphs(notes, lines === '' ? [] : lines.split('\n'));
      if (paragraphEdits(id, read, shown, roles).length > 0) changed.push(`${id} as read`);
      if (paragraphEdits(id, read, markdown, roles).length > 0) changed.push(`${id} as Markdown`);
      if (paragraphEdits(id, notes, retyped).length > 0) changed.push(`${id} notes as lines`);
      const has = (file: string) => files.exists(path.join(project.dir, 'Files', 'Data', id, file));
      const change = {
        ...(has('content.rtf') ? { content: documents.text(id) } : {}),
        ...(has('notes.rtf') ? { notes: documents.text(id, 'notes') } : {}),
        ...(has('synopsis.txt') ? { synopsis: documents.synopsis(id) } : {}),
      };
      if (Object.keys(change).length > 0) changes.set(id, change);
    }
    expect(changed).toEqual([]);
    files.takeChanges();
    expect(saveProject(project, { documents: changes })).toMatchObject({
      written: [],
      removed: [],
    });
  });
});

describe('headings.scriv', () => {
  it("reads each heading's level from its text", () => {
    const { project, documents } = held('headings.scriv');
    const levels = flatten(project.binder).flatMap(({ id }) =>
      readParagraphs(project, documents.text(id)).flatMap(({ level }) =>
        level === undefined ? [] : [level],
      ),
    );
    expect(levels).toEqual([1, 1, 1]);
  });
});
