#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineCommand, runMain } from 'citty';
import {
  addItem,
  type BinderPlace,
  moveItem,
  changeItem,
  setCustomField,
  trashItem,
} from './binder-edit.ts';
import type { BinderItem } from './binder-item.ts';
import { listFormats } from './compile-format.ts';
import { compileWithImages, readText } from './compile.ts';
import { dateStamp } from './dates.ts';
import { projectDocuments } from './document.ts';
import { applyEdits, type EditingModel, readForEditing } from './editable.ts';
import { createProject } from './new-project.ts';
import { ingestMarkdown } from './ingest.ts';
import { itemCompiles } from './item-compile.ts';
import {
  type FormEdits,
  type ImportEdits,
  type ItemParagraphs,
  markdownEdits,
  markdownItems,
  readItems,
  structuredEdits,
  structuredItems,
} from './item-forms.ts';
import { readModel } from './model.ts';
import { readProjectFiles } from './project-files.ts';
import {
  adaptiveTitle,
  ancestorsOf,
  findItem,
  indexBinder,
  openProject,
  type Project,
} from './project.ts';
import { type ItemDocumentsChange, saveProject } from './save.ts';
import { findItems, findText, parseSelector, type Selector, SelectorError } from './selector.ts';
import { addSnapshot, readSnapshots } from './snapshots.ts';
import { projectStructure } from './structure.ts';
import { type ChosenRoles, type StyleRoles, styleRoles } from './style-mapping.ts';

const project = {
  type: 'positional',
  description: 'The .scrivx file, or the .scriv folder around it',
  required: true,
} as const;
const format = {
  type: 'string',
  description: "A compile format's name, file name or path.  Defaults to the last one used.",
} as const;
const quiet = {
  type: 'boolean',
  description:
    'Do not list the <$…> left as written as Scrivener leaves them: placeholders it does not evaluate, and style endings with no style open',
} as const;

/** Lists each `<$…>` the compile left as written, unless told to keep quiet. */
const leftAsWritten = (silent: boolean | undefined) => (placeholder: string, title?: string) => {
  if (silent) return;
  const where = title === undefined ? '' : ` in "${title}"`;
  process.stderr.write(`Left as written, as Scrivener does: ${placeholder}${where}\n`);
};

const author = {
  type: 'string',
  description: 'Fills <$author>, which Scrivener takes from the Mac, not the project',
} as const;

const SELECTOR =
  'A selector: id:<ID>, path:<binder path> or field:<field ID>=<value>, then optionally ' +
  'heading:<text> or text:<text> to narrow to a section or paragraphs inside the items.';

const FORMS =
  "Two forms of the documents' own text: .md, Markdown, and .json, each " +
  "item's paragraphs as typed data.  Use Markdown for text, headings, lists, quotes and code.  " +
  'Use the structured form for everything else: what Markdown cannot say stays as it was.';

const COMPILED =
  'Each item also shows its compiled text, read only, cut from the same compile `compile` ' +
  'writes, so you can see replacements, prefixes, suffixes and titles: in Markdown, a block ' +
  'of fences between the <!-- compiled ID … --> and <!-- end of compiled ID --> comments after ' +
  'the item\'s own words; in JSON, its "compiled" field.  An item the compile leaves out says ' +
  'so instead.  Import never reads the compiled text into the item, and refuses any item whose ' +
  'compiled text was changed, writing nothing for it.';

/** What a command is given after the project: a selector's parts, then any `extra` others. */
function selected(args: { _: string[] }, extra = 0) {
  const [dir, ...rest] = args._;
  const parts = rest.slice(0, rest.length - extra);
  return { model: readForEditing(dir!), selector: parseSelector(parts) };
}

/** The items and paragraphs a selector names. */
function select(model: EditingModel, { items, within }: Selector) {
  const found = findItems(model.project, model.documents, items);
  return { found, places: within && findText(found, model.documents, within) };
}

/** The one item a selector names.  Naming more stops. */
function onlyItem(model: EditingModel, selector: Selector): BinderItem {
  const [first, ...rest] = findItems(model.project, model.documents, selector.items);
  if (rest.length > 0) throw new SelectorError('The selector names more than one item.');
  return first!;
}

