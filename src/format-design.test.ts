import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { listFormats, writeFormat } from './compile-format.ts';
import { compileModel } from './compile.ts';
import { newId } from './files.ts';
import {
  type FormatDesign,
  type LayoutDesign,
  NO_SEPARATOR,
  readFormatDesign,
} from './format-design.ts';
import {
  duplicateLayoutDesign,
  newLayoutDesign,
  newStyleDesign,
  setFormatDesign,
} from './format-edit.ts';
import {
  addFormatStyle,
  addProjectStyle,
  deleteFormat,
  duplicateFormat,
  setSectionTypes,
  setStyleBox,
  setStyleShortcut,
} from './format-manage.ts';
import { memoryFiles } from './memory-files.ts';
import { readModel } from './model.ts';
import { openProject, type Project } from './project.ts';
import { saveProject } from './save.ts';

const ITEMS = [
  { id: 'A', title: 'First', text: String.raw`one \'93words\'94` },
  { id: 'B', title: 'Second', text: 'two' },
];

function opened(options = {}) {
  const dir = writeFixture({ items: ITEMS, ...options });
  return { dir, project: openProject(dir) };
}

const formatOf = (project: Project) => listFormats(project)[0]!;
const types = (project: Project) => project.sectionTypes;

/** Changes a format, saves it, and compiles what a fresh read of the project finds. */
function compiledWith(changed: (design: FormatDesign) => Partial<FormatDesign>, options = {}) {
  const { dir, project } = opened(options);
  const found = formatOf(project);
  setFormatDesign(project, found, changed(readFormatDesign(found)));
  saveProject(project, { formats: [found] });
  return compileModel(readModel(openProject(dir)));
}

/** Changes the layout the fixture's items use. */
const withLayout = (change: Partial<LayoutDesign>) => (design: FormatDesign) => ({
  layouts: design.layouts.map((layout) =>
    layout.id === 'L-TEXT' ? { ...layout, ...change } : layout,
  ),
});

