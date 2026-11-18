/** Distinguish a simple, literal awk filter from a file operand. Complex
 * programs stay on the ordinary inspection path. */
export function isLiteralAwkFilter(word: string): boolean {
  const pattern = /^'\/(?:\\[^\r\n]|[^/\\'\r\n])+\/(.*)'$/.exec(word);
  if (!pattern || /\b(?:getline|system)\b/.test(pattern[1]!)) return false;
  // Comparisons are allowed in selectors. An action containing a redirect,
  // a string, or a pipe is not a simple output filter.
  const selectors = pattern[1]!.replace(/\{[a-z\d_\s;=+!-]*\}/gi, '');
  return /^[a-z\d_\s=+<>!-]*$/i.test(selectors);
}
