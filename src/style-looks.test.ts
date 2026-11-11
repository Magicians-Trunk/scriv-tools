import { describe, expect, it } from 'vite-plus/test';
import { projectDocuments, readDocumentText } from './document.ts';
import { rtfDocument } from '../test/rtf-builder.ts';
import { insertParagraphs, setParagraphStyle } from './edit.ts';
import { namedStyle, readParagraphs, sampleOf, styledLook } from './edit-pieces.ts';
import { openProject } from './project.ts';
import { writeFixture } from '../test/fixture.ts';
import { styleRange } from './edit-styles.ts';
import { replaceRange } from './edit-text.ts';
import { memoryFiles } from './memory-files.ts';
import { createProject } from './new-project.ts';
import type { CharacterFormat } from './rich-text.ts';

/** A new project's one document, holding one paragraph: plain text with one italic word. */
function opened() {
  const files = memoryFiles();
  const project = createProject('/work', 'Looks', files, new Date(2026, 10, 7, 12));
  const [item] = project.binder[0]!.children;
  const document = projectDocuments(project.dir, project.files).text(item!.id);
  insertParagraphs(project, document, document.paragraphs.length, [
    { text: [{ text: 'plain ' }, { text: 'word', italic: true }, { text: ' code' }] },
  ]);
  const at = document.paragraphs.length - 1;
  const texts = () =>
    document.paragraphs[at]!.content.flatMap((node) => (node.kind === 'text' ? [node] : []));
  return { project, document, at, texts };
}

const BODY: CharacterFormat = { font: { name: 'Body', family: 'swiss' }, size: 13, bold: true };

describe('a style applied, as Scrivener applies its type and font choices', () => {
  it('gives a Paragraph style no character attribute, and the font only as FontChange says', () => {
    const { project } = opened();
    const quote = namedStyle(project, 'Block Quote');
    expect(sampleOf(quote).character.font?.name).toMatch(/Oblique/);
    expect(styledLook(quote, BODY)).toEqual(BODY);
    const sized = { ...quote, fontChange: 'Size' };
    expect(styledLook(sized, BODY)).toEqual({ ...BODY, size: sampleOf(quote).character.size });
  });

  it('gives a Character or Paragraph+Character style its own attributes, but the font only as FontChange says', () => {
    const { project } = opened();
    const heading = namedStyle(project, 'Heading 1');
    const { font: _font, size, ...own } = sampleOf(heading).character;
    expect(styledLook(heading, BODY)).toEqual({ ...own, font: BODY.font, size });
    const code = namedStyle(project, 'Code Span');
    expect(styledLook(code, BODY).font).toEqual(sampleOf(code).character.font);
    expect(styledLook({ ...code, fontChange: undefined }, BODY).font).toEqual(BODY.font);
  });

  it('keeps Block Quote upright, and the italic word italic', () => {
    const { project, document, at, texts } = opened();
    const before = texts().map(({ format }) => format);
    setParagraphStyle(project, document, at, 'Block Quote');
    expect(texts().map(({ format }) => format)).toEqual(before);
    expect(texts().some(({ format }) => /Oblique/.test(format.font?.name ?? ''))).toBe(false);
  });

  it('makes a Paragraph+Character paragraph alike, but for text in a character style', () => {
    const { project, document, at, texts } = opened();
    styleRange(project, document, at, { start: 11, end: 15 }, 'Code Span');
    const coded = texts().at(-1)!.format;
    setParagraphStyle(project, document, at, 'Heading 1');
    const looks = texts().map(({ format }) => format);
    expect(looks.some((format) => format.italic)).toBe(false);
    expect(texts().at(-1)!.format).toEqual(coded);
    expect(looks[0]).toEqual(styledLook(namedStyle(project, 'Heading 1'), before(looks[0]!)));
  });

  it("gives typed text a Paragraph+Character style's look, and plain text none", () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: 'plain words' }] });
    const fixture = openProject(dir);
    const plain = projectDocuments(dir).text('A');
    replaceRange(fixture, plain, 0, { start: 0, end: 5 }, [{ text: 'PLAIN', italic: true }]);
    expect(readParagraphs(fixture, plain)[0]!.text[0]).toEqual({ text: 'PLAIN', italic: true });
    const quote = namedStyle(fixture, 'Block Quote');
    quote.type = 'Para+Char';
    quote.format = readDocumentText(rtfDocument(String.raw`\i sample`));
    setParagraphStyle(fixture, plain, 0, 'Block Quote');
    replaceRange(fixture, plain, 0, { start: 0, end: 5 }, [{ text: 'QUOTE' }]);
    const typed = plain.paragraphs[0]!.content.find(
      (node) => node.kind === 'text' && node.text.includes('QUOTE'),
    );
    expect(typed).toMatchObject({ format: { italic: true } });
    const { project, document, at, texts } = opened();
    setParagraphStyle(project, document, at, 'Heading 1');
    replaceRange(project, document, at, { start: 0, end: 5 }, [{ text: 'TITLE' }]);
    const { bold } = styledLook(namedStyle(project, 'Heading 1'), {});
    expect(!!texts()[0]!.format.bold).toBe(!!bold);
  });
});

/** A look as it was before a style: only the font and size a style may leave stay. */
const before = ({ font, size }: CharacterFormat): CharacterFormat => ({
  ...(font ? { font } : {}),
  ...(size === undefined ? {} : { size }),
});
