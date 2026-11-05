/** Shared by the build-time indexer and lazy browser search client. */
export const searchSchema = {
  title: 'string',
  content: 'string',
  url: 'string',
} as const;

export interface SearchResult {
  title: string;
  content: string;
  url: string;
}
