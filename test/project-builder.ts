/**
 * Builds Scrivener 3 fixture projects from a blank project made by Scrivener, so Scrivener opens
 * them.  Open each in Scrivener, compile it with its format, and keep the output beside it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFormatFile } from '../src/compile-format.ts';
import {
  compileXml,
  type FormatChoices,
  type ProjectOptions,
  writeCompileXml,
} from '../src/compile-xml.ts';
import { stylesFile, writeStyles } from '../src/project-styles.ts';
import { type Scrformat, scrformat, writeScrformat } from '../src/scrformat.ts';
import { type Keyword, scrivxFile, writeScrivx } from '../src/scrivx.ts';
import { newUnread } from '../src/xml-codec.ts';
import { parseXml, readXml } from '../src/xml.ts';
import { binderItem, type ItemSpec, uuid } from './binder-items.ts';

/** The compile options that are on or off. */
type BooleanOption = {
  [K in keyof ProjectOptions]-?: ProjectOptions[K] extends boolean | undefined ? K : never;
}[keyof ProjectOptions];

export interface LayoutSpec {
  name: string;
  /** The `<Include>` attributes, such as `Titles="Yes" Text="Yes"`. */
  include: string;
  /** More settings, after `<Include>`: `<Titles>`, `<Prefix>`, `<Suffix>` and the like. */
  settings?: string;
  /** The layout's own `<Separators>`; by default it uses the format's. */
  separators?: string;
}

export interface FormatSpec {
  name: string;
  id: string;
  /** Layouts in place of the base format's Heading, Text Section with Heading and Text Section. */
  layouts?: LayoutSpec[];
  /** More settings for the base format's layouts, by layout name. */
  layoutSettings?: Record<string, string>;
  /** The layout for each section type, by name.  By default the base format's assignments. */
  assign?: Record<string, string>;
  /** More `<Style>` elements. */
  styles?: string;
  formattingOptions?: string;
  /** The format's `<SeparatorSettings>`, in place of the base format's. */
  separatorSettings?: string;
  /** The `<TitleLinks>` settings, after the styles. */
  titleLinks?: string;
  replacements?: string;
}

export interface ProjectSpec {
  title: string;
  abbreviatedTitle?: string;
  authors?: string[];
  forename?: string;
  surname?: string;
  items: ItemSpec[];
  /** The items in the Research folder. */
  research?: ItemSpec[];
  /** The keywords, each with those filed under it. */
  keywords?: Keyword[];
  /** A folder beside the Draft folder, added to the first format as front matter. */
  frontMatter?: ItemSpec & { id: string };
  /** Section types beyond Heading, Sub-Heading and Section. */
  sectionTypes?: string[];
  /** Project paragraph styles copied from Block Quote under new names. */
  projectStyles?: string[];
  /** Project character styles copied from Code Span under new names. */
  characterStyles?: string[];
  /** Custom metadata text fields. */
  customFields?: { id: string; title: string }[];
  /** Compile options to set, or to drop with `undefined`. */
  options?: Partial<Record<BooleanOption, boolean | undefined>>;
  /** A compile filter that leaves out items with this label. */
  excludeLabel?: string;
  replacements?: string;
  /** More MultiMarkdown metadata keys. */
  metadata?: Record<string, string>;
  /** The compile formats; the first is the one last used. */
  formats: FormatSpec[];
}

/** A format Scrivener accepted, matching its Basic MultiMarkdown setting for setting. */
const BASE_FORMAT = path.join(
  import.meta.dirname,
  'fixtures/basic.scriv/Settings/Compile Formats/Fixture-MultiMarkdown.scrformat',
);
const BASE_ASSIGN = { Heading: 'Heading', Section: 'Text Section with Heading' };

const BLANK_TYPES = {
  Heading: 'C6B39E90-02BC-4B4B-AFC7-77CE685FD644',
  'Sub-Heading': '0AC65ACC-AF13-41C3-B22D-161220936660',
  Section: '812CD63D-A184-4DBE-8E52-B9F11991C4BF',
};
const DEFAULT_SEPARATORS =
  '<Separators UseDefault="Yes"><Before Type="Single"/><Between Type="Single"/><AfterOverride Use="No" Type="Single"/></Separators>';

