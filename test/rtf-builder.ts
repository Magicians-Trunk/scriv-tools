/** RTF document bodies written the way Scrivener 3 on macOS writes them, for fixture projects. */

const BS = '\\';

/** A paragraph break, as Cocoa writes it: a backslash ending the line. */
export const PARA = `${BS}\n`;

const TABS = [560, 1120, 1680, 2240, 2800, 3360, 3920, 4480, 5040, 5600, 6160, 6720]
  .map((stop) => `${BS}tx${stop}`)
  .join('');

/** Back to a plain paragraph after a list or a table. */
export const PLAIN = `${BS}pard${TABS}${BS}pardirnatural${BS}partightenfactor0\n`;

/** Starts list paragraphs; follow with `listItem` calls and end with `PLAIN`. */
export const LIST = `${BS}pard${BS}tx220${BS}tx720${BS}pardeftab720${BS}li720${BS}fi-720${BS}pardirnatural${BS}partightenfactor0\n`;

/** The bullet and circle markers Cocoa draws for list levels 0 and 1 of list 1. */
export const BULLET = `${BS}uc0${BS}u8226 `;
export const CIRCLE = `${BS}uc0${BS}u9702 `;

const LIST_TABLE = [
  `{${BS}*${BS}listtable`,
  `{${BS}list${BS}listtemplateid1${BS}listhybrid`,
  listLevel(23, 'disc', '', 1, `${BS}'01${BULLET};`, '', 720),
  listLevel(23, 'circle', '', 2, `${BS}'01${CIRCLE};`, '', 1440),
  `{${BS}listname ;}${BS}listid1}`,
  `{${BS}list${BS}listtemplateid2${BS}listhybrid`,
  listLevel(0, 'decimal', '.', 101, `${BS}'02${BS}'00.;`, `${BS}'01`, 720),
  listLevel(4, 'lower-alpha', '.', 102, `${BS}'02${BS}'01.;`, `${BS}'01`, 1440),
  `{${BS}listname ;}${BS}listid2}}`,
  `{${BS}*${BS}listoverridetable{${BS}listoverride${BS}listid1${BS}listoverridecount0${BS}ls1}{${BS}listoverride${BS}listid2${BS}listoverridecount0${BS}ls2}}`,
].join('');

/** One level of a list definition: its number format, marker, and indent. */
function listLevel(
  format: number,
  marker: string,
  after: string,
  template: number,
  text: string,
  numbers: string,
  indent: number,
): string {
  const fixed = `${BS}leveljc0${BS}leveljcn0${BS}levelfollow0${BS}levelstartat1${BS}levelspace360${BS}levelindent0`;
  return (
    `{${BS}listlevel${BS}levelnfc${format}${BS}levelnfcn${format}${fixed}` +
    `{${BS}*${BS}levelmarker ${BS}{${marker}${BS}}${after}}` +
    `{${BS}leveltext${BS}leveltemplateid${template}${text}}{${BS}levelnumbers${numbers};}` +
    `${BS}fi-360${BS}li${indent}${BS}lin${indent} }`
  );
}

/** A Cocoa RTF document with Scrivener's header, a list table, and the given body. */
export function rtfDocument(body: string): string {
  return (
    `{${BS}rtf1${BS}ansi${BS}ansicpg1252${BS}cocoartf2822\n` +
    `{${BS}fonttbl${BS}f0${BS}fswiss${BS}fcharset0 Helvetica;${BS}f1${BS}fnil${BS}fcharset0 Menlo-Regular;}\n` +
    `{${BS}colortbl;${BS}red255${BS}green255${BS}blue255;}\n` +
    `{${BS}*${BS}expandedcolortbl;;}\n${LIST_TABLE}\n${PLAIN}\n${BS}f0${BS}fs24 ${BS}cf0 ${body}}`
  );
}

/** One list paragraph of list `list` (1 bullets, 2 numbers) at `level`, drawn with `marker`. */
export function listItem(list: number, level: number, marker: string, text: string): string {
  return `${BS}ls${list}${BS}ilvl${level} {${BS}listtext\t${marker}\t}${text}${PARA}`;
}

