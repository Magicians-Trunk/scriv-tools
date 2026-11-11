/**
 * The raw markup fixture: what Scrivener does with placeholders, replacements and smart
 * punctuation in text set in a style treated as raw markup, as a paragraph style and as a
 * character style.
 */
import type { ProjectSpec } from './project-builder.ts';
import { APOSTROPHE, PARA, QUOTE_CLOSE, QUOTE_OPEN, rtfDocument } from './rtf-builder.ts';

const STYLE_FORMAT = `<Format><![CDATA[${rtfDocument('Attributes')}]]></Format>`;
const rawStyle = (name: string, id: string, type: string, prefix: string, suffix: string) =>
  `<Style Name="${name}" ID="${id}" Type="${type}">${STYLE_FORMAT}<RawMarkup>Yes</RawMarkup>` +
  `<Prefix><![CDATA[${prefix}]]></Prefix><Suffix><![CDATA[${suffix}]]></Suffix></Style>`;

/** The same text with each kind of placeholder, a smart quote and a word a replacement swaps. */
const PIECES = [
  ['custom field', '<$custom:field>'],
  ['title', '<$title>'],
  ['counter', '<$n>'],
  ['punctuation', `${QUOTE_OPEN}it${APOSTROPHE}s${QUOTE_CLOSE}`],
  ['replacement', 'SWAPME'],
] as const;

export const rawMarkup: ProjectSpec = {
  title: 'Raw Markup Fixture',
  customFields: [{ id: 'field', title: 'Field' }],
  projectStyles: ['Raw Block'],
  characterStyles: ['Raw Span'],
  formats: [
    {
      name: 'Fixture Raw Markup',
      id: 'F6000000-0000-4000-8000-000000000001',
      replacements:
        '<Replacements><Replacement><Replace><![CDATA[SWAPME]]></Replace><With><![CDATA[swapped]]></With></Replacement></Replacements>',
      styles:
        rawStyle('Raw Block', 'F6000000-0000-4000-8000-000000000010', 'Para', '[raw]', '[/raw]') +
        rawStyle('Raw Span', 'F6000000-0000-4000-8000-000000000011', 'Char', '{', '}'),
    },
  ],
  items: [
    ...PIECES.map(([name, piece]) => ({
      title: `Raw paragraph, ${name}`,
      styles: ['Raw Block'],
      custom: { field: 'value' },
      text: `before ${piece}${PARA}<$Scr_Ps::0>raw ${piece} end${PARA}<!$Scr_Ps::0>after ${piece}`,
    })),
    ...PIECES.map(([name, piece]) => ({
      title: `Raw span, ${name}`,
      styles: ['Raw Span'],
      custom: { field: 'value' },
      text: `before <$Scr_Cs::0>raw ${piece} end<!$Scr_Cs::0> after ${piece}`,
    })),
  ],
};
