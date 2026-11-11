import { describe, expect, it } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { footnote, link, PARA } from '../test/rtf-builder.ts';
import { compareDocument, type ChangedLine } from './document-compare.ts';
import { projectDocuments, readDocumentText } from './document.ts';
import { openProject } from './project.ts';

/** A project whose items hold each text, by the letters A, B and so on. */
function versions(...texts: string[]) {
  const items = texts.map((text, at) => {
    const id = String.fromCharCode(65 + at);
    return { id, title: id, text, styles: [STYLES.heading, STYLES.codeSpan] };
  });
  const project = openProject(writeFixture({ items }));
  const documents = projectDocuments(project.dir);
  return { project, read: (id: string) => documents.text(id) };
}

const imageLink = (file: string) => `see \\{$SCRImageLink[]=${file}\\} here`;

function compared(was: string, now: string) {
  const { project, read } = versions(was, now);
  return compareDocument(project, read('A'), read('B'));
}

const changedLine = (was: string, now: string) =>
  compared(was, now).lines.find((line): line is ChangedLine => line.kind === 'changed')!;

const comment = (id: string, words: string) => ({
  id,
  color: [1, 0, 0],
  text: readDocumentText(`{\\rtf1\\ansi ${words}}`),
});

const picture = (bytes: string) =>
  String.raw`{\*\shppict{\pict {\*\nisusfilename shot_1}\picw1\pich1\jpegblip ${bytes}}}`;

describe('comparing documents', () => {
  it('sees an image linked in the text, by what it links', () => {
    expect(compared(imageLink('one.png'), imageLink('one.png')).changed).toBe(false);
    expect(compared(imageLink('one.png'), imageLink('two.png')).changed).toBe(true);
  });

  it('finds nothing in the same text, and shows it as the same', () => {
    const { lines, changed } = compared('one', 'one');
    expect(changed).toBe(false);
    expect(lines.map(({ kind }) => kind)).toEqual(['same']);
  });

  it('shows words changed, added and removed paragraphs', () => {
    const was = `the quick brown fox${PARA}gone entirely now`;
    const now = `the quick red fox${PARA}fresh text here`;
    const { lines } = compared(was, now);
    expect(lines.map(({ kind }) => kind)).toEqual(['changed', 'removed', 'added']);
    expect(lines[0]).toMatchObject({ words: [{ start: 10, end: 15, was: 'brown', now: 'red' }] });
  });

  it('reads a restyle as a restyle, with no words changed', () => {
    const line = changedLine('heading text', '<$Scr_Ps::0>heading text<!$Scr_Ps::0>');
    expect(line.words).toEqual([]);
    expect(line.style).toEqual({ was: undefined, now: 'Heading 1' });
    expect(line.formatting).toEqual([]);
  });

  it('reads a character style, bold or a link on text that stayed as its look', () => {
    expect(changedLine('one two', 'one <$Scr_Cs::1>two<!$Scr_Cs::1>').looks).toEqual([
      { start: 4, end: 7, text: 'two', was: {}, now: { style: 'Code Span' } },
    ]);
    expect(changedLine('one two', String.raw`one \b two\b0 `).looks[0]?.now).toEqual({
      bold: true,
    });
    const linked = changedLine('one two', `one ${link('https://example.org', 'two')}`);
    expect(linked.looks[0]?.now.link).toEqual({ kind: 'address', address: 'https://example.org' });
  });

  it('keeps apart two looks side by side', () => {
    const line = changedLine('ab cd', String.raw`\b ab\b0  \i cd\i0 `);
    expect(line.looks.map(({ text }) => text)).toEqual(['ab', 'cd']);
  });

  it('shows notes that came, went and changed', () => {
    const add = changedLine('words here', `words here${footnote('a note')}`);
    expect(add.words).toEqual([]);
    expect(add.notes).toEqual([{ note: 'footnote', now: 'a note' }]);
    const gone = changedLine(`words here${footnote('a note')}`, 'words here');
    expect(gone.notes).toEqual([{ note: 'footnote', was: 'a note' }]);
    const both = changedLine(`words here${footnote('old')}`, `words here${footnote('new')}`);
    expect(both.notes).toEqual([{ note: 'footnote', was: 'old', now: 'new' }]);
    const kept = changedLine(
      `words here${footnote('kept')}${footnote('old')}`,
      `words here${footnote('kept')}${footnote('new')}`,
    );
    expect(kept.notes).toHaveLength(1);
  });

  it('shows direct formatting a reader sees, by name, and never the style markers', () => {
    const { project, read } = versions('same words', 'same words');
    const was = read('A');
    const now = read('B');
    now.paragraphs[0]!.format.alignment = 'center';
    expect(compareDocument(project, was, now).lines[0]).toMatchObject({
      kind: 'changed',
      formatting: ['alignment'],
    });
    const sized = read('B');
    const [node] = sized.paragraphs[0]!.content;
    if (node?.kind === 'text') node.format = { ...node.format, size: 40 };
    expect(compareDocument(project, was, sized).lines[0]).toMatchObject({
      formatting: ['size'],
    });
  });

  it('compares the look of pictures, images, annotations, breaks and placeholders', () => {
    const texts = [
      String.raw`{\Scrv_annot \color={\R=1.0\G=0.0\B=0.0} \text=note\end_Scrv_annot}`,
      String.raw`{\Scrv_annot \color={\R=0.0\G=1.0\B=0.0} \text=note\end_Scrv_annot}`,
    ];
    const line = changedLine(texts[0]!, texts[1]!);
    expect(line.notes).toEqual([]);
    expect(compared('<$n> one', '<$n> one').changed).toBe(false);
    expect(compared(String.raw`one\line two`, String.raw`one\line two`).changed).toBe(false);
    expect(
      compared('{$SCRImageLink[w:1;h:1]=a.png}', '{$SCRImageLink[w:2;h:2]=a.png}').changed,
    ).toBe(true);
  });

  it('sees a picture, and which one', () => {
    const { project, read } = versions(`one ${picture('ffd8')}`, `one ${picture('ffd9')}`);
    expect(compareDocument(project, read('A'), read('A')).changed).toBe(false);
    expect(compareDocument(project, read('A'), read('B')).changed).toBe(true);
  });

  it('shows comments that came, went and changed', () => {
    const { project, read } = versions('text', 'text');
    const was = {
      ...read('A'),
      comments: [comment('X', 'one'), comment('Y', 'two'), comment('Z', 'same')],
    };
    const now = {
      ...read('A'),
      comments: [comment('Y', 'changed'), comment('Z', 'same'), comment('W', 'new')],
    };
    const { comments, changed } = compareDocument(project, was, now);
    expect(changed).toBe(true);
    expect(comments).toEqual([
      { id: 'X', was: 'one' },
      { id: 'Y', was: 'two', now: 'changed' },
      { id: 'W', now: 'new' },
    ]);
  });
});