/** Saves, and lists what was written and anything to know. */
function save(opened: Project, documents?: Map<string, ItemDocumentsChange>): void {
  const { written, removed, warnings } = saveProject(opened, documents ? { documents } : {});
  for (const file of [...written, ...removed]) process.stdout.write(`${file}\n`);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
}

const mapping = {
  type: 'string',
  description:
    'A JSON file naming the styles that mean a quote, a code block, a code span, strong or emphasis, in place of Scrivener\'s names for them, such as {"quote":"Aside"}.  Headings come from the stylesheet.',
} as const;

/** Which style means what in a model's stylesheet, with what a mapping file chooses. */
function rolesOf(model: EditingModel, file: string | undefined): StyleRoles {
  const chosen: ChosenRoles = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return styleRoles(model.project, chosen);
}

/** Saves the edits a form comes to, or stops on what stops them, writing nothing. */
function saveEdits(model: EditingModel, { edits, problems }: FormEdits): void {
  if (problems.length > 0) throw new Error(problems.join('\n'));
  save(model.project, applyEdits(model.project, model.documents, edits));
}

/** Saves the items a form gives back, and says which it refused and why, failing if any. */
function saveImport(model: EditingModel, imported: ImportEdits): void {
  saveEdits(model, imported);
  for (const { item, reason } of imported.refused) {
    process.stderr.write(`Refused ${item}, so nothing was written for it: ${reason}\n`);
  }
  if (imported.refused.length > 0) process.exitCode = 1;
}

/** A value as JSON can hold it: a map as an object. */
const plainValues = (_: string, value: unknown) =>
  value instanceof Map ? Object.fromEntries(value) : value;

/** Whether `yes` or `no` says to include an item.  Anything else stops. */
function included(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'yes' || value === 'no') return value === 'yes';
  throw new SelectorError('--compile takes yes or no.');
}

/** The index among its parent's children to put an item at, when one is given. */
const place = (parent: BinderItem, index: string | undefined): BinderPlace =>
  index === undefined ? { parent } : { parent, index: Number(index) };

