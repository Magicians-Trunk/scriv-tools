import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import {
  readCompileChoices,
  readFormatChoices,
  setCompileChoices,
  setFormatChoices,
} from './compile-choices.ts';
import { compileModel } from './compile.ts';
import type { CompileXml } from './compile-xml.ts';
import { readModel } from './model.ts';
import { openProject } from './project.ts';
import { saveProject } from './save.ts';

const items = [{ id: 'A', title: 'First', text: 'one words' }];

function opened(options = {}) {
  const dir = writeFixture({ items, ...options });
  return { dir, project: openProject(dir) };
}

const compiled = (project: ReturnType<typeof openProject>) => compileModel(readModel(project));

const formatOf = (project: ReturnType<typeof openProject>) => readModel(project).format;

describe('compile choices', () => {
  it('reads what the settings file holds', () => {
    const { project } = opened({
      compile: (settings: CompileXml) => {
        settings.projectSettings.options.removeHyperlinks = true;
        settings.projectSettings.options.convertLinksToMmd = true;
      },
    });
    const choices = readCompileChoices(project);
    expect(choices.scope).toBe('Included');
    expect(choices.removeHyperlinks).toBe(true);
    expect(choices.convertLinks).toBe(true);
    expect(choices.filter).toBeUndefined();
  });

  it('saves a change to the file, and a project read again compiles with it', () => {
    const { dir, project } = opened();
    setCompileChoices(project, {
      projectTitle: 'A New Name',
      metadata: [{ key: 'Title', value: '<$projecttitle>' }],
      replacements: [{ replace: 'one', with: 'ONE-CHANGED', caseSensitive: true }],
    });
    saveProject(project);
    const again = openProject(dir);
    expect(readCompileChoices(again).projectTitle).toBe('A New Name');
    const text = compiled(again);
    expect(text).toContain('ONE-CHANGED');
    expect(text).toContain('title: A New Name');
  });

  it('changes every option, and leaves what is not given', () => {
    const { project } = opened();
    const before = readCompileChoices(project);
    setCompileChoices(project, {});
    expect(readCompileChoices(project)).toEqual(before);
    const changed = {
      scope: 'All',
      includeGroupText: true,
      removeComments: true,
      removeAnnotations: true,
      removeFootnotes: true,
      deleteStruckThrough: true,
      removeHyperlinks: true,
      convertLists: true,
      convertLinks: true,
      abbreviatedTitle: 'Short',
      forename: 'Given',
      surname: 'Family',
    };
    setCompileChoices(project, changed);
    expect(readCompileChoices(project)).toMatchObject(changed);
  });

  it('writes Convert rich text to MultiMarkdown only once it is set, as Scrivener does', () => {
    const { dir, project } = opened();
    const file = path.join(dir, 'Settings', 'compile.xml');
    const before = fs.readFileSync(file, 'utf8');
    expect(readCompileChoices(project)).toMatchObject({
      convertRichText: false,
      escapeSpecialCharacters: true,
    });
    setCompileChoices(project, { convertRichText: false, escapeSpecialCharacters: true });
    saveProject(project);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    setCompileChoices(project, { convertRichText: true });
    saveProject(project);
    expect(fs.readFileSync(file, 'utf8')).toContain(
      '<ResampleImages DPI="72">No</ResampleImages>\n            <ConvertRichTextToMMD>Yes</ConvertRichTextToMMD>\n',
    );
    setCompileChoices(project, { escapeSpecialCharacters: false });
    saveProject(project);
    expect(fs.readFileSync(file, 'utf8')).toContain(
      '<ConvertRichTextToMMD DoNotEscape="Yes">Yes</ConvertRichTextToMMD>',
    );
    const again = openProject(dir);
    expect(readCompileChoices(again)).toMatchObject({
      convertRichText: true,
      escapeSpecialCharacters: false,
    });
    expect(compiled(again)).toContain('one words');
    setCompileChoices(again, { convertRichText: false, escapeSpecialCharacters: true });
    saveProject(again);
    expect(fs.readFileSync(file, 'utf8')).toContain(
      '<ConvertRichTextToMMD>No</ConvertRichTextToMMD>',
    );
  });

  it('keeps the first author in the list, and takes one away', () => {
    const { project } = opened({
      compile: (settings: CompileXml) => {
        settings.projectSettings.metadata.authors = [
          { role: 'aut', name: 'Old' },
          { name: 'Second' },
        ];
      },
    });
    setCompileChoices(project, { author: 'New' });
    expect(project.compileSettings!.projectSettings.metadata.authors).toEqual([
      { role: 'aut', name: 'New' },
      { name: 'Second' },
    ]);
    setCompileChoices(project, { author: '' });
    expect(readCompileChoices(project).author).toBe('Second');
  });

  it('gives a project with no authors its first', () => {
    const { project } = opened();
    project.compileSettings!.projectSettings.metadata.authors = undefined;
    setCompileChoices(project, { author: 'First Author' });
    expect(readCompileChoices(project).author).toBe('First Author');
    setCompileChoices(project, { author: '' });
    project.compileSettings!.projectSettings.metadata.authors = undefined;
    setCompileChoices(project, { author: '' });
    expect(readCompileChoices(project).author).toBe('');
  });

  it('turns a filter on for a label, a status or a value, and off', () => {
    const { project } = opened();
    const label = { field: 'label', value: '1' } as const;
    const status = { field: 'status', value: '2' } as const;
    const custom = { field: 'custom', fieldId: 'F', value: 'V' } as const;
    const held = { field: 'collection', value: 'C' } as const;
    const kept = { field: 'label', value: '1', keep: true } as const;
    for (const filter of [label, status, custom, held, kept]) {
      setCompileChoices(project, { filter });
      expect(readCompileChoices(project).filter).toEqual(filter);
    }
    setCompileChoices(project, { filter: undefined });
    expect(readCompileChoices(project).filter).toBeUndefined();
  });

  it('says a project never compiled has no choices', () => {
    const { project } = opened({ neverCompiled: true });
    expect(() => setCompileChoices(project, { scope: 'All' })).toThrow('never been compiled');
    expect(() => readCompileChoices(project)).toThrow('never been compiled');
  });
});

