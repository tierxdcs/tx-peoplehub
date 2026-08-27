import type { NavLeaf } from './nav';

/**
 * Fuzzy matcher for the sidebar's "Jump to" search.
 *
 * It runs entirely client-side over the app's own nav model — a fixed list of a
 * couple of hundred short labels — so there is no endpoint, no debounce budget
 * and no index to keep warm.
 *
 * The scoring extends the token-overlap (Dice) idea already used for the
 * Customer BOM Intake item search, with two additions that matter for a nav box
 * you type into one character at a time:
 *
 *  - PREFIX tolerance, so "emp" finds "Employees" and "sal str" finds "Salary
 *    Structures". Whole-token Dice alone scores both of those zero.
 *  - INITIALS and subsequence matching, so "poc" finds "Purchase Orders" style
 *    multi-word labels and a typo-ish "invcs" still reaches "Invoices".
 *
 * Every rung of the ladder returns a fixed band, so ranking is explainable:
 * exact label beats prefix beats token-prefix beats substring beats token
 * overlap beats initials beats loose subsequence. A match on the SECTION name
 * counts at a discount, which is what makes typing "vouchers" list that
 * section's pages without letting a section name outrank a real label hit.
 */

/** Anything below this is noise rather than a match. */
export const NAV_SEARCH_MIN_SCORE = 0.2;

/** How many results the sidebar shows — same cap as the BOM intake matcher. */
export const NAV_SEARCH_LIMIT = 8;

/** Lowercase, and collapse every non-alphanumeric run to a single space. */
export function normaliseQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenise(value: string): string[] {
  const normalised = normaliseQuery(value);
  return normalised ? normalised.split(' ') : [];
}

/** Do all query tokens prefix-match distinct label tokens? ("sal str") */
function coversByPrefix(queryTokens: string[], labelTokens: string[]): boolean {
  const used = new Set<number>();
  return queryTokens.every((queryToken) => {
    const index = labelTokens.findIndex(
      (labelToken, at) => !used.has(at) && labelToken.startsWith(queryToken),
    );
    if (index === -1) return false;
    used.add(index);
    return true;
  });
}

/** Token Dice coefficient — the Customer BOM Intake measure, verbatim in spirit. */
function diceScore(queryTokens: string[], labelTokens: string[]): number {
  const left = new Set(queryTokens);
  const right = new Set(labelTokens);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

/**
 * Are the query's characters present in order? Scored by density — a match
 * packed into a short span ranks above one scattered across the whole label.
 */
function subsequenceDensity(text: string, query: string): number {
  const haystack = text.replace(/ /g, '');
  const needle = query.replace(/ /g, '');
  if (!needle) return 0;
  let first = -1;
  let at = 0;
  for (let index = 0; index < haystack.length && at < needle.length; index += 1) {
    if (haystack[index] !== needle[at]) continue;
    if (first === -1) first = index;
    at += 1;
    if (at === needle.length) return needle.length / (index - first + 1);
  }
  return 0;
}

/**
 * 0 (no match) … 1 (exact). `query` must already be normalised — the caller
 * normalises once per keystroke instead of once per candidate.
 */
export function scoreText(normalisedQuery: string, text: string): number {
  if (!normalisedQuery) return 0;
  const target = normaliseQuery(text);
  if (!target) return 0;
  if (target === normalisedQuery) return 1;
  if (target.startsWith(normalisedQuery)) return 0.95;

  const queryTokens = normalisedQuery.split(' ');
  const targetTokens = target.split(' ');
  if (coversByPrefix(queryTokens, targetTokens)) return 0.85;
  if (target.includes(normalisedQuery)) return 0.75;

  const dice = diceScore(queryTokens, targetTokens);
  if (dice > 0) return 0.5 + 0.2 * dice;

  const initials = targetTokens.map((token) => token[0]).join('');
  if (initials.startsWith(normalisedQuery.replace(/ /g, ''))) return 0.65;

  const density = subsequenceDensity(target, normalisedQuery);
  return density > 0 ? 0.2 + 0.25 * density : 0;
}

/** A section-name hit is a real but weaker signal than a page-label hit. */
const SECTION_WEIGHT = 0.6;

export function scoreNavLeaf(normalisedQuery: string, leaf: NavLeaf): number {
  return Math.max(
    scoreText(normalisedQuery, leaf.label),
    SECTION_WEIGHT * scoreText(normalisedQuery, leaf.section),
  );
}

export interface NavSearchHit {
  leaf: NavLeaf;
  score: number;
}

/**
 * Rank the nav leaves for a raw (un-normalised) query. Ties break on the
 * shorter label — the more specific page — then alphabetically, so the list
 * never reshuffles between renders for the same input.
 */
export function searchNav(
  query: string,
  leaves: NavLeaf[],
  limit = NAV_SEARCH_LIMIT,
): NavSearchHit[] {
  const normalised = normaliseQuery(query);
  if (!normalised) return [];
  return leaves
    .map((leaf) => ({ leaf, score: scoreNavLeaf(normalised, leaf) }))
    .filter((hit) => hit.score >= NAV_SEARCH_MIN_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.leaf.label.length - b.leaf.label.length ||
        a.leaf.label.localeCompare(b.leaf.label),
    )
    .slice(0, limit);
}