await runMain(
  defineCommand({
    meta: {
      name: 'scriv-tools',
      description:
        'Reads Scrivener 3 projects, compiles them to MultiMarkdown as Scrivener does, and edits them.',
    },
    subCommands: {
      new: defineCommand({
        meta: { description: 'Creates a blank project, with styles and a format of its own' },
        args: {
          name: { type: 'positional', description: "The project's name", required: true },
          folder: { type: 'string', description: 'The folder to put it in; here if left out' },
        },
        run({ args }) {
          const { dir } = createProject(args.folder ?? process.cwd(), args.name);
          process.stdout.write(`${dir}\n`);
        },
      }),
      compile: defineCommand({
        meta: {
          description: 'Compile the Draft folder with a compile format, images beside --output',
        },
        args: {
          project,
          format,
          author,
          'quiet-placeholders': quiet,
          output: { type: 'string', alias: 'o', description: 'Write here instead of stdout' },
        },
        run({ args }) {
          const { text, images } = compileWithImages(readModel(args.project, args.format), {
            ...args,
            onLeftAsWritten: leftAsWritten(args['quiet-placeholders']),
          });
          if (!args.output) {
            process.stdout.write(text);
            if (images.length > 0) process.stderr.write('Images are written only with --output.\n');
            return;
          }
          fs.writeFileSync(args.output, text, 'utf8');
          for (const { file, bytes } of images) {
            fs.writeFileSync(path.join(path.dirname(args.output), file), bytes);
          }
        },
      }),
      structure: defineCommand({
        meta: { description: 'The binder as JSON' },
        args: { project },
        run({ args }) {
          const opened = openProject(args.project);
          const structure = projectStructure(opened, projectDocuments(opened.dir));
          process.stdout.write(`${JSON.stringify(structure, null, 2)}\n`);
        },
      }),
      read: defineCommand({
        meta: { description: "One document's text, as the compile would emit it" },
        args: {
          project,
          id: { type: 'positional', description: "The document's binder id", required: true },
          format,
          author,
          'quiet-placeholders': quiet,
        },
        run({ args }) {
          const options = { ...args, onLeftAsWritten: leftAsWritten(args['quiet-placeholders']) };
          const model = readModel(args.project, args.format);
          const item = findItem(indexBinder(model.project.binder), args.id);
          process.stdout.write(readText(model, item, options));
        },
      }),
      find: defineCommand({
        meta: { description: `The items a selector names: ID, binder path, title.  ${SELECTOR}` },
        run({ args }) {
          const { model, selector } = selected(args);
          const { found } = select(model, selector);
          const index = indexBinder(model.project.binder);
          for (const item of found) {
            const title = (each: BinderItem) => adaptiveTitle(each, model.documents);
            const trail = [...ancestorsOf(index, item), item].map(title).join('/');
            process.stdout.write(`${item.id}\t${trail}\t${title(item)}\n`);
          }
        },
      }),
      export: defineCommand({
        meta: {
          description: `Writes items to <output>.md and <output>.json to edit.  ${FORMS}  ${COMPILED}  ${SELECTOR}`,
        },
        args: {
          mapping,
          format: {
            ...format,
            description: `${format.description}  Only the compiled text uses it.`,
          },
          author,
          output: {
            type: 'string',
            alias: 'o',
            description: 'The path, with no extension',
            required: true,
          },
        },
        run({ args }) {
          const { model, selector } = selected(args);
          const { found, places } = select(model, selector);
          const roles = rolesOf(model, args.mapping);
          const items = readItems(model, found, places);
          const compiles = itemCompiles(model.project, args.format, args);
          if ('stopped' in compiles) {
            process.stderr.write(`No item shows its compiled text: ${compiles.stopped}\n`);
          }
          fs.writeFileSync(`${args.output}.md`, markdownItems(items, roles, compiles), 'utf8');
          const structured = structuredItems(items, roles, compiles);
          fs.writeFileSync(
            `${args.output}.json`,
            `${JSON.stringify(structured, null, 2)}\n`,
            'utf8',
          );
        },
      }),
      import: defineCommand({
        meta: {
          description: `Takes an edited file back into the items and saves them: scriv-tools import <project> <selector> <file>.  It reads the items again first, and writes nothing if any change cannot be made.  It takes only each item's own words: an item whose compiled text was changed is refused and nothing is written for it; the other items are saved, and then the command fails.  ${FORMS}`,
        },
        args: { mapping },
        run({ args }) {
          const { model, selector } = selected(args, 1);
          const { found, places } = select(model, selector);
          const file = args._.at(-1)!;
          const roles = rolesOf(model, args.mapping);
          const items = readItems(model, found, places);
          const content = fs.readFileSync(file, 'utf8');
          if (!file.endsWith('.json')) {
            saveImport(model, markdownEdits(model, items, content, roles));
            return;
          }
          const structured: ItemParagraphs[] = JSON.parse(content);
          saveImport(model, structuredEdits(model, items, structured, roles));
        },
      }),
      ingest: defineCommand({
        meta: {
          description: `Takes a Markdown file or folder in under the item a selector names, and saves: scriv-tools ingest <project> <selector> <path>.  A file updates its item, changing only what differs, or becomes a new one; a folder becomes a folder.  Every change maps or nothing is saved.  ${SELECTOR}`,
        },
        args: {
          mapping,
          field: {
            type: 'string',
            description: "A custom field's ID holding each file's path, to find its item by",
          },
        },
        run({ args }) {
          const { model, selector } = selected(args, 1);
          const parent = onlyItem(model, selector);
          const source = args._.at(-1)!;
          const roles = rolesOf(model, args.mapping);
          saveEdits(model, ingestMarkdown(model, parent, source, roles, args.field));
        },
      }),
      files: defineCommand({
        meta: { description: "The project's other files, as typed JSON" },
        args: { project },
        run({ args }) {
          const { unsupported: _, ...files } = readProjectFiles(args.project);
          process.stdout.write(`${JSON.stringify(files, plainValues, 2)}\n`);
        },
      }),
      snapshots: defineCommand({
        meta: { description: `The snapshots of the item a selector names.  ${SELECTOR}` },
        args: { take: { type: 'string', description: 'Takes a snapshot first, with this title' } },
        run({ args }) {
          const { model, selector } = selected(args);
          const { id } = onlyItem(model, selector);
          const { dir } = model.project;
          if (args.take !== undefined) {
            const rtf = fs.readFileSync(
              path.join(dir, 'Files', 'Data', id, 'content.rtf'),
              'latin1',
            );
            addSnapshot(dir, id, { title: args.take, date: dateStamp(new Date()) }, rtf);
          }
          process.stdout.write(`${JSON.stringify(readSnapshots(dir, id), null, 2)}\n`);
        },
      }),
      add: defineCommand({
        meta: {
          description: `Adds a text or folder under the item a selector names.  ${SELECTOR}`,
        },
        args: {
          folder: { type: 'boolean', description: 'Add a folder, not a text' },
          title: { type: 'string', description: "The item's title" },
          index: {
            type: 'string',
            description: "Its place among the item's children; last if left out",
          },
        },
        run({ args }) {
          const { model, selector } = selected(args);
          const parent = onlyItem(model, selector);
          const type = args.folder ? 'Folder' : 'Text';
          const item = addItem(type, args.title, place(parent, args.index));
          save(model.project);
          process.stdout.write(`${item.id}\n`);
        },
      }),
      move: defineCommand({
        meta: { description: `Moves the item a selector names under another.  ${SELECTOR}` },
        args: {
          to: { type: 'string', description: 'A selector for the new parent', required: true },
          index: { type: 'string', description: 'Its place there; last if left out' },
        },
        run({ args }) {
          const { model, selector } = selected(args);
          const parent = onlyItem(model, parseSelector([args.to]));
          moveItem(model.project, onlyItem(model, selector), place(parent, args.index));
          save(model.project);
        },
      }),
      trash: defineCommand({
        meta: { description: `Moves the item a selector names to the Trash.  ${SELECTOR}` },
        run({ args }) {
          const { model, selector } = selected(args);
          trashItem(model.project, onlyItem(model, selector));
          save(model.project);
        },
      }),
      set: defineCommand({
        meta: {
          description: `Changes the item a selector names: only what is given changes.  ${SELECTOR}`,
        },
        args: {
          field: { type: 'string', description: "A custom field's ID" },
          value: { type: 'string', description: "The field's value; cleared if left out" },
          title: { type: 'string', description: "The item's title" },
          synopsis: { type: 'string', description: "The item's synopsis" },
          notes: { type: 'string', description: "The item's notes, in place of what they hold" },
          label: { type: 'string', description: 'A label by name; "" clears it' },
          status: { type: 'string', description: 'A status by name; "" clears it' },
          section: { type: 'string', description: 'A section type by name; "" follows structure' },
          compile: { type: 'string', description: 'Whether the compile includes it: yes or no' },
        },
        run({ args }) {
          const { model, selector } = selected(args);
          const { project: opened, documents } = model;
          const item = onlyItem(model, selector);
          const { field, value, title, synopsis, notes, label, status, section } = args;
          if (field !== undefined) setCustomField(opened, item, field, value);
          const include = included(args.compile);
          const change = changeItem(opened, documents, item, {
            ...(title === undefined ? {} : { title }),
            ...(label === undefined ? {} : { label }),
            ...(status === undefined ? {} : { status }),
            ...(section === undefined ? {} : { section }),
            ...(include === undefined ? {} : { include }),
            ...(synopsis === undefined ? {} : { synopsis }),
            ...(notes === undefined ? {} : { notes }),
          });
          save(opened, new Map([[item.id, change]]));
        },
      }),
      formats: defineCommand({
        meta: { description: 'The compile formats the CLI can find' },
        args: { project },
        run({ args }) {
          const lines = listFormats(openProject(args.project)).map(
            (found) => `${found.name}\t${found.source}\t${found.file}`,
          );
          process.stdout.write(`${lines.join('\n')}\n`);
        },
      }),
    },
  }),
);
