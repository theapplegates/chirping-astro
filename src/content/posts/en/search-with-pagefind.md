---
title: 'Search with OramaJS: instant, static, and fully offline'
description: 'How the bundled OramaJS search works — modal vs full-page UX, indexing rules, keyboard shortcuts, locale filtering and customisation hooks.'
pubDate: 2026-04-23
tags: [search, orama, performance]
categories: [Tutorials]
translationKey: search-with-pagefind
toc: true
---

Search is powered by [OramaJS](https://orama.com/products/oramajs), running
entirely in your browser. No account, API key, or search server is required.

## Try it

Open search with the header button, `/`, or `Cmd/Ctrl+K`. Type `Astro` or
`search` and notice the highlighted terms in result titles and excerpts.
Use the arrow keys and Enter to open a result. The dedicated search page
also accepts `?q=Astro` to prefill a query.

## Build the index

```sh
bun run build
bun run preview
```

The build runs Astro and then `bun run search:index`. The indexer extracts
rendered HTML from posts and pages (including MDX), excluding drafts, unlisted
posts, navigation, and comments. It writes language-specific indexes to
`dist/_orama/`. In dev, the index from the most recent build is served, so run
a build before using search and rebuild after content changes.

## Customise search

`src/utils/search.ts` loads the current language's index on demand and boosts
title matches. `src/utils/search-text.ts` exports `highlightSearchTerm(text, term)`
and `createExcerpt(text, term)`. Highlighting escapes all content before adding
`<mark>` elements, and excerpts show context around the first match.

The article layouts use `data-search-document` and `data-search-content`.
Exclude a region using `data-search-ignore`; existing `data-pagefind-ignore`
attributes remain supported. Adjust result markup in `SearchButton.astro` and
`search.astro`, and highlight colours in `src/styles/global.css`.

English and French are indexed separately with their respective tokenizers.
Result links retain the configured base path for GitHub Pages deployments.
