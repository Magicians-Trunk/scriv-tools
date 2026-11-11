import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { readRtfSyntax, writeRtfSyntax } from './rtf-syntax.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');

/** Every RTF file in the fixture projects, as Scrivener wrote it. */
const rtfFiles = fs
  .readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.rtf'))
  .map((file) => path.join(FIXTURES, file));

describe('RTF syntax', () => {
  it('writes every fixture document back exactly as Scrivener wrote it', () => {
    expect(rtfFiles.length).toBeGreaterThan(100);
    const changed = rtfFiles.filter((file) => {
      const source = fs.readFileSync(file, 'latin1');
      return writeRtfSyntax(readRtfSyntax(source)) !== source;
    });
    expect(changed).toEqual([]);
  });

  it('reads groups, destinations, words, symbols, hex and text', () => {
    expect(readRtfSyntax("{\\rtf1 a\\b0 \\fi-360\\'93{\\*\\x y}\\\\\n}")).toEqual([
      {
        kind: 'group',
        ignorable: false,
        tokens: [
          { kind: 'control', word: 'rtf', parameter: 1, space: true },
          { kind: 'text', text: 'a' },
          { kind: 'control', word: 'b', parameter: 0, space: true },
          { kind: 'control', word: 'fi', parameter: -360, space: false },
          { kind: 'hex', byte: 0x93, written: '93' },
          {
            kind: 'group',
            ignorable: true,
            tokens: [
              { kind: 'control', word: 'x', space: true },
              { kind: 'text', text: 'y' },
            ],
          },
          { kind: 'symbol', symbol: '\\' },
          { kind: 'text', text: '\n' },
        ],
      },
    ]);
  });

  it('keeps what is malformed as it is written', () => {
    for (const source of ['{\\rtf1 {open', 'a}b', '\\up007 \\dn-0x', 'end\\', "\\'9"]) {
      expect(writeRtfSyntax(readRtfSyntax(source))).toBe(source);
    }
    expect(readRtfSyntax('{a')).toEqual([
      { kind: 'group', ignorable: false, tokens: [{ kind: 'text', text: 'a' }], open: true },
    ]);
  });
});
