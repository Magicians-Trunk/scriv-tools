import { formatNumber } from './numbering.ts';
import {
  type FoundPlaceholder,
  type Piece,
  parsePlaceholders,
  placeholderText,
} from './placeholder-syntax.ts';

import { DATE_STYLES, LOCALE, TIME_STYLES, TODAY, formatDate, stampDate, usDate } from './dates.ts';
import { BoundText, type Edit } from './bound-text.ts';
import { type BinderItem } from './binder-item.ts';
import type { CompileInput } from './model.ts';
import {
  adaptiveTitle,
  findItem,
  ancestorsOf,
  draftFolder,
  labelName,
  statusName,
} from './project.ts';
import { listValueName } from './custom-field-values.ts';
import { isDocumented } from './documented-placeholders.ts';
import { UnsupportedError } from './unsupported.ts';

/** The project's names that placeholders read, from the compile settings or the command line. */
export interface ProjectNames {
  projectTitle: string;
  abbreviatedTitle: string;
  author: string;
  forename: string;
  surname: string;
}

/** What only a whole compile knows: numbers, positions and counts, and when it runs. */
export interface CompileContext {
  /** Each item's hierarchical number, from `hierarchicalNumbers`. */
  numbers: Map<string, string>;
  /** Each compiled item's position in the compile, from 1. */
  positions: Map<string, number>;
  now: Date;
}

/** The hierarchical numbering placeholders.  `<$hn_levelN>` past level 1 is not worked out yet. */
const NUMBERING = /^(hn|ahn|aon|hn_0|hn_level\d+)$/;

/** Placeholders whose value is uppercased when the placeholder is written in capitals. */
const UPPERCASED = new Set([
  'author',
  'name',
  'fullname',
  'username',
  'forename',
  'firstname',
  'surname',
  'lastname',
  'initial',
  'compilegroup',
  'draftname',
  'projecttitle',
  'projectname',
  'abbr_projecttitle',
  'abbr_projectname',
  'abbr_title',
]);

/** The item's title, which layout text evaluates before the replacements, as its text does. */
const TITLE = 'title';

/** Scrivener's link-target number, which it reads apart from the other placeholders. */
const LINK_ID = 'linkID';

/**
 * Which pass evaluates: the first, before the replacements; the one between them, over a last
 * paragraph; or the last, after them.
 */
type Pass = 'early' | 'between' | 'final';

const NUMBER_TYPES = new Set(['n', 'r', 'R', 'l', 'L', 'w', 'W', 't']);

/** A placeholder the compile cannot evaluate: the first pass leaves it, and the last stops on it. */
interface Unsupported {
  unsupported: string;
}

/** A placeholder's value; nothing when it has none, and is left as written or waits. */
type Value = string | undefined | Unsupported;

const unsupported = (feature: string): Unsupported => ({ unsupported: feature });

/** Text evaluated by the last pass, and each `<$…>` it leaves as written, as Scrivener does. */
export interface Evaluated {
  text: BoundText;
  leftAsWritten: string[];
}

/**
 * Evaluates placeholders across one compile.  Auto-numbering counts on from one section to the
 * next, so one instance serves the whole compile.
 */
export class Placeholders {
  private readonly counters = new Map<string, number>();
  private readonly keyed = new Map<string, number>();
  private restartNext = false;
  private readonly input: CompileInput;
  private readonly names: ProjectNames;
  private readonly compile: CompileContext | undefined;

  /** Without a compile context, placeholders that need the whole compile stop. */
  constructor(input: CompileInput, names: ProjectNames, compile?: CompileContext) {
    this.input = input;
    this.names = names;
    this.compile = compile;
  }

  /**
   * Evaluates the placeholders that can be evaluated now, before replacements, leaving the rest
   * (and every escaped one) as they are for `evaluate`.  Scrivener evaluates placeholders on both
   * sides of its replacements: a value takes the replacements, and so does a placeholder a
   * replacement writes.
   */
  evaluateKnown(source: BoundText, item?: BinderItem): BoundText {
    return source.edit(this.edits(source, item, 'early'));
  }

  /**
   * Replaces every placeholder in `source`.  One backslash before a placeholder leaves it as
   * written, without the backslash; document variables need the item they describe.  A
   * placeholder whose whole text is a document link's describes the linked item.
   */
  evaluate(source: BoundText, item?: BinderItem): Evaluated {
    const leftAsWritten: string[] = [];
    const text = source.edit(this.edits(source, item, 'final', () => true, leftAsWritten));
    return { text, leftAsWritten };
  }

  /**
   * Evaluates the placeholders from `start` on as the second pass would, leaving escaped ones,
   * and custom fields it does not find, for it.  Scrivener does this to a document's last
   * paragraph after each replacement that changes the document's text, so a placeholder a
   * replacement writes there takes the replacements after it.
   */
  evaluateFrom(source: BoundText, start: number, item?: BinderItem): BoundText {
    const chosen = (piece: FoundPlaceholder) => piece.start >= start && piece.slashes !== 1;
    return source.edit(this.edits(source, item, 'between', chosen));
  }

