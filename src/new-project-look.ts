/**
 * What a new project is written with: styles and a compile format of its own, never Scrivener's
 * built-in ones.  Each style Markdown has is here, so Edit writes real styles, and the format says
 * what each compiles to.  The samples are RTF as Scrivener writes a style's, which it reads back.
 */
import type { CompileXml } from './compile-xml.ts';
import { type DocumentText, readDocumentText } from './document.ts';
import { newId } from './files.ts';
import type { ProjectStyle } from './project-styles.ts';
import { type Scrformat, scrformat } from './scrformat.ts';
import type {
  FormattingSample,
  FormatStyleModel,
  LayoutInclude,
  SectionLayoutModel,
} from './scrformat-layouts.ts';
import type { SectionTypes } from './scrivx.ts';
import { newUnread } from './xml-codec.ts';
import { parseXml } from './xml.ts';

/** The format every new project has, which is the one it compiles with until told otherwise. */
export const NEW_PROJECT_FORMAT = 'Markdown Documents';

const SANS = 'Helvetica';
const SANS_BOLD = 'Helvetica-Bold';
const SANS_OBLIQUE = 'Helvetica-Oblique';
const MONO = 'Menlo-Regular';

const HEADER = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0`;
const COLORS = String.raw`{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}`;

/** The font table's entry for a font, by its number. */
const fontEntry = (font: string, at: number) => String.raw`\f${at}\fswiss\fcharset0 ${font};`;

/** A sample of text in a look: a font, paragraph settings, and the character size in half points. */
function sampleRtf(font: string, paragraph: string, size: number): string {
  return `${HEADER}{\\fonttbl${fontEntry(font, 0)}}
${COLORS}
\\pard${paragraph}\\pardirnatural\\partightenfactor0

\\f0\\fs${size} \\cf0 Attributes}`;
}

/** A heading's sample: bold text between the tags that give it a level, as Scrivener writes it. */
function headingRtf(level: number, size: number): string {
  return `${HEADER}{\\fonttbl${fontEntry(SANS, 0)}${fontEntry(SANS_BOLD, 1)}}
${COLORS}
\\pard${BODY}\\pardirnatural\\partightenfactor0

