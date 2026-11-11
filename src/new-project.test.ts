import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vite-plus/test';
import { COMPILE_SETTINGS, MAC_WINDOW_STATE, PROJECT_FILE, WINDOW_STATE } from './blank-project.ts';
import { listFormats, readFormatFile } from './compile-format.ts';
import { compileModel } from './compile.ts';
import { applyEdits, mapItemMarkdown, readEditable, readForEditing } from './editable.ts';
import { styleMapping } from './style-mapping.ts';
import { localFiles } from './local-files.ts';
import { readParagraphs } from './edit-pieces.ts';
import { memoryFiles } from './memory-files.ts';
import { readModel } from './model.ts';
import { createProject } from './new-project.ts';
import { NEW_PROJECT_FORMAT } from './new-project-look.ts';
import { openProject, projectName } from './project.ts';
import { saveProject } from './save.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');
const BLANK = path.join(FIXTURES, 'blank.scriv');
/** A format Scrivener accepted. */
const SAMPLE = path.join(
  FIXTURES,
  'basic.scriv/Settings/Compile Formats/Fixture-MultiMarkdown.scrformat',
);
const UUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g;

const created = (name = 'Some Docs') => {
  const files = memoryFiles();
  return { files, project: createProject('/work', name, files, new Date(2026, 10, 6, 12)) };
};

const read = (file: string) => fs.readFileSync(path.join(BLANK, file), 'utf8');
const keys = (model: object) => Object.keys(model).toSorted();

/** Each style's shortcut digit, by name, for the styles that have the attribute. */
const digits = ({ styles }: { styles: { name: string; shortcut?: string }[] }) =>
  Object.fromEntries(
    styles.flatMap(({ name, shortcut }) => (shortcut === undefined ? [] : [[name, shortcut]])),
  );

const decoded = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Writes Markdown into a new project's one document, and compiles it. */
function written(markdown: string) {
  const { project } = created();
  const model = readForEditing(project);
  const [item] = project.binder[0]!.children;
  const { edits, problems } = mapItemMarkdown(readEditable(model, [item!]), item!.id, markdown);
  expect(problems).toEqual([]);
  saveProject(project, { documents: applyEdits(project, model.documents, edits) });
  return { project, item: item!, text: compileModel(readModel(project), {}) };
}

describe('a blank project', () => {
  it('is the one Scrivener wrote', () => {
    expect(PROJECT_FILE).toBe(read('blank-scriv-doc.scrivx'));
    expect(COMPILE_SETTINGS).toBe(read('Settings/compile.xml'));
    expect(WINDOW_STATE).toBe(read('Settings/ui-common.xml'));
    expect(MAC_WINDOW_STATE).toBe(read('Settings/ui.plist'));
  });
});