  private edits(
    bound: BoundText,
    item: BinderItem | undefined,
    pass: Pass,
    chosen: (piece: FoundPlaceholder) => boolean = () => true,
    leftAsWritten: string[] = [],
  ): Edit[] {
    return parsePlaceholders(bound.text).flatMap((piece) => {
      if (piece.kind === 'text' || !chosen(piece)) return [];
      const text = this.resolve(piece, bound, pass, leftAsWritten, item);
      return text === undefined
        ? []
        : [{ start: piece.start - piece.slashes, end: piece.end, text }];
    });
  }

  /**
   * A placeholder's text in the compile, or nothing when it waits for the second pass.  The last
   * pass adds to `leftAsWritten` each placeholder it leaves as written.
   */
  private resolve(
    piece: FoundPlaceholder,
    bound: BoundText,
    pass: Pass,
    leftAsWritten: string[],
    item?: BinderItem,
  ): string | undefined {
    const early = pass === 'early';
    // Layout and metadata text, but for its <$title>, and a placeholder a link covers only part of,
    // wait for the replacements.
    const deferred = bound.isDeferred(piece.start, piece.end) && piece.name !== TITLE;
    const waits = deferred || bound.isPartlyBound(piece.start, piece.end);
    if (early && waits) return undefined;
    if (piece.slashes === 1) {
      if (early) return undefined;
      // Scrivener keeps the backslash before <$linkID>, which it reads apart from the rest.
      return piece.name === LINK_ID
        ? placeholderText(piece)
        : placeholderText(piece, { slashes: false });
    }
    const linked = bound.itemAt(piece.start, piece.end);
    const described = linked === undefined ? item : findItem(this.input.index, linked);
    const parts = piece.argument.map((part) =>
      part.kind === 'text' ? part.text : this.resolve(part, bound, pass, leftAsWritten, described),
    );
    if (parts.includes(undefined)) return undefined;
    const argument = parts.join('');
    const slashes = '\\'.repeat(piece.slashes);
    const value = this.value(piece.name, piece.separator, argument, pass, described);
    if (typeof value === 'string') return slashes + value;
    // What the first pass cannot evaluate, it leaves for the last.
    if (early) return undefined;
    if (value !== undefined) throw new UnsupportedError(value.unsupported);
    const whole = placeholderText(piece, { argument });
    if (pass === 'final') leftAsWritten.push(whole);
    return whole;
  }

  private value(
    name: string,
    separator: string | undefined,
    argument: string,
    pass: Pass,
    item?: BinderItem,
  ): Value {
    if (name === 'rst') {
      this.restartNext = true;
      return '';
    }
    if (name === 'include') return this.include(argument);
    if (name.startsWith('rst_')) {
      this.counters.delete(name.slice(4));
      return '';
    }
    if (NUMBER_TYPES.has(name) || name === 'sn') return this.number(name, separator, argument);
    const lower = name.toLowerCase();
    if (UPPERCASED.has(lower) && (name === lower || name === name.toUpperCase())) {
      const value = this.projectValue(lower);
      return name === lower ? value : value.toUpperCase();
    }
    const today = this.today(name, argument);
    if (today !== undefined) return today;
    if (item) return this.itemValue(name, argument, pass, item);
    return this.notImplemented(name);
  }

  /** A documented placeholder the library does not evaluate is unsupported; others have none. */
  private notImplemented(name: string): Value {
    return isDocumented(name) ? unsupported(`placeholder <$${name}>`) : undefined;
  }

  /**
   * `<$include>` works only as a document link's whole text (see `markup.ts`), and Scrivener
   * leaves it as written anywhere else, as it does `<$include:name>` naming no document.
   */
  private include(name: string): Value {
    const named = this.input.index.byTitle.has(name);
    return named ? unsupported(`<$include:${name}> naming a document`) : undefined;
  }

  private projectValue(name: string): string {
    const { projectTitle, abbreviatedTitle, author } = this.names;
    const { forename, surname } = this.names;
    if (name === 'forename' || name === 'firstname') return forename;
    if (name === 'surname' || name === 'lastname') return surname;
    // With no forename, Scrivener's initial is `?`.
    if (name === 'initial') return forename.charAt(0) || '?';
    if (name === 'compilegroup' || name === 'draftname') {
      return adaptiveTitle(draftFolder(this.input.project), this.input.documents);
    }
    if (name.startsWith('abbr_')) return abbreviatedTitle;
    if (name === 'projecttitle' || name === 'projectname') return projectTitle;
    return author;
  }

  /** The next number of an auto-numbering stream, or a named stream's current number. */
  private number(type: string, separator: string | undefined, argument: string): Value {
    const [streamName = '', key] = argument.split(':');
    const stream = type === 'sn' ? 'sn' : separator ? `${type}:${streamName}` : type;
    if (separator === '#') {
      const current = this.counters.get(stream);
      if (current === undefined) return unsupported(`<$${type}#${streamName}> before its stream`);
      return formatNumber(type, current);
    }
    if (key !== undefined) {
      const keyName = `${stream}:${key}`;
      const known = this.keyed.get(keyName);
      if (known !== undefined) return formatNumber(type, known);
      const next = this.increment(stream);
      this.keyed.set(keyName, next);
      return formatNumber(type, next);
    }
    if (type === 'n' && !separator) this.counters.delete('sn');
    return formatNumber(type === 'sn' ? 'n' : type, this.increment(stream));
  }

