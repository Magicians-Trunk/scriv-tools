import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { textBytes } from './files.ts';
import { memoryFiles } from './memory-files.ts';
import type { Paragraph } from './edit-markers.ts';
import { readPlist, writePlist } from './plist.ts';
import {
  readBinderBackup,
  readProjectFiles,
  writeBinderBackup,
  writeProjectFiles,
} from './project-files.ts';
import { writeScrivx } from './scrivx.ts';
import { openProject } from './project.ts';
import {
  checksumKey,
  checksumOf,
  indexedText,
  readChecksums,
  writeChecksums,
} from './search-index.ts';
import { readIni, writeIni, writeJson } from './settings-forms.ts';
import { addSnapshot, readSnapshots, snapshotFile, snapshotText } from './snapshots.ts';
import { uiStateFile } from './ui-state.ts';
import { newUnread, writeXml } from './xml-codec.ts';
import { parseXml } from './xml.ts';

const put = (dir: string, file: string, text: string) => {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
};

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

const SIDE_FILES: Record<string, string> = {
  'Files/version.txt': '23',
  'Settings/recents.txt': 'A\nB',
  'Files/Data/docs.checksum': 'a/content.rtf=abc\nb/synopsis.txt=def',
  'Settings/ui.ini': '[General]\nshow=true\nstate=@ByteArray(\\x1=)\n\n[Layout]\nsize=2\n',
  'Settings/mobile.settings': '{\n  "On" : true,\n  "List" : [\n    "a"\n  ],\n  "Scale" : 1.2\n}',
  'Settings/mobile-outline.states':
    '{\n  "$ROOT" : [\n\n  ],\n  "Empty" : {\n\n  },\n  "None" : null\n}',
  'Files/search.indexes': `${XML}<SearchIndexes Version="1.0">
    <Documents>
        <Document ID="A">
            <Title>A</Title>
            <Synopsis>short</Synopsis>
            <Text>words</Text>
            <Notes>noted</Notes>
            <Comments>said</Comments>
        </Document>
    </Documents>
</SearchIndexes>`,
  'Settings/projectpreferences.xml': `${XML}<ProjectPreferences Version="1.0">
    <UseProjectPreferences>No</UseProjectPreferences>
    <UseCustomFootnotesFont>No</UseCustomFootnotesFont>
    <FootnotesFont Size="10.0">Courier</FootnotesFont>
    <FootnoteMarker UseMarker="No">*</FootnoteMarker>
</ProjectPreferences>`,
  'Settings/favorites.xml': `${XML}<Favorites Version="1.0">
    <MoveTo>
        <Recent>
            <UUID Date="2025-08-26 18:27:24 +0200">A</UUID>
        </Recent>
        <Popular>
            <UUID Used="4" Date="2025-08-26 18:27:24 +0200">A</UUID>
        </Popular>
    </MoveTo>
</Favorites>`,
  'Settings/templateinfo.xml': `${XML}<TemplateSettings Version="1.0">
    <Title>Blank</Title>
    <Category>Blank</Category>
    <CustomImageData Type="Base64">TU0=</CustomImageData>
</TemplateSettings>`,
  'Settings/User/folder-sync.settings': `${XML}<FolderSyncSettings Version="1.0">
    <takesSnapshots Type="Bool">Yes</takesSnapshots>
    <folderPath Type="String"/>
</FolderSyncSettings>`,
  'Settings/ui-common.xml': `${XML}<UIStates>
    <Split>None</Split>
    <BinderAffects>Current</BinderAffects>
</UIStates>`,
  'Files/writing.history': `${XML}<WritingHistory>
    <Day dwc="0" dcc="0" dtwc="298" owc="110" occ="570" dtcc="1771">2026-04-15</Day>
</WritingHistory>`,
};

const PLIST = `${XML}<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Empty</key>
	<dict/>
	<key>Items &amp; more</key>
	<array>
		<string>a &lt; b</string>
		<string></string>
		<integer>3</integer>
		<real>2.54</real>
		<true/>
		<false/>
		<date>2026-01-01T00:00:00Z</date>
		<array/>
	</array>
	<key>Font</key>
	<data>
	${'A'.repeat(68)}
	${'B'.repeat(4)}
	</data>
</dict>
</plist>
`;

function project() {
  const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] });
  for (const [file, text] of Object.entries(SIDE_FILES)) put(dir, file, text);
  put(dir, 'Settings/ui.plist', PLIST);
  put(dir, 'QuickLook/Preview.html', '<html></html>');
  put(dir, 'Icons/b.tiff', '');
  put(dir, 'Icons/a.png', '');
  return dir;
}

