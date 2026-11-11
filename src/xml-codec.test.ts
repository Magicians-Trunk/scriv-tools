import { describe, expect, it } from 'vite-plus/test';
import {
  attribute,
  byName,
  child,
  closedWhenEmpty,
  decimal,
  element,
  integer,
  list,
  listOf,
  string,
  text,
  textElement,
  newUnread,
  writeXml,
} from './xml-codec.ts';
import { parseXml } from './xml.ts';

/** Reads `xml` with the codec, and returns what it read, what it did not know, and it written. */
function roundTrip<T>(codec: ReturnType<typeof element<T>>, xml: string) {
  const found = newUnread();
  const value = codec.read(parseXml(xml, codec.name)!, found);
  return {
    value,
    unknown: [...found.unknown],
    missing: [...found.missing],
    written: writeXml(codec.write(value)),
  };
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

describe('element codecs', () => {
  const note = element<{ size: number; title: string }>('Note', {
    size: attribute('Size', decimal),
    title: closedWhenEmpty(string),
  });
  const notes = element<{ count: number; notes: { size: number; title: string }[] }>('Notes', {
    count: attribute('Count', integer),
    notes: list('List', note),
  });

  it('writes decimals as Cocoa does, empty text closed, and attributes escaped', () => {
    const { value, written } = roundTrip(
      notes,
      '<Notes Count="2"><List><Note Size="1.50"/><Note Size="72">a &amp; "b"</Note></List></Notes>',
    );
    expect(value.notes).toEqual([
      { size: 1.5, title: '' },
      { size: 72, title: 'a & "b"' },
    ]);
    expect(written).toBe(
      `${DECLARATION}<Notes Count="2">\n    <List>\n        <Note Size="1.5"/>\n` +
        '        <Note Size="72.0">a &amp; "b"</Note>\n    </List>\n</Notes>',
    );
    expect(writeXml(note.write({ size: 0.1234567, title: '<"x">' }))).toBe(
      `${DECLARATION}<Note Size="0.123457">&lt;"x"&gt;</Note>`,
    );
  });

  it('lists what it does not know or cannot find, naming where', () => {
    const { value, unknown, missing } = roundTrip(
      notes,
      '<Notes Extra="1"><Other/><List><Note Size="1">a</Note></List><List/></Notes>',
    );
    expect(unknown).toEqual([
      'the Extra attribute of Notes',
      'a Other element in Notes',
      'more than one List element in Notes',
    ]);
    expect(missing).toEqual(['a missing Count attribute of Notes']);
    expect(value.notes).toEqual([{ size: 1, title: 'a' }]);
    const wrapped = element<{ note: { size: number; title: string } }>('Wrap', {
      note: child(note),
    });
    expect(roundTrip(wrapped, '<Wrap/>').missing).toEqual([
      'a missing Note element in Wrap',
      'a missing Size attribute of Note',
    ]);
  });

  it('reads children of any name by name, in order, and writes them back', () => {
    const used = element<{ formats: Record<string, string> }>('LastUsed', {
      formats: byName((name) => textElement(name, string)),
    });
    const { value, unknown, written } = roundTrip(
      used,
      '<LastUsed><mmd>A</mmd><pdf>B</pdf><pdf>C</pdf></LastUsed>',
    );
    expect(value.formats).toEqual({ mmd: 'A', pdf: 'B' });
    expect(unknown).toEqual(['more than one pdf element in LastUsed']);
    expect(written).toBe(
      `${DECLARATION}<LastUsed>\n    <mmd>A</mmd>\n    <pdf>B</pdf>\n</LastUsed>`,
    );
  });

  it('stops when a field that must have a value reads none', () => {
    const lost = element<{ value?: string }>('Lost', {
      value: { attributes: [], children: [], read: () => undefined, write: () => undefined },
    });
    expect(() => roundTrip(lost, '<Lost/>')).toThrow('Lost was read without a value it needs.');
  });

  it('writes text as CDATA where Scrivener does, and an element with no children open and closed', () => {
    const held = element<{ rtf: string }>('Held', { rtf: text(string, true) });
    expect(writeXml(held.write({ rtf: '{\\rtf1 <a>}' }))).toBe(
      `${DECLARATION}<Held><![CDATA[{\\rtf1 <a>}]]></Held>`,
    );
    const ids = element<{ ids: string[] }>('Ids', { ids: text(listOf(string, ',')) });
    expect(roundTrip(ids, '<Ids></Ids>').value).toEqual({ ids: [] });
    expect(writeXml({ name: 'Empty', attributes: [], content: [] })).toBe(
      `${DECLARATION}<Empty></Empty>`,
    );
  });
});
