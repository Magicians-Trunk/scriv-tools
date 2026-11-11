/** Apple's XML property lists, as typed values, read by the XML parser and written as Apple does. */
import { XMLParser } from 'fast-xml-parser';

/** A value whose written form is kept, so it writes back as it was. */
export interface PlistScalar {
  kind: 'string' | 'integer' | 'real' | 'date' | 'data';
  value: string;
}

/** A list's value: a dictionary keeps its keys in order. */
export type PlistValue = PlistScalar | boolean | PlistValue[] | Map<string, PlistValue>;

/** The XML parser's node when it keeps order: one key names the tag, and `#text` is text. */
type Ordered = Record<string, Ordered[] | string>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: true,
  trimValues: false,
  parseTagValue: false,
  processEntities: true,
});

const TEXT = '#text';
const SCALARS = new Set(['string', 'integer', 'real', 'date', 'data']);

/** The node's tag. */
const tagOf = (node: Ordered) => Object.keys(node).find((key) => key !== ':@')!;

/** Whether what a tag holds is a node, not the text of one. */
const isNode = (held: Ordered | string): held is Ordered => typeof held !== 'string';

/** Whether what a text node holds is text. */
const isText = (held: unknown): held is string => typeof held === 'string';

/** What a tag holds. */
const heldBy = (node: Ordered, tag: string) => [node[tag]!].flat().filter(isNode);

/** The nodes inside a tag, leaving out the white space between them. */
const inside = (node: Ordered, tag: string) =>
  heldBy(node, tag).filter((each) => tagOf(each) !== TEXT);

/** A node's text, joined. */
const textOf = (node: Ordered, tag: string) =>
  heldBy(node, tag)
    .map((each) => each[TEXT])
    .filter(isText)
    .join('');

/** A value from its node.  A tag a list cannot hold stops. */
function readValue(node: Ordered): PlistValue {
  const tag = tagOf(node);
  if (tag === 'true') return true;
  if (tag === 'false') return false;
  if (tag === 'array') return inside(node, tag).map(readValue);
  if (tag === 'dict') {
    const nodes = inside(node, tag);
    const entries = new Map<string, PlistValue>();
    for (let at = 0; at < nodes.length; at += 2) {
      entries.set(textOf(nodes[at]!, 'key'), readValue(nodes[at + 1]!));
    }
    return entries;
  }
  if (!SCALARS.has(tag)) throw new Error(`A property list cannot hold <${tag}>.`);
  const value = textOf(node, tag);
  if (tag === 'data') return { kind: 'data', value: value.replaceAll(/\s/g, '') };
  if (tag === 'string') return { kind: 'string', value };
  if (tag === 'integer') return { kind: 'integer', value };
  return tag === 'real' ? { kind: 'real', value } : { kind: 'date', value };
}

/** A property list's value, from its file. */
export function readPlist(source: string): PlistValue {
  const nodes: Ordered[] = parser.parse(source);
  const plist = nodes.find((node) => tagOf(node) === 'plist');
  const [root] = plist ? inside(plist, 'plist') : [];
  if (!root) throw new Error('The file is not a property list.');
  return readValue(root);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escape = (value: string) => value.replaceAll(/[&<>]/g, (found) => ESCAPES[found]!);

/** How wide Apple writes data, less eight for each level of indent. */
const DATA_WIDTH = 76;

/** Data in lines, at this depth. */
function writeData(value: string, depth: number): string[] {
  const indent = '\t'.repeat(depth);
  const width = DATA_WIDTH - depth * 8;
  const lines: string[] = [`${indent}<data>`];
  for (let at = 0; at < value.length; at += width) {
    lines.push(`${indent}${value.slice(at, at + width)}`);
  }
  return [...lines, `${indent}</data>`];
}

function writeValue(value: PlistValue, depth: number): string[] {
  const indent = '\t'.repeat(depth);
  if (typeof value === 'boolean') return [`${indent}<${value}/>`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}<array/>`];
    const items = value.flatMap((each) => writeValue(each, depth + 1));
    return [`${indent}<array>`, ...items, `${indent}</array>`];
  }
  if (value instanceof Map) {
    if (value.size === 0) return [`${indent}<dict/>`];
    const inner = '\t'.repeat(depth + 1);
    const entries = [...value].flatMap(([key, each]) => [
      `${inner}<key>${escape(key)}</key>`,
      ...writeValue(each, depth + 1),
    ]);
    return [`${indent}<dict>`, ...entries, `${indent}</dict>`];
  }
  if (value.kind === 'data') return writeData(value.value, depth);
  return [`${indent}<${value.kind}>${escape(value.value)}</${value.kind}>`];
}

const HEADER = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
];

/** A property list as Apple writes it. */
export function writePlist(value: PlistValue): string {
  return [...HEADER, ...writeValue(value, 0), '</plist>', ''].join('\n');
}