describe('readProjectFiles', () => {
  it('reads every file into its types', () => {
    const files = readProjectFiles(project());
    expect(files.version).toBe(23);
    expect(files.recents).toEqual(['A', 'B']);
    expect(files.checksums?.get('a/content.rtf')).toBe('abc');
    expect(files.searchIndex?.documents[0]).toMatchObject({ id: 'A', synopsis: 'short' });
    expect(files.favorites?.moveTo?.popular[0]).toMatchObject({ used: 4, item: 'A' });
    expect(files.templateInfo?.title).toBe('Blank');
    expect(files.folderSync?.takesSnapshots).toEqual({ type: 'Bool', value: 'Yes' });
    expect(files.writingHistory?.days[0]).toMatchObject({ dtwc: 298, date: '2026-04-15' });
    expect(files.preferences?.footnotesFont?.name).toBe('Courier');
    expect(files.uiIni?.map(({ name }) => name)).toEqual(['General', 'Layout']);
    expect(files.mobileSettings).toMatchObject({ On: true, Scale: 1.2 });
    expect(files.uiPlist).toBeInstanceOf(Map);
    expect(files.preview).toBe('<html></html>');
    expect(files.icons).toEqual(['a.png', 'b.tiff']);
  });

  it('reads nothing of files a project does not have', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-files-'));
    expect(readProjectFiles(dir)).toEqual({ unsupported: new Map() });
  });
});

describe('writeProjectFiles', () => {
  it('writes nothing when nothing changed', () => {
    const dir = project();
    expect(writeProjectFiles(dir, readProjectFiles(dir))).toEqual([]);
  });

  it('writes a changed file as it was written, and only that one', () => {
    const dir = project();
    const files = readProjectFiles(dir);
    files.version = 24;
    files.writingHistory!.days[0]!.dwc = 5;
    const written = writeProjectFiles(dir, files).map((file) => path.relative(dir, file));
    expect(written.toSorted()).toEqual(['Files/version.txt', 'Files/writing.history']);
    expect(fs.readFileSync(path.join(dir, 'Files/writing.history'), 'utf8')).toBe(
      SIDE_FILES['Files/writing.history']!.replace('dwc="0"', 'dwc="5"'),
    );
  });

  it('writes each file back as it read it', () => {
    const dir = project();
    const files = readProjectFiles(dir);
    for (const file of Object.keys(SIDE_FILES)) fs.rmSync(path.join(dir, file));
    fs.rmSync(path.join(dir, 'Settings/ui.plist'));
    writeProjectFiles(dir, files);
    for (const [file, text] of Object.entries(SIDE_FILES)) {
      expect(fs.readFileSync(path.join(dir, file), 'utf8')).toBe(text);
    }
    expect(fs.readFileSync(path.join(dir, 'Settings/ui.plist'), 'utf8')).toBe(PLIST);
  });

  it('stops on a changed file holding what its model does not know', () => {
    const dir = project();
    const file = 'Files/writing.history';
    put(dir, file, SIDE_FILES[file]!.replace('<Day ', '<Day extra="1" '));
    const files = readProjectFiles(dir);
    files.writingHistory!.days[0]!.dwc = 5;
    files.version = 24;
    expect(() => writeProjectFiles(dir, files)).toThrow('extra');
    expect(readProjectFiles(dir).version).toBe(23);
  });
});

describe('property lists', () => {
  it('writes a list as it read it', () => {
    expect(writePlist(readPlist(PLIST))).toBe(PLIST);
  });

  it('reads only the text of a string', () => {
    const read = readPlist('<plist><string>a<b/>c</string></plist>');
    expect(read).toEqual({ kind: 'string', value: 'ac' });
  });

  it('stops on what is no property list', () => {
    expect(() => readPlist(`${XML}<other/>`)).toThrow('not a property list');
    expect(() => readPlist('<plist><thing/></plist>')).toThrow('cannot hold <thing>');
  });
});

describe('settings forms', () => {
  it('keeps every key of an INI section, in the line ends asked for', () => {
    const sections = readIni('[A]\r\nb=c=d\r\n\r\n[E]\r\nf=g\r\n');
    expect(sections[0]?.entries).toEqual([['b', 'c=d']]);
    expect(writeIni(sections, '\r\n')).toBe('[A]\r\nb=c=d\r\n\r\n[E]\r\nf=g\r\n');
    expect(readIni('stray=1\n')).toEqual([]);
  });

  it('writes JSON as Apple does', () => {
    expect(writeJson({ a: [1, { b: 'c' }] })).toBe(
      '{\n  "a" : [\n    1,\n    {\n      "b" : "c"\n    }\n  ]\n}',
    );
  });
});