describe('a format design', () => {
  it('reads the format', () => {
    const { project } = opened();
    const design = readFormatDesign(formatOf(project));
    expect(design.name).toBe('Fixture Format');
    expect(design.layouts.map(({ id }) => id)).toEqual(['L-HEADING', 'L-TEXT']);
    expect(design.layouts[1]).toMatchObject({ text: true, titles: false, ownSeparators: false });
    expect(design.styles.length).toBeGreaterThan(0);
  });

  it('writes the same file when nothing changed', () => {
    const { project } = opened();
    const found = formatOf(project);
    const before = writeFormat(found);
    setFormatDesign(project, found, readFormatDesign(found));
    expect(writeFormat(found)).toBe(before);
  });

  it('compiles a layout with what it was given', () => {
    const text = compiledWith(
      withLayout({
        titles: true,
        titlePrefix: 'Part: ',
        titleSuffix: ' (end)',
        hashCount: 3,
        prefix: 'BEFORE «é» {x}\n',
        suffix: 'AFTER',
      }),
    );
    expect(text).toContain('### Part: First (end)');
    expect(text).toContain('BEFORE «é» {x}');
    expect(text).toContain('AFTER');
    expect(text).not.toContain('file=');
  });

  it('sets a title in capitals, and each part of a section', () => {
    const text = compiledWith(
      withLayout({
        titles: true,
        titleCase: 'Uppercase',
        runIn: false,
        suffixAfterHashes: true,
        titleSuffix: 'x',
        text: false,
        notes: true,
        synopsis: true,
        uppercasedWords: 1,
        blankLine: '---',
        prefixAfterTitle: true,
        suffixAfterSubdocuments: true,
      }),
    );
    expect(text).toContain('FIRST');
    expect(text).not.toContain('two');
  });

  it('goes back to a title by its level', () => {
    const { project } = opened();
    const found = formatOf(project);
    const fixed = withLayout({ titles: true, hashCount: 2 });
    setFormatDesign(project, found, fixed(readFormatDesign(found)));
    const open = withLayout({ hashCount: 0 });
    setFormatDesign(project, found, open(readFormatDesign(found)));
    expect(readFormatDesign(found).layouts[1]?.hashCount).toBe(0);
  });

  it('gives a layout separators of its own, or none after', () => {
    const { project } = opened();
    const found = formatOf(project);
    const own = {
      ownSeparators: true,
      separatorBetween: 'Custom',
      separatorBetweenText: '@@@',
      separatorAfter: 'Custom',
      separatorAfterText: '%%%',
    };
    setFormatDesign(project, found, withLayout(own)(readFormatDesign(found)));
    const layout = readFormatDesign(found).layouts[1]!;
    expect(layout).toMatchObject(own);
    const off = withLayout({ separatorAfter: NO_SEPARATOR });
    setFormatDesign(project, found, off(readFormatDesign(found)));
    expect(readFormatDesign(found).layouts[1]?.separatorAfter).toBe(NO_SEPARATOR);
  });

  it('reads a layout with no separators of its own at all', () => {
    const { project } = opened();
    const found = formatOf(project);
    delete found.model.sectionLayouts[1]!.separators;
    expect(readFormatDesign(found).layouts[1]?.ownSeparators).toBe(false);
  });

  it('changes the separators of folders and of text', () => {
    const text = compiledWith(({ textSeparators, folderSeparators }) => ({
      textSeparators: { ...textSeparators, between: 'Custom', betweenText: '***' },
      folderSeparators: { ...folderSeparators, between: 'PageBreak' },
    }));
    expect(text).toContain('***');
  });

  it('adds a layout, and refuses to remove one in use', () => {
    const { project } = opened();
    const found = formatOf(project);
    const { layouts } = readFormatDesign(found);
    const added = newLayoutDesign('Added');
    setFormatDesign(project, found, { layouts: [...layouts, added] });
    expect(readFormatDesign(found).layouts.at(-1)).toMatchObject({ name: 'Added', titles: true });
    setFormatDesign(project, found, { layouts });
    expect(readFormatDesign(found).layouts).toHaveLength(2);
    expect(() => {
      setFormatDesign(project, found, { layouts: layouts.slice(1) });
    }).toThrow('"Heading" is still used');
  });

  it('adds a style, changes one, and gives styles MultiMarkdown meanings', () => {
    const { project } = opened();
    const found = formatOf(project);
    const { styles } = readFormatDesign(found);
    const added = { ...newStyleDesign('Aside', 'Para'), prefix: '<<', suffix: '>>' };
    const first = { ...styles[0]!, paraPrefix: '| ', deleteText: true };
    setFormatDesign(project, found, {
      styles: [first, ...styles.slice(1), added],
      blockQuoteStyle: added.id,
      codeBlockStyle: '',
      codeSpanStyle: added.id,
      captionStyle: added.id,
    });
    const design = readFormatDesign(found);
    expect(design.styles.at(-1)).toMatchObject({ name: 'Aside', prefix: '<<', suffix: '>>' });
    expect(design.styles[0]).toMatchObject({ paraPrefix: '| ', deleteText: true });
    expect(design).toMatchObject({ blockQuoteStyle: added.id, codeBlockStyle: '' });
  });

  it('writes a format with no styles or settings yet', () => {
    const { project } = opened();
    const found = formatOf(project);
    const { model } = found;
    delete model.styles;
    delete model.mmd;
    delete model.transformations;
    delete model.formattingOptions;
    delete model.titleLinks;
    delete model.footnotesAndComments;
    expect(readFormatDesign(found)).toMatchObject({ styles: [], commentTemplate: '' });
    const style = newStyleDesign('New', 'Char');
    setFormatDesign(project, found, {
      styles: [style],
      removeSmartPunctuation: true,
      notesBeforeText: true,
      updateTitleLinks: true,
      annotationPrefix: '[',
      metadata: [{ key: 'a', value: 'b' }],
    });
    expect(readFormatDesign(found)).toMatchObject({
      removeSmartPunctuation: true,
      notesBeforeText: true,
      includeSubtitles: false,
      updateTitleLinks: true,
      annotationPrefix: '[',
      metadata: [{ key: 'a', value: 'b' }],
    });
    setFormatDesign(project, found, { includeSubtitles: true });
    expect(readFormatDesign(found)).toMatchObject({
      includeSubtitles: true,
      notesBeforeText: true,
    });
  });

  it('changes the rest of the format', () => {
    const text = compiledWith(() => ({
      name: 'Renamed',
      removeSmartPunctuation: true,
      usePandocSyntax: true,
      addClosingHashes: true,
      includeSubtitles: true,
      annotationSuffix: ']',
      commentTemplate: '<$lnk>: <$cmt>',
      replacements: [{ replace: 'two', with: 'CHANGED', caseSensitive: true }],
    }));
    expect(text).toContain('one "words"');
    expect(text).toContain('CHANGED');
  });

  it('takes the template off with nothing in it', () => {
    const { project } = opened();
    const found = formatOf(project);
    setFormatDesign(project, found, { commentTemplate: 'x' });
    expect(readFormatDesign(found).commentTemplate).toBe('x');
    setFormatDesign(project, found, { commentTemplate: '' });
    expect(readFormatDesign(found).commentTemplate).toBe('');
  });

  it("keeps the place of the project's metadata", () => {
    const { project } = opened();
    const found = formatOf(project);
    found.model.mmd = {
      metadata: [
        { key: 'a', value: '1' },
        { isProjectMetadataPlaceholder: true, value: '' },
      ],
    };
    expect(readFormatDesign(found).metadata).toEqual([{ key: 'a', value: '1' }]);
    setFormatDesign(project, found, {
      metadata: [
        { key: 'x', value: '1' },
        { key: 'y', value: '2' },
      ],
    });
    expect(found.model.mmd.metadata[1]?.isProjectMetadataPlaceholder).toBe(true);
    setFormatDesign(project, found, { metadata: [] });
    expect(found.model.mmd.metadata).toHaveLength(1);
  });

  it("refuses a format that is not the project's own", () => {
    const { project } = opened();
    const found = { ...formatOf(project), source: 'built-in' as const };
    expect(() => {
      setFormatDesign(project, found, { name: 'x' });
    }).toThrow('duplicate it first');
  });
});

