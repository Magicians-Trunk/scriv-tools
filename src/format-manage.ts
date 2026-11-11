/**
 * What surrounds a format's design: adding styles, copying and deleting formats, and the section
 * types the project gives them.  These change the project; `saveProject` writes it.
 */
import {
  type FoundFormat,
  listFormats,
  MULTIMARKDOWN,
  projectFormatFile,
} from './compile-format.ts';
import { plainDocument } from './document.ts';
import { EditError } from './edit-pieces.ts';
import { newId } from './files.ts';
import { readFormatDesign } from './format-design.ts';
import { newStyleDesign, refuseOthers, setFormatDesign } from './format-edit.ts';
import { flatten, type Project } from './project.ts';
import type { ProjectStyle } from './project-styles.ts';
import type { SectionTypes } from './scrivx.ts';
import type { StyleRoles } from './style-mapping.ts';

/** A style for the project, plain until Scrivener gives it a look. */
export function addProjectStyle(project: Project, name: string, type: string): ProjectStyle {
  if (project.styles.some((style) => style.name === name)) {
    throw new EditError(`The project already has a style "${name}".`);
  }
  const style = { name, id: newId(), type, format: plainDocument('') };
  project.styles.push(style);
  return style;
}

/** What Scrivener's sample of a heading holds, with the level it says the style is. */
const headingSample = (level: number) => `<$Scr_H::${level}>Attributes<!$Scr_H::${level}>`;

/** The style a role names, added to the project: it has a heading's level if it is a heading. */
function addRoleStyle(project: Project, name: string, roles: StyleRoles): void {
  const depth = Object.keys(roles.headings).find((level) => roles.headings[+level] === name);
  if (name === roles.codeSpan) addProjectStyle(project, name, 'Char');
  else if (name === roles.code) addProjectStyle(project, name, 'Para+Char');
  else if (depth === undefined) addProjectStyle(project, name, 'Para');
  else addProjectStyle(project, name, 'Para+Char').format = plainDocument(headingSample(+depth));
}

/** Adds to the stylesheet any of these names that a role means and the project does not have. */
export function addMissingStyles(project: Project, names: string[], roles: StyleRoles): void {
  const wanted = new Set([
    ...Object.values(roles.headings),
    roles.quote,
    roles.code,
    roles.codeSpan,
  ]);
  for (const name of new Set(names)) {
    const held = project.styles.some((style) => style.name === name);
    if (!held && wanted.has(name)) addRoleStyle(project, name, roles);
  }
}

/**
 * Gives a style the digit of its shortcut, taking it from any style that has it, since a digit
 * means one style.  An empty digit leaves the style with none: no attribute, as a style Scrivener
 * never gave one has.
 */
export function setStyleShortcut(project: Project, name: string, digit: string): void {
  for (const style of project.styles) {
    if (style.name === name && digit !== '') style.shortcut = digit;
    else if (style.name === name || (digit !== '' && style.shortcut === digit)) {
      delete style.shortcut;
    }
  }
}

/** Gives a style its highlight box, or none: no attribute, as a style that never had one has. */
export function setStyleBox(project: Project, name: string, box: number[] | undefined): void {
  const style = project.styles.find((each) => each.name === name)!;
  if (box) style.box = box;
  else delete style.box;
}

/** Adds a style to a format, and to the project if it is new there too. */
export function addFormatStyle(
  project: Project,
  found: FoundFormat,
  name: string,
  type: string,
): void {
  refuseOthers(found);
  if (!project.styles.some((style) => style.name === name)) addProjectStyle(project, name, type);
  const { styles } = readFormatDesign(found);
  setFormatDesign(project, found, { styles: [...styles, newStyleDesign(name, type)] });
}

/**
 * A copy of a format in the project under a new name, going by the same choices, and made the one
 * last used.  It is not written until it is saved.
 */
export function duplicateFormat(project: Project, found: FoundFormat, name: string): FoundFormat {
  const id = newId();
  const file = projectFormatFile(project, name);
  if (listFormats(project).some((held) => held.name === name || held.file === file)) {
    throw new EditError(`The project already has a format "${name}".`);
  }
  const settings = project.compileSettings;
  const choices = settings?.formats.find((held) => held.id === found.id);
  if (choices) settings!.formats.push({ ...structuredClone(choices), id });
  if (settings) settings.lastUsedFormats[MULTIMARKDOWN] = id;
  found.model.name = name;
  found.model.id = id;
  return { ...found, name, id, file, source: 'project' };
}

/**
 * Takes a format out of the project: its choices go, and the next format left becomes the one
 * last used.  `saveProject` removes its file, given it in `removedFormats`.
 */
export function deleteFormat(project: Project, found: FoundFormat): void {
  refuseOthers(found);
  const others = listFormats(project).filter(({ id }) => id !== found.id);
  if (others.length === 0) throw new EditError('A project needs a format to compile with.');
  const settings = project.compileSettings;
  if (!settings) return;
  settings.formats = settings.formats.filter(({ id }) => id !== found.id);
  if (settings.lastUsedFormats[MULTIMARKDOWN] === found.id) {
    settings.lastUsedFormats[MULTIMARKDOWN] = others[0]!.id;
  }
}

/** The section types and how the binder's structure picks them. */
export type SectionTypesDesign = SectionTypes;

/** Stops if an item has a section type set by hand that is going. */
function refuseUsedTypes(project: Project, kept: Set<string>) {
  for (const item of flatten(project.binder)) {
    const chosen = item.metadata?.sectionType?.id;
    if (chosen && !kept.has(chosen)) {
      const type = project.sectionTypes.definitions.find(({ id }) => id === chosen);
      throw new EditError(`The section type "${type?.name}" is still set on "${item.title}".`);
    }
  }
}

/** Changes the section types, and which the binder's structure gives each level; a type gone
 * from the list goes from the levels and the formats' choices with it. */
export function setSectionTypes(project: Project, design: SectionTypesDesign): void {
  const kept = new Set(design.definitions.map(({ id }) => id));
  refuseUsedTypes(project, kept);
  const stays = (ids: string[]) => ids.filter((id) => kept.has(id));
  const { folders, containers, files } = design.levels;
  project.sectionTypes = {
    definitions: design.definitions,
    levels: { folders: stays(folders), containers: stays(containers), files: stays(files) },
  };
  for (const format of project.compileSettings?.formats ?? []) {
    format.sectionLayouts = format.sectionLayouts.filter(({ typeId }) => kept.has(typeId));
  }
}