\\f0\\fs26 \\cf0 <$ScrKeepWithNext><$Scr_H::${level}>
\\f1\\b\\fs${size} Attributes
\\f0\\b0\\fs26 <!$Scr_H::${level}>}`;
}

/** The size of each heading, from the first, in half points. */
const HEADING_SIZES = [40, 34, 30, 28, 26, 26];

/**
 * The format converts paragraph spacing to empty lines, as Markdown needs: spacing after is a line
 * of it, and spacing before would be another.  What goes on from line to line, as a list and code
 * do, has none: the compile ends a list with an empty line, and code's style ends with its own.
 */
const BODY = String.raw`\sa280`;
const LIST = String.raw`\tx220\tx720\pardeftab720\li720\fi-720`;
const QUOTE = String.raw`\li720\sa280`;
const CODE = String.raw`\li360`;
const CENTERED = String.raw`\qc\sa280`;
const ATTRIBUTION = String.raw`\qr\li720\sa280`;

/** A style's name and what it is, with what it says to the format. */
interface OwnStyle {
  name: string;
  type: 'Para' | 'Char' | 'Para+Char';
  fontChange?: string;
  rtf: string;
  /** Goes on with the same style after a return. */
  repeats?: boolean;
  lists?: string[];
  /** What the compile writes around text in it. */
  prefix?: string;
  suffix?: string;
  /** The digit of its keys, as a blank Scrivener project has it, empty for no digit yet. */
  shortcut?: string;
}

/** The digit each heading has, as a blank Scrivener project gives only these two one. */
const HEADING_SHORTCUTS = ['4', '5'];

const OWN_STYLES: OwnStyle[] = [
  ...HEADING_SIZES.map((size, at): OwnStyle => ({
    name: `Heading ${at + 1}`,
    type: 'Para+Char',
    fontChange: 'Size',
    rtf: headingRtf(at + 1, size),
    prefix: `${'#'.repeat(at + 1)} `,
    ...(at < HEADING_SHORTCUTS.length ? { shortcut: HEADING_SHORTCUTS[at]! } : {}),
  })),
  { name: 'Centered Text', type: 'Para', rtf: sampleRtf(SANS, CENTERED, 26), shortcut: '1' },
  { name: 'Block Quote', type: 'Para', rtf: sampleRtf(SANS_OBLIQUE, QUOTE, 26), shortcut: '2' },
  { name: 'Attribution', type: 'Para', rtf: sampleRtf(SANS, ATTRIBUTION, 26), shortcut: '' },
  {
    name: 'Code Block',
    type: 'Para+Char',
    fontChange: 'Face+Size',
    rtf: sampleRtf(MONO, CODE, 22),
    repeats: true,
    suffix: '\n',
  },
  { name: 'Code Span', type: 'Char', fontChange: 'Face+Size', rtf: sampleRtf(MONO, '', 22) },
  { name: 'Bullet List', type: 'Para', rtf: sampleRtf(SANS, LIST, 26), lists: ['{disc}'] },
  { name: 'Numbered List', type: 'Para', rtf: sampleRtf(SANS, LIST, 26), lists: ['{decimal}.'] },
  { name: 'Caption', type: 'Para', rtf: sampleRtf(SANS_OBLIQUE, BODY, 22), shortcut: '3' },
  {
    name: 'Strong',
    type: 'Char',
    rtf: sampleRtf(SANS_BOLD, '', 26),
    prefix: '**',
    suffix: '**',
  },
  {
    name: 'Emphasis',
    type: 'Char',
    rtf: sampleRtf(SANS_OBLIQUE, '', 26),
    prefix: '*',
    suffix: '*',
  },
  {
    name: 'Note',
    type: 'Para',
    rtf: sampleRtf(SANS, QUOTE, 26),
    prefix: '> **Note:** ',
  },
  {
    name: 'Keyboard',
    type: 'Char',
    fontChange: 'Face+Size',
    rtf: sampleRtf(MONO, '', 22),
    prefix: '<kbd>',
    suffix: '</kbd>',
  },
];

/** The look of plain text in a new project, kept where Scrivener keeps a project's own. */
export const plainTextSample = (): DocumentText => readDocumentText(sampleRtf(SANS, BODY, 26));

/** A new project's styles. */
export function newProjectStyles(): ProjectStyle[] {
  return OWN_STYLES.map(({ name, type, fontChange, rtf, repeats, lists, shortcut }) => {
    const id = newId();
    return {
      name,
      id,
      type,
      ...(fontChange === undefined ? {} : { fontChange }),
      ...(repeats ? { next: id } : {}),
      format: readDocumentText(rtf),
      ...(lists === undefined ? {} : { lists }),
      ...(shortcut === undefined ? {} : { shortcut }),
    };
  });
}

/** What a format holds besides its layouts and styles, which are its own, as Scrivener writes it. */
const REST_OF_FORMAT = `<CompileFormat Name="" ID="">
<SupportedTypes><Type>mmd</Type></SupportedTypes>
<SectionLayouts/>
<SeparatorSettings>
<FolderSeparators><Before Type="Double"/><Between Type="Double"/><AfterOverride Use="No" Type="Single"/></FolderSeparators>
<TextSeparators><Before Type="Double"/><Between Type="Double"/><AfterOverride Use="No" Type="Single"/></TextSeparators>
<Font Size="13.0" Override="No">${SANS}</Font>
</SeparatorSettings>
<Layout><Scriptwriting><PFAsDualDialogue>No</PFAsDualDialogue><MoreAndContd Enabled="No"><MoreText><![CDATA[]]></MoreText><ContdText><![CDATA[]]></ContdText></MoreAndContd><Elements/></Scriptwriting></Layout>
<Transformations><RemoveSmartPunctuation>Yes</RemoveSmartPunctuation><PlainTextConversion State="On">Para</PlainTextConversion><OutlineIndent State="Off">18.0</OutlineIndent></Transformations>
<Tables><ConvertToImages MaxWidth="600.0">No</ConvertToImages></Tables>
<FootnotesAndComments>
<Footnotes><Font Size="12.0" Override="No">${SANS}</Font><DividerStyle>Default</DividerStyle><FootnoteStyle>Arabic</FootnoteStyle><EndnoteStyle>Arabic</EndnoteStyle><Numbering>Continuous</Numbering><EndnotesArrangement><Placement>End</Placement><SectionGrouping><Font Size="12.0">${SANS}</Font></SectionGrouping></EndnotesArrangement><AvoidWidowsAndOrphans>Yes</AvoidWidowsAndOrphans><CanSplitAcrossPages>Yes</CanSplitAcrossPages><KeepAtBottomOfPage>Yes</KeepAtBottomOfPage><CenterSingleLineFootnotes>No</CenterSingleLineFootnotes><InlinePlainText/></Footnotes>
<Comments><AnnotationsRTFType>Comments</AnnotationsRTFType></Comments>
</FootnotesAndComments>
<PageSettings>
<PrintSettings PaperSize="612.0,792.0" LeftMargin="72.0" RightMargin="72.0" TopMargin="90.0" BottomMargin="90.0" PaperType="na-letter" Orientation="Portrait" HorizontalPagination="Clip" VerticalPagination="Auto" ScaleFactor="1.0" HorizontallyCentered="Yes" VerticallyCentered="Yes" Collates="Yes" PagesAcross="1" PagesDown="1"/>
<Margins Units="CM" RespectPrinterBounds="Yes"><Top>0.0</Top><Bottom>0.0</Bottom><Left>0.0</Left><Right>0.0</Right></Margins>
<HeadersAndFooters><HeaderFont Size="12.0">${SANS}</HeaderFont><FooterFont Size="12.0">${SANS}</FooterFont><FirstRegularPage>-1</FirstRegularPage><StandardHeader/><StandardFooter/><FirstPagesHeader/><FirstPagesFooter/><RectoHeader/><RectoFooter/><NewSectionHeader/><NewSectionFooter/><BackMatterHeader/><BackMatterFooter/></HeadersAndFooters>
</PageSettings>
<PrintPDF><InternalLinkColor>0.0 0.0 0.998199</InternalLinkColor></PrintPDF>
<RTF><Columns Location="FirstPage" Number="2" TwipsBetween="360"/></RTF>
<ScriptFormats><SummaryFont Size="12.0">${SANS}</SummaryFont><ScriptNoteFont Size="12.0">${SANS}</ScriptNoteFont></ScriptFormats>
<HTML><UseCenteredBodyTable Width="600">No</UseCenteredBodyTable></HTML>
<PlainText><Extension></Extension></PlainText>
<MMD><MetaData><Value IsProjectMetaDataPlaceholder="Yes"/></MetaData><LaTeXDocumentClass>Memoir</LaTeXDocumentClass></MMD>
<EBookSettings><BaseFormat><![CDATA[${sampleRtf(SANS, BODY, 26)}]]></BaseFormat><CSSStylesFromDirectFormatting>Yes</CSSStylesFromDirectFormatting><TablesAndLists><TableStyle>Basic</TableStyle><EpubListStyle>Basic</EpubListStyle><KindleListStyle>Basic</KindleListStyle><EpubBulletStyle>Basic</EpubBulletStyle><KindleBulletStyle>Basic</KindleBulletStyle></TablesAndLists><ScriptSettings HasScriptFormatting="No"><![CDATA[]]></ScriptSettings><PandocSettings><Version>2</Version></PandocSettings></EBookSettings>
<PostProcessing Enabled="No" Type="Path"/>
</CompileFormat>`;

const plainSample = (): FormattingSample => ({
  document: readDocumentText(sampleRtf(SANS, '', 26)),
});

/** A section layout that takes its look from the text, as Markdown has no other. */
function newLayout(name: string, include: LayoutInclude): SectionLayoutModel {
  const separator = { type: 'Single', text: '' };
  return {
    name,
    id: newId(),
    include,
    blankLineSeparator: { skipStyles: true, text: '' },
    formatting: {
      override: false,
      ebooksUseBaseFormatting: true,
      title: plainSample(),
      titlePrefix: plainSample(),
      titleSuffix: plainSample(),
      metadata: plainSample(),
      synopsis: plainSample(),
      notes: plainSample(),
      text: plainSample(),
      subtitles: plainSample(),
      preserveUncommonAlignment: true,
      preserveTabsAndIndents: false,
    },
    separators: {
      useDefault: true,
      before: separator,
      between: separator,
      afterOverride: { use: false, ...separator },
    },
  };
}

/** A style of the format, under its own ID, as a format holds one. */
function formatStyle({ name, type, rtf, prefix, suffix }: OwnStyle): FormatStyleModel {
  return {
    name,
    id: newId(),
    type,
    format: readDocumentText(rtf),
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  };
}

/** A new project's compile format: titles and text, with every style Markdown has. */
export function newProjectFormat(): Scrformat {
  const format = scrformat.read(parseXml(REST_OF_FORMAT, 'CompileFormat')!, newUnread());
  const styles = OWN_STYLES.map(formatStyle);
  const named = (name: string) => styles.find((style) => style.name === name)!.id;
  return {
    ...format,
    name: NEW_PROJECT_FORMAT,
    id: newId(),
    sectionLayouts: [
      newLayout('Folder Title', { titles: true }),
      newLayout('Title and Text', { titles: true, text: true }),
      newLayout('Text Only', { text: true }),
    ],
    styles,
    mmd: {
      ...format.mmd!,
      blockQuoteStyleId: named('Block Quote'),
      codeBlockStyleId: named('Code Block'),
      codeSpanId: named('Code Span'),
      captionStyleId: named('Caption'),
    },
  };
}

/**
 * Makes a format the one a project compiles with, each section type written by the layout that
 * suits it: folders by their title, and documents by their title and text.
 */
export function chooseProjectFormat(
  settings: CompileXml,
  { definitions, levels }: SectionTypes,
  { id, sectionLayouts }: Scrformat,
): void {
  const [folderTitle, titleAndText] = sectionLayouts;
  const heading = new Set(levels.folders);
  settings.currentFileType = 'mmd';
  settings.lastUsedFormats = { mmd: id };
  settings.formats.push({
    id,
    sectionLayouts: definitions.map((type) => ({
      typeId: type.id,
      layoutId: (heading.has(type.id) ? folderTitle! : titleAndText!).id,
    })),
  });
}
