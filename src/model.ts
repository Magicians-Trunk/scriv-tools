import type { CompiledImage } from './resolve-markup.ts';
import { type CompileFormat, findFormat } from './compile-format.ts';
import {
  type CompileSettings,
  type FormatAssignment,
  readAssignment,
  readSettings,
} from './compile-settings.ts';
import { type Documents, projectDocuments } from './document.ts';
import { type BinderIndex, indexBinder, openProject, type Project } from './project.ts';
import { type Replacement } from './replacements.ts';

/**
 * A Scrivener project as the compile sees it: the binder (`project`), where its documents come
 * from, the project's compile settings, and the compile format.  The compile reads nothing else,
 * so a changed model compiles as Scrivener would compile the changed project.
 */
export interface ScrivenerModel {
  project: Project;
  documents: Documents;
  settings: CompileSettings;
  format: CompileFormat;
  /** The project's layout for each section type, and front matter, for the format. */
  assignment: FormatAssignment;
}

/** A model as one compile reads it: with its binder indexed, and every replacement in order. */
export interface CompileInput extends ScrivenerModel {
  index: BinderIndex;
  replacements: Replacement[];
  /** The images the compile has come to, by name. */
  images: Map<string, CompiledImage>;
}

/**
 * Reads a project, with its compile settings and format (a name, file name or path; the last one
 * used when not given).  Its documents are read from the project's files as they are needed.
 */
export function readModel(input: string | Project, format?: string): ScrivenerModel {
  const project = typeof input === 'string' ? openProject(input) : input;
  const settings = readSettings(project);
  const found = findFormat(project, format, settings.lastUsedFormat);
  return {
    project,
    documents: projectDocuments(project.dir, project.files),
    settings,
    format: found,
    assignment: readAssignment(project, found),
  };
}

/** The model as a compile reads it, the binder as it is now. */
export function compileInput(model: ScrivenerModel): CompileInput {
  return {
    ...model,
    index: indexBinder(model.project.binder),
    replacements: [...model.settings.replacements, ...model.format.replacements],
    images: new Map(),
  };
}
