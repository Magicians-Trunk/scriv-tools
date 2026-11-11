/**
 * The look of plain text in a document with none to copy.  Scrivener takes it from a Mac
 * preference the project does not hold, so it is taken from the project: the nearest plain text in
 * the binder, else the format the project's preferences store.
 */
import * as path from 'pathe';
import { type Documents, type DocumentText, rtfText } from './document.ts';
import { firstText, plainNeighbour } from './edit-pieces.ts';
import { flatten, type Project } from './project.ts';
import type { CharacterFormat, ParagraphFormat } from './rich-text.ts';
import { element, newUnread, optionalTextChild } from './xml-codec.ts';
import { readXml } from './xml.ts';

export interface PlainLook {
  format: ParagraphFormat;
  character: CharacterFormat;
}

const preferences = element<{ textFormat: DocumentText | undefined }>('ProjectPreferences', {
  textFormat: optionalTextChild('TextFormatRTFData', rtfText, true),
});

/** The look of a document's plain text nearest its start, when it has any. */
function lookIn(document: DocumentText): PlainLook | undefined {
  const paragraph = plainNeighbour(document, 0);
  const text = firstText(paragraph?.content ?? []);
  return paragraph && text && { format: paragraph.format, character: text.format };
}

/** The format the project's preferences store, whether or not they are switched on. */
function storedLook({ dir, files }: Pick<Project, 'dir' | 'files'>): PlainLook | undefined {
  const file = path.join(dir, 'Settings', 'projectpreferences.xml');
  if (!files.exists(file)) return undefined;
  const { textFormat } = preferences.read(readXml(file, preferences.name, files), newUnread());
  return textFormat && lookIn(textFormat);
}

/** The look plain text takes in an item with none of its own to copy. */
export function plainLook(
  { binder, dir, files }: Pick<Project, 'binder' | 'dir' | 'files'>,
  documents: Pick<Documents, 'text'>,
  item: string,
): PlainLook | undefined {
  const items = flatten(binder);
  const at = items.findIndex(({ id }) => id === item);
  const nearest = items
    .map(({ id }, index) => ({ id, distance: Math.abs(index - at) }))
    .toSorted((a, b) => a.distance - b.distance);
  for (const { id } of nearest) {
    const look = lookIn(documents.text(id));
    if (look) return look;
  }
  return storedLook({ dir, files });
}
