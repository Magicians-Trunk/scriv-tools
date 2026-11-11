/** `Snapshots/<id>/`: a document's saved versions, each an RTF file named for its date. */
import { localFiles } from './local-files.ts';
import { type Files, latin1Bytes, latin1Text, textBytes } from './files.ts';
import * as path from 'pathe';
import {
  attribute,
  element,
  newUnread,
  optionalTextChild,
  repeated,
  string,
  textChild,
  writeXml,
} from './xml-codec.ts';
import { readXml } from './xml.ts';

/** A saved version of a document, as its index lists it. */
export interface Snapshot {
  title?: string;
  date: string;
  /** The IDs of the styles its RTF's markers number, comma-separated. */
  styleIds?: string;
}

const snapshot = element<Snapshot>('Snapshot', {
  title: optionalTextChild('Title', string),
  date: textChild('Date', string),
  styleIds: optionalTextChild('StyleIDs', string),
});

/** A snapshot's `index.xml`. */
export const snapshotsFile = element('Snapshots', {
  version: attribute('Version', string),
  snapshots: repeated(snapshot),
});

const folderOf = (dir: string, id: string) => path.join(dir, 'Snapshots', id);

/** A snapshot's date, as Scrivener stamps one. */
const SNAPSHOT_DATE =
  /^(?<day>\d{4}-\d{2}-\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) (?<zone>[+-]\d{4})$/;

/**
 * The file a snapshot's date names, its zone with its sign, east of Greenwich as west of it:
 * `2026-10-24 22:41:10 -0400` is `2026-10-24-22-41-10-0400`, and `+0100` stays `+0100`.  Any other
 * date stops.
 */
export function snapshotFile(date: string): string {
  const parts = SNAPSHOT_DATE.exec(date)?.groups;
  if (!parts) throw new Error(`Unreadable snapshot date: "${date}"`);
  const { day, hour, minute, second, zone } = parts;
  return `${day}-${hour}-${minute}-${second}${zone}.rtf`;
}

/** A document's snapshots, oldest first as the index holds them. */
export function readSnapshots(dir: string, id: string, files: Files = localFiles): Snapshot[] {
  const file = path.join(folderOf(dir, id), 'index.xml');
  if (!files.exists(file)) return [];
  return snapshotsFile.read(readXml(file, snapshotsFile.name, files), newUnread()).snapshots;
}

/** A snapshot's RTF. */
export function snapshotText(
  dir: string,
  id: string,
  { date }: Pick<Snapshot, 'date'>,
  files: Files = localFiles,
): string {
  return latin1Text(files.read(path.join(folderOf(dir, id), snapshotFile(date))));
}

/** Adds a snapshot of a document's RTF, as Scrivener files one. */
export function addSnapshot(
  dir: string,
  id: string,
  added: Snapshot,
  rtf: string,
  files: Files = localFiles,
): void {
  const folder = folderOf(dir, id);
  files.write(path.join(folder, snapshotFile(added.date)), latin1Bytes(rtf));
  const snapshots = [...readSnapshots(dir, id, files), added];
  const index = writeXml(snapshotsFile.write({ version: '1.0', snapshots }));
  files.write(path.join(folder, 'index.xml'), textBytes(index));
}
