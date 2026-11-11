/**
 * Saves edited copies of projects into `<folder>`, for Scrivener to open and compile:
 * `node scripts/save-check.ts <folder> [<project>]`.
 *
 * First, the basic fixture project.  The edits touch each file the library writes:
 * a document's text and formatting, a synopsis, a new item, a binder title, a label, and the
 * project title in the compile settings.  Beside the copy goes the library's own compile of it,
 * `<folder>/basic-saved.md`.  Open the copy in Scrivener: it should open without complaint and
 * show every edit, search should find the new text, and its compile should match
 * `basic-saved.md` byte for byte.
 *
 * Then, given a project whose last-used compile format Scrivener saved (the fixtures' formats were
 * written by the fixture builder), a copy of it with that format renamed, its text sections
 * separated by a custom separator, and a replacement added, saved with the format.  Beside it goes
 * the library's compile of it, `<folder>/format-saved.md`.  Compiled in Scrivener with the renamed
 * format, the copy should match it byte for byte; and if Scrivener writes the format back, its file
 * should be as the library wrote it, kept in `<folder>/format-saved.scrformat`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileModel } from '../src/compile.ts';
import { listFormats } from '../src/compile-format.ts';
import { projectDocuments } from '../src/document.ts';
import { readModel } from '../src/model.ts';
import { openProject } from '../src/project.ts';
import { saveProject } from '../src/save.ts';

const [folder, formatProject] = process.argv.slice(2);
if (folder === undefined) {
  console.error('usage: save-check.ts <folder> [<project>]');
  process.exit(1);
}
const copy = path.join(folder, 'basic-saved.scriv');
fs.rmSync(copy, { recursive: true, force: true });
fs.cpSync(path.join(import.meta.dirname, '..', 'test', 'fixtures', 'basic.scriv'), copy, {
  recursive: true,
});
fs.renameSync(path.join(copy, 'basic.scrivx'), path.join(copy, 'basic-saved.scrivx'));

const project = openProject(copy);
const documents = projectDocuments(copy);
const [part] = project.binder[0]!.children;
const [chapter] = part!.children;

// A paragraph rewritten, part of it bold; a synopsis; a binder title and label.
const text = documents.text(chapter!.id);
text.paragraphs[0]!.content = [
  { kind: 'text', text: 'Saved by scriv-tools, ', format: {} },
  { kind: 'text', text: 'partly bold', format: { bold: true } },
  { kind: 'text', text: '.', format: {} },
];
chapter!.title = 'Chapter One, Saved';
chapter!.metadata = { ...chapter!.metadata, custom: chapter!.metadata?.custom ?? {}, labelId: '1' };

// A new item at the end of the first part, with text of its own.
const added = {
  ...structuredClone(chapter!),
  id: randomUUID().toUpperCase(),
  title: 'Added',
  children: [],
};
part!.children.push(added);
const addedText = structuredClone(documents.text(chapter!.id));
addedText.paragraphs = [addedText.paragraphs[0]!];
addedText.paragraphs[0]!.content = [
  { kind: 'text', text: 'A new document, findable: zephyrine.', format: {} },
];
addedText.comments = [];

// The project title.
project.compileSettings!.projectSettings.metadata.projectTitle = 'Basic, Saved';

const result = saveProject(project, {
  documents: new Map([
    [chapter!.id, { content: text, synopsis: 'A synopsis the save wrote.' }],
    [added.id, { content: addedText }],
  ]),
});
const lines = [
  ...result.written.map((file) => `wrote   ${path.relative(copy, file)}`),
  ...result.removed.map((file) => `removed ${path.relative(copy, file)}`),
  ...result.warnings.map((warning) => `warning ${warning}`),
];

// The fixture's own compile date, which its placeholders print.
const compiled = compileModel(readModel(copy), { now: new Date(2026, 9, 31, 12) });
fs.writeFileSync(path.join(folder, 'basic-saved.md'), compiled);
lines.push('', `Open ${copy} in Scrivener, then compile it with its last-used format.`);
if (formatProject !== undefined) lines.push('', ...checkFormat(formatProject));
process.stdout.write(`${lines.join('\n')}\n`);

/** Saves a copy of `source` with its last-used format changed, and says what to check. */
function checkFormat(source: string): string[] {
  const formatCopy = path.join(folder!, 'format-saved.scriv');
  fs.rmSync(formatCopy, { recursive: true, force: true });
  fs.cpSync(source, formatCopy, { recursive: true });
  fs.rmSync(path.join(formatCopy, 'Files', 'user.lock'), { force: true });
  const scrivx = fs.readdirSync(formatCopy).find((file) => file.endsWith('.scrivx'))!;
  fs.renameSync(path.join(formatCopy, scrivx), path.join(formatCopy, 'format-saved.scrivx'));
  const copied = openProject(formatCopy);
  const lastUsed = copied.compileSettings!.lastUsedFormats.mmd;
  const found = listFormats(copied).find(
    (format) => format.source === 'project' && format.id === lastUsed,
  )!;
  const { model } = found;
  model.name = `${model.name} Saved`;
  model.separatorSettings.textSeparators.between = { type: 'Custom', text: '<!-- saved -->' };
  model.replacements.push({ replace: 'Magician', with: 'Conjurer' });
  const saved = saveProject(copied, { formats: [found] });
  fs.copyFileSync(found.file, path.join(folder!, 'format-saved.scrformat'));
  const output = compileModel(readModel(formatCopy, model.name), {
    now: new Date(2026, 9, 31, 12),
  });
  fs.writeFileSync(path.join(folder!, 'format-saved.md'), output);
  return [
    ...saved.written.map((file) => `wrote   ${path.relative(formatCopy, file)}`),
    '',
    `Open ${formatCopy} in Scrivener, then compile it with "${model.name}".`,
  ];
}
