/**
 * Taking Markdown files into a project: a file updates the item it belongs to, or becomes a new
 * one, and a folder becomes a folder.  Each file goes through the Markdown form, so it changes
 * only what differs, and every file reads or none is taken in.
 */
import { readText } from './files.ts';
import * as path from 'pathe';
import { addItem, setCustomField } from './binder-edit.ts';
import type { BinderItem } from './binder-item.ts';
import type { EditingModel } from './editable.ts';
import { blockEdits, type FormEdits, markdownBlocks, readItems } from './item-forms.ts';
import { flatten } from './project.ts';
import type { StyleRoles } from './style-mapping.ts';

/** A file's place in a project. */
interface Placed {
  item: BinderItem;
  file: string;
}

/** What taking files in comes to. */
export interface Ingested extends FormEdits {
  /** The titles of the items added to the binder. */
  added: string[];
}

/** The extension of what is taken in. */
const MARKDOWN = '.md';

/** A title from a file's name. */
const titleOf = (file: string) => path.basename(file, MARKDOWN);

/** The item a file belongs to: by its custom field when given one, else by title in its folder. */
function itemFor(
  model: EditingModel,
  parent: BinderItem,
  file: string,
  relative: string,
  field: string | undefined,
  added: string[],
): BinderItem {
  const title = titleOf(file);
  const found =
    field === undefined
      ? parent.children.find((item) => item.title === title)
      : flatten(model.project.binder).find((item) => item.metadata?.custom[field] === relative);
  if (found) return found;
  const made = addItem('Text', title, { parent });
  if (field !== undefined) setCustomField(model.project, made, field, relative);
  added.push(title);
  return made;
}

/** The folder under a parent with this title, made if it is not there. */
function folderFor(parent: BinderItem, title: string, added: string[]): BinderItem {
  const found = parent.children.find((item) => item.title === title);
  if (found) return found;
  added.push(title);
  return addItem('Folder', title, { parent });
}

/** Every Markdown file under a folder, with its item, in name order. */
function walk(
  model: EditingModel,
  parent: BinderItem,
  folder: string,
  root: string,
  field: string | undefined,
  added: string[],
): Placed[] {
  const { files } = model.project;
  return files
    .list(folder)
    .toSorted((a, b) => a.localeCompare(b))
    .flatMap((name): Placed[] => {
      const file = path.join(folder, name);
      if (files.isDirectory(file)) {
        return walk(model, folderFor(parent, name, added), file, root, field, added);
      }
      if (path.extname(name) !== MARKDOWN) return [];
      const relative = path.relative(root, file);
      return [{ item: itemFor(model, parent, file, relative, field, added), file }];
    });
}

/** An item alone, so it reads as one document whatever is under it. */
const alone = (item: BinderItem): BinderItem => ({ ...item, children: [] });

/**
 * Takes a Markdown file, or a folder of them, in under `parent`.  `field` names a custom field that
 * holds each file's path from the folder, which finds its item wherever it has moved to.  New
 * items are in the binder when this returns; the edits are for `applyEdits`.
 */
export function ingestMarkdown(
  model: EditingModel,
  parent: BinderItem,
  source: string,
  roles: StyleRoles,
  field?: string,
): Ingested {
  const added: string[] = [];
  const { files } = model.project;
  const placed = files.isDirectory(source)
    ? walk(model, parent, source, source, field, added)
    : [
        {
          item: itemFor(model, parent, source, path.basename(source), field, added),
          file: source,
        },
      ];
  const items = readItems(
    model,
    placed.map(({ item }) => alone(item)),
  );
  const read = placed.map(({ item, file }) => ({
    item: item.id,
    ...markdownBlocks(readText(files, file)),
  }));
  const problems = read.flatMap((each) => each.problems);
  if (problems.length > 0) return { edits: [], problems, added };
  const groups = read.map(({ item, blocks }) => ({ item, blocks }));
  // Every change is made or none is: an item its edits would not give its file stops them all.
  const { edits, refused } = blockEdits(model, items, groups, roles);
  const stopped = refused.map(({ item, reason }) => `${item}: ${reason}`);
  return { edits: stopped.length > 0 ? [] : edits, problems: stopped, added };
}