/** Writes a project from `spec` to `target` (a `.scriv` path), starting from `blank`. */
export function buildProject(blank: string, target: string, spec: ProjectSpec): void {
  const name = path.basename(target, '.scriv');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(blank, target, { recursive: true });
  const blankScrivx = fs.readdirSync(target).find((file) => file.endsWith('.scrivx'))!;
  fs.renameSync(path.join(target, blankScrivx), path.join(target, `${name}.scrivx`));
  for (const file of ['binder.autosave', 'binder.backup', 'search.indexes']) {
    fs.rmSync(path.join(target, 'Files', file), { force: true });
  }
  fs.rmSync(path.join(target, 'Files', 'Data'), { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'Files', 'Data'));

  const styleIds = addProjectStyles(target, spec.projectStyles ?? [], spec.characterStyles ?? []);
  const typeIds: Record<string, string> = { ...BLANK_TYPES };
  for (const type of spec.sectionTypes ?? []) typeIds[type] = uuid();
  const ids = {
    section: (type: string) => typeIds[type]!,
    style: (style: string) => styleIds[style]!,
  };
  const item = (described: ItemSpec) => binderItem(target, described, ids);

  const scrivxPath = path.join(target, `${name}.scrivx`);
  const scrivx = scrivxFile.read(readXml(scrivxPath, 'ScrivenerProject'), newUnread());
  scrivx.identifier = uuid();
  const draft = scrivx.binder.find((top) => top.type === 'DraftFolder')!;
  draft.children = spec.items.map(item);
  scrivx.binder.find((top) => top.type === 'ResearchFolder')!.children = (spec.research ?? []).map(
    item,
  );
  if (spec.keywords) scrivx.keywords = spec.keywords;
  if (spec.frontMatter) {
    const research = scrivx.binder.findIndex((top) => top.type === 'ResearchFolder');
    scrivx.binder.splice(research, 0, item(spec.frontMatter));
  }
  for (const type of spec.sectionTypes ?? []) {
    scrivx.sectionTypes.definitions.push({ id: typeIds[type]!, name: type });
  }
  scrivx.customFields = (spec.customFields ?? []).map(({ id, title }) => ({
    id,
    type: 'Text',
    wraps: false,
    align: 'Left',
    title,
  }));
  fs.writeFileSync(scrivxPath, writeScrivx(scrivx));

  fs.mkdirSync(path.join(target, 'Settings', 'Compile Formats'), { recursive: true });
  const layoutIds = spec.formats.map((format) => writeFormat(target, format));
  writeCompileSettings(target, spec, typeIds, layoutIds);
}

/** Copies Block Quote under each new name, and returns every style's ID by name. */
function addProjectStyles(
  target: string,
  paragraphs: string[],
  characters: string[],
): Record<string, string> {
  const file = path.join(target, 'Files', 'styles.xml');
  const unsupported = { scrivx: newUnread(), styles: newUnread(), compileSettings: newUnread() };
  const { styles } = stylesFile.read(readXml(file, 'Styles'), unsupported.styles);
  const copies = (template: string, names: string[]) => {
    const original = styles.find((style) => style.name === template)!;
    return names.map((name) => ({ ...original, name, id: uuid() }));
  };
  styles.push(...copies('Block Quote', paragraphs), ...copies('Code Span', characters));
  fs.writeFileSync(file, writeStyles({ styles, unsupported }));
  return Object.fromEntries(styles.map((style) => [style.name, style.id]));
}

/**
 * The parts of a compile format the XML fragments set, read as the library reads a format file.
 * Fixture specs give format settings in Scrivener's own terms, as written in its files.
 */
function formatParts(fragments: string): Scrformat {
  const xml = `<CompileFormat Name="" ID="">${fragments}</CompileFormat>`;
  return scrformat.read(parseXml(xml, 'CompileFormat')!, newUnread());
}

