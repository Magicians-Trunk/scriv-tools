import { describe, expect, it } from 'vite-plus/test';
import { readDocumentText } from './document.ts';
import type { ProjectStyle } from './project-styles.ts';
import { shapeOfStyle, styleMapping, styleOfShape } from './style-mapping.ts';

const style = (name: string, lists?: string[], sample = ''): ProjectStyle => ({
  name,
  id: name,
  type: 'Para',
  format: readDocumentText(sample),
  ...(lists ? { lists } : {}),
});

const project = {
  styles: [
    style('Heading 1'),
    style('Chapter', undefined, String.raw`{\rtf1 <$Scr_H::2>Attributes<!$Scr_H::2>}`),
    style('Marked'),
    style('Other'),
    style('Bullet List', ['{disc}']),
    style('Numbered List', ['{decimal}.']),
  ],
};

const mapping = styleMapping(project);

describe('styleMapping', () => {
  it("reads the stylesheet: a sample's heading level, then Scrivener's names, and its lists", () => {
    expect(mapping).toEqual({
      headings: {
        1: 'Heading 1',
        2: 'Chapter',
        3: 'Heading 3',
        4: 'Heading 4',
        5: 'Heading 5',
        6: 'Heading 6',
      },
      quote: 'Block Quote',
      code: 'Code Block',
      codeSpan: 'Code Span',
      bullet: 'Bullet List',
      numbered: 'Numbered List',
    });
  });

  it('maps no list it cannot write', () => {
    const lettered = { styles: [style('Lettered', ['{mystery}.'])] };
    expect(styleMapping(lettered).bullet).toBeUndefined();
    expect(styleMapping(lettered).numbered).toBeUndefined();
  });

  it('takes what a caller chooses for a role', () => {
    expect(styleMapping(project, { quote: 'Other', codeSpan: 'Marked' })).toMatchObject({
      quote: 'Other',
      codeSpan: 'Marked',
      code: 'Code Block',
    });
  });

  it('maps the later of two list styles of one kind', () => {
    const two = { styles: [style('One', ['{disc}']), style('Two', ['{disc}'])] };
    expect(styleMapping(two).bullet).toBe('Two');
  });
});

describe('shapes', () => {
  it('goes from each style to its node and back, a heading by its level', () => {
    for (const name of ['Block Quote', 'Code Block', 'Bullet List', 'Numbered List']) {
      expect(styleOfShape(mapping, shapeOfStyle(mapping, name))).toEqual({ style: name });
    }
    const heading = shapeOfStyle(mapping, 'Other', 2);
    expect(heading).toEqual({ kind: 'heading', depth: 2 });
    expect(styleOfShape(mapping, heading)).toEqual({ style: 'Chapter', level: 2 });
    expect(shapeOfStyle(mapping, 'Chapter')).toEqual({ kind: 'paragraph' });
  });

  it('takes no style, and a style no node maps to, as a paragraph', () => {
    expect(shapeOfStyle(mapping, undefined)).toEqual({ kind: 'paragraph' });
    expect(shapeOfStyle(mapping, 'Other')).toEqual({ kind: 'paragraph' });
    expect(styleOfShape(mapping, { kind: 'paragraph' })).toEqual({});
  });

  it('has no style for a node nothing is mapped to', () => {
    expect(styleOfShape({ headings: {} }, { kind: 'heading', depth: 4 })).toBeUndefined();
  });
});