describe('a format with little in it', () => {
  it('sets meanings on a format with no MultiMarkdown settings', () => {
    const { project } = opened();
    const found = formatOf(project);
    delete found.model.mmd;
    setFormatDesign(project, found, { usePandocSyntax: true });
    expect(readFormatDesign(found).usePandocSyntax).toBe(true);
  });

  it('reads metadata with no key', () => {
    const { project } = opened();
    const found = formatOf(project);
    found.model.mmd = { metadata: [{ value: 'alone' }] };
    expect(readFormatDesign(found).metadata).toEqual([{ key: '', value: 'alone' }]);
  });

  it('sets one formatting option, keeping or starting the other', () => {
    const { project } = opened();
    const found = formatOf(project);
    delete found.model.formattingOptions;
    setFormatDesign(project, found, { includeSubtitles: true });
    expect(found.model.formattingOptions).toEqual({
      notesBeforeText: false,
      includeSubtitles: true,
    });
    delete found.model.formattingOptions;
    setFormatDesign(project, found, { notesBeforeText: true });
    expect(readFormatDesign(found).includeSubtitles).toBe(false);
    setFormatDesign(project, found, { includeSubtitles: true });
    setFormatDesign(project, found, { includeSubtitles: false });
    expect(found.model.formattingOptions).toEqual({
      notesBeforeText: true,
      includeSubtitles: false,
    });
  });
});

describe('the last format', () => {
  it('stays: a project needs one to compile with', () => {
    const dir = writeFixture({ items: ITEMS });
    const names = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' });
    const entries = names
      .map((name) => path.join(dir, name))
      .filter((file) => fs.statSync(file).isFile())
      .map((file): [string, Uint8Array] => [file, new Uint8Array(fs.readFileSync(file))]);
    const project = openProject(dir, memoryFiles(entries));
    expect(() => {
      deleteFormat(project, formatOf(project));
    }).toThrow('needs a format');
  });
});

describe('a copy of a format', () => {
  it('is written beside the others, goes by the same choices, and is used next', () => {
    const { dir, project } = opened();
    const copy = duplicateFormat(project, formatOf(project), 'My/Copy');
    saveProject(project, { formats: [copy] });
    const again = openProject(dir);
    expect(listFormats(again).map(({ name }) => name)).toContain('My/Copy');
    expect(copy.file).toContain('My-Copy.scrformat');
    const model = readModel(again);
    expect(model.format.name).toBe('My/Copy');
    expect(compileModel(model)).toContain('one');
  });

  it('needs no choices to copy, nor compile settings', () => {
    const { project } = opened();
    project.compileSettings!.formats = [];
    expect(duplicateFormat(project, formatOf(project), 'A').id).toBeTruthy();
    project.compileSettings = undefined;
    expect(duplicateFormat(project, formatOf(project), 'B').name).toBe('B');
  });
});

