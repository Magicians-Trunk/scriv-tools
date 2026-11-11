/**
 * Which project style each kind of Markdown node takes.  It works on nodes, never on text, and
 * stands apart from the compile, so anything that holds a Markdown tree can use it.  The
 * stylesheet alone decides: a compile format shapes only what the compile writes.
 */
import type { Heading } from 'mdast';
import { listKind } from './edit-lists.ts';
import { sampleOf } from './edit-pieces.ts';
import { headingTagOf } from './markup.ts';
import type { Project } from './project.ts';
import type { ProjectStyle } from './project-styles.ts';

/** What kind of block a paragraph is in Markdown. */
export type BlockShape =
  | { kind: 'paragraph' }
  | { kind: 'heading'; depth: Heading['depth'] }
  | { kind: 'quote' }
  | { kind: 'code' }
  | { kind: 'list'; ordered: boolean; level: number }
  | { kind: 'cell'; row: number; column: number; part: number };

/** A kind of block a style can make: a table's cell is the table's, not a style's. */
type StyledShape = Exclude<BlockShape, { kind: 'cell' }>;

/** The style each kind of node takes, by name.  A kind left out has no style mapped to it. */
export interface StyleMapping {
  /** Heading styles, by depth. */
  headings: Record<number, string>;
  quote?: string;
  code?: string;
  bullet?: string;
  numbered?: string;
  codeSpan?: string;
  /** Character styles that mean Markdown's strong and emphasised text. */
  strong?: string;
  emphasis?: string;
}

/** The depths Markdown has. */
const DEPTHS = [1, 2, 3, 4, 5, 6] as const;

/**
 * The kind of block a paragraph is: a heading by its text's own HTML header level, never by its
 * style's name, else by its style; a plain paragraph unless a node maps to it.
 */
export function shapeOfStyle(
  mapping: StyleMapping,
  style: string | undefined,
  level?: number,
): StyledShape {
  const depth = DEPTHS.find((each) => each === level);
  if (depth !== undefined) return { kind: 'heading', depth };
  if (style === undefined) return { kind: 'paragraph' };
  if (style === mapping.quote) return { kind: 'quote' };
  if (style === mapping.code) return { kind: 'code' };
  if (style === mapping.bullet) return { kind: 'list', ordered: false, level: 0 };
  if (style === mapping.numbered) return { kind: 'list', ordered: true, level: 0 };
  return { kind: 'paragraph' };
}

const namedAs = (style: string | undefined) => (style === undefined ? undefined : { style });

/**
 * The style a kind of block takes: none for a paragraph, or a list with no list style, which lists
 * need not have; `undefined` when none is mapped.  A heading also has its level.
 */
export function styleOfShape(
  mapping: StyleMapping,
  shape: StyledShape,
): { style?: string; level?: number } | undefined {
  switch (shape.kind) {
    case 'paragraph':
      return {};
    case 'heading': {
      const named = namedAs(mapping.headings[shape.depth]);
      return named && { ...named, level: shape.depth };
    }
    case 'quote':
      return namedAs(mapping.quote);
    case 'code':
      return namedAs(mapping.code);
    default:
      return namedAs(shape.ordered ? mapping.numbered : mapping.bullet) ?? {};
  }
}

/** The style that means each kind of text in a project, whether or not the project has it yet. */
export interface StyleRoles {
  /** Heading styles, by depth. */
  headings: Record<number, string>;
  quote: string;
  code: string;
  codeSpan: string;
  /** The character styles that mean bold and italic, if the project has them. */
  strong?: string;
  emphasis?: string;
}

/** The heading level a style's sample carries in Scrivener's own tag. */
export const headingLevel = (style: ProjectStyle) =>
  sampleOf(style)
    .before.map(headingTagOf)
    .find((tag) => tag)?.level;

/** The styles a caller chooses for roles Scrivener ties to styles only by its own names. */
export type ChosenRoles = Partial<
  Pick<StyleRoles, 'quote' | 'code' | 'codeSpan' | 'strong' | 'emphasis'>
>;

/**
 * Which style means what, from the stylesheet.  A heading is the style whose sample carries
 * Scrivener's heading tag at that level, else Scrivener's default name for it.  Quote, code and
 * the rest go by Scrivener's default names, unless `chosen` names others.  Bold and italic need
 * no style, so those two mean one only where the project holds it.
 */
export function styleRoles(
  { styles }: Pick<Project, 'styles'>,
  chosen: ChosenRoles = {},
): StyleRoles {
  const headings: Record<number, string> = {};
  for (const depth of DEPTHS) headings[depth] = `Heading ${depth}`;
  for (const style of styles) {
    const level = headingLevel(style);
    if (level !== undefined) headings[level] = style.name;
  }
  const held = (name: string) => styles.find((style) => style.name === name)?.name;
  const strong = chosen.strong ?? held('Strong');
  const emphasis = chosen.emphasis ?? held('Emphasis');
  return {
    headings,
    quote: chosen.quote ?? 'Block Quote',
    code: chosen.code ?? 'Code Block',
    codeSpan: chosen.codeSpan ?? 'Code Span',
    ...(strong === undefined ? {} : { strong }),
    ...(emphasis === undefined ? {} : { emphasis }),
  };
}

/** The mapping the stylesheet gives: its roles, and the styles that make lists. */
export function styleMapping(project: Pick<Project, 'styles'>, chosen?: ChosenRoles): StyleMapping {
  const mapping: StyleMapping = styleRoles(project, chosen);
  for (const { name, lists } of project.styles) {
    const kind = listKind(lists?.[0] ?? '');
    if (kind) mapping[kind] = name;
  }
  return mapping;
}
