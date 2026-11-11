import {
  attributeNames,
  childNames,
  children as childElements,
  text as elementText,
  type XmlElement,
} from './xml.ts';

/**
 * An element to write: its name, its attributes in order, and its text or child elements.  An
 * element with neither is written empty, `<Name/>`.
 */
export interface XmlNode {
  name: string;
  attributes: [string, string][];
  content?: string | XmlNode[];
  /** Whether the text is written as CDATA, as Scrivener writes RTF held in XML. */
  cdata?: boolean;
}

/**
 * What reading a file found that its model does not hold: what the library does not know (an
 * attribute, element or value), which could change what the file means; and what is missing,
 * which reads as its default.  Writing the file back would lose the first and add the second.
 */
export interface Unread {
  unknown: Set<string>;
  missing: Set<string>;
}

export const newUnread = (): Unread => ({ unknown: new Set(), missing: new Set() });

/** Everything reading found that the model does not hold, in order. */
export const unreadList = ({ unknown, missing }: Unread): string[] => [...unknown, ...missing];

/** How a value is written in an attribute or as an element's text. */
export interface Value<T> {
  /** Reads the value, adding to `unread` a value it does not know. */
  read: (raw: string, unread: Unread) => T;
  write: (value: T) => string;
}

/** How one property of a model object is held in its element: an attribute, the text or children. */
export interface Field<T> {
  /** The attribute and child element names the field reads. */
  attributes: string[];
  children: string[];
  /** Whether it may read no value, leaving the property out. */
  optional?: boolean;
  /** Whether it reads child elements of any name. */
  anyChild?: boolean;
  /** Reads the field from the element named `owner`, adding to `unread` what it cannot read. */
  read: (element: XmlElement, unread: Unread, owner: string) => T;
  /** Adds the value to the element being written. */
  write: (value: T, node: XmlNode) => void;
}

/** How a model object is held as an element, and read and written. */
export interface Codec<T> {
  name: string;
  /** Reads the element, adding to `unread` each attribute and element it does not know. */
  read: (element: XmlElement, unread: Unread) => T;
  write: (value: T) => XmlNode;
}

/** A field for each of the object's properties, in the order the element holds them. */
export type Fields<T> = { [K in keyof T]-?: Field<T[K]> };

export const string: Value<string> = { read: (raw) => raw, write: (value) => value };

export const integer: Value<number> = { read: Number, write: String };

/** `Yes` or `No`. */
export const yesNo: Value<boolean> = {
  read: (raw) => raw === 'Yes',
  write: (value) => (value ? 'Yes' : 'No'),
};

/** A decimal as Cocoa writes one: at most six places, and at least one. */
export const decimal: Value<number> = {
  read: Number,
  write: (value) => value.toFixed(6).replace(/(?<=\.\d+?)0+$/u, ''),
};

/**
 * One of the values the library knows.  Another is added to `unread` and read as `fallback`, so
 * that the project can still be read, though not written.
 */
export function oneOf<T extends string>(what: string, known: readonly T[], fallback: T): Value<T> {
  return {
    read: (raw, unread) => {
      const found = known.find((candidate) => candidate === raw);
      if (found !== undefined) return found;
      unread.unknown.add(`the ${what} ${raw}`);
      return fallback;
    },
    write: (value) => value,
  };
}

/** Values written one after another, with `separator` between them. */
export function listOf<T>(value: Value<T>, separator: string): Value<T[]> {
  return {
    read: (raw, unread) =>
      raw === '' ? [] : raw.split(separator).map((part) => value.read(part, unread)),
    write: (values) => values.map(value.write).join(separator),
  };
}

/** A colour as Scrivener writes one: red, green and blue, each from 0 to 1. */
export const color = listOf(decimal, ' ');

/** An attribute; one that is missing reads as `undefined`, and is left out when it is. */
export function attribute<T>(name: string, value: Value<T>): Field<T> {
  return {
    attributes: [name],
    children: [],
    read: (parent, unread, owner) => {
      const raw = parent[name];
      if (typeof raw === 'string') return value.read(raw, unread);
      unread.missing.add(`a missing ${name} attribute of ${owner}`);
      return value.read('', unread);
    },
    write: (written, node) => void node.attributes.push([name, value.write(written)]),
  };
}

export function optionalAttribute<T>(name: string, value: Value<T>): Field<T | undefined> {
  const required = attribute(name, value);
  return {
    ...required,
    optional: true,
    read: (found, unread, owner) =>
      typeof found[name] === 'string' ? required.read(found, unread, owner) : undefined,
    write: (written, node) => written !== undefined && required.write(written, node),
  };
}

