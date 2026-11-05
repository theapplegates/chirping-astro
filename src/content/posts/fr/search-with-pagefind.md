---
title: 'Recherche avec OramaJS : instantanée, statique et entièrement hors-ligne'
description: "Comment fonctionne la recherche OramaJS embarquée — modale vs page complète, règles d'indexation, raccourcis clavier, filtrage par locale et personnalisation."
pubDate: 2026-04-23
tags: [recherche, orama, performance]
categories: [Tutoriels]
translationKey: search-with-pagefind

toc: true
---

La recherche utilise [OramaJS](https://orama.com/products/oramajs) directement
dans votre navigateur, sans compte, clé API ou serveur de recherche.

## Essayer la recherche

Ouvrez la recherche avec le bouton du bandeau, `/` ou `Cmd/Ctrl+K`.
Saisissez `Astro` : les termes sont surlignés dans les titres et les extraits.
Les flèches sélectionnent un résultat et Entrée ouvre le lien. La page de
recherche accepte aussi `?q=Astro`.

## Générer les index

```sh
bun run build
bun run preview
```

Le build exécute Astro puis `bun run search:index`. Les index par langue sont
écrits dans `dist/_orama/`. Les articles et pages sont extraits du HTML rendu,
y compris MDX. Les brouillons, articles non répertoriés, menus et commentaires
sont exclus. La recherche nécessite un build et ne fonctionne pas en mode dev.

## Personnalisation

`src/utils/search.ts` charge l'index à la demande et favorise les titres.
`src/utils/search-text.ts` fournit `highlightSearchTerm(text, term)` et
`createExcerpt(text, term)`. Le contenu est échappé avant l'ajout des balises
`<mark>`. Les extraits montrent le contexte de la première correspondance.

Les layouts utilisent `data-search-document` et `data-search-content`.
Ajoutez `data-search-ignore` pour exclure une région ; les attributs existants
`data-pagefind-ignore` sont également reconnus. Le rendu est personnalisable
dans `SearchButton.astro` et `search.astro`, les couleurs dans `global.css`.

Les index anglais et français utilisent leurs tokenizers respectifs.
Les liens conservent le chemin de base du déploiement GitHub Pages.
