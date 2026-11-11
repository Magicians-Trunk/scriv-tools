/**
 * A three-way merge of a document, on the model: the edits from the base to each side, theirs
 * rebased over ours and made on ours.  Different paragraphs both apply, and different words of one
 * paragraph; the same words conflict.
 */
import { documentEdits, makeEdits } from './document-edits.ts';
import type { DocumentText } from './document.ts';
import { EditError, type Styles } from './edit-pieces.ts';
import { type EditConflict, rebaseEdits } from './edit-rebase.ts';
import type { DocumentEdit } from './editable.ts';

/** A person's choice of a side in a conflict; none leaves it a conflict, as ours has it. */
export type Choose = (conflict: EditConflict) => 'ours' | 'theirs' | undefined;

export interface MergedDocument {
  document: DocumentText;
  conflicts: EditConflict[];
  /** What stopped theirs being made, when the edits could be moved but the document refused. */
  refused?: string;
}

/** Merges two versions of a document made from `base`.  What conflicts stays as ours has it. */
export function mergeDocument(
  project: Styles,
  base: DocumentText,
  ours: DocumentText,
  theirs: DocumentText,
  choose: Choose = () => undefined,
): MergedDocument {
  const mine = documentEdits(project, base, ours);
  const other = documentEdits(project, base, theirs);
  const first = rebaseEdits(other, mine);
  const lost = new Set(
    first.conflicts.filter((each) => choose(each) === 'theirs').map(({ over }) => over),
  );
  const over: DocumentEdit[] = mine.filter((edit) => !lost.has(edit));
  const { edits, conflicts } = lost.size > 0 ? rebaseEdits(other, over) : first;
  const document = structuredClone(lost.size > 0 ? base : ours);
  if (lost.size > 0) makeEdits(project, document, over);
  const unsettled = conflicts.filter((each) => choose(each) === undefined);
  const made = structuredClone(document);
  try {
    makeEdits(project, made, edits);
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return { document, conflicts: unsettled, refused: error.message };
  }
  return { document: made, conflicts: unsettled };
}
