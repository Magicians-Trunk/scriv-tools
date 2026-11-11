/**
 * The media fixture: a PDF in the Research folder, and a keyword filed under another, as
 * Scrivener 3.5 writes them.  A project holding either opened but could not be saved.
 */
import type { ProjectSpec } from './project-builder.ts';

export const media: ProjectSpec = {
  title: 'Media Fixture',
  formats: [{ name: 'Fixture Media', id: 'FB000000-0000-4000-8000-000000000001' }],
  keywords: [
    {
      id: '0',
      title: 'Parser',
      color: [0.25, 0.5, 0.75],
      children: [{ id: '1', title: 'Tokenizer', color: [0.5, 0.75, 0.25], children: [] }],
    },
  ],
  items: [{ title: 'Tagged', keywords: ['1'], text: 'A document with a nested keyword.' }],
  research: [{ type: 'PDF', title: 'Specification' }],
};