describe('project styles', () => {
  it('adds one, saved with the project, and refuses a name it has', () => {
    const { dir, project } = opened();
    addProjectStyle(project, 'Aside', 'Para');
    saveProject(project);
    expect(openProject(dir).styles.map(({ name }) => name)).toContain('Aside');
    expect(() => addProjectStyle(project, 'Aside', 'Para')).toThrow('already has');
  });

  it("gives a style its shortcut's digit, taken from a style that had it, and takes it off", () => {
    const { dir, project } = opened();
    const digitOf = (name: string) =>
      openProject(dir).styles.find((style) => style.name === name)?.shortcut;
    setStyleShortcut(project, 'Heading 1', '3');
    saveProject(project);
    expect(digitOf('Heading 1')).toBe('3');
    setStyleShortcut(project, 'Block Quote', '3');
    saveProject(project);
    expect(digitOf('Heading 1')).toBeUndefined();
    expect(digitOf('Block Quote')).toBe('3');
    project.styles.find((style) => style.name === 'Code Span')!.shortcut = '';
    setStyleShortcut(project, 'Block Quote', '');
    saveProject(project);
    expect(digitOf('Block Quote')).toBeUndefined();
    expect(digitOf('Code Span')).toBe('');
  });
});

describe('setStyleBox', () => {
  it('gives a style its highlight box and takes it off, leaving no attribute', () => {
    const { dir, project } = opened();
    const stylesXml = () => fs.readFileSync(path.join(dir, 'Files', 'styles.xml'), 'utf8');
    setStyleBox(project, 'Heading 1', [0.5, 1, 0.25]);
    saveProject(project);
    expect(stylesXml()).toContain('Box="0.5 1.0 0.25"');
    expect(openProject(dir).styles.find((style) => style.name === 'Heading 1')?.box).toEqual([
      0.5, 1, 0.25,
    ]);
    setStyleBox(project, 'Heading 1', undefined);
    saveProject(project);
    expect(stylesXml()).not.toContain('Box=');
  });
});

describe('section types', () => {
  it('adds and renames a type, and picks types by structure', () => {
    const { dir, project } = opened();
    const id = newId();
    const { definitions, levels } = types(project);
    setSectionTypes(project, {
      definitions: [...definitions, { id, name: 'Added' }],
      levels: { ...levels, files: [id] },
    });
    saveProject(project);
    const again = openProject(dir).sectionTypes;
    expect(again.definitions.at(-1)).toEqual({ id, name: 'Added' });
    expect(again.levels.files).toEqual([id]);
  });

  it('takes a removed type out of what the formats chose', () => {
    const { project } = opened();
    const { definitions, levels } = types(project);
    const kept = definitions.filter(({ id }) => id !== 'T-HEADING');
    setSectionTypes(project, { definitions: kept, levels });
    const [choices] = project.compileSettings!.formats;
    expect(choices!.sectionLayouts.map(({ typeId }) => typeId)).not.toContain('T-HEADING');
  });

  it('refuses to remove a type an item uses, wherever it is', () => {
    const { project } = opened();
    const { definitions, levels } = types(project);
    const deep = project.binder[0]!.children[0]!;
    deep.metadata = { ...deep.metadata, custom: {}, sectionType: { id: 'T-HEADING' } };
    const kept = definitions.filter(({ id }) => id !== 'T-HEADING');
    expect(() => {
      setSectionTypes(project, { definitions: kept, levels });
    }).toThrow('still set on "First"');
  });

  it('needs no compile settings', () => {
    const { project } = opened();
    project.compileSettings = undefined;
    setSectionTypes(project, types(project));
    expect(project.compileSettings).toBeUndefined();
  });
});

const cased = (change: Partial<LayoutDesign>) =>
  compiledWith(withLayout({ titles: true, hashCount: 2, ...change }));

describe('title cases', () => {
  it('writes a title in each case, small capitals as capitals', () => {
    expect(cased({ titleCase: 'Uppercase' })).toContain('## FIRST');
    expect(cased({ titleCase: 'SmallCaps' })).toContain('## FIRST');
    expect(cased({ titleCase: 'Lowercase' })).toContain('## first');
  });

  it('cases a prefix and suffix, leaving what placeholders say to them', () => {
    const text = cased({
      titlePrefix: 'part <$title> ',
      prefixCase: 'Uppercase',
      titleSuffix: ' END',
      suffixCase: 'Lowercase',
    });
    expect(text).toContain('## PART First First end');
  });

  it('reads back as it was typed, and goes back to normal letters', () => {
    const { project } = opened();
    const found = formatOf(project);
    const up = withLayout({ titlePrefix: 'a', prefixCase: 'Uppercase', suffixCase: 'SmallCaps' });
    setFormatDesign(project, found, up(readFormatDesign(found)));
    expect(readFormatDesign(found).layouts[1]).toMatchObject({
      titlePrefix: 'a',
      prefixCase: 'Uppercase',
      suffixCase: 'SmallCaps',
    });
    const plain = withLayout({ prefixCase: 'Normal', suffixCase: 'Normal' });
    setFormatDesign(project, found, plain(readFormatDesign(found)));
    expect(found.model.sectionLayouts[1]!.titles?.prefix).toEqual({ text: 'a' });
  });
});

