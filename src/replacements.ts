import { BoundText } from './bound-text.ts';
import { UnsupportedError } from './unsupported.ts';
import { element, list, optionalAttribute, string, textChild, yesNo } from './xml-codec.ts';

/** An entry in a project's or a format's Replacements list. */
export interface Replacement {
  regex?: boolean;
  caseSensitive?: boolean;
  /** Switched off: listed, but not run. */
  ignore?: boolean;
  replace: string;
  with: string;
}

const WILDCARD = '$@';

/** A `<Replacements>` list, as compile settings and compile formats both hold one. */
export const replacements = list(
  'Replacements',
  element<Replacement>('Replacement', {
    regex: optionalAttribute('RegEx', yesNo),
    caseSensitive: optionalAttribute('CaseSensitive', yesNo),
    ignore: optionalAttribute('Ignore', yesNo),
    replace: textChild('Replace', string, true),
    with: textChild('With', string, true),
  }),
);

/**
 * Runs each replacement in order, so one's output feeds the next.  `changed` has its say after
 * each replacement that changes the document's own text (not the layout's).
 */
export function applyReplacements(
  text: BoundText,
  entries: Replacement[],
  changed: (text: BoundText) => BoundText = (same) => same,
): BoundText {
  return entries.reduce((result, replacement) => {
    if (replacement.ignore) return result;
    const replaced = replaceOnce(result, replacement);
    return replaced.ownText() === result.ownText() ? replaced : changed(replaced);
  }, text);
}

/**
 * One replacement.  A plain replacement that is not case-sensitive writes its text in capitals
 * where the match was all capitals.  `$@` stands for any text on the same line.
 */
function replaceOnce(result: BoundText, replacement: Replacement): BoundText {
  const flags = replacement.caseSensitive ? 'g' : 'gi';
  if (replacement.regex) {
    const template = icuTemplate(replacement.with);
    return result.replace(compile(replacement.replace, flags), template);
  }
  if (replacement.replace.includes(WILDCARD)) {
    const [before = '', after = ''] = replacement.replace.split(WILDCARD);
    const pattern = new RegExp(`${escape(before)}([^\\n]*?)${escape(after)}`, flags);
    return result.replace(pattern, ([, found = '']) =>
      replacement.with.split(WILDCARD).join(found),
    );
  }
  return result.replace(new RegExp(escape(replacement.replace), flags), ([match]) =>
    !replacement.caseSensitive && match === match.toUpperCase() && match !== match.toLowerCase()
      ? replacement.with.toUpperCase()
      : replacement.with,
  );
}

/**
 * A regular expression replacement's text, in ICU's template syntax as Scrivener reads it: `$n`
 * is group n, and a backslash writes the character after it as it is (`\\` is one backslash).
 */
function icuTemplate(template: string): (match: RegExpExecArray) => string {
  const parts = [...template.matchAll(/\\(.)|\$(\d+)|[^\\$]+|[\s\S]/gsu)];
  return (match) =>
    parts
      .map(([whole, escaped, group]) => {
        if (escaped !== undefined) return escaped;
        if (group === undefined) return whole;
        return match[Number(group)] ?? '';
      })
      .join('');
}

function compile(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new UnsupportedError(`regular expression ${pattern}`);
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
