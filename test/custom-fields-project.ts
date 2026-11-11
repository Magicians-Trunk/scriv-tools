/**
 * The custom fields fixture: the raw markup fixture's `<$custom:field>` came out empty, for a
 * field whose ID is its title in lower case, as Scrivener names fields itself.  Fields named each
 * way, looked up by ID and by title.
 */
import type { ProjectSpec } from './project-builder.ts';
import { PARA } from './rtf-builder.ts';

const FIELDS = [
  { id: 'field', title: 'Field' },
  { id: 'note', title: 'Note' },
  { id: 'colour', title: 'Colour Name' },
  { id: 'shortcut', title: 'MacShortcut' },
  { id: 'Upper', title: 'Upper' },
];

export const customFields: ProjectSpec = {
  title: 'Custom Fields Fixture',
  customFields: FIELDS,
  formats: [{ name: 'Fixture Custom Fields', id: 'FA000000-0000-4000-8000-000000000001' }],
  items: [
    {
      title: 'Each field',
      custom: Object.fromEntries(FIELDS.map(({ id }) => [id, `${id}-value`])),
      text: FIELDS.flatMap(({ id, title }) => [
        `${id} by ID: <$custom:${id}>`,
        `${id} by title: <$custom:${title}>`,
      ]).join(PARA),
    },
  ],
};
