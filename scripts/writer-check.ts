/**
 * Copies every fixture project into `<folder>`, each RTF document rewritten from its rich text
 * model alone, for Scrivener to open and compile: `node scripts/writer-check.ts <folder>`.
 * Scrivener reads the writer's RTF as it reads its own when every compile matches the fixture's
 * output.  The copies are compiled here first, as a check that the model kept the text.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileModel } from '../src/compile.ts';
import { readModel } from '../src/model.ts';
import { readRichText } from '../src/rich-text-reader.ts';
import { writeRichText } from '../src/rich-text-writer.ts';

const [folder] = process.argv.slice(2);
if (folder === undefined) {
  console.error('usage: writer-check.ts <folder>');
  process.exit(1);
}
const fixtures = path.join(import.meta.dirname, '..', 'test', 'fixtures');
const goldens = fs.readdirSync(fixtures).filter((file) => file.endsWith('.md'));
const lines: string[] = [];
for (const project of fs.readdirSync(fixtures).filter((name) => name.endsWith('.scriv'))) {
  const copy = path.join(folder, project);
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(fixtures, project), copy, { recursive: true });
  fs.rmSync(path.join(copy, 'user.lock'), { force: true });
  let rewritten = 0;
  for (const file of fs.readdirSync(copy, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.rtf')) continue;
    const at = path.join(copy, file);
    fs.writeFileSync(at, writeRichText(readRichText(fs.readFileSync(at, 'latin1'))), 'latin1');
    rewritten += 1;
  }
  const name = path.basename(project, '.scriv');
  for (const golden of goldens.filter((file) => file.split('.')[0] === name)) {
    const format = golden.split('.')[1];
    const model = readModel(copy, format === 'md' ? undefined : format);
    const same =
      compileModel(model, { now: new Date(2026, 9, 31, 12) }) ===
      fs.readFileSync(path.join(fixtures, golden), 'utf8');
    lines.push(
      `${same ? 'same' : 'DIFFERS'}  ${project} (${rewritten} documents)  ${format === 'md' ? 'last-used format' : format}  ->  ${golden}`,
    );
  }
}
process.stdout.write(`${lines.join('\n')}\n`);
