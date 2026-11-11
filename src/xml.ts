import { localFiles } from './local-files.ts';
import { type Files, readText } from './files.ts';
import { XMLParser } from 'fast-xml-parser';

/**
 * A parsed XML element.  Every child element is an array, attributes are strings, and the text
 * (including CDATA) is `#text`, untrimmed, because Scrivener's prefixes keep their whitespace.
 */
export interface XmlElement {
  [name: string]: XmlElement[] | string | undefined;
  '#text'?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  alwaysCreateTextNode: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
});

/** Parses XML and returns its root element, the one named `root`, if it has one. */
export function parseXml(source: string, root: string): XmlElement | undefined {
  const document: XmlElement = parser.parse(source);
  return children(document, root)[0];
}

/** Reads an XML file and returns its root element. */
export function readXml(file: string, root: string, files: Files = localFiles): XmlElement {
  const element = parseXml(readText(files, file), root);
  if (!element) throw new Error(`${file} has no <${root}> element.`);
  return element;
}

export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  const value = element?.[name];
  return Array.isArray(value) ? value : [];
}

/** The key the parser gives an element's text. */
const TEXT_NODE = '#text';

/** The element's text, or `''` when it is missing. */
export function text(element: XmlElement | undefined): string {
  return element?.[TEXT_NODE] ?? '';
}

/** The names of the element's child elements. */
export function childNames(element: XmlElement): string[] {
  return Object.keys(element).filter((name) => Array.isArray(element[name]));
}

/** The names of the element's attributes. */
export function attributeNames(element: XmlElement): string[] {
  return Object.keys(element).filter(
    (name) => name !== TEXT_NODE && typeof element[name] === 'string',
  );
}