/** A link field: a web address, `scrivlnk://<id>` or `scrivcmt://<id>`. */
export function link(target: string, text: string): string {
  return `{${BS}field{${BS}*${BS}fldinst{HYPERLINK "${target}"}}{${BS}fldrslt ${text}}}`;
}

/** An inline footnote, annotation or Preserve Formatting, stored as escaped text. */
export function footnote(text: string): string {
  return `${BS}{${BS}${BS}Scrv_fn=${text}${BS}${BS}end_Scrv_fn${BS}}`;
}

export function annotation(text: string): string {
  return `${BS}{${BS}${BS}Scrv_annot ${BS}${BS}color=${BS}{${BS}${BS}R=1.0${BS}${BS}G=0.0${BS}${BS}B=0.0${BS}} ${BS}${BS}text=${text}${BS}${BS}end_Scrv_annot${BS}}`;
}

export function preserved(text: string): string {
  return `${BS}{${BS}${BS}Scrv_ps=${text}${BS}${BS}end_Scrv_ps${BS}}`;
}

export function struck(text: string): string {
  return `{${BS}strike ${text}}`;
}

/** A line break inside a paragraph. */
export const LINE = `${BS}line `;

/** Curly quotes, an apostrophe, dashes and an ellipsis, as cp1252 escapes. */
export const QUOTE_OPEN = `${BS}'93`;
export const QUOTE_CLOSE = `${BS}'94`;
export const APOSTROPHE = `${BS}'92`;
export const EM_DASH = `${BS}'97`;
export const EN_DASH = `${BS}'96`;
export const ELLIPSIS = `${BS}'85`;

/** A code span in Menlo, for a document whose `content.styles` lists a code span style at `index`. */
export function codeSpan(index: number, text: string): string {
  return `<$Scr_Cs::${index}>\n${BS}f1 ${text}\n${BS}f0 <!$Scr_Cs::${index}>`;
}

/** A table cell: its text, alignment (`ql`, `qc`, `qr`, `qj`) and merge. */
export interface Cell {
  text?: string;
  align?: 'qc' | 'qr' | 'qj';
  merge?: 'first' | 'rest' | 'top' | 'below';
}

const MERGE_WORDS = { first: 'clmgf', rest: 'clmrg', top: 'clvmgf', below: 'clvmrg' };

/** A table, row by row; a cell with no text in a `rest` merge is written as an empty cell. */
export function table(rows: Cell[][], width = 2160): string {
  return rows
    .map((row, index) => {
      const definitions = row
        .map(
          (cell, column) =>
            `${cell.merge ? `${BS}${MERGE_WORDS[cell.merge]} ` : ''}${BS}clvertalt ${BS}clshdrawnil ${BS}clbrdrt${BS}brdrnil ${BS}clbrdrl${BS}brdrnil ${BS}clbrdrb${BS}brdrnil ${BS}clbrdrr${BS}brdrnil ${BS}clpadl100 ${BS}clpadr100 ${BS}gaph${BS}cellx${width * (column + 1)}\n`,
        )
        .join('');
      const cells = row
        .map((cell) =>
          cell.merge === 'rest'
            ? `${BS}pard${BS}intbl${BS}itap1${BS}cell `
            : `${BS}pard${BS}intbl${BS}itap1${BS}pardeftab720${cell.align ? BS + cell.align : ''}${BS}partightenfactor0\n\n${BS}f0${BS}fs24 ${BS}cf0 ${cell.text ?? ''}${BS}cell \n`,
        )
        .join('');
      const last = index === rows.length - 1 ? `${BS}lastrow` : '';
      return `${BS}itap1${BS}trowd ${BS}taflags1 ${BS}trgaph108${BS}trleft-108 ${BS}trbrdrl${BS}brdrnil ${BS}trbrdrr${BS}brdrnil \n${definitions}${cells}${last}${BS}row\n`;
    })
    .join('');
}