describe('what the format design refuses', () => {
  it('refuses a layout only the default choices use', () => {
    const { project } = opened();
    const found = formatOf(project);
    const [own] = project.compileSettings!.formats;
    own!.id = 'DEFAULT';
    const { layouts } = readFormatDesign(found);
    expect(() => {
      setFormatDesign(project, found, { layouts: layouts.slice(1) });
    }).toThrow('still used');
  });

  it('removes a layout from a project never compiled', () => {
    const { project } = opened({ neverCompiled: true });
    const found = formatOf(project);
    const { layouts } = readFormatDesign(found);
    setFormatDesign(project, found, { layouts: layouts.slice(1) });
    expect(readFormatDesign(found).layouts).toHaveLength(1);
  });

  it('takes a section type left following the structure as no use of one', () => {
    const { project } = opened();
    const { definitions, levels } = types(project);
    const item = project.binder[0]!.children[0]!;
    item.metadata = { ...item.metadata, custom: {}, sectionType: { id: '' } };
    setSectionTypes(project, { definitions: definitions.slice(1), levels });
    expect(types(project).definitions).toHaveLength(definitions.length - 1);
  });

  it('takes a removed type out of the levels', () => {
    const { project } = opened();
    const { definitions } = types(project);
    const [first] = definitions;
    setSectionTypes(project, {
      definitions: definitions.slice(1),
      levels: { folders: [first!.id], containers: [first!.id], files: [first!.id] },
    });
    expect(types(project).levels).toEqual({ folders: [], containers: [], files: [] });
  });

  it('refuses a copy that would land on another format', () => {
    const { project } = opened();
    const found = formatOf(project);
    expect(() => duplicateFormat(project, found, 'Fixture Format')).toThrow('already has');
    expect(() => duplicateFormat(project, found, 'Fixture/Format')).toThrow('already has');
  });

  it('deletes a format, leaving what was last used alone unless it was this one', () => {
    const { dir, project } = opened();
    const found = formatOf(project);
    const copy = duplicateFormat(project, found, 'Copy');
    saveProject(project, { formats: [copy] });
    const again = openProject(dir);
    const [first, second] = listFormats(again);
    const last = () => again.compileSettings!.lastUsedFormats.mmd;
    const other = first!.id === last() ? second! : first!;
    const lastBefore = last();
    deleteFormat(again, other);
    expect(last()).toBe(lastBefore);
    const used = listFormats(again).find(({ id }) => id === lastBefore)!;
    again.compileSettings!.lastUsedFormats.mmd = used.id;
    deleteFormat(again, used);
    expect(last()).not.toBe(lastBefore);
    saveProject(again, { removedFormats: [other] });
    expect(listFormats(openProject(dir)).map(({ id }) => id)).not.toContain(other.id);
  });

  it("deletes a format in a project never compiled, and not one of Scrivener's", () => {
    const { project } = opened({ neverCompiled: true });
    const found = formatOf(project);
    const copy = duplicateFormat(project, found, 'Copy');
    saveProject(project, { formats: [copy] });
    deleteFormat(project, copy);
    const theirs = { ...found, source: 'built-in' as const };
    expect(() => {
      deleteFormat(project, theirs);
    }).toThrow('duplicate it first');
  });

  it("adds a style for a format, and refuses one that is not the project's own", () => {
    const { project } = opened();
    const found = formatOf(project);
    const theirs = { ...found, source: 'built-in' as const };
    const before = project.styles.length;
    expect(() => {
      addFormatStyle(project, theirs, 'Aside', 'Para');
    }).toThrow('duplicate it first');
    expect(project.styles).toHaveLength(before);
    addFormatStyle(project, found, 'Aside', 'Para');
    addFormatStyle(project, found, 'Aside', 'Char');
    expect(project.styles).toHaveLength(before + 1);
  });

  it('copies a layout under a new name and ID, and keeps raw markup on a style', () => {
    const layout = newLayoutDesign('One');
    expect(duplicateLayoutDesign(layout)).toMatchObject({ name: 'One copy', titles: true });
    expect(duplicateLayoutDesign(layout).id).not.toBe(layout.id);
    const { project } = opened();
    const found = formatOf(project);
    const raw = { ...newStyleDesign('Raw', 'Para'), rawMarkup: true };
    setFormatDesign(project, found, { styles: [raw] });
    expect(readFormatDesign(found).styles[0]?.rawMarkup).toBe(true);
  });
});