/**
 * How an element's text is written: as it is, escaped; as CDATA; or as CDATA unless it is empty,
 * when it is written `<Name></Name>`.  Each element Scrivener writes has one way.
 */
export type TextForm = 'plain' | 'cdata' | 'cdataUnlessEmpty';

/** The element's own text: written `<Name></Name>` when it is empty and not CDATA. */
export function text<T>(value: Value<T>, form: TextForm | boolean = 'plain'): Field<T> {
  const mode = form === true ? 'cdata' : form === false ? 'plain' : form;
  return {
    attributes: [],
    children: [],
    read: (parent, unread) => value.read(elementText(parent), unread),
    write: (written, node) => {
      node.content = value.write(written);
      if (mode === 'cdata' || (mode === 'cdataUnlessEmpty' && node.content !== '')) {
        node.cdata = true;
      }
    },
  };
}

/**
 * The element's own text, where Scrivener writes an element with none as empty, `<Name/>`, not
 * `<Name></Name>`.  Each element Scrivener writes has one way or the other.
 */
export function closedWhenEmpty(value: Value<string>, cdata = false): Field<string> {
  return {
    attributes: [],
    children: [],
    read: (parent, unread) => value.read(elementText(parent), unread),
    write: (written, node) => {
      if (written === '') return;
      node.content = value.write(written);
      if (cdata) node.cdata = true;
    },
  };
}

/** Adds a child element to the element being written. */
function addChild(node: XmlNode, written: XmlNode): void {
  if (!Array.isArray(node.content)) node.content = [];
  node.content.push(written);
}

/** Every child element the codec reads, in order. */
export function repeated<T>(codec: Codec<T>): Field<T[]> {
  return {
    attributes: [],
    children: [codec.name],
    read: (parent, unread) =>
      childElements(parent, codec.name).map((found) => codec.read(found, unread)),
    write: (values, node) => {
      for (const value of values) addChild(node, codec.write(value));
    },
  };
}

/** A child element the codec reads, or `undefined` when there is none. */
export function optionalChild<T>(codec: Codec<T>): Field<T | undefined> {
  return {
    attributes: [],
    children: [codec.name],
    optional: true,
    read: (parent, unread, owner) => {
      const found = childElements(parent, codec.name);
      if (found.length > 1) unread.unknown.add(`more than one ${codec.name} element in ${owner}`);
      return found[0] && codec.read(found[0], unread);
    },
    write: (value, node) => value !== undefined && addChild(node, codec.write(value)),
  };
}

export function child<T>(codec: Codec<T>): Field<T> {
  const optional = optionalChild(codec);
  return {
    ...optional,
    optional: false,
    read: (parent, unread, owner) => {
      const value = optional.read(parent, unread, owner);
      if (value !== undefined) return value;
      unread.missing.add(`a missing ${codec.name} element in ${owner}`);
      return codec.read({}, unread);
    },
  };
}

/**
 * Child elements named for what they hold, such as a compile setting for each file type, by name,
 * in order.
 */
export function byName<T>(codec: (name: string) => Codec<T>): Field<Record<string, T>> {
  return {
    attributes: [],
    children: [],
    anyChild: true,
    read: (parent, unread, owner) =>
      Object.fromEntries(
        childNames(parent).map((name) => {
          const [first, ...more] = childElements(parent, name);
          if (more.length > 0) unread.unknown.add(`more than one ${name} element in ${owner}`);
          return [name, codec(name).read(first!, unread)];
        }),
      ),
    write: (values, node) => {
      for (const [name, value] of Object.entries(values)) addChild(node, codec(name).write(value));
    },
  };
}

/** An element holding only children named for what they hold, as a record by name. */
export function namedChildren<T>(
  name: string,
  codec: (child: string) => Codec<T>,
): Codec<Record<string, T>> {
  const wrapper = element<{ entries: Record<string, T> }>(name, { entries: byName(codec) });
  return {
    name,
    read: (found, unread) => wrapper.read(found, unread).entries,
    write: (entries) => wrapper.write({ entries }),
  };
}

/** A field read and written as another, its value changed each way. */
export function mapField<T, U>(
  field: Field<T>,
  read: (value: T) => U,
  write: (value: U) => T,
): Field<U> {
  return {
    attributes: field.attributes,
    children: field.children,
    read: (parent, unread, owner) => read(field.read(parent, unread, owner)),
    write: (value, node) => field.write(write(value), node),
  };
}