describe('createProject', () => {
  it("gives the styles Scrivener's digits, as a blank Scrivener project has them", () => {
    const made = digits(created().project);
    expect(made).toEqual(digits(openProject(BLANK)));
    expect(made).toEqual({
      'Centered Text': '1',
      'Block Quote': '2',
      Caption: '3',
      'Heading 1': '4',
      'Heading 2': '5',
      Attribution: '',
    });
  });

  it('names the project, its file and its compile title', () => {
    const { files, project } = created();
    expect(project.dir).toBe('/work/Some Docs.scriv');
    expect(project.file).toBe('/work/Some Docs.scriv/Some Docs.scrivx');
    expect(projectName(project)).toBe('Some Docs');
    expect(project.compileSettings!.projectSettings.metadata.projectTitle).toBe('Some Docs');
    expect(decoded(files.read(`${project.dir}/QuickLook/Preview.html`))).toContain('Some Docs');
  });

  it('keeps no ID of the blank project, and two projects share none', () => {
    const blankIds = new Set(
      [PROJECT_FILE, COMPILE_SETTINGS, WINDOW_STATE, MAC_WINDOW_STATE].flatMap((text) =>
        text.match(UUID),
      ),
    );
    const idsOf = ({ files }: ReturnType<typeof created>) =>
      [...files.all().values()].flatMap((bytes) => decoded(bytes).match(UUID) ?? []);
    const ids = idsOf(created());
    expect(ids.filter((id) => blankIds.has(id))).toEqual([]);
    const other = new Set(idsOf(created()));
    expect(ids.filter((id) => other.has(id))).toEqual([]);
  });

  it('gives each section type a layout of its own format', () => {
    const { project } = created();
    const { compileSettings, sectionTypes } = project;
    const [format] = listFormats(project);
    expect(compileSettings!.lastUsedFormats).toEqual({ mmd: format!.id });
    expect(compileSettings!.currentFileType).toBe('mmd');
    const chosen = compileSettings!.formats.find(({ id }) => id === format!.id)!;
    expect(chosen.sectionLayouts.map(({ typeId }) => typeId)).toEqual(
      sectionTypes.definitions.map(({ id }) => id),
    );
    const layouts = format!.model.sectionLayouts.map(({ id }) => id);
    for (const { layoutId } of chosen.sectionLayouts) expect(layouts).toContain(layoutId);
  });

  it('holds a format of its own, with all Scrivener writes in one', () => {
    const { project } = created();
    const formats = listFormats(project);
    expect(formats.map(({ name }) => name)).toEqual([NEW_PROJECT_FORMAT]);
    expect(formats[0]!.unsupported).toEqual({ unknown: new Set(), missing: new Set() });
    expect(keys(formats[0]!.model)).toEqual(keys(readFormatFile(SAMPLE, 'project').model));
  });

  it('opens on its first document, and saving it changes nothing', () => {
    const { files, project } = created();
    const [item] = project.binder[0]!.children;
    expect(decoded(files.read(`${project.dir}/Settings/recents.txt`))).toBe(item!.id);
    files.takeChanges();
    expect(saveProject(project).written).toEqual([]);
  });

  it('maps every kind of Markdown to a style', () => {
    const { project } = created();
    expect(styleMapping(project)).toEqual({
      headings: {
        1: 'Heading 1',
        2: 'Heading 2',
        3: 'Heading 3',
        4: 'Heading 4',
        5: 'Heading 5',
        6: 'Heading 6',
      },
      quote: 'Block Quote',
      code: 'Code Block',
      codeSpan: 'Code Span',
      bullet: 'Bullet List',
      numbered: 'Numbered List',
      strong: 'Strong',
      emphasis: 'Emphasis',
    });
  });

  it('compiles what is written as the Markdown it was', () => {
    const { text, project, item } = written(
      'Some *light* and **heavy** `code` at [a link](https://example.com).\n\n## A heading\n\n* one\n* two\n\n1. first\n\n> said\n\n```\nrun\n```\n\nThe end.\n',
    );
    expect(text).toBe(
      'Title: Some Docs\n\n' +
        'Some *light* and **heavy** `code` at [a link](https://example.com).\n\n' +
        '## A heading\n\n* one\n* two\n1. first\n\n> said\n\n\trun\n\nThe end.',
    );
    const again = readEditable(readForEditing(project), [item]);
    expect(again.markdown).toContain('Some *light* and **heavy** `code`');
  });

  it('keeps paragraphs apart by their spacing, with no empty paragraph in the document', () => {
    const { project, item, text } = written('one\n\ntwo\n\n## three\n\n```\nfour\nfive\n```\n');
    expect(text).toBe('Title: Some Docs\n\none\n\ntwo\n\n## three\n\n\tfour\n\tfive\n');
    const { documents } = readForEditing(project);
    const paragraphs = readParagraphs(project, documents.text(item.id));
    expect(paragraphs.filter((paragraph) => paragraph.text.length === 0)).toEqual([]);
  });

  it('goes by the lines of spacing before and after', () => {
    const { project, item } = written('one\n\ntwo\n\nthree\n');
    const model = readModel(project);
    const document = model.documents.text(item.id);
    document.paragraphs[0]!.format.spaceAfter = 680;
    document.paragraphs[1]!.format.spaceBefore = 240;
    vi.spyOn(model.documents, 'text').mockReturnValue(document);
    expect(compileModel(model, {})).toBe('Title: Some Docs\n\none\n\n\n\n\ntwo\n\nthree');
  });

  it('writes both strong and code, and all that a style cannot say', () => {
    const { text } = written('**`both`** and ***all*** of it\n\n```\none\n```\n\n```\ntwo\n```\n');
    expect(text).toContain('`both`');
    expect(text).toContain('**all** of it');
    expect(text).toContain('\tone\n\ttwo');
  });

  it('stops on a project that is there, and a name no folder can have', () => {
    const { files } = created();
    expect(() => createProject('/work', 'Some Docs', files)).toThrow('already there');
    expect(() => createProject('/work', '  ', files)).toThrow('cannot be called');
    expect(() => createProject('/work', 'a/b', files)).toThrow('cannot be called');
  });

  it('works on the disk as in memory', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-new-'));
    const project = createProject(folder, 'On Disk');
    expect(fs.existsSync(path.join(folder, 'On Disk.scriv', 'On Disk.scrivx'))).toBe(true);
    expect(compileModel(readModel(project.dir), {})).toContain('Title: On Disk');
    expect(project.files).toBe(localFiles);
  });
});