describe('format choices', () => {
  it('reads the layouts a format was given', () => {
    const { project } = opened();
    const { layouts, frontMatter } = readFormatChoices(project, formatOf(project));
    expect(layouts).toMatchObject({ 'T-HEADING': 'L-HEADING', 'T-SECTION': 'L-TEXT' });
    expect(frontMatter).toBeUndefined();
  });

  it('changes a layout, which the compile then uses, and only says it was last used', () => {
    const { dir, project } = opened();
    const format = formatOf(project);
    const before = structuredClone(project.compileSettings!.formats);
    project.compileSettings!.lastUsedFormats.mmd = '';
    setFormatChoices(project, format);
    expect(project.compileSettings!.lastUsedFormats.mmd).toBe(format.id);
    expect(project.compileSettings!.formats).toEqual(before);
    setFormatChoices(project, format, { layouts: { 'T-SECTION': 'L-HEADING' } });
    saveProject(project);
    const xml = fs.readFileSync(path.join(dir, 'Settings', 'compile.xml'), 'utf8');
    expect(xml).toContain('L-HEADING');
    expect(readFormatChoices(openProject(dir), format).layouts).toEqual({
      'T-SECTION': 'L-HEADING',
    });
  });

  it('begins a format with no choices of its own from the default ones', () => {
    const { project } = opened();
    const format = formatOf(project);
    const file = project.compileSettings!;
    const [first] = file.formats;
    file.formats = [{ ...first!, id: 'DEFAULT' }];
    setFormatChoices(project, format, { frontMatter: 'A' });
    expect(file.formats.map(({ id }) => id)).toEqual(['DEFAULT', format.id]);
    expect(file.formats[1]!.sectionLayouts).toEqual(first!.sectionLayouts);
    expect(file.formats[0]!.frontAndBackMatter).toBeUndefined();
  });

  it('begins from nothing with no default choices to go by', () => {
    const { project } = opened();
    const format = formatOf(project);
    project.compileSettings!.formats = [];
    setFormatChoices(project, format, { layouts: { 'T-SECTION': 'L-TEXT' } });
    expect(project.compileSettings!.formats).toEqual([
      { id: format.id, sectionLayouts: [{ typeId: 'T-SECTION', layoutId: 'L-TEXT' }] },
    ]);
  });

  it('adds front matter, moves it, and takes it off', () => {
    const { project } = opened();
    const format = formatOf(project);
    setFormatChoices(project, format, { frontMatter: undefined });
    expect(readFormatChoices(project, format).frontMatter).toBeUndefined();
    setFormatChoices(project, format, { frontMatter: 'A' });
    expect(readFormatChoices(project, format).frontMatter).toBe('A');
    setFormatChoices(project, format, { frontMatter: 'B' });
    expect(readFormatChoices(project, format).frontMatter).toBe('B');
    setFormatChoices(project, format, { frontMatter: undefined });
    expect(readFormatChoices(project, format).frontMatter).toBeUndefined();
  });

  it("uses MultiMarkdown's own front matter when the format keeps one", () => {
    const { project } = opened();
    const format = formatOf(project);
    const [choices] = project.compileSettings!.formats;
    const front = { add: true, folderId: 'OLD' };
    choices!.frontAndBackMatter = {
      defaultFront: { add: false, folderId: 'KEPT' },
      perFileType: { mmd: { front } },
    };
    setFormatChoices(project, format, { frontMatter: 'NEW' });
    expect(front.folderId).toBe('NEW');
    expect(choices!.frontAndBackMatter.defaultFront.folderId).toBe('KEPT');
  });
});
