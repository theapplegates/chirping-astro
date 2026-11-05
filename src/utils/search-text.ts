/** Escape content before adding the only HTML search results allow: our own mark tags. */
export function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function termPattern(term: string): RegExp | null {
  const terms = [...new Set(term.match(/[\p{L}\p{N}]+/gu) || [])].sort(
    (a, b) => b.length - a.length,
  );
  return terms.length ? new RegExp(terms.join('|'), 'giu') : null;
}

/** Case-insensitive, multi-word highlighting without interpreting input as HTML or regex. */
export function highlightSearchTerm(text: string, term: string): string {
  const pattern = termPattern(term);
  if (!pattern) return escapeHtml(text);
  let html = '';
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    html += escapeHtml(text.slice(position, start)) + `<mark>${escapeHtml(match[0])}</mark>`;
    position = start + match[0].length;
  }
  return html + escapeHtml(text.slice(position));
}

/** Show context around the first match, including matches deep inside long posts. */
export function createExcerpt(text: string, term: string, length = 240): string {
  const match = termPattern(term)?.exec(text);
  const start = Math.max(0, (match?.index || 0) - 70);
  const end = Math.min(text.length, start + length);
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