  private increment(stream: string): number {
    const next = this.restartNext ? 1 : (this.counters.get(stream) ?? 0) + 1;
    this.restartNext = false;
    this.counters.set(stream, next);
    return next;
  }

  /** Today's date, statistics and the compile's document count, which need no item. */
  private today(name: string, argument: string): Value {
    if (/^(wc|cc)\d*$/.test(name)) return '0';
    const style = TODAY[name];
    const dated = name === 'date' && argument;
    if (name !== 'doccount' && !dated && style === undefined) return undefined;
    const { compile } = this;
    if (!compile) return unsupported(`<$${name}> outside a whole compile`);
    if (name === 'doccount') return String(compile.positions.size);
    if (dated) return formatDate(compile.now, argument);
    return compile.now.toLocaleString(LOCALE, style);
  }

  private itemValue(name: string, argument: string, pass: Pass, item: BinderItem): Value {
    const binderDate = /^(short|medium|long|full)?(Created|Modified)(Date|Time)$/i.exec(name);
    if (binderDate) return this.binderDate(binderDate, argument, item);
    const { compile } = this;
    if (NUMBERING.test(name) || name === LINK_ID) {
      if (!compile) return unsupported(`<$${name}> outside a whole compile`);
      if (name === LINK_ID) return String(compile.positions.get(item.id));
      return compile.numbers.get(item.id) ?? unsupported(`placeholder <$${name}>`);
    }
    const ancestors = ancestorsOf(this.input.index, item);
    const parent = ancestors.at(-1);
    const aboveTop = unsupported(`<$${name}> above the top of the binder`);
    const title = (entry: BinderItem | undefined, spaces = true) => {
      if (!entry) return aboveTop;
      const written = adaptiveTitle(entry, this.input.documents);
      return spaces ? written : written.replaceAll(' ', '');
    };
    const position = (entry: BinderItem | undefined, above: BinderItem | undefined) =>
      entry && above ? String(above.children.indexOf(entry) + 1) : aboveTop;
    const level = /^level(\d+)_title(_no_spaces)?$/.exec(name);
    if (level) return title([...ancestors, item][Number(level[1])], !level[2]);
    switch (name) {
      case 'title':
        return title(item);
      case 'parenttitle':
        return title(parent);
      case 'title_no_spaces':
        return title(item, false);
      case 'parenttitle_no_spaces':
        return title(parent, false);
      case 'position':
        return position(item, parent);
      case 'parentposition':
        return position(parent, ancestors.at(-2));
      case 'label':
        return labelName(this.input.project, item) ?? '';
      case 'status':
        return statusName(this.input.project, item) ?? '';
      case 'synopsis':
        return this.input.documents.synopsis(item.id);
      case 'subDocCount':
        return String(item.children.length);
      case 'descendantCount':
        return String(countDescendants(item));

      case 'custom':
        return this.custom(item, argument, pass);

      default:
        return this.notImplemented(name);
    }
  }

  /** `<$createdDate>`, `<$longModifiedDate>`, `<$createdTime>` and the like, or with a pattern. */
  private binderDate(match: RegExpExecArray, argument: string, item: BinderItem): Value {
    const [, size = 'short', which = '', kind = ''] = match;
    const date = stampDate(which.toLowerCase() === 'created' ? item.created : item.modified);
    if (argument) return formatDate(date, argument);
    const styles = kind.toLowerCase() === 'date' ? DATE_STYLES : TIME_STYLES;
    const style = styles[size.toLowerCase()];
    return style ? usDate(date, style) : unsupported(`placeholder <$${match[0]}>`);
  }

  /**
   * A custom field's value.  Scrivener finds the field by its title as typed, never its ID; a
   * field it does not find is empty.  Before the replacements it finds only a field whose ID is
   * its title in lower case, as Scrivener names fields itself.
   */
  private custom(item: BinderItem, name: string, pass: Pass): Value {
    const field = this.input.project.customFields.find((candidate) => candidate.title === name);
    if (pass === 'early' && field?.id !== name.toLowerCase()) return undefined;
    if (!field) return pass === 'between' ? undefined : '';
    const value = item.metadata?.custom[field.id];
    if (field.type === 'List') return listValueName(field, value);
    if (field.type !== 'Text') return unsupported(`<$custom> for a ${field.type} field`);
    return value ?? '';
  }
}

function countDescendants(item: BinderItem): number {
  return item.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

/** The first hierarchical numbering placeholder a text uses, which sets its item's number. */
export function numberingTag(text: string): string | undefined {
  const find = (pieces: Piece[]): string | undefined => {
    for (const piece of pieces) {
      if (piece.kind === 'text') continue;
      if (piece.slashes !== 1 && NUMBERING.test(piece.name)) return piece.name;
      const inner = find(piece.argument);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return find(parsePlaceholders(text));
}
