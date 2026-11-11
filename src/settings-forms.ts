/** The two plain forms settings are kept in besides XML: Apple's JSON, and Qt's INI on Windows. */

/** A JSON value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A value as Apple's JSON writer writes it: two spaces to a level, and ` : ` after a key. */
function writeJsonValue(value: JsonValue, indent: string): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[\n\n' + indent + ']';
    const items = value.map((each) => `${inner}${writeJsonValue(each, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{\n\n' + indent + '}';
    const written = entries.map(
      ([key, each]) => `${inner}${JSON.stringify(key)} : ${writeJsonValue(each, inner)}`,
    );
    return `{\n${written.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** A JSON settings file, as Apple writes one. */
export const writeJson = (value: JsonValue) => writeJsonValue(value, '');

/** A section of an INI file: its name, and its keys in order, each value as written. */
export interface IniSection {
  name: string;
  entries: [string, string][];
}

/** An INI file's sections, in order. */
export function readIni(source: string): IniSection[] {
  const sections: IniSection[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (line === '') continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      sections.push({ name: line.slice(1, -1), entries: [] });
      continue;
    }
    const at = line.indexOf('=');
    sections.at(-1)?.entries.push([line.slice(0, at), line.slice(at + 1)]);
  }
  return sections;
}

/** Sections as an INI file, a blank line after each, in the line ends given. */
export function writeIni(sections: IniSection[], end = '\n'): string {
  return sections
    .map(({ name, entries }) =>
      [`[${name}]`, ...entries.map(([key, value]) => `${key}=${value}`), '', ''].join(end),
    )
    .join('')
    .slice(0, -end.length);
}
