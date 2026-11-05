import { describe, expect, test } from 'bun:test';
import { createExcerpt, highlightSearchTerm } from './search-text';

describe('search highlighting', () => {
  test('highlights multiple terms with original case and French accents', () => {
    expect(highlightSearchTerm('Astro et café ASTRO', 'astro café')).toBe(
      '<mark>Astro</mark> et <mark>café</mark> <mark>ASTRO</mark>',
    );
  });
  test('escapes HTML even when the query contains markup or regex syntax', () => {
    expect(highlightSearchTerm('<img onerror="x"> [astro]', 'astro|.*')).toBe(
      '&lt;img onerror=&quot;x&quot;&gt; [<mark>astro</mark>]',
    );
    expect(highlightSearchTerm('<mark>unsafe</mark>', '')).toBe('&lt;mark&gt;unsafe&lt;/mark&gt;');
  });
  test('does not highlight inside escaped entities', () => {
    expect(highlightSearchTerm('& amp', 'amp')).toBe('&amp; <mark>amp</mark>');
  });
  test('finds context deep in an article', () => {
    const excerpt = createExcerpt('intro '.repeat(300) + 'needle near the end', 'needle');
    expect(excerpt).toContain('needle');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(242);
  });
});
