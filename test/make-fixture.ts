/**
 * Writes a fixture project for Scrivener to compile: `node test/make-fixture.ts <name> <folder>`
 * builds `<folder>/<name>.scriv` from `fixtures/blank.scriv`.  See `fixture-projects.ts`.
 */
import * as path from 'node:path';
import { FIXTURES, PENDING_FIXTURES } from './fixture-projects.ts';
import { buildProject } from './project-builder.ts';

const [name, folder] = process.argv.slice(2);
const all = { ...FIXTURES, ...PENDING_FIXTURES };
const spec = name === undefined ? undefined : all[name];
if (!spec || folder === undefined) {
  console.error(`usage: make-fixture.ts <${Object.keys(all).join('|')}> <folder>`);
  process.exit(1);
}
const target = path.join(folder, `${name}.scriv`);
buildProject(path.join(import.meta.dirname, 'fixtures', 'blank.scriv'), target, spec);
process.stdout.write(`${target}\n`);
