/** Binder items for test projects: each item's `.scrivx` entry and the files in its data folder. */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  BinderItem,
  BinderItemType,
  ItemMetadata,
  ItemSectionType,
} from '../src/binder-item.ts';
import { readDocumentText, writeComments } from '../src/document.ts';
import { newUnread } from '../src/xml-codec.ts';
import { rtfDocument } from './rtf-builder.ts';

export interface ItemSpec {
  /** A fixed binder ID, for links and tests that point at the item. */
  id?: string;
  title?: string;
  type?: BinderItemType;
  /** The RTF body (see `rtf-builder.ts`). */
  text?: string;
  /** Style names, in the order the text's `<$Scr_…::n>` markers number them. */
  styles?: string[];
  synopsis?: string;
  /** The RTF body of the item's notes. */
  notes?: string;
  comment?: { id: string; text: string };
  label?: string;
  status?: string;
  /** A section type's name, chosen by hand. */
  section?: string;
  /** The section type's name for the item's subdocuments. */
  childSection?: string;
  /** Custom metadata values, by field ID. */
  custom?: Record<string, string>;
  include?: boolean;
  /** The IDs of the item's keywords. */
  keywords?: string[];
  children?: ItemSpec[];
}

/** The project's IDs for the section type and style names items use. */
export interface ProjectIds {
  section: (name: string) => string;
  style: (name: string) => string;
}

const STAMP = '2026-10-31 01:13:04 -0400';

/** A PDF of one blank page, its cross-reference table giving each object's offset. */
function blankPdf(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const table = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table.join('')}`;
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
}

export const uuid = () => randomUUID().toUpperCase();

function sectionType(item: ItemSpec, ids: ProjectIds): ItemSectionType | undefined {
  const { section, childSection } = item;
  if (section === undefined && childSection === undefined) return undefined;
  const chosen: ItemSectionType = { id: section === undefined ? '' : ids.section(section) };
  if (childSection !== undefined) chosen.childDefault = ids.section(childSection);
  return chosen;
}

/** The files in the item's data folder, by name. */
function itemFiles(item: ItemSpec, ids: ProjectIds): [string, string][] {
  const files: [string, string][] = [];
  if (item.type === 'PDF') files.push(['content.pdf', blankPdf()]);
  if (item.text !== undefined) files.push(['content.rtf', rtfDocument(item.text)]);
  if (item.styles) files.push(['content.styles', item.styles.map(ids.style).join(',')]);
  if (item.synopsis !== undefined) files.push(['synopsis.txt', item.synopsis]);
  if (item.notes !== undefined) files.push(['notes.rtf', rtfDocument(item.notes)]);
  if (item.comment) {
    const text = readDocumentText(rtfDocument(item.comment.text));
    const comment = { id: item.comment.id, collapsed: false, color: [0.98, 0.86, 0.36], text };
    files.push([
      'content.comments',
      writeComments({ comments: [comment], unsupported: newUnread() }),
    ]);
  }
  return files;
}

/** Writes the item's files, and its children's, into `project` and returns its binder item. */
export function binderItem(project: string, item: ItemSpec, ids: ProjectIds): BinderItem {
  const id = item.id ?? uuid();
  const files = itemFiles(item, ids);
  const folder = path.join(project, 'Files', 'Data', id);
  if (files.length > 0) fs.mkdirSync(folder, { recursive: true });
  for (const [file, content] of files) {
    fs.writeFileSync(path.join(folder, file), content, 'latin1');
  }
  const type = item.type ?? 'Text';
  const metadata: ItemMetadata = {
    includeInCompile: item.include !== false,
    custom: item.custom ?? {},
  };
  const chosen = sectionType(item, ids);
  if (chosen) metadata.sectionType = chosen;
  if (item.label !== undefined) metadata.labelId = item.label;
  if (item.status !== undefined) metadata.statusId = item.status;
  if (type === 'PDF') metadata.fileExtension = 'pdf';
  const written: BinderItem = {
    id,
    type,
    created: STAMP,
    modified: STAMP,
    metadata,
    keywords: item.keywords ?? [],
    bookmarks: [],
    children: (item.children ?? []).map((descendant) => binderItem(project, descendant, ids)),
  };
  if (item.title !== undefined) written.title = item.title;
  if (type === 'PDF') written.mediaSettings = { currentPdfPage: 0 };
  if (type === 'Text') written.textSettings = { textSelection: [0, 0] };
  return written;
}