describe('indexed text', () => {
  it('writes each paragraph on a line, a list item with its marker', () => {
    const format = {};
    const end: Paragraph['end'] = { kind: 'paragraph', format };
    const paragraphs: Paragraph[] = [
      { format, end, content: [{ kind: 'text', text: 'plain', format }] },
      {
        format,
        end,
        marker: [{ text: '\t•\t', format }],
        content: [{ kind: 'text', text: 'item', format }],
      },
    ];
    expect(indexedText({ paragraphs }, { dir: '/p.scriv', files: memoryFiles() })).toBe(
      'plain\n\t•\titem',
    );
  });

  it('writes a linked image only when its file is not there, as the compile does', () => {
    const format = {};
    const source = '{$SCRImageLink[w:1;h:1]=gone.png}';
    const image = { kind: 'image' as const, path: 'gone.png', source, format };
    const end: Paragraph['end'] = { kind: 'paragraph', format };
    const content = [{ kind: 'text' as const, text: 'a ', format }, image];
    const document = { paragraphs: [{ format, end, content }] };
    const files = memoryFiles();
    const dir = '/here/p.scriv';
    expect(indexedText(document, { dir, files })).toBe('a MISSING_IMAGE:gone.png');
    files.write('/here/gone.png', textBytes('x'));
    expect(indexedText(document, { dir, files })).toBe('a ');
  });
});

describe('checksums', () => {
  it('reads and writes the file, with keys in lower case', () => {
    const sums = readChecksums('a/content.rtf=1\nb/content.rtf=2\n');
    expect(writeChecksums(sums)).toBe('a/content.rtf=1\nb/content.rtf=2');
    expect(checksumKey('ABC', 'content.rtf')).toBe('abc/content.rtf');
    expect(checksumOf(textBytes('a'))).toBe('86f7e437faa5a7fce15d1ddcb9eaeaea377667b8');
  });
});

describe('snapshots', () => {
  const date = '2026-10-24 22:41:10 -0400';

  it('names a snapshot for its date', () => {
    expect(snapshotFile(date)).toBe('2026-10-24-22-41-10-0400.rtf');
    expect(snapshotFile('2026-10-24 22:41:10 +0530')).toBe('2026-10-24-22-41-10+0530.rtf');
    expect(snapshotFile('2026-10-24 22:41:10 +0000')).toBe('2026-10-24-22-41-10+0000.rtf');
    expect(() => snapshotFile('yesterday')).toThrow('Unreadable snapshot date');
  });

  it('has none until one is taken, then reads it and its text back', () => {
    const dir = project();
    expect(readSnapshots(dir, 'A')).toEqual([]);
    addSnapshot(dir, 'A', { title: 'Before', date }, '{\\rtf1 old}');
    addSnapshot(dir, 'A', { date: '2026-10-25 01:00:00 -0400', styleIds: 'X,Y' }, '{\\rtf1 new}');
    const snapshots = readSnapshots(dir, 'A');
    expect(snapshots.map(({ title }) => title)).toEqual(['Before', undefined]);
    expect(snapshots[1]?.styleIds).toBe('X,Y');
    expect(snapshotText(dir, 'A', snapshots[0]!)).toBe('{\\rtf1 old}');
  });
});

describe('binder backups', () => {
  it('reads the project a backup holds', () => {
    const dir = project();
    const file = path.join(dir, 'Files', 'binder.backup');
    const opened = openProject(dir);
    writeBinderBackup(file, 'fixture.scrivx', writeScrivx(opened));
    expect(readBinderBackup(file).binder[0]?.type).toBe('DraftFolder');
  });

  it('stops on a backup with no project in it', () => {
    const dir = project();
    const file = path.join(dir, 'Files', 'binder.backup');
    writeBinderBackup(file, 'other.txt', 'text');
    expect(() => readBinderBackup(file)).toThrow('no project file');
    writeBinderBackup(file, 'fixture.scrivx', '<Other/>');
    expect(() => readBinderBackup(file)).toThrow('no project');
  });
});

describe('window state', () => {
  it('writes the empty copyholder list open, as Scrivener does', () => {
    const source = `${XML}<UIStates>
    <Split>None</Split>
    <BinderAffects>Current</BinderAffects>
    <Editors Primary="Editor1">
        <Editor1>
            <Copyholder PreferredOrientation="Horizontal" VerticalPos="Right" HorizontalPos="Bottom">
                <Content></Content>
            </Copyholder>
        </Editor1>
    </Editors>
</UIStates>`;
    const read = uiStateFile.read(parseXml(source, 'UIStates')!, newUnread());
    expect(writeXml(uiStateFile.write(read))).toBe(source);
  });
});
