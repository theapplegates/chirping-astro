/* global fetch */
import { create, load, search } from '@orama/orama';
import { searchSchema, type SearchResult } from './search-schema';
export type { SearchResult } from './search-schema';

type SearchDatabase = ReturnType<typeof create<typeof searchSchema>>;
const indexes = new Map<string, Promise<SearchDatabase>>();

/** Share in-flight loads between the modal and the full search page; retry failures. */
export function loadSearchIndex(url: string): Promise<SearchDatabase> {
  const cached = indexes.get(url);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Search index unavailable (${response.status})`);
    const data = await response.json();
    const db = create({ schema: searchSchema, language: data.language });
    load(db, data);
    return db;
  })().catch((error) => {
    indexes.delete(url);
    throw error;
  });
  indexes.set(url, pending);
  return pending;
}

export async function searchSite(
  url: string,
  term: string,
  limit: number,
): Promise<SearchResult[]> {
  const db = await loadSearchIndex(url);
  const results = await search(db, {
    term,
    properties: ['title', 'content'],
    boost: { title: 2 },
    limit,
  });
  return results.hits.map(({ document }) => document);
}
