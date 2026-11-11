import { matches } from './diff.ts';
import { readCutDocument, readRichText, type Cut, type CutDocument } from './rich-text-reader.ts';
import { addedEntries, documentTables, type Tables } from './rich-text-header.ts';
import { changeFormatting, writeParagraph, writeRichText } from './rich-text-writer.ts';
import { same, type Formatting, type RichDocument, type RichParagraph } from './rich-text.ts';
import { writeRtfSyntax, type RtfToken } from './rtf-syntax.ts';
import { firstWord } from './rtf-text.ts';

/**
 * Writes the document as RTF over the RTF it was read from: the source's own bytes wherever the
 * document still reads as the source does, and the writer's, as macOS writes them, for what
 * changed.  macOS writes the same formatting in more than one order, so writing everything anew
 * would change bytes the document did not.  Where keeping the source cannot give back the
 * document (its tables changed, or the source is not the usual shape), it is written anew, unless
 * it is unchanged.
 */
export function rewriteRichText(source: string, document: RichDocument): string {
  const cut = readCutDocument(source);
  const kept = cut && keptRewrite(cut, document);
  if (kept !== undefined && readsAs(readRichText(kept), document)) return kept;
  // A source that cannot be cut, but reads as the document, is the document as it was.
  return same(readRichText(source), document) ? source : writeRichText(document);
}

/**
 * Whether what was written reads as the document: the same, but that its font and colour tables
 * may list, at their ends, fonts and colours its text uses that the document's do not.
 */
function readsAs(read: RichDocument, document: RichDocument): boolean {
  const { fonts, colors, ...rest } = read;
  const { fonts: wantedFonts, colors: wantedColors, ...wanted } = document;
  return same(rest, wanted) && extendsList(wantedFonts, fonts) && extendsList(wantedColors, colors);
}

/** A run of the source's tokens holding whole paragraphs, and the formatting either side. */
interface Piece {
  rtf: string;
  /** Which of the source's paragraphs it holds: from `first`, `count` of them. */
  first: number;
  count: number;
  start: Cut;
  end: Cut;
}

function keptRewrite(cut: CutDocument, document: RichDocument): string | undefined {
  const { document: original, tokens, after, header, cuts } = cut;
  const tables = documentTables(document);
  // Nothing in a header can leave a paragraph unended, so the header always ends at a cut.
  const headerCut = cuts.find((place) => place.tokens === header)!;
  const kept = keptHeader(original, document, tables, tokens.slice(0, header));
  if (kept === undefined) return undefined;
  // Each piece runs to the next cut that ends a paragraph; what is left after the last is the tail.
  const pieces: Piece[] = [];
  let start = headerCut;
  for (const place of cuts) {
    if (place.tokens <= start.tokens || place.paragraphs === start.paragraphs) continue;
    const rtf = writeRtfSyntax(tokens.slice(start.tokens, place.tokens));
    const count = place.paragraphs - start.paragraphs;
    pieces.push({ rtf, first: start.paragraphs, count, start, end: place });
    start = place;
  }
  // What follows the last cut is the last paragraph, when it has no mark ending it, or nothing.
  let tail = writeRtfSyntax(tokens.slice(start.tokens));
  const count = original.paragraphs.length - start.paragraphs;
  if (count > 0) {
    pieces.push({ rtf: tail, first: start.paragraphs, count, start, end: start });
    tail = '';
  }

  let rtf = `{${writeRtfSyntax(kept)}`;
  let formatting: Formatting = headerCut;
  const matched = matchParagraphs(original.paragraphs, document.paragraphs);
  const byFirst = new Map(pieces.map((piece) => [piece.first, piece]));
  let index = 0;
  while (index < document.paragraphs.length) {
    const piece = byFirst.get(matched[index] ?? -1);
    // The piece is kept when every paragraph it holds is here, unchanged and in order.
    const places = piece ? matched.slice(index, index + piece.count) : [];
    const whole =
      piece !== undefined &&
      places.length === piece.count &&
      places.every((place, offset) => place === piece.first + offset);
    if (whole) {
      rtf += changeFormatting(formatting, piece.start, tables) + piece.rtf;
      formatting = piece.end;
      index += piece.count;
    } else {
      const written = writeParagraph(document.paragraphs[index]!, formatting, tables);
      rtf += written.rtf;
      formatting = written.after;
      index += 1;
    }
  }
  return `${rtf}${tail}}${writeRtfSyntax(after)}`;
}

/**
 * The source's header, its font and colour tables with what the document's text adds at their
 * ends, and its lists likewise, so every entry already there keeps its number.  Nothing when the
 * document's settings changed, its own tables are not the source's with entries added, or a table
 * that needs an entry is not there.
 */
function keptHeader(
  original: RichDocument,
  document: RichDocument,
  tables: Tables,
  header: RtfToken[],
): RtfToken[] | undefined {
  const { paragraphs: _, fonts, colors, lists, listOverrides, ...settings } = original;
  const { paragraphs: __, fonts: newFonts, colors: newColors, ...rest } = document;
  const { lists: newLists, listOverrides: newOverrides, ...wanted } = rest;
  const extended = extendsList(fonts, newFonts) && extendsList(colors, newColors);
  if (!same(settings, wanted) || !extended) return undefined;
  // A document with no colour table is written as though it listed only the automatic colour.
  const listsChanged = !same(lists, newLists) || !same(listOverrides, newOverrides);
  const missing = addedEntries(
    tables,
    fonts.length,
    Math.max(colors.length, 1),
    listsChanged ? { lists: newLists, listOverrides: newOverrides } : undefined,
  );
  const kept = header.map((token) => {
    if (token.kind !== 'group') return token;
    const table = firstWord(token);
    for (const [name, entries] of missing) {
      if (name !== table) continue;
      missing.delete(name);
      if (entries.table) return { ...token, tokens: [token.tokens[0]!, ...entries.tokens] };
      return { ...token, tokens: [...token.tokens, ...entries.tokens] };
    }
    return token;
  });
  // A table the source does not have goes after the ones it does.
  for (const [name, { table }] of missing) {
    if (!table) continue;
    missing.delete(name);
    kept.push(...table);
  }
  return [...missing.values()].some((entries) => entries.needed) ? undefined : kept;
}

/** Whether `after` is `before` with entries added at its end. */
function extendsList<T>(before: T[], after: T[]): boolean {
  return same(before, after.slice(0, before.length));
}

/**
 * Each of the document's paragraphs' place among the source's, where it is one of them kept in
 * order (the longest such run), else `undefined`.
 */
function matchParagraphs(
  source: RichParagraph[],
  document: RichParagraph[],
): (number | undefined)[] {
  const matched: (number | undefined)[] = Array.from({ length: document.length });
  for (const { a, b, length } of matches(source, document, same)) {
    for (let at = 0; at < length; at += 1) matched[b + at] = a + at;
  }
  return matched;
}
