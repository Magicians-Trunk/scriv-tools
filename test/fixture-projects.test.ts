import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { compileModel } from '../src/compile.ts';
import { readModel } from '../src/model.ts';
import { openProject } from '../src/project.ts';
import { FIXTURES } from './fixture-projects.ts';
import { buildProject } from './project-builder.ts';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const goldens = fs.readdirSync(fixtures).filter((file) => file.endsWith('.md'));

describe('the fixture projects, rebuilt from their specs', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'scrivener-fixtures-'));

  it.each(Object.keys(FIXTURES))('%s compiles as Scrivener compiled it', (name) => {
    const target = path.join(folder, `${name}.scriv`);
    buildProject(path.join(fixtures, 'blank.scriv'), target, FIXTURES[name]!);
    const outputs = goldens.filter((file) => file.split('.')[0] === name);
    expect(outputs).not.toHaveLength(0);
    for (const golden of outputs) {
      const format = golden.split('.')[1];
      const model = readModel(openProject(target), format === 'md' ? undefined : format);
      const compiled = compileModel(model, { now: new Date(2026, 9, 31, 12) });
      expect(compiled).toBe(fs.readFileSync(path.join(fixtures, golden), 'utf8'));
    }
  });
});
