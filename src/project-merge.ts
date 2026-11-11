/**
 * A three-way merge of a project, on the model: base, ours and theirs, each as read.  Nothing here
 * reads git.  It is how a proposal lands late, and how a change is rejected: to take back a commit,
 * merge its parent over the project with the commit itself as the base.
 */
import { binderPlaces, type ProjectVersion } from './binder-compare.ts';
import { type FoundFormat, formatIn } from './compile-format.ts';
import { type Choose, mergeDocument } from './document-merge.ts';
import { compareDocument } from './document-compare.ts';
import type { DocumentPart, DocumentText } from './document.ts';
import type { EditConflict } from './edit-rebase.ts';
import { ownFormats, sharedStyles, styleFace } from './project-compare.ts';
import type { Project } from './project.ts';
import type { ProjectStyle } from './project-styles.ts';
import { same } from './rich-text.ts';
import type { ItemDocumentsChange, ProjectChanges } from './save.ts';
import { mergeScrivx, type ScrivxConflict } from './scrivx-merge.ts';
import { mergeKeyed, pick, type ValueConflict } from './value-compare.ts';

/** A place two changes could not be merged, each kind with what a person needs to choose. */
export type MergeConflict =
  | ScrivxConflict
  | { kind: 'document'; item: string; part: DocumentPart; conflict: EditConflict }
  /** The edits could be moved, and the document would not take them. */
  | { kind: 'refused'; item: string; part: DocumentPart; reason: string };

export interface MergedProject {
  /** What to pass `saveProject`, with `project` as the merged project. */
  project: Project;
  changes: ProjectChanges;
  conflicts: MergeConflict[];
}

/** Whether two versions of a document read as written the same. */
const sameFile = (a: DocumentText, b: DocumentText) =>
  a.source === b.source && same(a.styleIds, b.styleIds) && same(a.comments, b.comments);

const keyedFormats = (list: FoundFormat[]) => list.map((format) => ({ id: format.name, format }));

const sameFormat = (a: { format: FoundFormat }, b: { format: FoundFormat }) =>
  same(a.format.model, b.format.model);

function mergeFormats(
  base: FoundFormat[],
  ours: FoundFormat[],
  theirs: FoundFormat[],
  conflicts: ValueConflict[],
) {
  const merged = mergeKeyed(
    keyedFormats(base),
    keyedFormats(ours),
    keyedFormats(theirs),
    ['formats'],
    conflicts,
    sameFormat,
  );
  return merged.map(({ format }) => format);
}

/** What of a project two sides changed, on ours, a document at a time. */
function mergeItems(
  { base, ours, theirs }: Sides,
  project: Project,
  choose: Choose | undefined,
  conflicts: MergeConflict[],
) {
  const shared = { styles: project.styles, files: project.files };
  const documents = new Map<string, ItemDocumentsChange>();
  const held = (id: string) => documents.get(id) ?? {};
  const merged = binderPlaces({ project, documents: ours.documents });
  for (const id of merged.keys()) {
    for (const part of ['content', 'notes'] as const) {
      const was = base.documents.text(id, part);
      const mine = ours.documents.text(id, part);
      const other = theirs.documents.text(id, part);
      if (sameFile(was, other) || sameFile(mine, other)) continue;
      if (!compareDocument(shared, was, other).changed) continue;
      const result = mergeDocument(shared, was, mine, other, choose);
      for (const conflict of result.conflicts) {
        conflicts.push({ kind: 'document', item: id, part, conflict });
      }
      if (result.refused !== undefined) {
        conflicts.push({ kind: 'refused', item: id, part, reason: result.refused });
      }
      documents.set(id, { ...held(id), [part]: result.document });
    }
    const values: ValueConflict[] = [];
    const mine = ours.documents.synopsis(id);
    const other = theirs.documents.synopsis(id);
    const synopsis = pick(base.documents.synopsis(id), mine, other, ['synopsis', id], values);
    conflicts.push(...values);
    if (synopsis !== mine) documents.set(id, { ...held(id), synopsis });
  }
  return documents;
}

interface Sides {
  base: ProjectVersion;
  ours: ProjectVersion;
  theirs: ProjectVersion;
}

/**
 * Merges two versions of a project made from `base`, into ours, whose project takes the merged
 * binder and settings.  What conflicts stays as ours has it, unless `choose` says otherwise.
 */
export function mergeProjects(
  base: ProjectVersion,
  ours: ProjectVersion,
  theirs: ProjectVersion,
  choose?: Choose,
): MergedProject {
  const { project } = ours;
  const { merged, conflicts: scrivx } = mergeScrivx(base.project, project, theirs.project);
  const values: ValueConflict[] = [];
  const conflicts: MergeConflict[] = [...scrivx];
  const styled = sharedStyles(sharedProject(base.project, project), theirs.project);
  const equalStyles = (a: ProjectStyle, b: ProjectStyle) =>
    same(styleFace(styled, a), styleFace(styled, b));
  const styles = mergeKeyed(
    base.project.styles,
    project.styles,
    theirs.project.styles,
    ['styles'],
    values,
    equalStyles,
  );
  const compile = pick(
    base.project.compileSettings,
    project.compileSettings,
    theirs.project.compileSettings,
    ['compile'],
    values,
  );
  const was = ownFormats(project);
  const formats = mergeFormats(ownFormats(base.project), was, ownFormats(theirs.project), values);
  Object.assign(project, merged, { styles });
  if (compile) project.compileSettings = compile;
  conflicts.push(...values);
  const documents = mergeItems({ base, ours, theirs }, project, choose, conflicts);
  const kept = new Set(formats.map(({ name }) => name));
  const changed = formats
    .filter((format) => !same(was.find(({ name }) => name === format.name)?.model, format.model))
    .map((format) => formatIn(project, format));
  return {
    project,
    changes: {
      documents,
      formats: changed,
      removedFormats: was.filter(({ name }) => !kept.has(name)),
    },
    conflicts,
  };
}

/** A project with the styles of two: those only `was` has, as they were. */
const sharedProject = (was: Project, now: Project): Project => ({
  ...now,
  styles: sharedStyles(was, now).styles,
});
