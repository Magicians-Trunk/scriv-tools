/** The project's styles, from `Files/styles.xml`: each with its formatting as a sample document. */
import { documentRichText, type DocumentText, rtfText } from './document.ts';
import type { Project } from './project.ts';
import { refuseUnknown } from './unsupported.ts';
import {
  attribute,
  type Codec,
  color,
  element,
  optionalAttribute,
  optionalList,
  repeated,
  string,
  textChild,
  textElement,
  writeXml,
} from './xml-codec.ts';

export interface ProjectStyle {
  name: string;
  id: string;
  /** What it styles: `Para`, `Char` or `Para+Char`. */
  type: string;
  /** Which font settings it changes, such as `Size`. */
  fontChange?: string;
  /** The highlight box Scrivener draws around its text: red, green and blue, each from 0 to 1. */
  box?: number[];
  /** The style the next paragraph takes. */
  next?: string;
  shortcut?: string;
  /** Its formatting: a sample of text in the style, as RTF read into markup. */
  format: DocumentText;
  /** A list style's markers, by level. */
  lists?: string[];
}

const style = element<ProjectStyle>('Style', {
  name: attribute('Name', string),
  id: attribute('ID', string),
  type: attribute('Type', string),
  fontChange: optionalAttribute('FontChange', string),
  box: optionalAttribute('Box', color),
  next: optionalAttribute('Next', string),
  shortcut: optionalAttribute('Shortcut', string),
  format: textChild('Format', rtfText, true),
  lists: optionalList('Lists', textElement('ListItem', string)),
});

/** The `Files/styles.xml` file. */
export const stylesFile: Codec<{ styles: ProjectStyle[] }> = element('Styles', {
  styles: repeated(style),
});

/** What a style does to the characters in it, as far as its sample says. */
export interface StyleLook {
  bold: boolean;
  italic: boolean;
  monospace: boolean;
}

/** A font's name says what the RTF may not: a style can name a bold face and never set `\b`. */
const BOLD_FONT = /bold|black|heavy/i;
const ITALIC_FONT = /italic|oblique/i;
const MONOSPACE_FONT = /mono|menlo|courier|consolas/i;

/** What a style's sample does to characters: a paragraph style's sample does nothing to them. */
export function styleLook({ type, format }: ProjectStyle): StyleLook {
  const looks = type.includes('Char')
    ? documentRichText(format).paragraphs.flatMap(({ content }) => content.map((run) => run.format))
    : [];
  const fontIs = (font: RegExp) => looks.some((look) => font.test(look.font?.name ?? ''));
  return {
    bold: looks.some((look) => look.bold) || fontIs(BOLD_FONT),
    italic: looks.some((look) => look.italic) || fontIs(ITALIC_FONT),
    monospace: fontIs(MONOSPACE_FONT),
  };
}

/**
 * The project's styles as their file, as Scrivener writes it.  Refuses styles read with anything
 * the library does not know.
 */
export function writeStyles({
  styles,
  unsupported,
}: Pick<Project, 'styles' | 'unsupported'>): string {
  refuseUnknown('the styles file', unsupported.styles);
  return writeXml(stylesFile.write({ styles }));
}