/** Writes a format from the base format, and returns its layouts' IDs by name. */
function writeFormat(target: string, spec: FormatSpec): Record<string, string> {
  const format = readFormatFile(BASE_FORMAT, 'project').model;
  Object.assign(format, { name: spec.name, id: spec.id });
  if (spec.layouts) {
    const layouts = spec.layouts.map(
      (layout) =>
        `<Layout Name="${layout.name}" ID="${uuid()}"><Include ${layout.include}/>${layout.settings ?? ''}${layout.separators ?? DEFAULT_SEPARATORS}</Layout>`,
    );
    format.sectionLayouts = formatParts(
      `<SectionLayouts>${layouts.join('')}</SectionLayouts>`,
    ).sectionLayouts;
  } else {
    for (const layout of format.sectionLayouts) layout.id = uuid();
  }
  for (const [name, settings] of Object.entries(spec.layoutSettings ?? {})) {
    const layout = format.sectionLayouts.find((each) => each.name === name)!;
    const changes = `<SectionLayouts><Layout Name="" ID=""><Include/>${settings}</Layout></SectionLayouts>`;
    const { name: _, id: __, include: ___, ...set } = formatParts(changes).sectionLayouts[0]!;
    Object.assign(layout, set);
  }
  const parts = formatParts(
    [
      spec.formattingOptions,
      spec.separatorSettings,
      spec.styles && `<Styles>${spec.styles}</Styles>`,
      spec.titleLinks,
      spec.replacements,
    ]
      .filter(Boolean)
      .join(''),
  );
  if (parts.formattingOptions) format.formattingOptions = parts.formattingOptions;
  if (spec.separatorSettings) format.separatorSettings = parts.separatorSettings;
  if (parts.styles) format.styles = [...(format.styles ?? []), ...parts.styles];
  if (parts.titleLinks) format.titleLinks = parts.titleLinks;
  if (spec.replacements) format.replacements = parts.replacements;
  const file = `${spec.name.replaceAll(' ', '-')}.scrformat`;
  fs.writeFileSync(path.join(target, 'Settings', 'Compile Formats', file), writeScrformat(format));
  return Object.fromEntries(format.sectionLayouts.map((layout) => [layout.name, layout.id]));
}

/** Sets the project's compile settings: metadata, options, filter, and each format's layouts. */
function writeCompileSettings(
  target: string,
  spec: ProjectSpec,
  typeIds: Record<string, string>,
  layoutIds: Record<string, string>[],
): void {
  const file = path.join(target, 'Settings', 'compile.xml');
  const unsupported = { compileSettings: newUnread() };
  const settings = compileXml.read(readXml(file, 'CompileSettings'), unsupported.compileSettings);
  const { content, options, metadata } = settings.projectSettings;
  metadata.projectTitle = spec.title;
  metadata.abbreviatedTitle = spec.abbreviatedTitle ?? spec.title;
  metadata.authors = (spec.authors ?? ['']).map((name) => ({ role: 'aut', name }));
  if (spec.surname !== undefined) metadata.surname = spec.surname;
  if (spec.forename !== undefined) metadata.forename = spec.forename;
  for (const [key, value] of Object.entries(spec.metadata ?? {})) metadata.mmd.push({ key, value });
  // An option set to `undefined` is left out of the file.
  Object.assign(options, spec.options);
  if (spec.excludeLabel !== undefined) {
    Object.assign(content.filter, { state: 'On', exclude: true, label: spec.excludeLabel });
  }
  if (spec.replacements) {
    settings.projectSettings.replacements = formatParts(spec.replacements).replacements;
  }
  settings.currentFileType = 'mmd';
  settings.formats.push(
    ...spec.formats.map((format, index): FormatChoices => {
      const ids = layoutIds[index]!;
      const choices: FormatChoices = {
        id: format.id,
        sectionLayouts: Object.entries(format.assign ?? BASE_ASSIGN).map(([type, layout]) => ({
          typeId: typeIds[type]!,
          layoutId: ids[layout]!,
        })),
      };
      if (index === 0 && spec.frontMatter) {
        choices.frontAndBackMatter = { defaultFront: { add: true, folderId: spec.frontMatter.id } };
      }
      return choices;
    }),
  );
  settings.lastUsedFormats = { mmd: spec.formats[0]!.id };
  fs.writeFileSync(file, writeCompileXml(settings, unsupported));
}