/** An element with only text, held as its value; written as CDATA where Scrivener does. */
export function textElement<T>(name: string, value: Value<T>, cdata = false): Codec<T> {
  const codec = element<{ value: T }>(name, { value: text(value, cdata) });
  return {
    name,
    read: (found, unread) => codec.read(found, unread).value,
    write: (written) => codec.write({ value: written }),
  };
}

/** A child element holding only text, or `undefined` when there is none. */
export function optionalTextChild<T>(
  name: string,
  value: Value<T>,
  cdata = false,
): Field<T | undefined> {
  return optionalChild(textElement(name, value, cdata));
}

export function textChild<T>(name: string, value: Value<T>, cdata = false): Field<T> {
  return child(textElement(name, value, cdata));
}

/**
 * A child element holding a list of elements the codec reads, or `undefined` when there is no
 * such element.
 */
export function optionalList<T>(name: string, codec: Codec<T>): Field<T[] | undefined> {
  return optionalChild(listElement(name, codec));
}

/** A child element holding a list of elements; none at all reads as an empty list. */
export function list<T>(name: string, codec: Codec<T>): Field<T[]> {
  return mapField(
    optionalList(name, codec),
    (values) => values ?? [],
    (values) => (values.length > 0 ? values : undefined),
  );
}

function listElement<T>(name: string, codec: Codec<T>): Codec<T[]> {
  const wrapper = element<{ items: T[] }>(name, { items: repeated(codec) });
  return {
    name,
    read: (found, unread) => wrapper.read(found, unread).items,
    write: (items) => wrapper.write({ items }),
  };
}

/**
 * An element read into an object, a property from each field, and written back from one.  The
 * fields' order is the order of the element's attributes and of its children.  An attribute or
 * child the fields do not read is added to `unread`, so that what was read can be refused for
 * writing: writing it would drop what the model does not hold.
 */
export function element<T>(name: string, fields: Fields<T>): Codec<T> {
  const all: Field<unknown>[] = Object.values(fields);
  const attributes = new Set(all.flatMap((field) => field.attributes));
  const children = new Set(all.flatMap((field) => field.children));
  const anyChild = all.some((field) => field.anyChild);
  return {
    name,
    read: (found, unread) => {
      for (const known of attributeNames(found)) {
        if (!attributes.has(known)) unread.unknown.add(`the ${known} attribute of ${name}`);
      }
      for (const known of anyChild ? [] : childNames(found)) {
        if (!children.has(known)) unread.unknown.add(`a ${known} element in ${name}`);
      }
      const value: Partial<T> = {};
      for (const key in fields) {
        const read = fields[key].read(found, unread, name);
        if (read !== undefined) value[key] = read;
      }
      if (!holdsEvery(value, fields)) throw new Error(`${name} was read without a value it needs.`);
      return value;
    },
    write: (value) => {
      const node: XmlNode = { name, attributes: [] };
      for (const key in fields) fields[key].write(value[key], node);
      return node;
    },
  };
}

/** Whether the object has a value for every field that is not optional. */
function holdsEvery<T>(value: Partial<T>, fields: Fields<T>): value is T {
  for (const key in fields) {
    if (!fields[key].optional && value[key] === undefined) return false;
  }
  return true;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Text escaped as Scrivener escapes it: quotes only in attributes. */
function escape(value: string, quotes: boolean): string {
  return value.replaceAll(quotes ? /["&<>]/gu : /[&<>]/gu, (found) => ESCAPES[found]!);
}

const INDENT = '    ';

function writeNode(node: XmlNode, depth: number): string {
  const indent = INDENT.repeat(depth);
  const attributes = node.attributes.map(([key, value]) => ` ${key}="${escape(value, true)}"`);
  const open = `${indent}<${node.name}${attributes.join('')}`;
  const { content } = node;
  if (content === undefined) return `${open}/>`;
  if (typeof content === 'string') {
    const body = node.cdata ? `<![CDATA[${content}]]>` : escape(content, false);
    return `${open}>${body}</${node.name}>`;
  }
  if (content.length === 0) return `${open}></${node.name}>`;
  const inner = content.map((written) => writeNode(written, depth + 1));
  return [`${open}>`, ...inner, `${indent}</${node.name}>`].join('\n');
}

/**
 * An XML document as Scrivener writes one: four spaces to a level, and a newline at the end only
 * in the files that have one.
 */
export function writeXml(root: XmlNode, finalNewline = false): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${writeNode(root, 0)}${finalNewline ? '\n' : ''}`;
}
