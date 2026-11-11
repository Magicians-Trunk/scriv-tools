import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { scrivxFile, writeScrivx } from './scrivx.ts';
import { newUnread, unreadList } from './xml-codec.ts';
import { readXml } from './xml.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');

const scrivxFiles = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.scriv'))
  .map((name) => {
    const folder = path.join(FIXTURES, name);
    return path.join(
      folder,
      fs.readdirSync(folder).find((file) => file.endsWith('.scrivx'))!,
    );
  });

describe('scrivxFile and writeScrivx', () => {
  it('write every fixture project file back as Scrivener wrote it, knowing all of it', () => {
    const changed = scrivxFiles.filter((file) => {
      const found = newUnread();
      const written = writeScrivx(scrivxFile.read(readXml(file, 'ScrivenerProject'), found));
      return unreadList(found).length > 0 || written !== fs.readFileSync(file, 'utf8');
    });
    expect(changed).toEqual([]);
  });
});
